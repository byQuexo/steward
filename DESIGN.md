# Steward Design System — "Verdict"

Steward is a company assistant whose every tool call is decided by **Warden**, an authorization
layer. The UI is inspired by the quiet, near-black product surfaces of frontier AI labs (think
x.ai / grok.com): a dark canvas, white and grey type, a lot of empty space, one confident prompt
bar in the middle. It is *inspired by*, not a copy: no xAI names, logos, marks, fonts or assets.

The twist is the whole point of the system:

> **Color is a verdict.** The interface is ink on black (or ink on paper). Color appears only
> where Warden has decided something. If you see color, authority was exercised there.

A glance at any screen therefore answers the question an admin, an approver or a worried user
actually has: *where did the security decisions happen, and what were they?*

---

## 1. Principles

1. **Monochrome by default.** Text, buttons, links, charts, icons, avatars, focus rings: greys
   only. Brand color does not exist. The primary button is inverted ink (white on black / black
   on white).
2. **Color is a verdict.** Exactly three hues, each tied to one Warden effect:
   - **Allow** — cool teal (`--allow`). Quiet: text and hairlines, never a big fill.
   - **Held** (require approval) — warm amber, called **ember** (`--approval`). The only color
     that may glow and move.
   - **Deny** — signal red (`--deny`). Loud, solid, unambiguous.
3. **Only what waits on a human moves.** Ambient motion is reserved for (a) the thinking orb
   while the assistant works and (b) the ember border beam on a pending approval. Everything
   else is still.
4. **Fault is not deny.** A network error, a crashed connector or a failed tool is *not* a
   decision. Faults are monochrome (dashed hairline + warning glyph). Red means "Warden said no",
   nothing else.
5. **Never color alone.** Every verdict is also a word ("Erlaubt / Allowed") and a glyph
   (shield-check, clock, ban). Color is redundant encoding, never the only one (WCAG 1.4.1).
6. **One hero.** Each screen has one obvious thing to do: the composer on chat, the pending
   card on approvals, the what-if run in the console.
7. **Hairlines, not boxes.** Structure comes from 1px low-contrast borders and space, not
   shadows, fills or gradients.

### The verdict trail

Each assistant turn shows a **verdict trail** next to the agent name: one small tick per
Warden decision in that turn, in order, in its verdict color (`● ● ◆ ✕`). The activity rail
below it is a hairline whose nodes light up in the same colors. Scrolling a long conversation,
you see the decisions without reading a word. Screen readers get the summary as text
("3 decisions: 2 allowed, 1 denied").

---

## 2. Color tokens

Tokens are CSS variables holding HSL triplets (`H S% L%`), consumed by Tailwind as
`hsl(var(--token) / <alpha>)`. Dark is the default theme (`html.dark`); light is opt-in via the
theme toggle and stored in `localStorage["steward.theme"]`.

### Neutrals (ink)

| Token                 | Dark          | Light         | Use                                    |
| --------------------- | ------------- | ------------- | -------------------------------------- |
| `--background`        | `0 0% 3%`     | `0 0% 98.5%`  | Canvas                                 |
| `--card`              | `0 0% 6%`     | `0 0% 100%`   | Raised surface (composer, cards)       |
| `--popover`           | `0 0% 8%`     | `0 0% 100%`   | Menus, dialogs, toasts                 |
| `--secondary`/`--muted` | `0 0% 10%`  | `0 0% 95%`    | Insets, user bubble, chips             |
| `--accent`            | `0 0% 13%`    | `0 0% 92%`    | Hover / selected                       |
| `--border`            | `0 0% 15%`    | `0 0% 88%`    | Hairlines                              |
| `--input`             | `0 0% 22%`    | `0 0% 78%`    | Control borders                        |
| `--foreground`        | `0 0% 95%`    | `0 0% 7%`     | Primary text, primary button fill      |
| `--muted-foreground`  | `0 0% 62%`    | `0 0% 36%`    | Secondary text (≥ 4.5:1 on every surface) |
| `--subtle`            | `0 0% 46%`    | `0 0% 55%`    | Decorative only (icons, rules), never body text |
| `--ring`              | `0 0% 92%`    | `0 0% 9%`     | Focus ring                             |

