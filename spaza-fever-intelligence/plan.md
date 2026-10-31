# Spaza FEVER Intelligence implementation plan

## Goal
Build a standalone PostgreSQL-backed retail management app around the uploaded `spaza_intelligence_db` schema. The application must start with an email/password login gate, enforce role-aware access, and present distinct Customer, Manager, and Admin workspaces.

## Database approach
Reuse the uploaded SQL schema and seed data as the source of truth. The app connects with `pg` using `DATABASE_URL`; database initialization remains owned by Docker Compose under `database/init`. Application queries use parameterized SQL and shop scoping through `shop_users`.

## Backend approach
Use Express with local password authentication using `node:crypto` scrypt, signed HTTP-only session cookies, and role checks. Add routes for authentication, dashboard metrics, products, sales, low-stock products, users, and the AI assistant. The AI endpoint uses an optional OpenAI-compatible provider when configured and has a useful database-aware fallback when no AI key is present.

## Frontend approach
Use the existing React/Vite client and Pick n Pay-inspired palette: deep blue, vivid red, and warm yellow. Build a login/register gate, then a shell with role-specific navigation. Customers see a browse-and-cart ordering view; managers see sales, products, stock alerts, and quick actions; admins see shop health, users, audit visibility, and system metrics. Keep browser-facing API URLs relative.

## Project structure
- `client/src/main.tsx`: login gate, role workspaces, dashboard views, and API client.
- `client/src/styles.css`: responsive brand system and dashboard layout.
- `server/index.ts`: Express server, sessions, auth, reporting, products, sales, and AI routes.
- `server/db/schema.ts`: TypeScript representation of the uploaded schema's core users and shop tables.
- `database/init/`: uploaded database schema and seed SQL copied into the application bundle.
- `shared/types.ts`: shared role and API types.

## Build workflow
Run `docker compose up -d`, install dependencies with `pnpm install`, initialize the database from Docker's init scripts, and start with `pnpm dev`. Validate with `pnpm check` and `pnpm build`. Keep secrets in `.env`, never in the repository.

## Design
Three possible directions: Market Ledger — probability 0.06; Countertop Command — probability 0.04; Blue Flame Retail — probability 0.08. Chosen: **Countertop Command**.

- **Design movement:** modern South African convenience-retail operations dashboard with bold supermarket signage and compact till-counter utility.
- **Core principles:** fast scanning, clear hierarchy, trustworthy numbers, friendly human language.
- **Color philosophy:** deep blue anchors trust and operational focus; red marks urgency and action; yellow signals value and momentum; off-white keeps dense data calm.
- **Layout paradigm:** persistent left rail and a wide working canvas with a narrow context panel for alerts and AI guidance, avoiding a centered marketing-card composition.
- **Signature elements:** clipped-corner action tiles, receipt-like metric strips, and a small flame mark used as a status indicator.
- **Interaction philosophy:** every action shows its operational consequence; low-stock items are visible before users need to search.
- **Animation:** subtle 160ms hover lifts, gentle count-in for metrics, and no distracting perpetual motion.
- **Typography system:** Inter/system sans for UI, bold condensed-looking uppercase labels through letter spacing, and tabular numbers for money and stock.
- **Brand essence:** the practical intelligence layer for independent spaza retailers; personality: alert, capable, local.
- **Brand voice:** direct, encouraging, operational. Example lines: “Know what moved today.” and “Bread is below the shelf line — reorder before the rush.”
- **Wordmark & logo:** SF monogram inside a rounded flame-shaped badge, paired with the compact wordmark “Spaza FEVER”.
- **Signature brand color:** FEVER red `#e31837`.
