# Mission Control — common commands. Run `make` or `make help` to list them.
# Each target wraps a pnpm script or a Docker command, so either form works.

.DEFAULT_GOAL := help
.PHONY: help install setup reset api build lint check test test-int test-all test-watch coverage \
        db-up db-down db-logs db-migrate db-generate db-seed db-psql db-destroy

API := pnpm --silent --filter @mission-control/api

# The database addresses, once `make setup` has copied .env.example to .env.
-include .env

help: ## List the available commands
	@awk 'BEGIN {FS = ":.*## "} \
	  /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} \
	  /^[a-z-]+:.*## / {printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

##@ Getting started

install: ## Install dependencies
	pnpm install

setup: ## Start Postgres, create roles and databases, migrate, seed and build (safe to repeat)
	pnpm demo:setup

reset: ## Wipe and reseed the demo data
	pnpm demo:reset

api: ## Run the API (http://localhost:3000 unless PORT in .env says otherwise)
	pnpm api

##@ Code

build: ## Typecheck every package
	pnpm build

lint: ## Lint (casts, non-null assertions) and find unused exports, files and dependencies
	pnpm lint

check: lint build test test-int ## Lint, typecheck, then run every test

##@ Tests

test: ## Unit tests; no database needed
	pnpm test

test-int: ## Integration tests, against the test database (needs Postgres up)
	pnpm test:int

test-all: test test-int ## Unit and integration tests

test-watch: ## Unit tests, rerun on change
	pnpm exec vitest --project unit

coverage: ## Unit and integration tests, with each file's uncovered lines (needs Postgres up)
	pnpm test:coverage

##@ Database

db-up: ## Start Postgres in Docker (host port 54329)
	docker compose up -d --wait

db-down: ## Stop Postgres; the data is kept
	docker compose down

db-logs: ## Follow the Postgres logs
	docker compose logs -f postgres

db-migrate: ## Run the migrations as the owner role
	$(API) db:migrate

db-generate: ## Generate a migration after changing the schema
	$(API) db:generate

db-seed: ## Wipe and reseed (the same as `make reset`)
	$(API) db:seed

db-psql: ## Open psql on the development database, as the owner role
	docker compose exec postgres psql "$(subst localhost:$(POSTGRES_PORT),localhost:5432,$(DATABASE_OWNER_URL))"

db-destroy: ## Stop Postgres and DELETE its data volume
	docker compose down -v
