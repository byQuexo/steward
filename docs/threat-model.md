# Threat model

Assumption: **the model can be manipulated.** Prompt injection in tickets, documents, chat
messages or issue bodies can make it call any tool with any arguments. Steward is safe if that
changes nothing a user could not do themselves, and nothing happens that needs a human without
one.

Every threat below names the control and the test that proves it. "Scenario" refers to
`profiles/<p>/scenarios/demo/*.yaml` (replayed over HTTP in CI), "suite" to the Warden
security suite (`scenarios/security/*.yaml`, plus generated attacks and mutation testing).

| # | Threat | Control | Proven by |
|---|---|---|---|
| T1 | Injected text makes the model call a tool the user may not use (salary, chat post) | The gateway lists only permitted tools; a call to an unlisted tool is answered as denied by the guard hook and never sent | Scenario 05 (`not_executed`), suite P1–P2 |
| T2 | Injected text makes the model do a permitted but harmful write (close all tickets) | Every write the user may make waits for the user's own confirmation (`confirm-writes`, `approve_by: subject`) with the exact arguments; writes that need someone else are confirmed by the user first (`confirm_first`) | Scenario 05 (`confirm: cancel`), suite P3, T4 |
| T3 | A user reads data of another unit / tenant through the assistant | Argument rules (`salary-only-own-unit`, `tenant-pinning`) on the gateway; unknown arguments deny | Scenarios 02, gateway_flow test, suite S3, T2 |
| T4 | Missing or mistyped arguments skip an approval (`amount: "80000"`) | Unknown always denies, in `approve_if` too | Suite T6, generated attacks |
| T5 | Documents of another team leak via search or a guessed page-image URL | `docs-in-scope` (`subset_of` doc_scope) at the gateway, the docs server cuts again, `page-in-scope` on every image fetch | Suite D3–D5, console test `page_images_are_checked_on_every_fetch` |
| T6 | A citation is invented | Docs backend returns only verified quotes (docrag-bench verification, or verbatim sentences); the eval gates `unverified_citation = 0` | `steward-mcp-servers` docs tests, eval gate |
| T7 | A sub-agent escalates (research agent writes) | Delegation tokens carry the `act` chain; effective scopes are the intersection over the chain; `may_delegate_to` enforced at the token service | Suite A2, A4, A5; scenario 06 |
| T8 | A delegation token is replayed against another agent | Tokens are minted per hop with audience and `azp`; the agent server rejects tokens for another agent | `steward-a2a` (`token is for another agent`), Warden A2A tests |
| T9 | Task hijacking across users or agents | Warden A2A proxy binds tasks to their creator | Warden `warden-a2a` tests |
| T10 | An admin abuses "test as user" to act as someone | Impersonated principals are read-only in the engine itself (`impersonation.read_only`), the operator is in every audit event, test sessions cannot decide approvals or open the console | Suite I1–I4, scenario 07, console test `test_as_is_read_only_and_ends_cleanly` |
| T11 | A removed role keeps working until the token expires | Role change → token service revokes the subject, Keycloak ends sessions, the gateway introspects on every call | Console test `role_changes_apply_on_the_next_call`, gateway_flow `revoking_a_user…` |
| T12 | Self-approval or one person approving a four-eyes action twice | The inbox excludes the requester from approvers and counts distinct approvers; Warden rejects an approver equal to the subject, except for rules marked `approve_by: subject`, where only the subject may answer | Console test `approvals_route_to_leads…`, scenario 11 |
| T13 | Memory of another user is read or written | `x-memory` actions with `owner == subject.id` rules, checked in process | Suite M2–M3, memory tests |
| T14 | Secrets/PII persisted in memory (IBAN, card) | Refused before storage (checksums), not masked | Scenario 09, `steward-memory` tests |
| T15 | Cost runaway (loops, huge contexts) | Budget hook stops before the next model call; ledger is fail-closed | Scenario 08, `steward-cost` tests |
| T16 | The assistant bypasses the gateway and calls a system directly | MCP servers live on an internal network the assistant is not attached to | `deploy/smoke.sh` network check |
| T17 | Upstream systems receive user tokens | Gateway and A2A proxy exchange tokens per hop (RFC 8693); MCP servers verify the exchanged token's audience | gateway_flow test (effect subject via exchanged token), Warden e2e tests |
| T18 | CSRF against the browser session | HttpOnly SameSite=Lax cookie plus a custom header on every state-changing request | Console test `state_changes_need_the_csrf_header` |
| T19 | Audit log tampering | Warden's hash-chained JSONL with HMAC'd arguments and signed checkpoints; the console verifies the chain | Warden audit tests, smoke `audit chain verifies` |
| T20 | Compromised connector floods errors / hangs | Per-upstream circuit breaker removes it from `tools/list` | Console test `a_failing_connector_disappears…` |

## Out of scope

* **Exfiltration within allowed actions, fully.** If a user may read deals and post to chat,
  an injected instruction can try to post deals to a channel the user may post to. The post
  waits for the user's confirmation with the exact text, so it no longer happens silently,
  but a user who confirms without reading lets it through. Channel allowlists are the second
  line; there is no content detection.
* **A compromised Steward process** holds user tokens in memory for active sessions and can use
  them within each user's rights. It cannot exceed them: every system checks the token.
* **Answer quality and hallucinations** outside cited document answers are measured by the
  quality eval, not prevented.
* The demo secrets in `deploy/dev.env` and the demo passwords are for local use only.
