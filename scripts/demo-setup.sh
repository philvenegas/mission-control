#!/usr/bin/env bash
# Start Postgres, create the roles and databases, migrate, seed and build. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "1/5 Environment"
if [ -f .env ]; then
  echo "  kept .env"
else
  cp .env.example .env
  echo "  copied .env.example to .env"
fi

step "2/5 Postgres"
if ! docker info >/dev/null 2>&1; then
  echo "  Docker is not running. Start Docker, then run pnpm demo:setup again." >&2
  exit 1
fi
docker compose up -d --wait --quiet-pull 2>&1 | sed 's/^/  /'
echo "  Postgres is up on port $(grep -E '^POSTGRES_PORT=' .env | cut -d= -f2)"

step "3/5 Roles, databases and migrations"
pnpm --silent --filter @mission-control/api db:bootstrap
pnpm --silent --filter @mission-control/api db:migrate

step "4/5 Seed"
pnpm --silent --filter @mission-control/api db:seed

step "5/5 Build"
pnpm --silent -r --reporter=silent build
echo "  built"

printf '\nReady. Run the tests with: pnpm test && pnpm test:int\n'
