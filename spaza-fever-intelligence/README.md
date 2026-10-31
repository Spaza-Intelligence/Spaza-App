# Spaza FEVER Intelligence

A standalone retail management system for spaza shops and small retailers, backed by PostgreSQL.

## Accounts and access

Public registration always creates a **Customer** account; any role submitted by a browser or API caller is ignored. Managers and Admins must be provisioned by an authenticated Admin. Each user can manage personal API keys from the **API keys** menu. Keys inherit the account's role and shop restrictions.

## Run on Ubuntu or WSL

Requirements: Docker Engine or Docker Desktop with WSL integration. Node.js 20+, pnpm, `curl`, and `jq` are needed only if you also run checks from the Ubuntu host.

```bash
cd spaza-fever-intelligence
cp .env.example .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d --build
docker compose ps
```

Compose starts PostgreSQL (`db`), the Express API (`api`), and the Vite/React frontend (`frontend`). Open `http://localhost:5173`; the API health check is at `http://localhost:3001/api/health`. View startup logs with `docker compose logs -f db api frontend` and leave the stack running while using the site.

The first PostgreSQL start initializes the schema and demo shop. For an existing Docker database, apply any newly added migration once from the project root. The API-key migration is:

```bash
docker compose exec -T db psql -U spaza_user -d spaza_db < database/init/003_api_keys.sql
```

If credentials differ, use the values from `.env`. Do not use `docker compose down -v` unless you intend to delete the local database volume.

### Create the first Admin

The demo owner seeded into a fresh database has a deliberately unusable password. Create the initial trusted Admin through the bootstrap CLI in the API container; it requires an interactive terminal and only succeeds when there is no active Admin account:

```bash
docker compose exec api pnpm bootstrap:admin
```

The CLI securely prompts for the name, email, and a password of at least 12 characters. On a fresh database it replaces the unusable demo-owner password and assigns that account the Admin role. On a database without the placeholder owner, it creates a new Admin in the first active shop. It refuses if an active Admin already exists.

Before upgrading an existing installation for production, review all existing Manager/Admin accounts and revoke any API keys that may have been issued to untrusted accounts. Older versions allowed public sign-up to choose a privileged role; this update secures new registrations but does not silently change existing account roles. If a trusted Admin already exists, use it to audit **Users & shops** rather than bypassing the bootstrap check.

Sign in at `http://localhost:5173`. In **Users & shops**, the Admin can create Customer, Manager, and Admin accounts, set initial passwords, change roles, and deactivate/reactivate shop members. Share initial passwords privately; each member should sign in and change their password from **API keys → Account security**. The shop must retain at least one active Admin. Public sign-up remains Customer-only.

For a host-based development alternative, start only PostgreSQL with Compose, install dependencies on Ubuntu, then run the frontend and API together with:

```bash
docker compose up -d db
pnpm install --frozen-lockfile
pnpm dev
```

Port `3000` is intentionally left untouched for the user's SLMS system. Stop the full stack while preserving database data with `docker compose down`; never add `-v` unless you intentionally want to delete the database volume.

## API keys

After signing in, choose **API keys**, create a named key, and copy the secret immediately; it is shown only once. Store it in a password manager or local environment variable, not in source code. Use HTTPS and restrict network exposure outside local development. See [API.md](API.md) for endpoints and security behavior.

## Database connection

The default `.env` connection is:

```env
DATABASE_URL=postgresql://spaza_user:spaza_password@127.0.0.1:5433/spaza_db
```

The source-of-truth schema and migrations are in `database/`. Do not commit `.env` or real credentials.

## Capstone database design

The project includes a capstone-ready database design based on the running application and its 17 PostgreSQL tables. Open the editable [Word design document](docs/Capstone_Database_Design.docx) or its [Markdown source](docs/Capstone_Database_Design.md). The [ERD overview](docs/Spaza_FEVER_ERD.png) and three focused, editable Mermaid diagrams are in `docs/`.

The document covers the problem statement, target users, business processes, functional requirements, entities and attributes, keys, relationships, ER diagrams, draft table design, 10 business questions, example SQL queries, and a verification matrix. It separates implemented functionality from known UI/API gaps and recommended schema improvements.

## Checks

```bash
docker compose exec api pnpm check
docker compose exec api pnpm build
./scripts/test-api.sh
# Optional: sign in as an Admin and test team account provisioning
./scripts/test-admin-provisioning.sh
```
