<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# TranscriptApp Open Findings — Design

**Date:** 2026-08-06
**Source review:** [`docs/ux-reviews/TranscriptApp.md`](../../ux-reviews/TranscriptApp.md)
**Predecessor:** [`2026-08-06-transcript-ux-findings-design.md`](2026-08-06-transcript-ux-findings-design.md)

## Goal

Close all eleven findings still `open` in `docs/ux-reviews/TranscriptApp.md`, leaving that review
with no open findings.

## Scope

| Id                                       | Sev | What it is                                                |
| ---------------------------------------- | --- | --------------------------------------------------------- |
| `transcript-no-timestamps`               | Med | `event.ts` is on the wire and never rendered              |
| `transcript-no-aria-live`                | Med | Streamed events are never announced to a screen reader    |
| `transcript-no-design-system-primitives` | Med | `StatusBanner` is bespoke; a literal `●` sits in its copy |
| `transcript-hardcoded-spacing`           | Med | Every gap, padding, and radius is a one-off literal       |
| `transcript-no-focus-visible`            | Med | The `<summary>` disclosure has no hover/focus/cursor rule |
| `transcript-dead-end-error-states`       | Med | Terminal states say what happened, never what to do next  |
| `transcript-timeline-rail-invisible`     | Low | The 2px rail uses `--border` against a near-black page    |
| `transcript-unknown-payload-raw-json`    | Low | Unrecognised payloads dump full-height JSON inline        |
| `transcript-banner-status-undifferentiated` | Low | `error` and `invalid-token` render identically           |
| `transcript-dim-text-contrast`           | Low | The longest bodies use the most recessive token           |
| `transcript-no-live-scroll-affordance`   | Low | A live session grows off-screen with no cue               |

### Out of scope

`docs/ux-reviews/SettingsApp.md`'s two residues and `docs/ux-reviews/PluginsSection.md`'s one stay
`open`. The plugins finding in particular starts server-side —
`src/plugins/registry-context-eligibility.ts:102` collapses six distinct plugin states into a single
client-visible `inactive` reason — so it is a different subsystem with a different risk profile and
does not belong in a presentation-layer project.

### Corrections to the record

Two premises this project inherits were wrong and are corrected here.

- **A spacing scale exists.** The predecessor spec (line 48) states there is no `--space-*` scale in
  `tokens.css`, "only `--radius: 6px`". That is wrong — it searched for the wrong prefix.
  `client/shared/tokens.css` carries `--s1`…`--s9` (4px base), `--gap-group/section/field/inline/tight`,
  `--radius-control`, `--radius-pill`, `--row-h`, `--control-h-sm/md/lg`, `--content-max`, and
  `--table-max`. `transcript-hardcoded-spacing` is therefore substantially more actionable than that
  spec claimed: nearly every literal has a token target.
- **`transcript-dim-text-contrast` is not an accessibility defect.** `client/shared/tokens.css:21`
  documents `--text-dim` at 5.69:1 on `--bg` and 4.70:1 on `--surface-hover` — it clears WCAG SC
  1.4.3. The finding keeps its id and is re-scoped from dimension 6 (Accessibility) to dimension 1
  (Visual hierarchy & scanning): the complaint that survives is that the *longest* blocks render in
  the *most recessive* token, which inverts hierarchy. Its existing heading already says exactly
  this; only the `Dimension:` line is wrong.

## Constraints that shape the architecture

**Every pure module must ship in the same commit as its consumer.** `knip --strict` analyses
production entry points only, so a module imported solely by its own test reads as an unused file
and fails the write-hook gate. The predecessor project hit this with `empty-state.ts`. There is no
`knip.json` and no ignore mechanism in use; adding one is not an option. This rules out a
"all logic first, all markup second" split and dictates the vertical-slice structure below.

**The viewer stays non-interactive.** It currently contains zero buttons and zero click handlers.
Two decisions preserve that: the terminal states get copy rather than controls (Slice 3), and the
scroll affordance is automatic rather than a "jump to latest" button (Slice 4).

## Architecture

Five vertical slices. Each pairs a pure, table-driven module with the component that consumes it;
the closing slice is pure styling. This follows the predecessor's pattern — concentrate branching in
pure functions that are exhaustively testable without mounting a component, and keep branch-heavy
Svelte markup out of the mutation ratchet's way.

### Slice 1 — Banner rebuild

Closes `transcript-no-design-system-primitives` and `transcript-banner-status-undifferentiated`.

**New — `client/transcript/banner.ts`** (pure):

```ts
export interface BannerCopy {
  label: string
  tone: StatusTone
  dot: boolean
}

export function bannerFor(status: ViewerStatus): BannerCopy
```

Backed by a `Record<ViewerStatus, BannerCopy>`, so a new `ViewerStatus` fails to compile rather than
falling through to a default.

