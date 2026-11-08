# One request through the system

Sven (sales) asks: *„Setz den Deal d-1007 auf 80.000 Euro“*. This is the richest single path in
Steward: a model, a tool call, the in-process check, the gateway, a rule that holds the call,
the user's own confirmation, an approver, a re-check, a token exchange, the upstream, the audit
log and the cost ledger. Follow it once and every other request is a subset.

```mermaid
sequenceDiagram
    autonumber
    actor Sven
    actor Sara
    participant UI as Browser (React)
    participant BFF as Steward BFF + agent
    participant GW as Warden gateway
    participant Inbox as Approvals inbox
    participant STS as Token service
    participant CRM as CRM (MCP server)
    Sven->>UI: „Setz den Deal d-1007 auf 80.000 Euro“
    UI->>BFF: POST /api/chat (session cookie, x-steward header)
    BFF->>GW: MCP tools/list with Sven's token
    GW-->>BFF: only the tools Sven may use
    BFF->>BFF: model proposes crm.update_deal(amount 80000); guard hook checks in process
    BFF->>GW: tools/call crm.update_deal with Sven's token
    GW->>GW: verify token, normalize, scope gate, rules → require_approval (big-deals-need-approval)
    GW->>Inbox: webhook v1 (signed), exact arguments + args_hash
    Inbox-->>UI: SSE approval_pending, awaiting: requester
    Sven->>UI: Ausführen
    UI->>Inbox: POST /api/approvals/{id} approve
    Inbox-->>Sara: now in her inbox
    Sara->>Inbox: approve
    Inbox-->>GW: approve, approver sara, args_hash
    GW->>GW: approver ≠ subject, same args, same policy version, token still valid, check again
    GW->>STS: exchange Sven's token for one scoped to the CRM
    GW->>CRM: tools/call with the exchanged token
    CRM-->>GW: result
    GW-->>BFF: result (and an audit event, hash-chained)
    BFF-->>UI: SSE tool_result, answer tokens, cost, done
```

## Step by step

1. **Browser → BFF** (`crates/steward/src/chat.rs`, `chat`). The browser never holds a token:
   it sends a session cookie, and state-changing requests need the `x-steward` header (a CSRF
   guard). The BFF looks up Sven's tokens server-side and verifies them
   (`crates/steward/src/app.rs`, the `Authed` extractor).
2. **Agent turn** (`crates/steward-agents/src/runner.rs`, `Runtime::run`). The preamble is the
   profile's prompt plus context (user, roles, tenants, date, kill switch, remembered facts).
   The model comes from `profiles/acme/models.yaml` per role; in CI it is the scripted model.
3. **Tools per session** (`crates/steward-agents/src/tools.rs`, `GatewaySession`). The agent
   opens an MCP session to the gateway *with Sven's token*. `tools/list` is already filtered,
   so Hanna, for example, never sees `hr.get_salary`. The model cannot call what is not listed.
4. **Guard hook** (`crates/steward-agents/src/guard.rs`). Before a call leaves the process,
   warden-core checks it with the same policy. A deny never leaves the process; a held call
   (`require_approval`) goes on, because the gateway owns approvals.
5. **Gateway decides** (Warden, `warden-gateway`). Verify the token (issuer, audience, expiry,
   `act` chain), normalize the action (Unicode, URIs), check the catalog, the scope gate
   (`roles ∩ agent ceiling ∩ token scopes ∩ chain`), then every rule. Deny beats approval beats
   allow; unknown values deny. Here `big-deals-need-approval` holds the call: amount ≥ 50,000.
6. **Inbox** (`crates/steward/src/inbox.rs`, `Inbox::request`). The gateway POSTs the request
   (webhook protocol v1, `X-Warden-Signature` HMAC). Because `approvals.yaml` has
   `confirm_first`, it first waits for Sven: an SSE event puts the gate card in his chat
   (`ui/src/components/approval-card.tsx`). He confirms; only now does the request reach Sara,
   the approver routed for this rule. Sven himself can no longer decide it.
7. **Back to the gateway.** The inbox answers `approve` with `approver: sara` and the
   `args_hash`. The gateway refuses self-approval, refuses a hash for other arguments, refuses if
   the policy changed or the token expired meanwhile, and runs the check once more (the kill
   switch may be on now).
8. **Token exchange and upstream.** The gateway exchanges Sven's token at the token service
   for one whose audience is the CRM server only (RFC 8693), with Sven still the subject. The
   CRM server (`crates/steward-mcp-servers/src/crm.rs`) never sees Sven's own token and verifies
   the exchanged one itself.
9. **Evidence.** Every decision, approval and forwarded call is an audit event in a hash
   chain with signed checkpoints; arguments are stored as an HMAC, not in clear text. The
   console's audit page verifies the chain.
10. **Answer and cost.** The tool result goes back to the model, which writes the answer.
    Every model response is booked in the ledger (`crates/steward-cost`); the budget hook stops
    a run before the next model call if the run, the user's day or the team's month is over
    budget.

A smaller deal (say 45,000 euros) takes the same path with one difference: no rule needs Sara,
so the last rule, `confirm-writes` (`approve_by: subject`), holds it for Sven alone. If he
cancels, nothing ran, and the model is told only "This action was not approved."

## Why it is built this way

