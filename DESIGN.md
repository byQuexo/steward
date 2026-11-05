# Steward Design System — "Verdict"

Steward is a company assistant whose every tool call is decided by **Warden**, an authorization
layer. The UI is inspired by the quiet, near-black product surfaces of frontier AI labs (think
x.ai / grok.com) and the density of good developer tools (Linear, the Vercel and x.ai consoles):
a dark canvas, white and grey type, small confident type, hairlines, one prompt bar in the middle. It is *inspired by*, not a copy: no xAI names, logos, marks, fonts or assets.

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
3. **Only Steward and what waits on a human move.** Ambient motion is reserved for (a) Steward's
   presence (§7) and (b) the thin ember line on a pending gate. Everything else is still.
4. **Fault is not deny.** A network error, a crashed connector or a failed tool is *not* a
   decision. Faults are monochrome (dashed hairline + warning glyph). Red means "Warden said no",
   nothing else.
5. **Never color alone.** Every verdict is also a word ("Erlaubt / Allowed") and a glyph
   (shield-check, clock, ban). Color is redundant encoding, never the only one (WCAG 1.4.1).
6. **One hero.** Each screen has one obvious thing to do: the composer on chat, the selected
   gate on approvals, the what-if run in the console.
7. **Hairlines, not boxes.** Structure comes from 1px low-contrast borders and space, not
   shadows, fills or gradients.

### The verdict trail

Each Steward turn shows a **verdict trail** next to his name: one small tick per Warden decision
in that turn, in order, in its verdict color (`● ▬ ▬ ◆`). Every line of the activity log below
starts with the same colored mark. Scrolling a long conversation,
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

## 3. Typography and density

