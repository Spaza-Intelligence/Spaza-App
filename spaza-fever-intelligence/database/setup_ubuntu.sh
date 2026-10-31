#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Engine first."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

docker compose up -d
echo
echo "Database status:"
docker compose ps
echo
echo "Connect with:"
echo "docker compose exec db psql -U spaza_user -d spaza_db"
