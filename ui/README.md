# Steward UI

The web UI of Steward: chat with the assistant, and see what Warden decided for every tool call
(allow / approval / deny with the rule id), approvals, citations with page images, memory, costs
and the admin console (effective rights, what-if, test as user, roles, audit, kill switch,
connectors).

Vite + React 18 + TypeScript (strict) + Tailwind, shadcn-style components (`src/components/ui`,
Radix primitives), lucide icons, react-router, recharts. All strings live in `src/i18n.ts`
(German and English; picked from the profile's `locale` in `/api/info`).

## Develop

```sh
# backend (from the repo root; see the main README for CARGO_TARGET_DIR on Windows)
cargo build -p steward
steward demo --profile profiles/acme --listen 127.0.0.1:8000 --ui ui/dist

# UI with hot reload; /api, /auth and /hooks are proxied to STEWARD_URL (default 127.0.0.1:8000)
cd ui
npm ci
npm run dev        # http://localhost:5173
```

Demo users (dev login): hanna, henrik, sven, sara, ivo, ines (admin), fiona.

## Scripts

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run build`     | Production build into `ui/dist` (served by the backend, SPA fallback) |
| `npm run typecheck` | `tsc --noEmit`                                                      |
| `npm run lint`      | ESLint, zero warnings                                               |
| `npm test`          | Vitest: SSE parser, event → timeline reducer, i18n completeness     |
| `npm run e2e`       | Playwright against a running `steward demo` (`STEWARD_URL`, default `http://127.0.0.1:8000`) |

The e2e suite needs the built UI served by the backend and Chromium
(`npx playwright install chromium`). It covers the approval flow (sven asks, sara approves in a
second browser context), citations with page images, the prompt-injection denial, the console,
and axe checks (no serious or critical violations) in light and dark mode.

## Notes

- Every non-GET request sends `X-Steward: 1` (CSRF); the session is an HttpOnly cookie.
- `POST /api/chat` streams SSE; it is read with `fetch` + `ReadableStream` (`src/lib/sse.ts`) and
  folded into a per-turn activity timeline (`src/lib/timeline.ts`). Live inbox updates come from
  `GET /api/events` (EventSource).
- Voice mode uses the Web Speech API (`voice.mode: browser`) or the server's STT/TTS endpoints
  (`voice.mode: server`). Approvals are never given by voice.
- All motion (thinking orb, border beam on the active approval, fades) stops under
  `prefers-reduced-motion`.
