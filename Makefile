COMPOSE = docker compose

.PHONY: start stop bash destroy build

start: ai-setup-update stop
	$(COMPOSE) up -d --build --remove-orphans

stop:
	$(COMPOSE) down

bash:
	$(COMPOSE) exec -w /app chess bash

destroy:
	$(COMPOSE) down -v

## ai-setup START
# Shared Claude Code sandbox: https://github.com/Veragin/ai-setup (managed by its init.md)
AI_SERVICE = chess
AI_SETUP_REPO ?= git@github.com:Veragin/ai-setup.git
include .ai/setup/ai-setup.mk
.ai/setup/ai-setup.mk:
	git clone $(AI_SETUP_REPO) .ai/setup
## ai-setup END
