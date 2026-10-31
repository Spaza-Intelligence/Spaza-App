@echo off
setlocal
if not exist .env copy .env.example .env
docker compose up -d
echo.
echo Database status:
docker compose ps
echo.
echo Connect with:
echo docker compose exec db psql -U spaza_user -d spaza_db
endlocal