### Verdicts (the only chroma)

| Token                    | Dark           | Light          | Meaning                       |
| ------------------------ | -------------- | -------------- | ----------------------------- |
| `--allow`                | `166 62% 50%`  | `170 85% 26%`  | Allowed: ticks, nodes, hairlines |
| `--allow-foreground`     | `164 70% 66%`  | `170 90% 22%`  | Allowed: text                 |
| `--allow-soft`           | `166 45% 8%`   | `166 55% 94%`  | Allowed: chip fill            |
| `--approval` (ember)     | `34 96% 56%`   | `30 95% 40%`   | Held: ticks, beam, borders    |
| `--approval-foreground`  | `38 100% 68%`  | `26 90% 28%`   | Held: text                    |
| `--approval-soft`        | `32 60% 8%`    | `40 95% 93%`   | Held: chip fill               |
| `--deny`                 | `0 84% 60%`    | `0 74% 45%`    | Denied: ticks, solid fills    |
| `--deny-foreground`      | `0 95% 75%`    | `0 75% 36%`    | Denied: text                  |
| `--deny-soft`            | `0 50% 9%`     | `0 85% 96%`    | Denied: chip fill             |

`--destructive` aliases `--deny`: destructive actions (delete all memory, kill switch) *are*
refusals of authority, so they borrow the deny color. Charts use a grey ramp
(`--chart-1` … `--chart-5`), never verdict colors.

### What may be colored — exhaustive list

Decision chips and rule ids next to them · verdict trail ticks and rail nodes · the pending
approval card (ember border + beam) and its approve/deny buttons · votes on an approval ·
four-eyes progress · the kill-switch banner and kill-switch options · what-if results and trace
outcomes · audit effects · the approvals badge (ember: something is held for you) · memory
refusals (policy denied storing a fact). Anything else stays grey.

---

## 3. Typography