Font: **Geist** (variable, OFL) for UI, **Geist Mono** for code, rule ids, tool names and
eyebrows. Both are bundled via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`
(pinned) — no external font requests.

Steward is a tool, not a landing page: the density reference is Linear, the Vercel dashboard and
the x.ai console. Nothing is bigger than it needs to be to read comfortably.

| Role       | Size / line    | Weight | Tracking  | Use                                    |
| ---------- | -------------- | ------ | --------- | -------------------------------------- |
| Greeting   | 24–28 / 1.2    | 600    | −0.025em  | Chat empty state (max two lines), login title |
| H1         | 20 / 1.25      | 600    | −0.02em   | Page titles                            |
| H2         | 15 / 1.3       | 600    | −0.01em   | Console section titles                 |
| Card title | 13.5 / 1.3     | 500    | 0         | Card headers                           |
| Body       | 14 / 1.6       | 400    | 0         | Answers, messages, composer            |
| UI         | 13 / 1.45      | 400–500 | 0        | Nav, buttons, table cells, form labels |
| Meta       | 12–12.5 / 1.45 | 400    | 0         | Descriptions, notes, presence line     |
| Mono       | 11.5–12.5      | 400–500 | 0        | Tool names, rule ids, args, timers     |
| Eyebrow    | 10.5 mono caps | 500    | +0.08em   | Section labels, table headers          |

Numbers use `tabular-nums`. Never more than two weights on one screen.

### Density scale

| Thing                         | Size                                   |
| ----------------------------- | -------------------------------------- |
| Header bar                    | 44px, hairline bottom border           |
| Buttons                       | 28px (`sm`) / 32px (default), radius 6 |
| Inputs, selects               | 32px, radius 6                         |
| Composer                      | 44px single line, grows to 200px       |
| Log line (tool call)          | 28px                                   |
| Table row                     | ~36px (8px padding)                    |
| Badges                        | 18px, radius 4 — only for roles/labels, never for verdicts |
| Content column (chat)         | 680–720px                              |
| Pages / console               | 720 / 1040 / 1200px                    |
| Paddings                      | 12–16px; sections 20–32px apart        |
| Steward                       | 60px on an 80px disc (hero), 20px on a 28px disc (dock) |

---

## 4. Space, radii, hairlines

- **Spacing** on a 4px grid: 4, 8, 12, 16, 24, 32. Chat turns are 28px apart.
- **Radii:** `--radius` = 8px (cards, panels); controls 6px; gates and insets 4–5px; the composer
  10px. No full pills except the verdict trail ticks and the user initials.
- **Elevation:** none in dark. Depth = surface step (`background` → `card` → `popover`) plus a 1px
  `--border` hairline. Popovers (user menu, toasts) get one soft shadow.
- **Texture:** a faint 48px grid masked by a radial fade sits behind hero areas (login, empty chat),
  and a 3% monochrome film grain covers the canvas. Both are `position: fixed` pseudo-elements at
  `z-index: -1`: they paint under the content and contrast checkers (axe) measure text against
  the real background color instead of giving up on a background image.

---

## 5. Motion

| Token          | Value                              | Use                                 |
| -------------- | ---------------------------------- | ----------------------------------- |
| `--dur-micro`  | 120ms                              | Hover, press, color changes         |
| `--dur-enter`  | 220ms                              | Log lines, presence lines, toasts   |
| `--dur-layout` | 320ms                              | Composer docking, panels            |
| `--ease-out`   | `cubic-bezier(0.2, 0.8, 0.2, 1)`   | Everything entering                 |
| `--ease-in-out`| `cubic-bezier(0.6, 0, 0.2, 1)`     | Things leaving or moving            |

Enter = fade + 4px rise. No bounces, no parallax, no scroll-jacking. The greeting types itself
out once per page load (28ms per character).

Ambient motion budget: Steward himself (§7), the ember line on the first pending gate and a
faint mono line under the composer while a turn runs (`border-beam`).

**`prefers-reduced-motion: reduce` → no motion at all**: orbs and avatars get `paused`, beams get
`active={false}` (the gate keeps its static ember rule), the greeting appears at once, CSS
animations and transitions are cut to 0.01ms.

---

## 6. Components

### Header bar
A thin 44px bar with a hairline bottom border, nothing floating or centered.
- **Left:** the 20px Steward mark (metal ring), "Steward" in 13px semibold, the company in muted
  12px. Then the nav as **plain text links** (13px, muted; the active one is foreground with a
  1px underline sitting on the bar's hairline). The approvals count is a tiny ember square
  (16px, mono 10px) — the only color in the bar unless an indicator is on.
- **Right:** indicators only when active — **kill switch** (solid red, 24px, links to the
  console) and **test as** (inverted ink, with "Beenden") — then the theme toggle (28px icon) and
  the user's initials (28px circle) opening a small menu: name, roles in mono, sign out.
- Mobile: the nav moves into a menu button; indicators shrink to their icons.

### Composer
- 44px single line (14px text) that grows to 200px; `card` surface, 1px `--input` hairline,
  radius 10px; focus turns the hairline `--ring`. Send is a 32px inverted square (radius 6).
- While a turn runs: the send button becomes a stop square and a faint mono `border-beam` line
  runs along the bottom edge.
- Below: voice switch (11.5px) left, `kbd` hints right (⏎ send · ⇧⏎ new line · Ctrl/⌘K focus).
- Empty chat: centered under Steward and his greeting. With messages: docked at the bottom of the
  720px column, with Steward's presence line right above it.

### Suggestions
Small hairline chips under the hero composer: 28px, radius 6, 12.5px muted text.

### Messages
- **User:** right-aligned, `secondary` fill, radius 10 (top-right 3), 14px, no avatar.
- **Steward:** no bubble. A 12px header ("Steward" + verdict trail), the activity log, the answer
  in 14/1.6 prose, sources, then the cost in mono 11px.

### Activity log
An instrument log, one hairline gutter on the left, **one line per step**:

`● ticket.get  Erlaubt  scope.granted · ausgeführt                       ›`

colored verdict dot (shape doubles color: ● allow, ◆ held, ▬ deny) · mono tool name · verdict
word in its color · rule id in muted mono · ran / not run. No pills, no boxes. The line is a
`<details>` summary: click (or Enter) expands the exact arguments and the result in a small inset.
Sub-agent lines indent 16px and name their agent; handoffs are a line "→ Recherche-Agent ·
skill"; notices (abstained, budget, faults) are one muted line with a glyph.

### Gate (approval)
A call Warden held for a human is a **gate**, an instrument block inline in the log:

```
▌⏸ GATE  ticket.close  ticket-close-approval            wartet auf ines   0:42
▌ ticket_id  t-2051
▌ Die Freigabe gilt nur für genau diese Argumente – per Klick, nie per Sprache.
```

- Radius 5px, hairline border, a 2px **ember left rule**; one mono header line (11.5px) with the
  tool, the rule, who it waits for, four-eyes as `1/2`, and a **live timer**.
- The exact arguments as an aligned mono key/value list — nothing else. The explanation is one
  11px footnote.
- While pending, the first gate on screen gets a thin `border-beam` **line** (gold) along its top
  edge. No big glow, no card shadow.
- Resolved gates **collapse to one line**: `✓ freigegeben von sara · GATE crm.update_deal · 0:12`
  (teal) or `✗ abgelehnt von ines` (red), `abgelaufen` (grey).

### Inbox (approvals page)
A dense list, one 40px row per gate: ◆ · tool (mono) · four-eyes `1/2` · requester · rule
(muted mono) · age (live, mono) · compact actions **Freigeben ⏎** (teal) / **Ablehnen** (red text).
The selected row has an ember 2px left bar; a sticky detail pane on the right shows the gate
header, requester / rule / agent / votes, the exact arguments, the optional reason and the
footnote. Keyboard: `j`/`k` move, `⏎` approves the selected gate (never while typing in a field).
"My requests" below is the same row without actions, with a status word.

### Decision word (elsewhere)
Audit, what-if and connectors use the same dot · word · rule fragment as the log, never a pill.

### Citation card + page lightbox
Monochrome hairline row (radius 6): 54×72 page thumbnail, document and page in mono 11px, the
quote in 12.5px with a 1px foreground left rule, "verified quote" in grey (verification is not a
Warden verdict). The lightbox is a dialog on a 70% black scrim: page image on white, quote marked
with a foreground underline highlight.

### Tables
No zebra, no vertical lines. Header: mono eyebrow 10.5px, 32px high. Rows ~36px, hairline,
hover `accent/40`. Numbers right-aligned, tabular.

### Console nav
A 184px left rail on ≥ lg: 28px text links with a 14px icon; the active one is foreground on
`accent` with a 1px foreground tick on the left. Below lg it becomes a horizontal scroller.

### Toasts
Bottom-right, `popover`, hairline, radius 6, 13px. Monochrome glyphs; faults use a dashed border.

### Alerts and faults
`info`: hairline + grey glyph. `warning`: grey. `error` (fault): dashed hairline + grey glyph.
`held` / `denied` variants exist only for verdicts (e.g. memory refused by policy).

---

## 7. Presence — Steward is someone, not a spinner

Like a good copilot, Steward has *one* persistent body: a monochrome `bot-avatars` **droid**
that lives in the chat, and he **says who he is**. In the empty state he sits above his greeting
(60px on an 80px liquid disc), greets by first name and time of day in first person — "Guten
Abend, Ivo. Ich bin Steward." plus one short line — typed out once. During a conversation he is
docked small (20px on a 28px disc) right above the composer, with **one speech line** next to him
that narrates what he does, in first person. His research / action sub-agents bud off his disc
as small companions (a `liquid-gooey` droplet) when a handoff happens and merge back when they
return. He never blocks input, never talks in bubbles, never celebrates.

The behavior is a small state machine in `ui/src/lib/presence.ts` (pure, unit-tested), driven by
the chat events of the latest turn plus composer, voice and session state; timers (flashes,
dozing, glances) live in `ui/src/lib/use-presence.ts`. The state is exposed as `data-presence`
on `[data-testid="presence"]`.

| State               | Trigger (priority order, top wins)                         | Body (`bot-avatars`)                 | Halo (`thinking-orbs`) | Rim     | Line (de)                                        |
| ------------------- | ---------------------------------------------------------- | ------------------------------------ | ---------------------- | ------- | ------------------------------------------------ |
| `denied`            | a `deny` decision arrived (flash, 800ms)                   | head shake                           | —                      | red     | Darf ich nicht – Warden sagt nein.               |
| `approved`          | an approval flipped to approved (flash, 1.2s)              | one hop                              | —                      | teal    | Sara hat zugestimmt – weiter geht’s.             |
| `listening`         | voice push-to-talk held                                    | headphones on                        | `listening`            | —       | Ich höre zu …                                    |
| `awaiting_approval` | turn running and a gate is pending                         | settles, looks up toward the gate    | `breathing`, ember     | ember   | Warden hält das an. Ines muss zustimmen.         |
| `calling_tools`     | turn running, a call without result                        | `working`                            | `searching`            | —       | Ich frage Warden, ob ich Ticket t-2051 darf … → Ich lese Ticket t-2051 … / Ich rufe Deal d-1007 auf … |
| `composing`         | turn running, answer tokens streaming                      | `working`                            | `composing`            | —       | Ich schreibe die Antwort …                       |
| `thinking`          | turn running, nothing else yet (or a handoff just happened) | `working`                           | `solving`              | —       | Ich überlege … / Ich gebe das an den Recherche-Agenten. |
| `done`              | turn finished (flash, 1.2s)                                | small nod                            | —                      | —       | Erledigt.                                        |
| `paused`            | kill switch on and nothing running                         | `sleeping`, frozen, dimmed to 45%    | —                      | —       | Pause – Schreibaktionen sind gestoppt.           |
| `typing`            | composer has text and focus                                | turns toward the composer            | —                      | —       | Ich lese mit …                                   |
| `error`             | last turn failed or hit a budget stop                      | `sleeping`                           | —                      | —       | Das hat nicht geklappt. / Budget erreicht – ich halte an. |
| `dozing`            | no key, click or wheel for 60s                             | `sleeping` (wakes on any input)      | —                      | —       | Ich döse kurz. Schreib einfach los.              |
| `idle`              | otherwise                                                  | blinks, eyes follow the cursor, a glance at the composer every 12–22s, a rare jump | — | — | Bereit. Frag mich etwas. |

- Tool targets come from the events: `ticket_id` → "Ticket t-2051", `deal_id` → "Deal d-1007",
  otherwise the tool name; read-ish tools (`get/list/search/…`) are "lesen", others "aufrufen".
- **Poke:** clicking (or Enter on) Steward makes him hop and say one short line about what he can
  do for *this* user: "Ich kann 9 Werkzeuge für dich nutzen, z. B. …", one of the user's
  suggestions, or "Alles, was ich tue, prüft Warden vorher." (4.5s, then back to his state line).
- **Lines** fade in, one at a time; a state change replaces a poke line. All lines are in de and
  en (`presence.say.*`, `presence.click.*`).
- **Modifiers:** test-as session → glasses (he sees through someone else's eyes) and the idle
  line "Testsitzung – ich arbeite nur lesend."; kill switch → dimmed.
- "Done" deliberately has no teal rim: finishing a turn is not a verdict; teal appears on
  `approved`, which is.
- **Reduced motion:** avatar and orb `paused`, no shake/nod/hop/glance, no typing — the still pose
  plus the text line carry the meaning.

---

## 8. libraries.dev components

Six MIT packages from libraries.dev, pinned to exact versions, carry all the ambient life. Each is
wrapped once in `ui/src/components/avatars.tsx` (or `presence.tsx` / `voice-glow` in the chat), so
the theme (`useResolvedTheme`) and reduced motion (`useReducedMotion`) are wired in one place.

| Package | Version | Component | Where | Tuning | Reduced motion |
| --- | --- | --- | --- | --- | --- |
| `thinking-orbs` | 0.3.2 | `ThinkingOrb` | Halo behind Steward's presence; 20px inline orb for "transcribing" | grey ink; `color` = ember only while awaiting approval; preset 64 (hero) / 32 (dock) drawn at 1.2× the disc | `paused` (static representative frame) |
| `bot-avatars` | 0.2.2 | `BotAvatar` | Steward (droid), research (ghost), action (mech) | grey bodies (`saturation` 0), `smooth` shading, `interactive` on Steward (eyes follow the cursor, click = hop), `pose` for typing / glance / gate gaze, `glasses` for test-as, `headphones` while listening | `paused` (still pose of the state); no `poke` hops |
| `border-beam` | 1.4.1 | `BorderBeam` | Always `size="line"`: along the top edge of the first pending gate (`gold`), under the composer while a turn runs (`mono`, strength 0.45) | `staticColors` on the ember line so it stays amber | `active={false}`; the gate keeps its static ember rule |
| `voice-glow` | 0.3.0 | `VoiceBeam` | Bottom edge of the composer in voice mode: driven by the mic stream while listening, by the speech-output level while Steward speaks | `mono` (voice is not a verdict), `idle={0}` so silence shows nothing | `active={false}`; the text status ("Ich höre zu …") carries it |
| `liquid-gooey` | 0.2.2 | `Liquid` + `Liquid.Item` | A2A handoff: the research/action companion buds off Steward's disc like a droplet and merges back when the sub-agent returns | `fill` = `--accent`, `blur` 4–6, `transition` `smooth` (≈350ms), companions scale 0.35 → 1 | `transition={{ duration: 0 }}`: companions appear/disappear without travel |
| `metal-fx` | 2.0.11 | `MetalFx` (`circle`, `silver`) | The Steward mark only: login hero (44px) and the app-icon ring in the header (20px) | `strength` 0.85 / 0.6, never chromatic, never on content or chat buttons; the glyph sits above the canvas | `paused` (the metal silhouette stays, the shader freezes) |

Rules: no other glow or gradient effects exist in the product; never stack two of these on one
element; a beam always means "waiting on a human" (ember) or "Steward is working" (mono).

---

## 9. Voice mode

Voice mode replaces the textarea inside the same composer shell:
- A 32px hold-to-talk button (foreground fill). While held it inverts, the live transcript
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
- **Keyboard:** skip link first; Enter sends, Shift+Enter new line, Ctrl/⌘K focuses the composer;
  Space/Enter hold-to-talk; log lines expand with Enter; inbox `j`/`k`/`⏎`; Steward is a button
  (Enter pokes him); the user menu closes on Escape; dialogs trap focus; tables scroll with the
  keyboard (focusable wrapper).
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
| Let the first pending gate carry a thin ember line. | Add beams, glows or gradients to anything that is not waiting on a human. |
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
| Real typographic hierarchy at tool density: a 20px title, 14px body, 12px meta, mono caps eyebrows. | Five sizes of bold centered text, 56px headlines. |
| Hairline structure, surface steps, left-aligned content in pages and tables. | Glassmorphism blur cards everywhere, centered everything. |
| Show the Warden timeline like an instrument: one line per call, mono tool names and rule ids, verdict words, live gate timers. | Pill-in-pill badges, big glowing rounded cards, explanatory paragraphs on every gate. |
| Tabular figures for every number (costs, tokens, counts). | Proportional digits that jitter while streaming. |
| Purposeful empty states: say what will appear here and how to make it appear. | "Nothing here yet! 🎉" with a stock illustration. |
| Sharp details: visible focus rings, `kbd` hints (⏎ send · ⇧⏎ new line · Ctrl/⌘K focus), exact rule ids. | Hover-only affordances, unlabeled icons. |
| A single quiet character with a job: Steward says, in one short first-person line, what he does. | A mascot that dances, talks in bubbles or does tricks. |
| Bubbles only for the user, flat 1px edges, no drop shadows. | rounded-2xl bubbles with drop shadows on both sides. |
| Copy that names the thing: "Warden hält den Aufruf an – sara entscheidet." | "Your AI-powered assistant is here to help!" |
| Grey ramp + three verdict hues. | Purple/blue gradients, sparkle icons, rainbow glows, emoji. |

---

## 13. Implementation map

- Tokens: `ui/src/index.css` (`:root` = light, `.dark` = dark), Tailwind mapping in
  `ui/tailwind.config.ts`. Theme default dark (`index.html` pre-paint script, `theme-toggle.tsx`).
- Motion helpers: `ui/src/lib/motion.ts` (`useReducedMotion`, `useResolvedTheme`); shared looks
  (agent bodies, ember hex, effect → verdict tone) in `ui/src/lib/look.ts`.
- Orbs / avatars / beams / metal mark: `ui/src/components/avatars.tsx`.
- Header bar (indicators, user menu): `ui/src/components/app-shell.tsx`.
- Verdict word + trail: `ui/src/components/decision.tsx`; log lines: `ui/src/components/activity.tsx`;
  gate: `ui/src/components/approval-card.tsx` (timer in `ui/src/lib/clock.ts`); inbox:
  `ui/src/pages/approvals.tsx`.
- Presence state machine and first-person lines: `ui/src/lib/presence.ts` (+ `presence.test.ts`),
  timers (flashes, dozing, glances) in `ui/src/lib/use-presence.ts`, rendered by
  `ui/src/components/presence.tsx`; the typed greeting in `ui/src/pages/chat.tsx`.
- Voice glow levels (mic stream, speech output): `ui/src/lib/voice.ts`.
