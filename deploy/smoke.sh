#!/usr/bin/env bash
# Smoke test of the compose stack: real Keycloak tokens through Steward and the Warden gateway.
#   docker compose -f deploy/compose.yaml --env-file deploy/dev.env up -d --build && deploy/smoke.sh
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -f compose.yaml --env-file dev.env"
BASE=http://localhost:8000
KC=http://localhost:8080/realms/${REALM:-acme}/protocol/openid-connect/token
pass=0; fail=0
ok()  { echo "  ✓ $1"; pass=$((pass+1)); }
bad() { echo "  ✗ $1"; fail=$((fail+1)); }

echo "waiting for the assistant…"
for _ in $(seq 1 120); do curl -sf "$BASE/health" >/dev/null && break; sleep 2; done

token() { curl -sf -d grant_type=password -d client_id=${CLIENT:-acme-bot} -d client_secret=dev-bot-secret -d "username=$1" -d "password=$1" -d scope=openid "$KC" | sed -E 's/.*"access_token":"([^"]+)".*/\1/'; }
chat() { curl -sfN -H "Authorization: Bearer $1" -H 'content-type: application/json' -d "{\"message\": \"$2\"}" "$BASE/api/chat"; }

SVEN=$(token sven); HANNA=$(token hanna); SARA=$(token sara); IVO=$(token ivo)
[ -n "$SVEN" ] && ok "Keycloak issues user tokens" || bad "Keycloak token"

me=$(curl -sf -H "Authorization: Bearer $SVEN" "$BASE/api/me")
echo "$me" | grep -q '"user":"sven"' && ok "the assistant verifies Keycloak tokens" || bad "/api/me: $me"
echo "$me" | grep -q 'hr.get_salary' && bad "sven is offered HR tools" || ok "tools are filtered per user"

out=$(chat "$SVEN" "Welche Deals habe ich in DACH?")
echo "$out" | grep -q '"tool":"crm.list_deals","ok":true' && ok "MCP call through gateway, token exchange and upstream verification" || bad "crm.list_deals: $out"

out=$(chat "$HANNA" "Was verdient Henrik Wagner?")
echo "$out" | grep -q 'keine Berechtigung' && ok "salary refused for an HR member" || bad "hanna: $out"

out=$(chat "$IVO" "WireGuard meldet handshake did not complete. Was soll ich tun?")
echo "$out" | grep -q '"type":"citation"' && ok "verified citation from the scanned PDF" || bad "citation: $out"

# Approval: Sven's 80k change waits for Sara in the inbox.
(chat "$SVEN" "Setz den Deal d-1007 auf 80.000 Euro" > /tmp/steward-approval.txt) &
id=""
for _ in $(seq 1 60); do
  id=$(curl -sf -H "Authorization: Bearer $SARA" "$BASE/api/approvals" | sed -nE 's/.*"to_decide":\[\{"id":"([^"]+)".*/\1/p')
  [ -n "$id" ] && break; sleep 1
done
if [ -n "$id" ]; then
  curl -sf -H "Authorization: Bearer $SARA" -H 'content-type: application/json' -d '{"decision":"approve"}' "$BASE/api/approvals/$id" >/dev/null && ok "Sara approves in the inbox"
else
  bad "no approval reached Sara"
fi
wait
grep -q '"tool":"crm.update_deal","ok":true' /tmp/steward-approval.txt && ok "approved change executed" || bad "approval flow: $(cat /tmp/steward-approval.txt)"

out=$(chat "$SARA" "Recherchiere den Deal mit Fjord Logistics und lege im Projekt OPS ein Jira-Issue für das Angebot an" &
  sleep 3; ines=$(token ines)
  for _ in $(seq 1 30); do
    i=$(curl -sf -H "Authorization: Bearer $ines" "$BASE/api/approvals" | sed -nE 's/.*"to_decide":\[\{"id":"([^"]+)".*/\1/p')
    [ -n "$i" ] && curl -sf -H "Authorization: Bearer $ines" -H 'content-type: application/json' -d '{"decision":"approve"}' "$BASE/api/approvals/$i" >/dev/null && break
    sleep 1
  done; wait)
echo "$out" | grep -q '"type":"agent_handoff"' && ok "A2A delegation through the Warden A2A proxy" || bad "a2a: $out"

# Network isolation: the assistant cannot reach an MCP server, only the gateway.
if $COMPOSE exec -T steward curl -s --max-time 3 http://mcp:8100/health >/dev/null 2>&1; then bad "assistant reached an MCP server directly"; else ok "assistant cannot reach MCP servers directly"; fi
$COMPOSE exec -T steward curl -s --max-time 3 -o /dev/null -w '%{http_code}' http://gateway:8088/mcp | grep -qE '^(401|405|406)$' && ok "assistant reaches the gateway" || bad "gateway unreachable from the assistant"

audit=$(curl -sf -H "Authorization: Bearer $(token ines)" "$BASE/api/admin/audit?n=200")
echo "$audit" | grep -q '"status":"ok"' && ok "audit chain verifies" || bad "audit verify: ${audit:0:300}"

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