| status               | label                       | tone      | dot |
| -------------------- | --------------------------- | --------- | --- |
| `connecting`         | `Connecting…`               | `info`    | no  |
| `live`               | `Live`                      | `accent`  | yes |
| `finished`           | `Session finished`          | `neutral` | no  |
| `recording-disabled` | `Live only — not retained`  | `warn`    | no  |
| `invalid-token`      | `Link invalid or expired`   | `danger`  | no  |
| `error`              | `Reconnecting…`             | `warn`    | no  |

**Modified — `client/transcript/components/StatusBanner.svelte`.** Collapses to a `Pill`:

```svelte
<Pill tone={b.tone} dot={b.dot}>{b.label}</Pill>
```

wrapped in a `<div role="status">` so status transitions are announced. The bespoke `.tx-banner`
`<style>` block and its `border-radius: 6px` literal are deleted outright. `Dot` supplies the live
indicator, which removes the literal `●` from the `live` copy string — the specific artifact the
primitives finding cites.

`Pill` accepts exactly the six `StatusTone` values (`accent | warn | danger | info | neutral | mute`)
and renders `Dot` itself when `dot` is true, with `glow` on for `accent`. No shared primitive is
modified. This is the first shared *component* imported into the transcript bundle;
`client/shared/tokens.css` is already loaded there (`transcript.css` reads `var(--border)` today),
so `Pill`'s scoped styles need nothing extra.

**Status differentiation.** `error` and `invalid-token` currently both render `--danger` and read as
the same fatal condition. They are not: `error` self-heals — the native `EventSource` reconnects on
its own and `resync()` backfills the gap (`client/transcript/transcript.svelte.ts:39-54`) — while
`invalid-token` is terminal with no in-app recovery. Demoting `error` to `warn` with the label
`Reconnecting…` states what is actually happening and separates the two.

### Slice 2 — Timestamps

Closes `transcript-no-timestamps`.

`TranscriptEventSchema` already carries `ts: z.string()`
(`client/transcript/fetcher-schemas.ts:18`). Nothing on the wire or in the schema changes; the field
is simply read for the first time.

**New — `client/transcript/format-ts.ts`** (pure):

```ts
export function formatEventTime(ts: string): string
```

Parses with `new Date(ts)`. Returns `''` when `Number.isNaN(d.getTime())`, so a malformed `ts`
renders nothing rather than the literal text `Invalid Date`. Otherwise returns a fixed 24-hour
`HH:MM:SS` via `d.toTimeString().slice(0, 8)`.

**Deliberately not `toLocaleTimeString`.** Its output varies with the runtime's ICU locale data, so
the same fixture would render differently across machines and CI, making every screenshot baseline
that contains a timestamp non-deterministic.

**Modified — `client/transcript/components/TimelineEvent.svelte`.** A leading
`<time datetime={event.ts}>{formatEventTime(event.ts)}</time>` column, styled in `--text-dim` — a
short secondary label, which is the correct use of that token under Slice 5's hierarchy rule.

**Modified — `playwright.config.ts`.** Add `timezoneId: 'UTC'` to the `use` block. Local-time
formatting is correct for users but machine-dependent for baselines; pinning the browser timezone
makes every current and future time-rendering shot deterministic. The config has no `timezoneId`
today.

### Slice 3 — Terminal-state copy

Closes `transcript-dead-end-error-states`.

**Modified — `client/transcript/empty-state.ts`.** The `COPY` table stops returning `null` for the
three terminal statuses:

| status               | title                          | hint                                                                                                    |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `recording-disabled` | Live output only               | Nothing is retained for this session. Output appears as it happens and is gone on reload.               |
| `invalid-token`      | This link is no longer valid   | Transcript links expire when the session ends or the link is revoked. Ask the bot for a new link in your chat. |
| `error`              | Connection lost                | Reconnecting automatically — the page will fill in on its own.                                          |

`connecting`, `live`, and `finished` keep their existing copy. Every status now returns a record, so
`emptyStateFor`'s return type narrows from `EmptyStateCopy | null` to `EmptyStateCopy`, and
`TranscriptView`'s `{:else if empty !== null}` simplifies to `{:else}`.

**This reverses the predecessor's decision** that a second block under the banner would dilute it.
The reversal is the finding. With zero events the page is a single small pill on empty space, and a
pill has no room for what to do next. The banner stays the terse persistent status chip; the empty
state carries the explanation and the next step. Mild overlap between a banner label and an empty
state title is normal title/detail structure, not redundancy.

**No buttons.** `invalid-token` has no in-app recovery: transcript links are minted by magi and
posted into chat by the bot (`plugins/acp/index.ts:141`), so the viewer cannot mint one — the honest
affordance is guidance back to chat. `error` already reconnects on its own, so a "Retry" control
would misattribute work the browser is doing. `EmptyState`'s `action` snippet is left unused.

