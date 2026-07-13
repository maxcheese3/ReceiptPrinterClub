COMPOSE       = docker compose -f docker-compose.dev.yml
LOCAL_COMPOSE = docker compose -f docker-compose.local.yml

.DEFAULT_GOAL := help

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# ── Dev stack (server + frontend, frontend → production API) ────────────────

start: ## Start the full dev stack (server + frontend)
	$(COMPOSE) up -d

stop: ## Stop and remove dev containers
	$(COMPOSE) down

restart: stop start ## Restart the dev stack

build-frontend: ## Rebuild the frontend container image
	$(COMPOSE) build frontend

deploy-frontend: ## Rebuild and force-recreate the frontend container
	$(COMPOSE) up --build --force-recreate -d frontend

build-server: ## Rebuild the server container image
	$(COMPOSE) build server

deploy-server: ## Rebuild and force-recreate the server container
	$(COMPOSE) up --build --force-recreate -d server

logs: ## Tail logs from all dev containers
	$(COMPOSE) logs -f

logs-frontend: ## Tail logs from the frontend container only
	$(COMPOSE) logs -f frontend

logs-server: ## Tail logs from the server container only
	$(COMPOSE) logs -f server

# ── Local stack (server + frontend, frontend → local server) ────────────────

start-local: ## Start the local full stack (frontend hits local server)
	$(LOCAL_COMPOSE) up -d

stop-local: ## Stop and remove local containers
	$(LOCAL_COMPOSE) down

restart-local: stop-local start-local ## Restart the local full stack

build-local-server: ## Rebuild the server image in the local stack
	$(LOCAL_COMPOSE) build server

deploy-local-server: ## Rebuild and force-recreate the local server container
	$(LOCAL_COMPOSE) up --build --force-recreate -d server

logs-local: ## Tail logs from all local containers
	$(LOCAL_COMPOSE) logs -f

logs-local-frontend: ## Tail logs from the local frontend container
	$(LOCAL_COMPOSE) logs -f frontend

logs-local-server: ## Tail logs from the local server container
	$(LOCAL_COMPOSE) logs -f server

.PHONY: help \
        start stop restart \
        build-frontend deploy-frontend \
        build-server deploy-server \
        logs logs-frontend logs-server \
        start-local stop-local restart-local \
        build-local-server deploy-local-server \
        logs-local logs-local-frontend logs-local-server
