#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
COOKIE_FILE="${COOKIE_FILE:-/tmp/spaza-admin-test.cookies}"
STAMP="$(date +%s)"
EMAIL="admin-provision-test-${STAMP}@example.com"

command -v curl >/dev/null || { echo "curl is required"; exit 1; }
command -v jq >/dev/null || { echo "jq is required. Install it with: sudo apt install -y jq"; exit 1; }
read -r -p "Admin email: " ADMIN_EMAIL
read -r -s -p "Admin password: " ADMIN_PASSWORD
echo
rm -f "$COOKIE_FILE"

login="$(curl -sS -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' -c "$COOKIE_FILE" \
  -d "$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{email:$email,password:$password}')")"
echo "$login" | jq -e '.user.role == "ADMIN"' >/dev/null || { echo "Sign-in failed or this account is not an Admin."; exit 1; }
me="$(curl -sS "$BASE_URL/api/auth/me" -b "$COOKIE_FILE")"
ADMIN_ID="$(echo "$me" | jq -r '.user.id')"
curl -sS "$BASE_URL/api/users" -b "$COOKIE_FILE" | jq -e '.users | type == "array"' >/dev/null

created="$(curl -sS -X POST "$BASE_URL/api/users" -H 'Content-Type: application/json' -b "$COOKIE_FILE" \
  -d "$(jq -n --arg name "Admin Provision Test $STAMP" --arg email "$EMAIL" '{fullName:$name,email:$email,password:"TemporaryTestPassword123!",role:"CUSTOMER"}')")"
echo "$created" | jq '{user: {id: .user.id, email: .user.email, role: .user.role, active: .user.active}}'
echo "$created" | jq -e '.user.role == "CUSTOMER" and .user.active == true' >/dev/null || { echo "Admin could not provision the test account."; exit 1; }
USER_ID="$(echo "$created" | jq -r '.user.id')"

updated="$(curl -sS -X PATCH "$BASE_URL/api/users/$USER_ID" -H 'Content-Type: application/json' -b "$COOKIE_FILE" \
  -d '{"role":"MANAGER","active":false}')"
echo "$updated" | jq -e '.user.role == "MANAGER" and .user.active == false' >/dev/null || { echo "Role/status update failed."; exit 1; }

restored="$(curl -sS -X PATCH "$BASE_URL/api/users/$USER_ID" -H 'Content-Type: application/json' -b "$COOKIE_FILE" \
  -d '{"role":"CUSTOMER","active":true}')"
echo "$restored" | jq -e '.user.role == "CUSTOMER" and .user.active == true' >/dev/null || { echo "Test account restore failed."; exit 1; }

self_status="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$BASE_URL/api/users/$ADMIN_ID" \
  -H 'Content-Type: application/json' -b "$COOKIE_FILE" -d '{"role":"CUSTOMER"}')"
[[ "$self_status" == "400" ]] || { echo "Admin self-demotion should be rejected (expected 400, got $self_status)."; exit 1; }
curl -sS -X POST "$BASE_URL/api/auth/logout" -b "$COOKIE_FILE" >/dev/null
echo "Admin provisioning smoke test completed. Test account: $EMAIL"
