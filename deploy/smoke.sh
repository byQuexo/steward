#!/usr/bin/env bash
# Smoke test of the compose stack: real Keycloak tokens through Steward and the Warden gateway.
#   docker compose -f deploy/compose.yaml --env-file deploy/dev.env up -d --build && deploy/smoke.sh
# Needs curl and python3. STEWARD_PORT if the assistant is not on 8000.
set -uo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -f compose.yaml --env-file dev.env"
BASE=http://localhost:${STEWARD_PORT:-8000}
KC=http://localhost:8080/realms/${REALM:-acme}/protocol/openid-connect/token
PY=$(command -v python3 || command -v python)
TMP=$(mktemp -d)
pass=0; fail=0
ok()  { echo "  ✓ $1"; pass=$((pass+1)); }
bad() { echo "  ✗ $1"; fail=$((fail+1)); }

echo "waiting for the assistant…"
for _ in $(seq 1 120); do curl -sf "$BASE/health" >/dev/null && break; sleep 2; done

token() { curl -sf -d grant_type=password -d client_id=${CLIENT:-acme-bot} -d client_secret=dev-bot-secret -d "username=$1" -d "password=$1" -d scope=openid "$KC" | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'; }
# The body is written by Python so non-ASCII text is valid UTF-8 JSON on every shell.
chat() {
  local body; body=$(mktemp)
  "$PY" -c 'import json,sys; open(sys.argv[2], "w", encoding="utf-8").write(json.dumps({"message": sys.argv[1]}))' "$2" "$body"
  curl -sN --max-time 180 -H "Authorization: Bearer $1" -H 'content-type: application/json' --data-binary "@$body" "$BASE/api/chat"
  rm -f "$body"
}
# has_event FILE TYPE [KEY=VALUE…]: succeed if an SSE event of TYPE with all KEY=VALUE pairs exists.
has_event() {
  "$PY" - "$@" <<'EOF'
import json, sys
path, kind, *conds = sys.argv[1:]
want = dict(c.split("=", 1) for c in conds)
for line in open(path, encoding="utf-8", errors="replace"):
    if not line.startswith("data:"):
        continue
    try:
        e = json.loads(line[5:])
    except ValueError:
        continue
    if e.get("type") == kind and all(str(e.get(k)).lower() == v.lower() for k, v in want.items()):
        sys.exit(0)
sys.exit(1)
EOF
}
# Approve the first pending request the token's user may decide; retries for 60 s.
approve_first() {
  for _ in $(seq 1 60); do
    id=$(curl -sf -H "Authorization: Bearer $1" "$BASE/api/approvals" | "$PY" -c 'import json,sys; d=json.load(sys.stdin)["to_decide"]; print(d[0]["id"] if d else "")')
    if [ -n "$id" ]; then
      curl -sf -H "Authorization: Bearer $1" -H 'content-type: application/json' -d '{"decision":"approve"}' "$BASE/api/approvals/$id" >/dev/null && return 0
    fi
    sleep 1
  done
  return 1
}

SVEN=$(token sven); HANNA=$(token hanna); SARA=$(token sara); IVO=$(token ivo); INES=$(token ines)
[ -n "$SVEN" ] && ok "Keycloak issues user tokens" || bad "Keycloak token"

me=$(curl -sf -H "Authorization: Bearer $SVEN" "$BASE/api/me")
echo "$me" | grep -q '"user":"sven"' && ok "the assistant verifies Keycloak tokens" || bad "/api/me: $me"
echo "$me" | grep -q 'hr.get_salary' && bad "sven is offered HR tools" || ok "tools are filtered per user"

chat "$SVEN" "Welche Deals habe ich in DACH?" > "$TMP/deals"
has_event "$TMP/deals" tool_result tool=crm.list_deals ok=true && ok "MCP call through the gateway, token exchange and upstream verification" || bad "crm.list_deals: $(tail -c 400 "$TMP/deals")"

chat "$HANNA" "Was verdient Henrik Wagner?" > "$TMP/hanna"
grep -q 'keine Berechtigung' "$TMP/hanna" && ! has_event "$TMP/hanna" tool_result tool=hr.get_salary ok=true && ok "salary refused for an HR member" || bad "hanna: $(tail -c 400 "$TMP/hanna")"

chat "$IVO" "WireGuard meldet handshake did not complete. Was soll ich tun?" > "$TMP/vpn"
has_event "$TMP/vpn" citation doc_id=it-vpn-setup && ok "verified citation from the scanned PDF" || bad "citation: $(tail -c 400 "$TMP/vpn")"

# Approval: Sven's 80k change waits for Sara in the inbox.
chat "$SVEN" "Setz den Deal d-1007 auf 80.000 Euro" > "$TMP/approval" &
# Sven confirms his own request first (confirm_first); only then does it reach Sara.
approve_first "$SVEN" && approve_first "$SARA" && ok "Sven confirms, then Sara approves in her inbox" || bad "confirm or approval did not happen"
wait
has_event "$TMP/approval" tool_result tool=crm.update_deal ok=true && ok "approved change executed" || bad "approval flow: $(tail -c 400 "$TMP/approval")"

# A2A: research and action agents behind Warden's A2A proxy; Ines approves the Jira issue.
chat "$SARA" "Recherchiere den Deal mit Fjord Logistics und lege im Projekt OPS ein Jira-Issue für das Angebot an" > "$TMP/a2a" &
# The delegated Jira write waits for Sara's own confirmation (approve_by: subject).
approve_first "$SARA" || true
wait
has_event "$TMP/a2a" agent_handoff to=acme-research && has_event "$TMP/a2a" agent_handoff to=acme-action && ok "A2A delegation through the Warden A2A proxy" || bad "a2a: $(tail -c 400 "$TMP/a2a")"
has_event "$TMP/a2a" tool_result tool=jira.create_issue ok=true && ok "delegated write ran after approval" || bad "a2a write: $(grep -o '"type":"[a-z_]*"' "$TMP/a2a" | sort | uniq -c | tr '\n' ' ')"

# Network isolation: the assistant cannot reach an MCP server, only the gateway.
if $COMPOSE exec -T steward curl -s --max-time 3 http://mcp:8100/health >/dev/null 2>&1; then bad "assistant reached an MCP server directly"; else ok "assistant cannot reach MCP servers directly"; fi
code=$($COMPOSE exec -T steward curl -s --max-time 3 -o /dev/null -w '%{http_code}' http://gateway:8088/mcp | tr -dc '0-9')
[ -n "$code" ] && [ "$code" != "000" ] && ok "assistant reaches the gateway (HTTP $code without a token)" || bad "gateway unreachable from the assistant"

audit=$(curl -sf -H "Authorization: Bearer $INES" "$BASE/api/admin/audit?n=200")
echo "$audit" | grep -q '"status":"ok"' && ok "audit chain verifies" || bad "audit verify: ${audit:0:300}"

rm -rf "$TMP"
echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
