#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
COOKIE_FILE="${COOKIE_FILE:-/tmp/spaza-api-test.cookies}"
STAMP="$(date +%s)"
EMAIL="api-test-${STAMP}@example.com"
NAME="API Test Customer ${STAMP}"

command -v curl >/dev/null || { echo "curl is required"; exit 1; }
command -v jq >/dev/null || { echo "jq is required. Install it with: sudo apt install -y jq"; exit 1; }
rm -f "$COOKIE_FILE"

health="$(curl -sS "$BASE_URL/api/health")"
echo ">>> GET /api/health"
echo "$health" | jq .
echo "$health" | jq -e '.status == "ok" and .database == "connected"' >/dev/null || { echo "Database/API health check failed."; exit 1; }

register="$(curl -sS -X POST "$BASE_URL/api/auth/register" \
  -H 'Content-Type: application/json' -c "$COOKIE_FILE" \
  -d "$(jq -n --arg name "$NAME" --arg email "$EMAIL" '{fullName:$name,email:$email,password:"ApiTestPassword123!",role:"ADMIN"}')")"
echo ">>> POST /api/auth/register with a forged ADMIN role"
echo "$register" | jq .
echo "$register" | jq -e '.user.role == "CUSTOMER"' >/dev/null || { echo "Public registration improperly granted a privileged role."; exit 1; }

products="$(curl -sS -b "$COOKIE_FILE" "$BASE_URL/api/products")"
echo ">>> GET /api/products as Customer"
echo "$products" | jq -e '.products | type == "array"' >/dev/null || { echo "Customer product read failed."; exit 1; }

manager_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/categories" \
  -H 'Content-Type: application/json' -b "$COOKIE_FILE" -d '{"name":"Should Be Forbidden"}')"
[[ "$manager_status" == "403" ]] || { echo "Customer manager-write check expected 403, got $manager_status."; exit 1; }
user_admin_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/users" -b "$COOKIE_FILE")"
[[ "$user_admin_status" == "403" ]] || { echo "Customer user-management check expected 403, got $user_admin_status."; exit 1; }
provision_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/users" \
  -H 'Content-Type: application/json' -b "$COOKIE_FILE" \
  -d '{"fullName":"Forged Admin","email":"forged-admin@example.invalid","password":"NotARealPassword123!","role":"ADMIN"}')"
[[ "$provision_status" == "403" ]] || { echo "Customer team-provisioning check expected 403, got $provision_status."; exit 1; }

key_result="$(curl -sS -X POST "$BASE_URL/api/api-keys" -H 'Content-Type: application/json' -b "$COOKIE_FILE" \
  -d "$(jq -n --arg name "API smoke test $STAMP" '{name:$name,expirationDays:1}')")"
echo ">>> POST /api/api-keys"
echo "$key_result" | jq '{key, warning}'
API_KEY="$(echo "$key_result" | jq -r '.secret')"
API_KEY_ID="$(echo "$key_result" | jq -r '.key.id')"
[[ "$API_KEY" == spaza_* && -n "$API_KEY_ID" ]] || { echo "API key creation failed."; exit 1; }

key_dashboard="$(curl -sS -w '\n%{http_code}' "$BASE_URL/api/dashboard" -H "Authorization: Bearer $API_KEY")"
echo ">>> GET /api/dashboard using Bearer API key"
echo "$key_dashboard" | sed '$d' | jq '{user: .user.email, metrics}'
[[ "$(echo "$key_dashboard" | tail -n1)" == "200" ]] || { echo "Bearer API key was not accepted."; exit 1; }
key_management_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/api-keys" -H "Authorization: Bearer $API_KEY")"
[[ "$key_management_status" == "401" ]] || { echo "API keys must not manage other API keys (expected 401, got $key_management_status)."; exit 1; }

revoke="$(curl -sS -X DELETE "$BASE_URL/api/api-keys/$API_KEY_ID" -b "$COOKIE_FILE")"
echo ">>> DELETE /api/api-keys/$API_KEY_ID"
echo "$revoke" | jq -e '.ok == true' >/dev/null
revoked_status="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/dashboard" -H "Authorization: Bearer $API_KEY")"
[[ "$revoked_status" == "401" ]] || { echo "Revoked API key still worked (HTTP $revoked_status)."; exit 1; }

curl -sS -X POST "$BASE_URL/api/auth/logout" -b "$COOKIE_FILE" >/dev/null
echo "API smoke test completed successfully for $BASE_URL"
echo "Test account: $EMAIL"