Font: **Geist** (variable, OFL) for UI, **Geist Mono** for code, rule ids, tool names and
eyebrows. Both are bundled via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`
(pinned) — no external font requests.

| Role       | Size / line   | Weight | Tracking  | Use                                    |
| ---------- | ------------- | ------ | --------- | -------------------------------------- |
| Display    | 44–56 / 1.05  | 500    | −0.035em  | Chat greeting, login hero              |
| H1         | 30 / 1.15     | 500    | −0.03em   | Page titles                            |
| H2         | 18 / 1.3      | 500    | −0.015em  | Section titles                         |
| H3         | 15 / 1.35     | 600    | −0.01em   | Card titles                            |
| Body       | 15 / 1.65     | 400    | 0         | Answers, descriptions                  |
| Small      | 13 / 1.5      | 400    | 0         | Meta, table cells                      |
| Eyebrow    | 11 / 1.4 mono | 500    | +0.08em, uppercase | Section labels ("ZU ENTSCHEIDEN") |
| Code       | 12–13 mono    | 400–500 | 0        | Tool names, rule ids, args             |

Numbers use `tabular-nums`. Never use more than two weights on one screen.

---

## 4. Space, radii, hairlines

- **Spacing** on a 4px grid: 4, 8, 12, 16, 24, 32, 48, 64, 96. Sections are separated by 48–64px;
  chat turns by 40px.
- **Measure:** the chat column is 760px max; pages 960px; the console 1200px with a 208px rail.
- **Radii:** `--radius` = 14px for cards; controls 10px; composer 28px; pills and chips full;
  insets (args, code) 10px.
- **Elevation:** none in dark. Depth = surface step (`background` → `card` → `popover`) plus a 1px
  `--border` hairline. Light mode may add one soft shadow on popovers only
  (`0 8px 30px -12px rgb(0 0 0 / .18)`).
- **Texture:** a faint 48px grid masked by a radial fade sits behind hero areas (login, empty chat),
  and a 3% monochrome film grain covers the canvas. Both are `position: fixed` pseudo-elements at
  `z-index: -1`: they paint under the content and contrast checkers (axe) measure text against
  the real background color instead of giving up on a background image.

---

## 5. Motion

| Token          | Value                              | Use                                 |
| -------------- | ---------------------------------- | ----------------------------------- |
| `--dur-micro`  | 120ms                              | Hover, press, color changes         |
| `--dur-enter`  | 220ms                              | Timeline items, toasts, dialogs     |
| `--dur-layout` | 320ms                              | Composer docking, panels            |
| `--ease-out`   | `cubic-bezier(0.2, 0.8, 0.2, 1)`   | Everything entering                 |
| `--ease-in-out`| `cubic-bezier(0.6, 0, 0.2, 1)`     | Things leaving or moving            |

Enter = fade + 4px rise. No bounces, no parallax, no scroll-jacking.

Ambient motion budget: the **thinking orb** (`thinking-orbs`), the **agent avatars** while their
agent works (`bot-avatars`), the **ember beam** on the first pending approval and a faint **mono
beam** on the composer while a turn runs (`border-beam`).

**`prefers-reduced-motion: reduce` → no motion at all**: orbs and avatars get `paused`, beams get
`active={false}` (the ember border stays as a static 1px line), CSS animations and transitions
are cut to 0.01ms.

---

## 6. Components

### Composer (the hero)
- Empty chat: vertically centered under the greeting, 760px wide. With messages: docked at the
  bottom of the column with a fade-out mask above it.
- `card` surface, 1px `--input` hairline, radius 28px, 16px text, auto-grow to 200px.
- Inside, bottom row: voice-mode switch (left), send button (right): a 36px white circle with a
  black arrow; disabled = 40% opacity. While a turn runs it becomes a stop square (outline) and the
  composer gets a faint `mono` line beam (strength 0.45) along its bottom edge.
- Focus: the whole composer's hairline turns `--ring`, no glow.

### Suggestions
Minimal pills below the composer: hairline, `muted-foreground` text, 13px, full radius; hover =
foreground text + `accent` fill. Max two rows.

### Messages
- **User:** right-aligned bubble, `secondary` fill, radius 22px (top-right 6px), no avatar.
- **Assistant:** no bubble. Header row: agent avatar (24px), name in 13px medium, verdict trail.
  While working, a status line with a 20px orb and the phase ("searching…", "waiting for
  approval…", "writing…"). Answer in 15/1.65 prose; streaming caret is a thin foreground bar.
- Cost chip at the end: hairline pill, mono numbers.

### Thinking orb mapping
The orb is never a free-floating spinner: it is the **halo** behind Steward's presence (§7).

| Assistant phase                | `state`      | Tint                 |
| ------------------------------ | ------------ | -------------------- |
| Planning (no tool yet)         | `solving`    | none                 |
| Tool call in flight            | `searching`  | none                 |
| Waiting for an approval        | `breathing`  | ember (`color` prop) |
| Writing the answer             | `composing`  | none                 |
| Voice: listening               | `listening`  | none                 |

The ember-tinted orb is legitimate: a held call *is* a Warden verdict.

### Agent avatars
`bot-avatars`, one body per agent, all grey, `smooth` shading:
orchestrator = **Steward** = `droid` (lightest ink, the presence of §7), research = `ghost`
(mid grey), action = `mech` (darker grey). Sub-agents only appear as small companions next to
Steward when a handoff happens in the running turn, `state="working"` while their step runs.

### Decision chip
Pill, 11–12px, glyph + word, verdict `soft` fill, verdict hairline at 35%, verdict `foreground`
text, then the rule id in mono `muted-foreground`. Unknown effects render monochrome.

### Activity rail (timeline)
A 1px vertical hairline at the avatar's center. Each step is a node on the rail:
grey hollow dot = running / local, verdict-colored dot = decided. Tool name in mono 13px, chip,
status word. Sub-agent steps indent 24px with their own avatar. Handoffs are a dashed hairline row
"→ Research agent · skill". Arguments/results open in an inset (`muted` fill, mono 12px).

### Approval card
`card` surface, radius 14px. Eyebrow in mono ember: "HELD BY WARDEN · rule". Title = tool name in
mono. Exact arguments in an inset. Approvers, four-eyes progress (teal segments), votes as verdict
pills. Actions: **Approve** (teal fill, dark text) and **Deny** (hairline, red text). The *first*
pending card on screen is wrapped in `<BorderBeam colorVariant="gold" size="md">`; other pending
cards keep a static ember hairline. Decided cards drop all color except their status chip.

### Citation card + page lightbox
Monochrome hairline row: page thumbnail (72×96, hairline, radius 8), document title + page in
mono 12px, the quote in 14px with a 2px foreground left rule, "verified quote" with a check glyph
(grey — verification is not a Warden verdict). The lightbox is a dialog on a 70% black scrim
with a 2px blur: page image on white, quote marked with a foreground underline highlight.

### Tables
No zebra, no vertical lines. Header: mono eyebrow style. Rows: 1px hairline, 44px min height,
hover `accent/40`. Numbers right-aligned, tabular.

### Console nav
A left rail (208px) on ≥ lg with icon + label links; the active link is foreground text on
`accent` with a 2px foreground bar on the left. Below lg it becomes a horizontal scroller.

### Top bar
56px, transparent over the canvas with a bottom hairline. Left: the Steward gate mark + company.
Center: text nav as a segmented pill group. Right: theme toggle, user initials (grey circle),
logout. The approvals badge is the only colored thing in it (ember count when something waits
for *you*).

### Toasts
Bottom-right, `popover` surface, hairline, radius 12, 14px text. Monochrome glyphs. A toast
reporting a verdict (approval decided) may carry the verdict color on its glyph only.

### Banners
- **Test as** (impersonation): inverted ink — foreground fill, background text, a dashed bottom
  hairline. Not a verdict, so not colored; inversion says "you are not yourself" (and Steward's
  presence wears glasses, §7).
- **Kill switch**: solid `--deny` fill, white text (dark ink in dark mode). It is Warden denying
  everything, so it is the loudest red in the product.

### Banners, alerts, faults
`info`: hairline + grey glyph. `warning`: hairline + ember glyph only if it is a verdict
(held), otherwise grey. `error` (fault): dashed hairline + grey warning glyph + foreground text.

---

## 7. Presence — Steward is someone, not a spinner

Like a good copilot, Steward has *one* persistent body: a monochrome `bot-avatars` **droid**
that lives in the chat. It is large (76px, on a 112px liquid disc) above the greeting in the
empty state and docked small (24px on a 36px disc) in the status row right above the composer during a
conversation. Its research / action sub-agents bud off its disc as 20px companions (a
`liquid-gooey` droplet) when a handoff happens, and merge back when they return. It never blocks input, never speaks in bubbles, never celebrates.

Its behavior is a small state machine in `ui/src/lib/presence.ts` (pure, unit-tested), driven by
the chat events of the latest turn plus the composer, voice and session state. The current state
is exposed as `data-presence` on `[data-testid="presence"]`.

| State               | Trigger (priority order, top wins)                          | Body (`bot-avatars`)                  | Halo (`thinking-orbs`) | Rim (verdict) |
| ------------------- | ----------------------------------------------------------- | ------------------------------------- | ---------------------- | ------------- |
| `denied`            | a `deny` decision arrived (flash, 800ms)                    | head shake, `default`                 | —                      | red           |
| `approved`          | an approval in the turn flipped to approved (flash, 1.2s)   | one hop (`poke`), `default`           | —                      | teal          |
| `listening`         | voice push-to-talk held                                     | headphones on, `default`              | `listening`            | —             |
| `awaiting_approval` | turn running and an approval is pending                     | settles, looks up toward the card     | `breathing`, ember     | ember         |
| `calling_tools`     | turn running, a tool call without result                    | `working`                             | `searching`            | —             |
| `composing`         | turn running, answer tokens streaming                       | `working`                             | `composing`            | —             |
| `thinking`          | turn running, nothing else yet                              | `working`                             | `solving`              | —             |
| `done`              | turn finished (flash, 1.2s)                                 | small nod                             | —                      | —             |
| `error`             | last turn failed or hit a budget stop                       | `sleeping`                            | —                      | —             |
| `typing`            | composer has text and focus                                 | turns toward the composer (pose)      | —                      | —             |
| `paused`            | kill switch on and nothing running                          | `sleeping`, `paused`, dimmed to 45%   | —                      | —             |
| `idle`              | otherwise                                                   | breathing, blinks, glances, follows the cursor (`interactive`), rare jump | — | — |

Modifiers on top of any state: **test-as session** → glasses (`glasses="round"`: it sees through
someone else's eyes); **kill switch** → dimmed. "Done" deliberately has no teal rim: finishing a
turn is not a verdict; teal appears on `approved`, which is.

Reduced motion: avatar `paused`, orb `paused`, no shake/nod/hop — the static pose plus the text
status ("Steward · wartet auf Freigabe") carry the meaning.

---

## 8. libraries.dev components

Six MIT packages from libraries.dev, pinned to exact versions, carry all the ambient life. Each is
wrapped once in `ui/src/components/avatars.tsx` (or `presence.tsx` / `voice-glow` in the chat), so
the theme (`useResolvedTheme`) and reduced motion (`useReducedMotion`) are wired in one place.

| Package | Version | Component | Where | Tuning | Reduced motion |
| --- | --- | --- | --- | --- | --- |
| `thinking-orbs` | 0.3.2 | `ThinkingOrb` | Halo behind Steward's presence; 20px inline orb for "transcribing" | grey ink; `color` = ember only while awaiting approval; `size` 64 drawn at 1.6–2× for the halo | `paused` (static representative frame) |
| `bot-avatars` | 0.2.2 | `BotAvatar` | Steward (droid), research (ghost), action (mech) | grey bodies, `smooth` shading, `interactive` only on Steward, `pose` for typing / approval gaze, `glasses` for test-as, `headphones` while listening | `paused` (still pose of the state); no `poke` hops |
| `border-beam` | 1.4.1 | `BorderBeam` | First pending approval card (`gold`, `md`); composer while a turn runs (`mono`, `line`, strength 0.45) | `staticColors` on the ember beam so it stays amber | `active={false}`; the card keeps a static 1px ember border |
| `voice-glow` | 0.3.0 | `VoiceBeam` | Bottom edge of the composer in voice mode: driven by the mic stream while listening, by the speech-output level while Steward speaks | `mono` (voice is not a verdict), `idle={0}` so silence shows nothing | `active={false}`; the text status ("Ich höre zu …") carries it |
| `liquid-gooey` | 0.2.2 | `Liquid` + `Liquid.Item` | A2A handoff: the research/action companion buds off Steward's disc like a droplet and merges back when the sub-agent returns | `fill` = `--muted`, `blur` 6, `transition` `smooth` (≈350ms), companions scale 0.4 → 1 | `transition={{ duration: 0 }}`: companions appear/disappear without travel |
| `metal-fx` | 2.0.11 | `MetalFx` (`circle`, `silver`) | The Steward mark only: login hero and the app-icon ring in the top bar | `strength` 0.8 (hero) / 0.6 (top bar), never chromatic, never on content or chat buttons | `paused` (the metal silhouette stays, the shader freezes) |

Rules: no other glow or gradient effects exist in the product; never stack two of these on one
element; a beam always means "waiting on a human" (ember) or "Steward is working" (mono).

---

## 9. Voice mode

Voice mode replaces the textarea inside the same composer shell:
- A 44px round hold-to-talk button (foreground fill). While held it inverts, the live transcript
  appears next to it, and Steward's presence puts its headphones on and gets the `listening` halo.
- Transcribing: a 20px orb `working` next to the text. Speaking the answer: a speaker glyph and a "stop reading" ghost
  icon button.
- The composer's bottom edge carries a monochrome `voice-glow` that rises with the microphone
  level while listening and with the speech output while Steward reads the answer aloud.
- The hint under the composer reminds: *approvals are click-only, never by voice*. No approval
  control is ever reachable by voice.

---

## 10. Accessibility

- **Contrast:** body text ≥ 7:1, secondary text ≥ 4.5:1, verdict text on its soft fill ≥ 4.5:1 in
  both themes. Verified by axe (no serious/critical violations) in light and dark.
- **Focus:** 2px solid `--ring` outline, 2px offset, on every interactive element; never removed
  without a replacement. Inside the composer, focus-within draws the ring on the shell.
- **Keyboard:** skip link first; Enter sends, Shift+Enter new line; Space/Enter hold-to-talk;
  dialogs trap focus and close on Escape; tables scroll with the keyboard (focusable wrapper).
- **Semantics:** orbs and avatars are `role="img"` with a localized label, or `aria-hidden` when a
  text label sits next to them. Verdicts are words, not just color. Live regions announce answer
  progress politely.
- **Motion:** see §5 — reduced motion means none.

---

## 11. Do / Don't

| Do | Don't |
| --- | --- |
| Make the primary button white-on-black. | Introduce a brand color "for buttons". |
| Color a chip teal because Warden allowed the call. | Color a "Saved" toast green. |
| Use red only for Warden denials, the kill switch and destructive confirmations. | Use red for a 500 error or a failed fetch — that is a fault, monochrome. |
| Let the first pending approval glow ember. | Add beams, glows or gradients to anything that is not waiting on a human. |
| Pair every verdict color with a word and a glyph. | Rely on a colored dot alone. |
| Keep charts in a grey ramp. | Paint budget bars traffic-light colors. |
| Use mono for tool names, rule ids, args. | Use mono for prose. |
| Give the composer the space; one hero per screen. | Stack cards with shadows around the composer. |
| Pause orbs/avatars and stop beams under reduced motion. | Ship any motion that ignores `prefers-reduced-motion`. |

---

## 12. Not AI slop

Steward is an instrument for people who need to trust it. It should look like a well-made log
viewer that happens to talk, not like a generic "AI assistant" landing page.

| Do | Don't |
| --- | --- |
| Real typographic hierarchy: one display line, eyebrows in mono caps, body at 15px. | Five sizes of bold centered text. |
| Hairline structure, surface steps, left-aligned content in pages and tables. | Glassmorphism blur cards everywhere, centered everything. |
| Show the Warden timeline like an instrument: a rail, mono tool names and rule ids, verdict ticks, tabular timings and costs. | Hide decisions behind "✨ Thinking…" or a vague progress bar. |
| Tabular figures for every number (costs, tokens, counts). | Proportional digits that jitter while streaming. |
| Purposeful empty states: say what will appear here and how to make it appear. | "Nothing here yet! 🎉" with a stock illustration. |
| Sharp details: visible focus rings, `kbd` hints (⏎ send · ⇧⏎ new line · Ctrl/⌘K focus), exact rule ids. | Hover-only affordances, unlabeled icons. |
| A single quiet character (the presence) with a job: showing state. | A mascot that waves, talks or does tricks. |
| Bubbles only for the user, flat 1px edges, no drop shadows. | rounded-2xl bubbles with drop shadows on both sides. |
| Copy that names the thing: "Warden hält den Aufruf an – sara entscheidet." | "Your AI-powered assistant is here to help!" |
| Grey ramp + three verdict hues. | Purple/blue gradients, sparkle icons, rainbow glows, emoji. |

---

## 13. Implementation map

- Tokens: `ui/src/index.css` (`:root` = light, `.dark` = dark), Tailwind mapping in
  `ui/tailwind.config.ts`. Theme default dark (`index.html` pre-paint script, `theme-toggle.tsx`).
- Motion helpers: `ui/src/lib/motion.ts` (`useReducedMotion`, `useResolvedTheme`); shared looks
  (agent bodies, ember hex, effect → verdict tone) in `ui/src/lib/look.ts`.
- Orbs / avatars / beams: `ui/src/components/avatars.tsx` wraps `thinking-orbs@0.3.2`,
  `bot-avatars@0.2.2` and `border-beam@1.4.1`.
- Verdict chip + trail: `ui/src/components/decision.tsx`.
- Presence state machine: `ui/src/lib/presence.ts` (+ `presence.test.ts`), flash timers in
  `ui/src/lib/use-presence.ts`, rendered by `ui/src/components/presence.tsx`.
- Voice glow levels (mic stream, speech output): `ui/src/lib/voice.ts`.
