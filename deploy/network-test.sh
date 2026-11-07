#!/usr/bin/env bash
# Network isolation of the compose stack: who can open a connection to whom.
#   docker compose -f deploy/compose.yaml --env-file deploy/dev.env up -d --build && deploy/network-test.sh
#
# The MCP servers sit on `tools`, an internal network: only the Warden gateway (and the token
# service, for JWKS) is attached to it. Everything else, the assistant and its sub-agents
# included, must fail to even connect, whatever token it holds. And nothing on `tools` can
# reach the outside world. Authorization is tested by smoke.sh; this is the layer below it.
set -uo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -f compose.yaml --env-file dev.env"
pass=0; fail=0

# HTTP status of FROM → URL, or 000 if no connection could be made (DNS, refused, timeout).
probe() { $COMPOSE exec -T "$1" curl -s -o /dev/null --max-time 4 -w '%{http_code}' "$2" 2>/dev/null | tr -dc '0-9' | sed 's/^$/000/'; }

blocked() {
  local code; code=$(probe "$1" "$2")
  if [ "$code" = "000" ]; then echo "  ✓ $1 ✗→ $2"; pass=$((pass+1)); else echo "  ✗ $1 reached $2 (HTTP $code)"; fail=$((fail+1)); fi
}
reaches() {
  local code; code=$(probe "$1" "$2")
  if [ "$code" != "000" ]; then echo "  ✓ $1 → $2 (HTTP $code)"; pass=$((pass+1)); else echo "  ✗ $1 cannot reach $2"; fail=$((fail+1)); fi
}

echo "MCP servers: only the gateway gets through"
reaches gateway        http://mcp:8100/health
for from in steward agent-research agent-action a2a-research a2a-action; do
  blocked "$from" http://mcp:8100/health
done

echo "The tools network has no way out"
blocked mcp http://steward:8000/health
blocked mcp http://keycloak:8080/
blocked mcp https://example.com/

echo "The assistant's own paths work"
reaches steward http://gateway:8088/mcp
reaches steward http://a2a-research:9500/
reaches steward http://a2a-action:9500/

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
