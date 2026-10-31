# Delivery outcomes

## Database integration
- [x] The project uses the uploaded PostgreSQL schema as its source of truth, including shops, users, shop memberships, categories, suppliers, products, purchases, sales, payments, stock movements, expenses, customers, customer accounts, and audit logs.
- [x] Docker Compose starts PostgreSQL with the uploaded schema and seed SQL, and the API reads `DATABASE_URL` from `.env`.

## Local authentication and access
- [x] The first page is an email/password login gate with a create-account option.
- [x] Passwords are hashed with `node:crypto` scrypt and are never stored or compared as plaintext.
- [x] Sessions are HTTP-only and role-aware; user data is scoped to shops through `shop_users`.
- [x] Customer, Manager, and Admin users reach distinct role-specific menus after signing in.

## Working retail interface
- [x] Customers can browse products, add quantities to a cart, and submit an order.
- [x] Managers can see sales totals, product counts, low-stock alerts, and inventory/product actions.
- [x] Admins can see shop and user health plus audit-oriented information.
- [x] The interface uses the Spaza FEVER / Pick n Pay-inspired blue, red, and yellow palette and is responsive.

## AI assistant
- [x] The app includes an AI assistant panel that answers questions using current shop metrics and product/stock context.
- [x] The assistant has a deterministic database-aware fallback when no external AI provider is configured.

## Validation and handoff
- [x] `pnpm check` passes.
- [x] `pnpm build` passes.
- [x] The final ZIP excludes secrets, installed dependencies, and generated build output, and includes Ubuntu/WSL setup instructions.


## Validation note

The TypeScript check, frontend build, backend build, and server startup were verified in the development environment. Docker is not installed in the current sandbox, so PostgreSQL container startup must be verified on the user’s Ubuntu/WSL machine with Docker available.

## Personal API keys
- [x] Signed-in users can create up to 10 named keys for their current shop, optionally expiring within 365 days.
- [x] Secrets are shown only at creation and only SHA-256 hashes are stored in PostgreSQL.
- [x] Bearer authentication preserves the user's role permissions and shop boundary; keys cannot manage other keys.
- [x] Users can list metadata and revoke their own keys from the application.
- [x] API documentation and smoke tests cover key creation, use, and revocation.
- [ ] Run the Docker/PostgreSQL smoke test on Ubuntu, since Docker is unavailable in this sandbox.

## Role registration and team provisioning hardening
- [x] Public registration ignores caller-supplied roles and creates Customer accounts only.
- [x] A local interactive bootstrap CLI safely creates the first Admin and replaces the demo owner's unusable password.
- [x] Admin-only, browser-session team endpoints create accounts and update roles/status within the current shop.
- [x] Self-demotion/deactivation and removal of the shop's last active Admin are blocked.
- [x] The Admin UI manages team roles and account status; members can change their own passwords.
- [x] Smoke tests cover role forgery, Customer restrictions, and Admin provisioning.
- [ ] Run database-backed smoke tests on Ubuntu/WSL before production use.
