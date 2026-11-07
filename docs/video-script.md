# Video script

Three minutes, screen recording with voice-over. Everything shown runs from a fresh clone:
`(cd ui && npm ci && npm run build)`, then `cargo run --release -p steward -- demo` with a model
key (environment or OS credential store) for the live parts. Keep two browser windows side by
side for the approval shots. The longer, step-by-step version is the [demo script](demo-script.md).

| Time | Screen | Voice-over |
|---|---|---|
| 0:00 | Login screen, the seven Acme users | "Most company assistants decide in the prompt what a user may do. Steward never asks the model. Every tool call goes through Warden, outside the model." |
| 0:15 | **hanna** asks „Was verdient Henrik Wagner?“ | "Hanna is in HR, but salaries are for the HR lead. The salary tool is not even offered to her session. The model cannot call what Warden does not list." |
| 0:35 | **sven**: „Setz den Deal d-1007 auf 80.000 Euro“. Amber card „Bestätigen“ → Ausführen | "Nothing is written in Sven's name without him: he sees exactly what will run and confirms. A deal this big also needs the sales lead." |
| 0:50 | Second window, **sara**: Freigaben → approve. Sven's card turns teal, answer arrives | "Sara approves in her inbox. Only these arguments, and Sven could never approve his own request. Then the call runs." |
| 1:10 | **ivo**: the WireGuard question; open the citation, the scanned page with the highlighted quote | "Answers from documents come with a citation that is checked word for word against the page, here a scanned PDF. The page image is authorized again on every fetch." |
| 1:30 | **ivo**: „Fasse Ticket t-2051 zusammen“ with `--offline`: denied salary lookup, denied chat post, ticket close waiting for Ivo → Abbrechen | "This ticket contains a prompt injection. Even a fully hijacked model stays inside Ivo's rights: two calls denied, and the one he could do waits for him. He never asked for it, so he cancels. Nothing ran." |
| 1:50 | **sara**: research and Jira request. Handoffs to the research and action agents, Sara confirms the issue, OPS-104 | "Sub-agents get their own tokens with the whole delegation chain. The research agent can read, only the action agent can write, and the write still waits for Sara." |
| 2:15 | **ines**: Console → Effektive Rechte → what-if with the full trace; then „Als Hanna testen“ | "Admins see why someone may do something, try changes before they happen, and test the assistant as another user, read-only." |
| 2:35 | Console → Benutzer & Rollen: remove Sven's role; Sven's next request is denied | "Remove a role and the very next call is refused. No waiting for a token to expire." |
| 2:45 | Terminal: `cargo run -p steward -- demo --profile profiles/devteam` | "And Acme is just a profile. The same binary runs a software team in English: GitHub, incidents, runbooks." |
| 2:55 | README results table | "Every scenario is replayed in CI, with generated attacks and mutation testing on the policy. Links below." |

Recording notes: 1440×900, dark theme, browser zoom 100 %. For the injection shot use
`--offline`: a real model usually refuses the injected instructions itself, so there is
nothing for Warden to block on screen. Retake README screenshots with
`SCREENSHOTS=1 npx playwright test screens` (in `ui/`).