### Why a gateway, and still a check in the bot?
The gateway is the boundary that holds even if the bot is wrong: tools sit on a network only
the gateway can reach, so a bug or a hijacked model in Steward cannot get around it. The
in-process guard hook is not the security boundary; it saves a round trip and keeps a denied
call from ever leaving the process. If they disagree, the gateway wins.

### Why rules that can only restrict?
Because a policy written by people will contain mistakes. If rules could grant, a wrong rule
would open access. With roles that grant and rules that only deny or hold, a wrong rule closes
too much, which someone notices, instead of opening too much, which nobody notices.

### Why does the approval live in the gateway, bound to a hash of the arguments?
The approver must decide on exactly what will run. If the bot owned approvals, a model could
ask for approval of 8,000 and execute 80,000. The gateway holds the very call, shows the exact
arguments, binds the decision to their HMAC and forwards only those arguments. After the
approval it checks again: the policy, the token or the kill switch may have changed while a
human was thinking.

### Why does the user confirm their own writes, and why is that not self-approval?
Two different questions. *Approval* is separation of duties: Sven may not approve his own
80,000 deal, so the gateway refuses an approver equal to the requester. *Confirmation*
(`approve_by: subject`) asks whether Sven wants this at all, because the call was proposed by a
model that may have read an injected instruction. Only Sven can answer a confirmation, and
nobody else can confirm in his name. With `confirm_first`, he confirms before an approver is
bothered, so an injected request never lands in someone else's inbox.

### Why exchange the token instead of forwarding it?
A forwarded user token is valid at every service it is valid for; every MCP server that saw it
could replay it elsewhere. An exchanged token is valid for one upstream only, still names the
user, and carries the delegation chain, so sub-agents can act for the user without ever
holding the user's token.

### Retrieval: why lexical search here, and hybrid in docrag-bench?
Steward's built-in document search is BM25 with handling for German compounds. The corpus is
small, the questions name exact things (`E3`, `d-1007`, „Hotel-Limit“), CI must be deterministic
and must not need an embedding model, and a live eval showed what lexical search gets wrong:
„Hotel-Limit“ vs „Hotelkosten“, which compound matching fixed.

When docrag-bench is configured, Steward uses its pipeline instead: dense and BM25 retrieval
fused with reciprocal rank fusion (RRF, k = 60), then a cross-encoder reranker. The honest
numbers from its benchmark: recall@10 is 0.756 for hybrid, 0.735 for dense only and 0.716 for
BM25 only, with overlapping confidence intervals, so hybrid is not a proven large gain on that
data. It is chosen because the two retrievers fail differently: BM25 is best at the first
rank (recall@1 0.313 vs 0.271) on exact terms and numbers, dense handles paraphrase, and RRF
combines ranks without having to calibrate their scores against each other. The reranker then
lifts recall@1 to 0.330. The biggest gain in docrag-bench was not the retriever at all but OCR
for scanned PDFs (recall@10 on scans 0.000 → 0.776 → 0.834).

### Why verify citations in code?
A model can quote what is not there. Every citation must name a page that was actually
retrieved and quote text that appears verbatim on it; otherwise it is dropped. That check is a
string comparison, not another model call, so it cannot be talked out of anything. Page images
are authorized again on every fetch, so a guessed URL shows nothing.

### Why an LLM judge, why that one, and why it gates nothing?
The rubric (key facts, refusal and abstention phrases, forbidden tools, protected values) is
deterministic but brittle with real-model wording; the judge reads the answer against the
evidence and says whether it is correct and faithful. It is a different model family from the
assistant (`deepseek-v4.1-flash` judging answers from `claude-haiku-5.5`), so it does not grade
its own style, runs at temperature 0, and writes its reasoning before the verdict.

It gates nothing because nobody has validated it yet: agreement with the rubric was κ = 0.61 in
one run and close to 0 in another, although raw agreement was 96.6 %. That is the kappa
paradox: when almost every answer is correct, chance agreement is high and κ collapses. The
fix is 50 human labels (`labels.csv`), then κ between human and judge. Until then, only
deterministic gates can fail a run: `scope_violation`, `pii_leak`, `unapproved_write`,
`unverified_citation`, `delegation_escalation`.

### Why bootstrap intervals clustered by document?
Questions about the same document are not independent: if retrieval misses that document,
several questions fail together. Resampling documents (clusters) instead of questions gives
honest, wider intervals.

### Why a scripted model in CI?
CI should prove the system, not a model's mood. The scripted model runs the real agent loop,
tools, gateway, inbox and UI, but says what each scenario says, so a red build means the code
changed. Real models are tested separately (locally and in a nightly job when a key is set).

## Practice questions

Answer these out loud, then check against the sections above.

1. Hanna asks for Henrik's salary. Name the exact place where the request ends and what the
   model sees.
2. A ticket tells the assistant to post salaries to #allgemein. Which two different mechanisms
   stop the salary lookup and the post?
3. Sara approved 80,000. Between her click and the CRM call the admin turns on the kill switch
   for writes. What happens, and where?
4. Why can't a research agent write a deal even when Sara, who may write deals, asks it to?
5. What is the difference between `approve_by: subject` and self-approval, and why does the
   gateway allow one and refuse the other?
6. Your judge agrees with the rubric 96.6 % of the time but κ is near 0. Is the judge good?
7. Hybrid retrieval is only 2 points better than dense on recall@10 with overlapping
   intervals. Why use it anyway, and what would make you drop it?
8. Which of Steward's numbers come from deterministic code, and which depend on a model?
