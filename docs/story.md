# The story behind Steward

## The problem

Companies want one assistant that can read the CRM, answer from the handbook, open tickets
and change a deal. The usual way to build that is to give the model every tool and write the
rules into the prompt: "only show salaries to HR leads", "never post salaries to chat". That
holds until someone pastes a document that says otherwise. A prompt is advice to a model, not
a permission system, and the model is exactly the component an attacker can talk to.

Steward is my answer to: *what would a company assistant look like if the model were never
trusted with a permission decision?*

## The idea in one sentence

Every tool call, document page, memory read and sub-agent call is an action that
[Warden](https://github.com/byQuexo/warden) authorizes for this user, through this agent chain,
with these arguments, outside the model; the model only ever sees the tools it may use and a
generic "not permitted" when it tries anything else.

## Why this architecture

- **A gateway, not checks in the bot.** All tools sit behind the Warden gateway on a network
  the assistant cannot reach directly (`tools` is an internal Docker network; CI proves the
  assistant cannot connect to an MCP server, whatever token it holds). If the bot had the
  checks, a bug in the bot would be a bug in the security. The bot still runs the same policy
  in process as a second line, so a denied call never even leaves it.
- **The user's own token, exchanged, never forwarded.** The assistant calls the gateway with
  the user's token; the gateway exchanges it (RFC 8693) for one scoped to each upstream. Sub-
  agents get their own exchanged tokens with the whole delegation chain inside, so a research
  agent cannot write even when a sales lead asks it to.
- **Rules can only restrict.** Roles grant scopes; rules can only take away or hold a call for
  a human. There is no rule that can widen rights, so a mistake in a rule fails closed.
- **Nothing is written in the user's name without them.** Every write waits for the user's own
  confirmation on a card with the exact arguments. Writes that need someone else (a deal over
  50,000 euros, a tenant export) go to that person afterwards, and self-approval is refused.
  An injected write shows up as a card nobody asked for.
- **Company = profile.** Connectors, people, policy, approvals, prompts, documents and test
  scenarios live in one directory. The second profile (an English software company with
  GitHub and incidents) runs on the same binary and proves nothing about Acme is hard-coded.

## What the tests and evals actually show

| Claim | Evidence | What it does *not* prove |
|---|---|---|
| Permissions hold | Warden's security suites: 191 (Acme) and 176 (devteam) cases including generated attacks, 100 % rule coverage, deleting any single rule makes a case fail (rule deletion only; conditions and thresholds are not mutated) | That the policy matches what a real company wants; the suites test the policy as written |
| The flows work end to end | 11 + 9 demo conversations replayed over HTTP against the full stack in CI; Playwright in two browsers; the Docker stack with real Keycloak tokens (13 checks) | Behaviour with a real model: replays use a scripted model |
| The assistant cannot bypass the gateway | network test from inside the containers (12 checks) | Anything about a compromised Steward process, which holds user tokens |
| Answers are good with a real model | **Not yet reproducibly backed.** One local run (2026-11-06) of the 88 questions with `claude-haiku-5.5` and `deepseek-v4.1-flash` reported rubric 97.7 %, but its report was not kept, its commit was not recorded and the harness changed afterwards. What an archived run needs: [eval/README.md](../eval/README.md#status-of-the-real-model-numbers) | Even once archived: generality (the questions were written for this data, the rubric was tuned on earlier runs, the judge is another model). The 50 human labels that would validate the judge (κ) are not done yet |

The security numbers come from deterministic code and run on every push. There is no
reproducible quality number yet: CI uses a scripted model, and the nightly real-model eval is
skipped (not passed) whenever no API key is configured.

## What is simulated

- **All data is synthetic**: people, salaries, deals, tickets and documents come from a
  deterministic seed (Faker plus hand-written records). The "scanned" PDFs are rendered images
  of generated text. Licenses: [DATA_LICENSES.md](../DATA_LICENSES.md).
- **All systems are mocks**: HR, CRM, tickets, Jira, chat and GitHub are Steward's own MCP
  servers over that data. A real system plugs in by URL (`server: { url: … }`), but none is
  connected in this repo.
- **CI uses a scripted model** that replays the demo conversations. It runs the real agent
  loop, tools and gateway, but it says what the scenario says. A real model is used only when
  an API key is present (environment or OS credential store).
- **Keycloak** in the Docker stack is real; in `steward demo` an in-process token service plays
  the identity provider.

## What does not work yet

- Approvals are held in memory; a restart drops pending ones (they fail closed). Sessions and
  chat history are in memory too.
- `steward demo` logs in any profile user by name without a password and uses fixed dev
  secrets; the Docker stack's Keycloak passwords equal the user ids. Local use only.
- A user who confirms without reading lets an injected write through. Confirmation makes it
  visible, not impossible; channel rules are the second line.
- When a user cancels, the model only learns "not approved", so it may say "nicht freigegeben"
  rather than "you cancelled".
- Model choice is fixed per agent role; a router by difficulty is on the roadmap.
- Document search is lexical (BM25 with German compound handling) unless docrag-bench is
  configured; there is no vector search in the default setup.
- No voice yet; a voice agent under the same checks is on the roadmap.

## Try it in five minutes

```bash
git clone https://github.com/byQuexo/steward && cd steward
(cd ui && npm ci && npm run build)
cargo run --release -p steward -- demo --offline     # http://127.0.0.1:8000, scripted model
cargo run --release -p steward -- replay             # all 11 Acme scenarios, no browser
```

Log in as **sven** and ask „Setz den Deal d-1007 auf 80.000 Euro“: confirm the card, then log in
as **sara** in a second browser and approve it. The [demo script](demo-script.md) walks through
all eleven stories; the [walkthrough](walkthrough.md) follows one request through every layer.
