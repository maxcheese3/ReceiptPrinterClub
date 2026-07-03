COMPOSE = docker compose -f docker-compose.dev.yml

.DEFAULT_GOAL := help

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

start: ## Start the full dev stack (server + frontend)
	$(COMPOSE) up -d

stop: ## Stop and remove dev containers
	$(COMPOSE) down

restart: stop start ## Restart the dev stack

build: ## Rebuild the frontend container image
	$(COMPOSE) build frontend

deploy: ## Rebuild and force-recreate the frontend container
	$(COMPOSE) up --build --force-recreate -d frontend

logs: ## Tail logs from all dev containers
	$(COMPOSE) logs -f

logs-frontend: ## Tail logs from the frontend container only
	$(COMPOSE) logs -f frontend

.PHONY: help start stop restart build deploy logs logs-frontend
