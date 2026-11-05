<p align="center">
  <img alt="Steward: the company assistant that cannot be talked out of the rules. Every tool call through Warden, humans approve writes, answers with sources, any company in one profile." src="docs/assets/readme/banner.svg" width="100%">
</p>

<p align="center">
  <a href="https://github.com/byQuexo/steward/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/byQuexo/steward/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=CI"></a>
  <img alt="Rust and rig 0.46" src="https://img.shields.io/badge/Rust-rig%200.46-B7410E?style=for-the-badge&logo=rust&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/UI-React%20%C2%B7%20shadcn-3178C6?style=for-the-badge&logo=react&logoColor=white">
  <a href="https://github.com/byQuexo/warden"><img alt="Authorized by Warden" src="https://img.shields.io/badge/authorized%20by-Warden-0d9488?style=for-the-badge"></a>
  <a href="#license"><img alt="License: MIT OR Apache-2.0" src="https://img.shields.io/badge/License-MIT%20%7C%20Apache--2.0-10b981?style=for-the-badge"></a>
</p>

<p align="center">
  <img alt="20 of 20 demo scenarios pass end to end over HTTP · 367 of 367 security cases, 0 violations, 100% mutation score · 27 µs per authorization decision (p50)" src="docs/assets/readme/metrics.svg" width="100%">
  <br>
  <sub>From CI on every push: every demo scenario of both profiles replayed against the full stack (<code>steward replay</code>), Warden's security suites with generated attacks and mutation testing (<code>warden eval --generate --mutate --coverage --gate</code>), decision latency from <code>warden bench</code> on the Acme policy. → <a href="#results">Results</a></sub>
</p>

## Try it

```bash
git clone https://github.com/byQuexo/steward && cd steward
(cd ui && npm ci && npm run build)
cargo run --release -p steward -- demo          # → http://127.0.0.1:8000
```

One process boots a token service, the Warden gateway, seven MCP servers, two A2A sub-agents
and the assistant, with the demo company **Acme GmbH** and seven people to log in as. No
Docker, no API key: a scripted model replays the demo scenarios through the real agent loop.
Set `OPENROUTER_API_KEY` (or any provider in `profiles/acme/models.yaml`) and a real model
answers instead. For the full stack with Keycloak: `make demo`.

| Log in as | Ask | What happens |
|---|---|---|
| **hanna** (HR) | „Was verdient Henrik Wagner?“ | The salary tool is not even offered to her. |
| **sven** (sales) | „Setz den Deal d-1007 auf 80.000 Euro“ | Warden holds the call; **sara** approves it in her inbox; then it runs. |
| **ivo** (IT) | „WireGuard meldet handshake did not complete. Was soll ich tun?“ | Answer from a *scanned* PDF with a verified citation and the page image. |
| **ivo** | „Fasse Ticket t-2051 zusammen“ | The ticket contains a prompt injection. Salary lookup and chat post denied, ticket close waits for approval. Nothing ran. |
| **ines** (admin) | Console → „Als Hanna testen“ | The assistant exactly as Hanna sees it, read-only. Remove a role: the old token is refused on the next call. |

All eleven Acme stories are in the [demo script](docs/demo-script.md).

<p align="center">
  <img alt="The chat: Steward's activity log for a prompt-injection ticket. ticket.get allowed in teal, the salary lookup and the chat post denied in red, the ticket close held for approval in amber with the exact arguments." src="docs/assets/screens/chat-injection.png" width="49%">
  <img alt="The approvals inbox: Sara sees Sven's held deal change with the exact arguments that will run, and approves or rejects it." src="docs/assets/screens/approvals.png" width="49%">
  <br>
  <sub>Monochrome until Warden decides: teal allowed, amber waiting for a human, red denied. Design system: <a href="DESIGN.md">DESIGN.md</a>.</sub>
</p>

## What makes it different