### Slice 4 — Announcements and follow-the-tail

Closes `transcript-no-aria-live` and `transcript-no-live-scroll-affordance`.

**Modified — `client/transcript/TranscriptView.svelte`.** The timeline becomes:

```svelte
<div class="tx-timeline" role="log" aria-live={status === 'live' ? 'polite' : 'off'}>
```

`role="log"` is the ARIA role for an append-only chronological feed, which is exactly what this is.
Gating `aria-live` to the `live` status keeps the history bulk-load — which lands during
`connecting` — from being read out in full; only genuinely new streamed events are announced.

**New — `client/transcript/autoscroll.ts`** (pure):

```ts
export function shouldFollow(scrollY: number, innerHeight: number, scrollHeight: number, slack?: number): boolean
```

Returns `scrollY + innerHeight >= scrollHeight - slack`, with `slack` defaulting to `64`. Pure
arithmetic, so the follow decision is unit-testable without a DOM.

`TranscriptView` runs a single `$effect` keyed on `events.length` that, when `status === 'live'` and
`shouldFollow(window.scrollY, window.innerHeight, document.body.scrollHeight)` is true, calls
`window.scrollTo({ top: document.body.scrollHeight })`. The page itself scrolls — `.tx-wrap` is not
a scroll container — so window geometry is the right measurement.

Two properties matter. A user who has scrolled up is never yanked back to the bottom. And the scroll
is instant, never `behavior: 'smooth'`, which sidesteps `prefers-reduced-motion` entirely rather
than special-casing it.

### Slice 5 — Presentation pass

Closes `transcript-hardcoded-spacing`, `transcript-no-focus-visible`,
`transcript-timeline-rail-invisible`, `transcript-dim-text-contrast`, and
`transcript-unknown-payload-raw-json`. Pure styling and markup; no logic.

