# Spaza Intelligence Database

This package creates a PostgreSQL database for a spaza-shop and small-retail management system.

It includes tables for:

- Shops and users
- Categories and products
- Suppliers and purchases
- Sales, sale items, and payments
- Stock movement history
- Expenses
- Customers and customer accounts
- Audit logs

## Requirements

Choose one of these methods:

### Option A: Docker

Install Docker Desktop on Windows or Docker Engine plus Docker Compose on Ubuntu.

### Option B: Local PostgreSQL

Install PostgreSQL 15 or newer and use the `psql` commands in this file.

## Option A: Run with Docker

Open a terminal or CMD in this folder and run:

```bash
docker compose up -d
```

Check the database container:

```bash
docker compose ps
```

Open PostgreSQL:

```bash
docker compose exec db psql -U spaza_user -d spaza_db
```

Exit PostgreSQL:

```sql
\q
```

Stop the database without deleting data:

```bash
docker compose stop
```

Stop and remove the container but keep the database volume:

```bash
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to delete the database volume and all stored data.

## Ubuntu commands

```bash
cd spaza_intelligence_db
cp .env.example .env
docker compose up -d
docker compose ps
docker compose logs -f db
```

If Docker requires `sudo` on your Ubuntu installation, use `sudo docker compose` instead.

## Windows CMD commands

```cmd
cd spaza_intelligence_db
copy .env.example .env
docker compose up -d
docker compose ps
docker compose logs -f db
```

## Connect from your application

Use these values in your API `.env` file:

```env
DATABASE_URL=postgresql://spaza_user:spaza_password@localhost:5433/spaza_db
```

The database is exposed on host port `5433` to avoid conflicting with another PostgreSQL installation. Inside Docker Compose, the database hostname is `db` and the port is `5432`:

```env
DATABASE_URL=postgresql://spaza_user:spaza_password@db:5432/spaza_db
```

## Local PostgreSQL without Docker

Create a database and run the schema:

```bash
createdb spaza_db
psql -d spaza_db -f db/init/001_schema.sql
psql -d spaza_db -f db/init/002_seed.sql
```

On Windows CMD, the same commands work if PostgreSQL's `bin` directory is in your PATH:

```cmd
createdb spaza_db
psql -d spaza_db -f db\init\001_schema.sql
psql -d spaza_db -f db\init\002_seed.sql
```

## Default sample login

The seed file creates a sample owner record for demonstration only:

```text
Email: owner@example.com
Password: not-a-real-password
```

The password value is not a usable password hash. Your application must create real users using bcrypt or another secure password-hashing library. Change or remove the sample account before production use.

## Verify the database

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT * FROM shops;
SELECT * FROM products;
```

## Backup and restore

Backup with Docker:

```bash
docker compose exec -T db pg_dump -U spaza_user -d spaza_db > spaza_backup.sql
```

Restore into the running database:

```bash
docker compose exec -T db psql -U spaza_user -d spaza_db < spaza_backup.sql
```

## Important rules

- Do not commit `.env` files containing real passwords.
- Do not use `docker compose down -v` unless you want to delete all database data.
- Completed sales should not be deleted; use returns or adjustments.
- Every stock change should create a `stock_movements` record.
- Use database transactions when recording a sale or purchase.
- Use server-side authorization so one shop cannot read another shop's data.
