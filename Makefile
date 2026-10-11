resume ?=
COMPOSE = docker compose

# Resolved version of the Claude CLI baked into the image. `make start` looks up
# the latest published version and writes it here; the Dockerfile installs that
# exact version, so the layer stays cached until a new release appears.
CLAUDE_VERSION_FILE = .claude-code-version

# Git author for commits made inside the container. Read from the host's git
# config unless already set in the environment.
GIT_USER_NAME ?= $(shell git config user.name)
GIT_USER_EMAIL ?= $(shell git config user.email)

define CLAUDE_CONFIG
{"includeCoAuthoredBy":false}
endef

define TS_CLAUDE_LSP
{"name":"village-lsp","version":"1.0.0","lspServers":{"typescript":{"command":"typescript-language-server","args":["--stdio"],"extensionToLanguage":{".ts":"typescript",".tsx":"typescriptreact",".js":"javascript",".jsx":"javascriptreact"}}}}
endef

AGENT_ENV_ARGS = \
	-e CLAUDE_CODE_OAUTH_TOKEN=$(CLAUDE_CODE_OAUTH_TOKEN) \
	-e CLAUDE_CODE_ENABLE_TELEMETRY=0 \
	-e AUTHOR_EMAIL=$(AUTHOR_EMAIL) \
	-e "GIT_USER_NAME=$(GIT_USER_NAME)" \
	-e "GIT_USER_EMAIL=$(GIT_USER_EMAIL)"

# Shared bootstrap: ensure local bins are on PATH and configure git author.
define GIT_SETUP
	export PATH="$$HOME/.local/bin:$$PATH" && \
	if [ -f "$$HOME/.gitconfig-host" ]; then git config --global include.path "$$HOME/.gitconfig-host"; fi && \
	if [ -n "$$GIT_USER_NAME" ]; then git config --global user.name "$$GIT_USER_NAME"; fi && \
	if [ -n "$$GIT_USER_EMAIL" ]; then git config --global user.email "$$GIT_USER_EMAIL"; fi && \
	if [ -z "$$GIT_USER_NAME" ] && [ -z "$$GIT_USER_EMAIL" ]; then \
		printf "\033[0;33mWarning: Could not determine git author. Set user.name/user.email in git config on your host.\033[0m\n"; \
	fi
endef

define CLAUDE_INIT
	mkdir -p $$HOME/.claude/lsp-plugin/.claude-plugin && \
	echo '"'"'$(CLAUDE_CONFIG)'"'"' > $$HOME/.claude/settings.json && \
	echo '"'"'$(TS_CLAUDE_LSP)'"'"' > $$HOME/.claude/lsp-plugin/.claude-plugin/plugin.json && \
	CJ="$$HOME/.claude.json"; [ -s "$$CJ" ] || echo "{}" > "$$CJ"; \
	if command -v jq >/dev/null 2>&1; then \
		VER=$$(claude --version 2>/dev/null | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1); \
		jq --arg v "$$VER" --arg pwd "$$PWD" '"'"'. + {hasCompletedOnboarding:true,theme:"dark",bypassPermissionsModeAccepted:true} + (if $$v=="" then {} else {lastOnboardingVersion:$$v} end) | .projects[$$pwd] = ((.projects[$$pwd] // {}) + {hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true})'"'"' "$$CJ" > "$$CJ.tmp" && mv "$$CJ.tmp" "$$CJ"; \
	else \
		echo '"'"'{"hasCompletedOnboarding":true,"theme":"dark","bypassPermissionsModeAccepted":true,"projects":{"/app":{"hasTrustDialogAccepted":true,"hasCompletedProjectOnboarding":true}}}'"'"' > "$$CJ"; \
	fi && \
	$(GIT_SETUP) && \
	$(if $(COPILOT_VERSION),claude --version,claude --model opus --dangerously-skip-permissions --plugin-dir $$HOME/.claude/lsp-plugin$(if $(resume), --continue))
endef

define LAUNCH_CLAUDE
	@$(COMPOSE) exec $(AGENT_ENV_ARGS) $(1) bash -c '$(CLAUDE_INIT)'
endef

.PHONY: start stop bash destroy ai build claude-version

# Resolve the latest published Claude CLI version and pin it to a file. Falls
# back to the previously pinned version (or "latest") when npm is unreachable.
claude-version:
	@V=$$(npm view @anthropic-ai/claude-code version 2>/dev/null | tr -d '[:space:]'); \
	if [ -z "$$V" ]; then \
		V=$$(cat $(CLAUDE_VERSION_FILE) 2>/dev/null | tr -d '[:space:]'); \
		if [ -n "$$V" ]; then \
			printf "\033[0;33mCould not reach npm, keeping pinned claude-code %s\033[0m\n" "$$V"; \
		else \
			V=latest; \
			printf "\033[0;33mCould not reach npm and no pin found, using claude-code 'latest'\033[0m\n"; \
		fi; \
	fi; \
	echo "$$V" > $(CLAUDE_VERSION_FILE); \
	printf "claude-code pinned to %s\n" "$$V"

start: stop claude-version
	CLAUDE_CODE_VERSION=$$(cat $(CLAUDE_VERSION_FILE)) $(COMPOSE) up -d --build --remove-orphans

stop:
	$(COMPOSE) down

bash:
	$(COMPOSE) exec -w /app chess bash

destroy:
	$(COMPOSE) down -v

ai:
	@echo "Starting claude for React..."
	$(call LAUNCH_CLAUDE,chess)