**Token migrations** (`client/transcript/transcript.css` and `TimelineEvent.svelte`'s `<style>`):

| Current                          | Becomes                              | Note                     |
| -------------------------------- | ------------------------------------ | ------------------------ |
| `.tx-wrap` padding `1.5rem 1rem 4rem` | `var(--s6) var(--s4) var(--s9)` | bottom 64px → 48px       |
| `.tx-timeline` gap `0.75rem`     | `var(--s3)`                          | 12px, exact              |
| `.tx-ev` padding `0.3rem 0.7rem` | `var(--s1) var(--s3)`                | 4.8/11.2px → 4/12px      |
| flex `gap: 0.5rem` (three rules) | `var(--s2)`                          | 8px, exact               |

**`max-width: 860px` stays a literal**, with a comment explaining why. `--content-max` is 760px and
`--table-max` is 1100px; a monospace view that renders raw JSON and long tool output legitimately
wants neither, and inventing a token with exactly one consumer is worse than a documented number.
Font sizes also stay — there is no font-size token in `tokens.css`, and they are not spacing values.

**Rail:** `.tx-ev`'s `border-left: 2px solid var(--border)` → `var(--strong)` (`#3a464d`), which is
visible against `--bg` and `--surface-1`. The `--accent-dim` override on `.tx-ev--prompt` stays.

**Focus and hover** on `.tx-thought summary`, the only interactive control in the viewer:

```css
.tx-thought summary { cursor: pointer; color: var(--text-muted); }
.tx-thought summary:hover { color: var(--text); }
.tx-thought summary:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

**Hierarchy:** `.tx-thought pre` and `.tx-raw` — the two longest bodies — move from `--text-dim` to
`--text-muted`. `--text-dim` is reserved for short secondary labels (`.tx-prompt__who`, the new
timestamp column). This is the re-scoped `transcript-dim-text-contrast`.

**Unknown payloads:** `.tx-raw` moves inside a disclosure in `TimelineEvent.svelte`:

```svelte
<details class="tx-raw-wrap">
  <summary>unrecognised event</summary>
  <pre class="tx-raw">{described.json}</pre>
</details>
```

so an unrecognised payload is disclosed on demand rather than dumping full-height JSON into the
timeline. The raw fallback itself is unchanged and stays the deliberate terminal branch of
`describeEvent` — the payload originates in magi and arrives typed as `z.unknown()`, so a shape the
mapper does not recognise must still be inspectable. This `<summary>` inherits the same focus rule
above, so the selectors are written to cover both disclosures.

## Files

**New:** `client/transcript/banner.ts`, `client/transcript/format-ts.ts`,
`client/transcript/autoscroll.ts`, and their three test files.

**Modified:** `client/transcript/components/StatusBanner.svelte`,
`client/transcript/components/TimelineEvent.svelte`, `client/transcript/TranscriptView.svelte`,
`client/transcript/empty-state.ts`, `client/transcript/transcript.css`, `playwright.config.ts`,
`tests/client/transcript/empty-state.test.ts`, and the two stories files.

**Unchanged:** `transcript.svelte.ts`, `fetchers.ts`, `sse.ts`, `stitch.ts`, `fetcher-schemas.ts`,
`describe-event.ts`, `TranscriptApp.svelte`, `index.ts`. No state, network, or schema changes
anywhere in this project.

**Never modified:** `client/shared/ui/status-tone.ts` —
`client/settings/fetcher-schemas-analytics.ts:75` consumes the same enum and would be silently
recoloured. No shared `client/shared/ui/` primitive is edited; they are consumed as-is.

## Testing

All four suites are pure — no component mounting — matching how
`tests/client/transcript/` already tests this area.

- **`tests/client/transcript/banner.test.ts`** — all six statuses, asserting `label`, `tone`, and
  `dot`; plus an assertion that no label contains `●`, which is what makes the primitives fix
  regression-proof.
- **`tests/client/transcript/format-ts.test.ts`** — a valid ISO string; a malformed string → `''`;
  an empty string → `''`; and a value whose formatted output is exactly 8 characters.
- **`tests/client/transcript/autoscroll.test.ts`** — at bottom → true; far above → false; exactly at
  the slack boundary → true; one pixel beyond it → false; custom `slack`.
- **`tests/client/transcript/empty-state.test.ts`** — extended: all six statuses now return a record,
  replacing the three `null` assertions.

Run every client suite as:

```
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>
```

A bare `bun test tests/client/...` matches nothing and reports success without executing.

`banner.ts`, `format-ts.ts`, and `autoscroll.ts` are new files, so the mutation ratchet seeds their
baselines on merge. All three are table- or arithmetic-driven, which is the shape that scores well
under Stryker.

## Stories and screenshots

- **`client/transcript/components/StatusBanner.stories.svelte`** — the six states stay; their
  baselines change because the markup is now a `Pill`.
- **`client/transcript/TranscriptView.stories.svelte`** — add empty variants for
  `recording-disabled`, `invalid-token`, and `error`, which previously rendered nothing below the
  banner and now carry copy.
- **`client/transcript/components/TimelineEvent.stories.svelte`** — existing states stay; every shot
  changes because of the new timestamp column. Add an `Unknown shape` variant confirming the
  disclosure is collapsed by default.

Then `bun run shoot:gen` and re-shoot all three groups.

**`pinDefaultViewport()` stays in every visual spec.** The repo invariant is that all specs pin it,
not only those that resize — established by `f81c604a0`, "test(visual): pin the default viewport in
every spec, not only the resizers." The predecessor project dropped it from one spec and had to
restore it in `a34cdfe7e`. Any new spec this project generates must have the call appended below
`@generated-end auto-screenshots`.

## Bookkeeping

- Mark all eleven findings `fixed` in `docs/ux-reviews/TranscriptApp.md`, each with a
  `- **Resolved:**` line naming its commit. The parser throws on a non-`open` status with no
  `Resolved:` line, so this is enforced rather than optional.
- `transcript-dim-text-contrast` additionally changes its `- **Dimension:**` line from
  `6. Accessibility` to `1. Visual hierarchy & scanning`, and its `Resolved:` line must record that
  the accessibility premise was false — `--text-dim` measures 5.69:1 on `--bg` — and that the
  finding was re-scoped to hierarchy before being fixed. Without that note the next reviewer
  re-files it as a contrast bug.
- Ids are never reused, renamed, or deleted.
- `bun run ux:backlog`, then `bun run format`. `docs/ux-reviews/_BACKLOG.md` is generated — never
  hand-edit it.

## Verification

- `bun run check:full`
- The four client suites, run explicitly with the browser-conditions command above
- `bun shoot -g StatusBanner`, `bun shoot -g TimelineEvent`, `bun shoot -g TranscriptView` all green
- `bun run knip` clean after every commit, not only at the end

## Global constraints

- Strict TypeScript; `.js` extensions in import paths.
- Never add lint-disable or type-ignore comments — fix the underlying issue.
- A `max-lines` / `max-lines-per-function` failure is a design signal — split, do not compress.
- Formatter is `oxfmt` via `bun run format`, not prettier.
- Do not modify `client/shared/ui/status-tone.ts` or any `client/shared/ui/` primitive.
- Never hand-edit `docs/ux-reviews/_BACKLOG.md`; regenerate with `bun run ux:backlog`.
- Never hand-edit inside `@generated-begin` / `@generated-end auto-screenshots` regions.
- Never pass `--no-verify` to `git commit`.
