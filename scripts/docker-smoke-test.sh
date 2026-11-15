#!/usr/bin/env bash
# Starts the built images the way docker-compose.yml does (migrator, then app, on one
# SQLite volume) and checks that the app serves a page and answers a database-backed
# request.
#
#   bash scripts/docker-smoke-test.sh <app-image> <migrator-image> [host-port]
set -euo pipefail

APP_IMAGE=${1:?usage: docker-smoke-test.sh <app-image> <migrator-image> [host-port]}
MIGRATOR_IMAGE=${2:?usage: docker-smoke-test.sh <app-image> <migrator-image> [host-port]}
PORT=${3:-3999}
RUN_ID="opm-smoke-$$"
VOLUME="$RUN_ID-data"
LOG_FILE=$(mktemp)
BASE_URL="http://127.0.0.1:$PORT"
LOGS_PID=""

cleanup() {
  [ -n "$LOGS_PID" ] && kill "$LOGS_PID" 2>/dev/null || true
  docker rm -f "$RUN_ID-app" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  echo "--- app container log ---" >&2
  cat "$LOG_FILE" >&2
  exit 1
}

docker volume create "$VOLUME" >/dev/null

echo "Applying migrations with $MIGRATOR_IMAGE"
docker run --rm --name "$RUN_ID-migrate" \
  -e DATABASE_URL=file:/app/data/dev.db \
  -v "$VOLUME:/app/data" \
  "$MIGRATOR_IMAGE"

echo "Starting $APP_IMAGE on $BASE_URL"
docker run -d --name "$RUN_ID-app" \
  -p "127.0.0.1:$PORT:3000" \
  -e DATABASE_URL=file:/app/data/dev.db \
  -e UPLOADS_DIR=/app/data/attachments \
  -e JWT_SECRET="smoke-test-$(date +%s)-$RANDOM-not-a-real-secret" \
  -v "$VOLUME:/app/data" \
  "$APP_IMAGE" >/dev/null
docker logs -f "$RUN_ID-app" >"$LOG_FILE" 2>&1 &
LOGS_PID=$!

status=""
for _ in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/login" || true)
  [ "$status" = "200" ] && break
  [ "$(docker inspect -f '{{.State.Running}}' "$RUN_ID-app" 2>/dev/null)" = "true" ] || fail "the app container exited before serving /login"
  sleep 1
done
[ "$status" = "200" ] || fail "GET /login returned '$status' after 60s"
echo "GET /login: 200"

# A well-formed login for an account that doesn't exist passes validation and the rate
# limit, so a 401 means the app reached the database. A broken driver answers 500.
body=$(mktemp)
status=$(curl -s -o "$body" -w '%{http_code}' -X POST "$BASE_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"email":"smoke-test@example.com","password":"not-the-password"}')
response=$(cat "$body")
rm -f "$body"
[ "$status" = "401" ] || fail "POST /api/v1/auth/login returned $status, expected 401: $response"
echo "POST /api/v1/auth/login (unknown account): 401"

echo "Container smoke test passed."
