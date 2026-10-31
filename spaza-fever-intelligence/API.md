# Spaza FEVER Intelligence API

The Express API runs at `http://localhost:3001`. Browser sign-in uses the HTTP-only `spaza_session` cookie. Programmatic clients can use an individual API key in `Authorization: Bearer <key>`. Browser requests should use relative `/api/...` URLs through the Vite proxy. Port `3000` is reserved for the user's SLMS system and is not touched by Spaza FEVER.

## Authentication and role assignment

`POST /api/auth/register` accepts `fullName`, `email`, and `password` (minimum 12 characters). It always creates a Customer (`CASHIER` in PostgreSQL) and ignores any `role` included in the request. `POST /api/auth/login` accepts `email` and `password`. `POST /api/auth/logout` clears the session. `GET /api/auth/me` returns the current browser-session user. Passwords are stored as scrypt hashes.

This rule affects new registrations only. Before upgrading an existing deployment, audit any Admin/Manager accounts created by earlier versions and revoke API keys belonging to untrusted accounts.

`POST /api/auth/change-password` requires a browser session and accepts `{ "currentPassword": "...", "newPassword": "..." }`; new passwords must be at least 12 characters.

In production, the server refuses to start without a `SESSION_SECRET` of at least 32 characters, and session cookies include the `Secure` attribute. Serve the app over HTTPS in production.

### Bootstrap the first Admin

From a trusted terminal connected to the local database, run `pnpm bootstrap:admin`. It interactively requests the Admin name, email, and password without echoing the password, then creates the first Admin in the first active shop. On a fresh database it reuses the demo Owner row with its deliberately unusable placeholder password. The command refuses if a real active Admin already exists. Do not expose an unauthenticated HTTP role-promotion or bootstrap endpoint.

### Admin-managed team accounts

These endpoints require a signed-in Admin browser session, not a Bearer API key. All provisioning is limited to the Admin's current shop. `POST /api/users` creates a new unique account and membership in that shop. `PATCH /api/users/:id` changes a member's role, active status, or both. The API does not allow Admins to remove their own Admin access, and it prevents removing/deactivating/demoting the last active Admin in the shop. Team account changes are written to the audit log.

Example creation request:

```json
{
  "fullName": "Sam Example",
  "email": "sam@example.com",
  "password": "a-long-unique-initial-password",
  "role": "MANAGER"
}
```

The Admin can view members using `GET /api/users`. In the app, open **Users & shops** to create members, change their roles, or deactivate/reactivate them. Share initial passwords through a private channel; the member should sign in and change the password from **API keys → Account security**. Never assign roles based on public form input.

## Individual API keys

Every signed-in user can create keys for their own integrations from **API keys** in the app, or with the cookie-authenticated API below. A key inherits the creator's current role permissions and is restricted to the creator's current shop. Key-management routes require the browser session; a Bearer key cannot create or revoke keys.

- `GET /api/api-keys` lists the signed-in user's key metadata (not secrets).
- `POST /api/api-keys` creates a key. Body: `{ "name": "Ubuntu integration", "expirationDays": 90 }`. Expiration may be omitted/null (no expiry), or be an integer from 1 to 365. Response includes `secret` exactly once; copy it immediately.
- `DELETE /api/api-keys/:id` revokes one of the signed-in user's active keys.

Keys are high-entropy random secrets. The database stores only a SHA-256 hash, plus a short prefix for identification; the full secret cannot be retrieved after creation. Each user may have up to 10 active keys per shop. Send the key in the HTTPS Authorization header, never in a URL, source code, or client-side/browser JavaScript:

```bash
curl http://localhost:3001/api/products \
  -H 'Authorization: Bearer YOUR_API_KEY'
```

Use HTTPS outside local development. Revoke a key immediately if it is lost or exposed. A key has the same access restrictions as its owning account; it does not grant additional permissions.

### Database migration

Fresh Docker databases load `database/init/003_api_keys.sql` automatically. If the PostgreSQL volume already existed before this migration was added, apply it once from the project root:

```bash
docker compose exec -T db psql -U spaza_user -d spaza_db < database/init/003_api_keys.sql
```

If you changed `POSTGRES_USER` or `POSTGRES_DB` in `.env`, substitute those values in the command.

## Core data endpoints

`GET /api/dashboard` returns shop metrics and low-stock alerts. `GET /api/products` lists active products. Managers and admins can use `POST /api/products` to create, `PATCH /api/products/:id` for partial updates, `PUT /api/products/:id` for full updates, and `DELETE /api/products/:id` to deactivate a product. Categories use `GET/POST /api/categories`; suppliers use `GET/POST /api/suppliers`.

`POST /api/orders` creates a transactional customer sale, payment, sale items, product stock decrement, and stock movement. Managers and admins can use `GET /api/sales`, `POST /api/purchases`, and `GET /api/stock/movements`.

`GET/POST /api/expenses` manages shop expenses. `GET/POST /api/customers` manages customer records. Admins can use `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, and `GET /api/audit-logs` with a browser session.

## Reports and assistant

`GET /api/reports/summary?days=30` returns daily revenue, best sellers, and expenses. `POST /api/ai/ask` accepts `{ "question": "..." }` and uses live shop metrics with an optional OpenAI-compatible provider configured through `.env`; without a key, it returns a deterministic database-aware answer. `GET /api/health` checks API and database availability.

All shop data queries are scoped to the authenticated user's shop membership. Manager and admin write operations use PostgreSQL transactions where stock or financial records are affected.

## Smoke testing

On Ubuntu/WSL, install `jq` once with `sudo apt install -y jq`, start Docker and the API, then run `./scripts/test-api.sh`. It verifies public signup cannot grant Admin privileges, Customer access restrictions, key creation/use/revocation, and logout. After bootstrapping an Admin, `./scripts/test-admin-provisioning.sh` exercises team account creation, role/status changes, and self-demotion protection. Set `BASE_URL=http://localhost:3001` if the API is hosted on another local port.