Most assistants decide in the prompt what a user may do. Steward never asks the model: every
tool call, document page, memory access and sub-agent call is an action that
[**Warden**](https://github.com/byQuexo/warden) authorizes for *this user, through this agent
chain, with these arguments*, outside the model.

```text
effective rights = user's roles ∩ assistant's ceiling ∩ every agent in the delegation chain
every call       = scope gate → rules that can only restrict → allow | approval | deny
```

- **A hijacked model stays inside the user's rights.** Tools the user may not use are never
  listed; calls to them are answered as denied. Writes that need a human wait for one, and the
  approver sees exactly the arguments that will run.
- **No token is ever passed along.** The assistant holds only the user's token; the gateway,
  the A2A proxy and every sub-agent get a token exchanged for them (RFC 8693) with the
  delegation chain inside, so a research agent can never write, even when asked by a lead.
- **Answers carry sources.** Document answers come with quotes verified against the page;
  page images are re-authorized on every fetch, so a guessed URL shows nothing.
- **Operable.** Effective rights per user with a what-if trace, test-as-user (read-only by
  construction), role changes that apply on the next call, a hash-chained audit, a kill
  switch, connector health, costs per user, team and agent with hard budgets.
- **A framework, not a demo.** A company is a [profile](docs/profiles.md): connectors, policy,
  approvals, prompts, people. The second profile, **Northwind Labs** (an English software
  company on GitHub, incidents and runbooks), runs on the same binary with no code change.
- **Proven, not promised.** Every demo story is an end-to-end test against the real stack;
  every policy rule is mutation-tested.

## Architecture

<img alt="The browser talks to Steward. Steward reaches tools only through the Warden gateway with the user's token; sub-agents are reached over A2A through Warden's A2A proxy; warden sts issues delegation and test-as tokens; MCP servers live on an internal network only the gateway reaches." src="docs/assets/readme/architecture.svg" width="100%">

| Piece | What it does |
|---|---|
| **Steward** (`crates/steward`) | Backend for the browser (sessions, SSE chat, approvals inbox, console API) and the orchestrator on [rig](https://github.com/0xPlaygrounds/rig) 0.46 with a Warden guard hook and a budget hook. |
| **Warden gateway** | In front of every MCP server: lists only permitted tools, decides every call, holds approvals, exchanges tokens per upstream, audits in a hash chain. |
| **warden sts** | Token exchange: delegation tokens with `act` chains for sub-agents, read-only test-as tokens, revocation. Trusts Keycloak for users. |
| **Sub-agents** (`steward-a2a`) | Research and action agents as A2A servers behind Warden's A2A proxy (per-caller agent cards, skill checks, task ownership). |
| **MCP servers** (`steward-mcp`) | HR, CRM (read-only SQL), helpdesk, documents ([docrag-bench](https://github.com/byQuexo/docrag-bench) or a built-in verified-quote backend), Jira, chat, GitHub over seed data. Swap any for a real server by URL. |
| **Memory, cost** | Facts per user/team (every access a Warden action, PII refused); a ledger with per-run, daily and monthly budgets; model calls as OpenTelemetry spans for Phoenix. |
| **UI** (`ui/`) | React, Tailwind, shadcn/ui and [libraries.dev](https://libraries.dev) components: chat with a live decision log, an animated Steward presence, approvals, console with in-browser what-if (Warden as WebAssembly), costs, memory, voice mode. See [DESIGN.md](DESIGN.md). |

More: [architecture](docs/architecture.md) (a chat turn step by step, the A2A token flow,
where each decision is made) and the [threat model](docs/threat-model.md) (20 threats, each
with the control and the test that proves it).

## Results

Every number is produced by CI.

| Suite | What | Result |
|---|---|---|
| Demo scenarios, Acme | 11 conversations over HTTP: login, SSE chat, approvers in the inbox, test-as, kill switch, A2A | **11 / 11** |
| Demo scenarios, Northwind | 9 conversations, same binary, other company | **9 / 9** |
| Warden security suite, Acme | 46 written + 145 generated attacks | **191 / 191**, rule coverage 12/12, mutants killed 12/12 |
| Warden security suite, Northwind | 60 written + 116 generated attacks | **176 / 176**, rule coverage 9/9, mutants killed 9/9 |
| Hard gates | scope violation, unapproved write, delegation escalation, failed cases | **0** |
| Decision latency (Acme policy, release) | `warden bench`, 100k decisions | p50 **27 µs**, p99 **66 µs** |
| Rust tests | unit and end-to-end (gateway, agent loop, console, scenarios) | **38** passing |
| UI | unit tests; Playwright end-to-end (approvals across two browsers, citations, injection, console) with axe on every page, light and dark | **44** unit, **12 / 12** e2e, 0 serious a11y violations |
| Docker stack with Keycloak | `deploy/smoke.sh`: real Keycloak tokens through gateway, token exchange, inbox approval, A2A with a delegated write, network isolation, audit verification | **13 / 13** |
| Seed | byte-identical regeneration of both profiles | ✅ |
| Quality eval (offline, CI) | 88 questions over 7 users; harness and hard gates on the scripted subset | gates **0** (`pii_leak`, `scope_violation`, `unapproved_write`, `unverified_citation`, `delegation_escalation`) |

<details>
<summary><b>What the demo scenarios prove</b></summary>

| # | Story | Proves |
|---|---|---|
| 01 | Hanna asks for a salary | hidden tools are never offered |
| 02 | Henrik: own unit yes, sales no | argument rules (`salary-only-own-unit`) |
| 03 | Sven's 80k deal, Sara approves | approvals with exact arguments, no self-approval |
| 04 | Ivo asks a scanned PDF | verified citation, page image |
| 05 | Prompt injection in a ticket | hijacked model stays inside the user's rights |
| 06 | Sara: research and action agents | A2A delegation with exchanged tokens, chain ceilings |
| 07 | Ines tests as Hanna | impersonation is read-only, audited |
| 08 | Fiona hits the budget | the run stops before the next model call |
| 09 | Sven's memory | remember, refuse an IBAN, use, forget |
| 10 | Kill switch | writes stop, reads continue |
| 11 | Tenant export | four eyes: two different approvers |
</details>

<details>
<summary>Design decisions</summary>

- **Warden decides, twice.** A guard hook checks each call in the agent loop (fail fast, no
  network); the gateway decides again and is authoritative. Approvals are owned by the
  gateway, so the inbox sees each request once and exactly the approved arguments run.
- **Restrict-only rules.** Roles grant, rules can only take away; anything unknown denies.
- **Scripted model instead of recordings.** Replaying provider HTTP breaks on every prompt
  change; a scripted rig model replays the scenarios through the same loop, hooks, gateway
  and budgets, so the demo and CI need no key. See [spikes](docs/spikes.md).
- **Generated, not hand-kept.** The Warden catalog, gateway upstreams, compose configs and
  the Keycloak realm are generated from the profile; CI fails if they drift.
- **Synthetic data only**, byte-for-byte reproducible ([data licenses](DATA_LICENSES.md)).
</details>

<details>
<summary>Design and limits</summary>

- **Exfiltration within allowed actions** is out of scope: if a user may read deals and post
  to a channel, an injected instruction can post deals there. Approvals on cross-system writes
  and channel rules are the mitigation.
- Approvals are held in memory; a restart drops pending ones (they fail closed).
- The offline demo answers only scripted questions; everything else needs a model key.
- The demo secrets in `deploy/dev.env` are for local use only.
</details>

<details>
<summary>Project layout</summary>

```
steward/
├── crates/
│   ├── steward/              # binary: BFF, inbox, console API, demo, replay, serve, agent, a2a-proxy
│   ├── steward-agents/       # rig turn: per-session MCP, guard + budget hooks, scripted model, events
│   ├── steward-a2a/          # research and action agents as A2A servers
│   ├── steward-mcp-servers/  # steward-mcp: hr, crm, ticket, docs, jira, chat, github
│   ├── steward-identity/     # OIDC + PKCE, sessions, Keycloak directory, token service client
│   ├── steward-memory/       # facts, Warden-checked, PII refused
│   ├── steward-cost/         # ledger, budgets, OTLP spans
│   └── steward-config/       # profiles, generators
├── profiles/
│   ├── acme/                 # German company: HR, CRM, IT, documents
│   └── devteam/              # English software company: GitHub, incidents, runbooks
├── ui/                       # React + Vite + Tailwind + shadcn/ui
├── seed/                     # deterministic synthetic data (Python, uv)
├── eval/                     # quality eval: rubric, judge, kappa, bootstrap CIs (Python, uv)
├── deploy/                   # compose stack with Keycloak, generated configs, smoke test
└── docs/                     # architecture, threat model, profiles, demo script, spikes, plan
```
</details>

## Quickstart

**Requirements:** Rust 1.97+, Node 20+ for the UI, [uv](https://docs.astral.sh/uv/) for seed
and eval, Docker for the Keycloak stack.

```bash
# everything in one process (dev login, scripted model unless a key is set)
(cd ui && npm ci && npm run build)
cargo run --release -p steward -- demo --profile profiles/acme      # or profiles/devteam

# the full stack: Keycloak, warden sts, gateway, A2A proxies, agents, Phoenix
make demo                       # PROFILE=devteam for the other company
make smoke                      # real Keycloak tokens through the stack
```

Log in with the user id as password in Keycloak (`sven`/`sven`, `ines`/`ines`, …).
Phoenix shows model spans at http://localhost:6006.

**Use a real model:** set the key named in `profiles/<p>/models.yaml` (`OPENROUTER_API_KEY` for
both profiles) or change the routes to any provider rig supports (`openai/…`,
`anthropic/…`, `ollama/qwen3:8b`, …).

**Make it your company:** see [profiles](docs/profiles.md).

## Running the tests

```bash
cargo test --workspace                                   # unit + end to end, both profiles' scenarios
cargo run -p steward -- replay --profile profiles/acme   # the scenario report
(cd seed && uv run pytest && uv run steward-seed --profile ../profiles/acme --check)
(cd ui && npm test && npm run build)                     # e2e: STEWARD_URL=… npm run e2e
make eval                                                # quality eval against a running demo
```

Warden's own gates per profile (also run in CI through Warden's reusable action):

```bash
cd profiles/acme && warden eval --policy warden/policy.yaml --catalog warden/catalog.yaml \
  --suite scenarios/security/acme.yaml --generate --mutate --coverage --gate
```

## What's next

- **Add a Voice Agent**: a realtime speech agent (streaming in and out, barge-in) as a third
  agent next to research and action, under the same Warden checks and approvals.
- **Durable approvals** that survive restarts (serialize the held rig run).
- **Per-user credentials for real SaaS connectors** (GitHub App installation tokens or a token
  vault in Warden), so live connectors act with each tenant's or user's own access.
- **More connectors** (Jira, Slack, Google Drive, Postgres) as presets with policy templates.
- **Qdrant ACL payload filters** in docrag-bench, so document scope is enforced in retrieval too.
- **Hosted demo** with a model key behind a rate limit.

## Docs

[Architecture](docs/architecture.md) · [Threat model](docs/threat-model.md) ·
[Profiles](docs/profiles.md) · [Demo script](docs/demo-script.md) · [Spikes](docs/spikes.md) ·
[Data licenses](DATA_LICENSES.md) · [Original plan (German)](docs/design/plan-de.md)

Built on [Warden](https://github.com/byQuexo/warden) (authorization),
[docrag-bench](https://github.com/byQuexo/docrag-bench) (cited document answers) and
[rig](https://github.com/0xPlaygrounds/rig) (agents).

The code was written by Claude; architecture, threat model, evaluation and review are by Tim.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
