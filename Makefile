PROFILE ?= acme
COMPOSE = docker compose -f deploy/compose.yaml --env-file deploy/dev.env
export CARGO_TERM_COLOR = always

.PHONY: demo demo-down smoke local seed profile test eval ui replay check

## Full stack with Keycloak in Docker (PROFILE=acme|devteam)
demo:
	PROFILE=$(PROFILE) $(COMPOSE) up --build -d
	@echo "assistant http://localhost:8000  keycloak http://localhost:8080  phoenix http://localhost:6006"

demo-down:
	$(COMPOSE) down -v

smoke:
	REALM=$(PROFILE) deploy/smoke.sh

## Everything in one process, no Docker, no API key
local: ui
	cargo run --release -p steward -- demo --profile profiles/$(PROFILE)

ui:
	cd ui && npm ci && npm run build

## Regenerate profile data and generated files
seed:
	cd seed && uv run steward-seed --profile ../profiles/$(PROFILE)

profile:
	cargo run -q -p steward -- profile generate --profile profiles/$(PROFILE)
	cargo run -q -p steward -- profile deploy --profile profiles/$(PROFILE) --out deploy/$(PROFILE)

## Tests and gates
test:
	cargo test --workspace
	cd seed && uv run pytest -q
	cd ui && npm test

replay:
	cargo run -q -p steward -- replay --profile profiles/$(PROFILE)

eval:
	cd eval && uv run steward-eval --base http://localhost:8000 --profile ../profiles/$(PROFILE) --gate --report report.md

check:
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings
	cd seed && uv run steward-seed --profile ../profiles/$(PROFILE) --check
	cargo run -q -p steward -- profile check --profile profiles/$(PROFILE)
