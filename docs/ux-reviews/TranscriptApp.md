<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — TranscriptApp

**Date:** 2026-08-06
**Reviewed:** `client/transcript/TranscriptApp.svelte`, `client/transcript/components/StatusBanner.svelte`, `client/transcript/components/TimelineEvent.svelte`, `client/transcript/transcript.css`, `client/transcript/transcript.svelte.ts`
**States captured:** All six `ViewerStatus` banner states (Connecting, Live, Finished, Recording disabled, Invalid token, Error) · ten `TimelineEvent` branches (Message, Tool call, Tool call failed, Thought, Plan, Permission request, Permission decided, Result, Unknown shape, Long-content overflow) · desktop
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

**Capture caveat:** `client/transcript/TranscriptApp.stories.svelte` declares
`component: StatusBanner`, so the story titled `transcript/TranscriptApp` renders the banner
alone — the composed viewer (header + timeline + wrapper) has no story and therefore no
screenshot at any viewport. Findings about the composed layout below are drawn from source, not
from a shot; that gap is itself filed as `transcript-app-story-renders-banner`.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                    |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | fail  | Raw JSON blocks sit at the same weight as prose; the 2px timeline rail is near-invisible, so events read as one flat run. |
| 2. Affordance & signifiers      | fail  | The two terminal states (`invalid-token`, `error`) offer no next step, and the only control is an unstyled `<summary>`.   |
| 3. Consistency w/ design system | fail  | Uses none of the shared kit (`StatusPill`, `StatusDot`, `EmptyState`, `Panel`); "Live" is a literal `●` character.        |
| 4. Feedback & state             | fail  | A failed tool call renders identically to a completed one, and zero events renders as a blank page in every status.       |
| 5. Content & language           | fail  | The user's own `prompt` event and every agent plan reach the end user as pretty-printed JSON.                             |
| 6. Accessibility                | warn  | Semantic `<h1>`/`<details>` are right, but nothing announces async updates and the longest blocks use the dimmest token.  |
| 7. Responsive / layout          | pass  | Single flex column, `max-width: 860px` with side padding, `white-space: pre-wrap` — long content wraps cleanly.           |
| 8. Spacing, alignment & sizing  | warn  | Internally consistent, but every value is a one-off (`0.85rem`, `0.3rem 0.7rem`, `0.75rem`, `860px`, `6px`) off-scale.    |
| 9. Interaction & micro-states   | fail  | No `:focus-visible`, hover, `cursor`, or busy styling exists anywhere in the three stylesheets.                           |

## Findings

Severity-ranked, highest first.

### [High] The user's own prompt renders as raw JSON

- **Id:** transcript-prompt-raw-json
- **Status:** fixed
- **Resolved:** `47a678dca` (mapper) + `c3d0d8c4c` (rendering) — `describeEvent` gives `prompt` its own branch. The field probe order (`prompt` → `text` → `content`) is a guess: no `prompt` fixture exists anywhere in this repository, so this must be re-verified against a real magi payload. The `raw` JSON fallback means a wrong guess degrades to the old behaviour rather than breaking, but if nobody records the assumption the finding silently reopens with nobody noticing.
- **Dimension:** 5. Content & language
- **Where visible:** Not shot (no story covers `type: 'prompt'`); reproduces via the fallback branch seen in `transcript-TimelineEvent-Unknown-shape-raw-fallback-1.png`
- **Source:** `client/transcript/components/TimelineEvent.svelte:36` — `prompt` is a first-class member of `TRANSCRIPT_EVENT_TYPES` (`client/transcript/fetcher-schemas.ts:9`) but has no branch, so it falls to `<pre class="tx-raw">`
- **Suggested fix:** Give `prompt` its own branch rendering the human's message text, visually attributed and distinct from agent output.

### [High] A failed tool call is indistinguishable from a successful one

- **Id:** transcript-tool-failure-reads-as-success
- **Status:** fixed
- **Resolved:** `47a678dca` (mapper) + `c3d0d8c4c` (rendering) — tool rows take colour from a `StatusTone` and carry a status glyph, so failed reads red with `✖` and completed green with `✔`.
- **Dimension:** 4. Feedback & state
- **Where visible:** `transcript-TimelineEvent-Tool-call-failed-1.png` — "run tests failed" renders in the same green `--accent` as the completed call in `transcript-TimelineEvent-Tool-call-1.png`
- **Source:** `client/transcript/components/TimelineEvent.svelte:26,51-55` — `.tx-tool` is unconditionally `--accent` and `.tx-tool__status` carries no styling
- **Suggested fix:** Drive the tool row's colour and icon from `payload.status` so failed, pending, and completed are distinguishable at a glance.

### [High] Agent plans render as pretty-printed JSON

- **Id:** transcript-plan-raw-json
- **Status:** fixed
- **Resolved:** `47a678dca` (mapper) + `c3d0d8c4c` (rendering) — plans render as a checklist with per-entry `[x]` / `[~]` / `[ ]` marks.
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `transcript-TimelineEvent-Plan-1.png` — a three-step plan occupies 13 lines of braces and quoted keys
- **Source:** `client/transcript/components/TimelineEvent.svelte:29`
- **Suggested fix:** Render plan entries as a checklist whose per-item marker reflects `completed` / `in_progress` / `pending`.

### [High] No empty state — a session with no events yet is a blank page

- **Id:** transcript-no-empty-state
- **Status:** fixed
- **Resolved:** `50b7c7ae7` (`emptyStateFor`) + `a53858ca5` (`TranscriptView`) — `emptyStateFor()` supplies status-aware copy rendered through the shared `EmptyState`; the three statuses whose banner already says everything render nothing.
- **Dimension:** 4. Feedback & state
- **Where visible:** `transcript-TranscriptApp-Connecting-1.png`, `transcript-TranscriptApp-Live-1.png` — everything below the banner is empty
- **Source:** `client/transcript/TranscriptApp.svelte:19-23` — the `{#each}` has no `{:else}`, and the initial state is `{ events: [], status: 'connecting' }` (`client/transcript/transcript.svelte.ts:103`)
- **Suggested fix:** Branch the timeline on zero events with status-appropriate copy, reusing the shared `EmptyState` primitive.

### [Med] The TranscriptApp story renders StatusBanner, not the app

- **Id:** transcript-app-story-renders-banner
- **Status:** fixed
- **Resolved:** `a53858ca5` — the banner states moved to `transcript/StatusBanner` and the composed viewer is storied as `transcript/TranscriptView` with populated, empty, and 640px shots.
- **Dimension:** 3. Consistency w/ design system
- **Where visible:** Every shot under `.storybook-shots/transcript/TranscriptApp.spec.ts/` shows a lone banner chip
- **Source:** `client/transcript/TranscriptApp.stories.svelte:11` — `defineMeta({ title: 'transcript/TranscriptApp', component: StatusBanner })`
- **Suggested fix:** Give the composed viewer a real story (fixture events, stubbed history/SSE) so its layout is covered by the screenshot suite at desktop and narrow widths.

### [Med] Events carry no timestamps

- **Id:** transcript-no-timestamps
- **Status:** fixed
- **Resolved:** `58e928535` — `formatEventTime` renders the existing `ts` field as `HH:MM:SS` in a time gutter. `playwright.config.ts` pins `timezoneId: 'UTC'` so baselines are machine-independent.
- **Dimension:** 5. Content & language
- **Where visible:** Every `TimelineEvent` shot
- **Source:** `client/transcript/components/TimelineEvent.svelte:15-38` — `event.ts` is in the schema (`client/transcript/fetcher-schemas.ts:18`) and never read
- **Suggested fix:** Show each event's time, at least on hover or for the session's start and end, so a reader can judge pace and recency.

### [Med] Asynchronous updates are never announced

- **Id:** transcript-no-aria-live
- **Status:** fixed
- **Resolved:** `060f69111` — the timeline is `role="log"` with `aria-live` gated to the `live` status, so the history bulk-load is not read aloud on open.
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible in a static shot; both the banner and the timeline mutate after mount
- **Source:** `client/transcript/TranscriptApp.svelte:14-24` — no `aria-live` on the header or the `.tx-timeline` container
- **Suggested fix:** Mark the status banner as a polite live region and the timeline as an append-only log so status flips and new events are announced.

### [Med] None of the shared UI kit is used

- **Id:** transcript-no-design-system-primitives
- **Status:** fixed
- **Resolved:** `c889e5bce` — StatusBanner rebuilt on the shared `Pill`/`Dot`; the bespoke style block and the literal `●` are gone.
- **Dimension:** 3. Consistency w/ design system
- **Where visible:** `transcript-TranscriptApp-Live-1.png` — the live indicator is a literal `●` glyph inside the text string, not a status dot
- **Source:** `client/transcript/components/StatusBanner.svelte:8,16-34` — bespoke `.tx-banner` chip where `StatusPill` / `StatusDot` exist
- **Suggested fix:** Rebuild the banner on the shared status primitives so the viewer inherits their colours, sizing, and future fixes.

### [Med] Every spacing and sizing value is a one-off

- **Id:** transcript-hardcoded-spacing
- **Status:** fixed
- **Resolved:** `92a54ebc1` — every gap and padding now uses the `--s*` scale. `max-width: 860px` stays a documented literal: `--content-max` is 760px and `--table-max` 1100px, and neither suits a monospace view.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** All shots
- **Source:** `client/transcript/transcript.css:1-11` (`860px`, `1.5rem 1rem 4rem`, `0.75rem`), `client/transcript/components/TimelineEvent.svelte:44-46` (`0.85rem`, `0.3rem 0.7rem`, `0.5rem`), `client/transcript/components/StatusBanner.svelte:21-23` (`0.4rem 0.7rem`, `6px`)
- **Suggested fix:** Replace the literals with the shared spacing, font-size, and radius tokens the rest of `client/` uses.

### [Med] No focus, hover, or cursor styling on the only interactive control

- **Id:** transcript-no-focus-visible
- **Status:** fixed
- **Resolved:** `92a54ebc1` — both `<summary>` disclosures gained `cursor`, `:hover`, and `:focus-visible` rules using `--focus-ring`.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** `transcript-TimelineEvent-Thought-1.png` — the "thinking" disclosure looks like static text
- **Source:** `client/transcript/components/TimelineEvent.svelte:41-64` — no `summary`, `:hover`, or `:focus-visible` rule in the block
- **Suggested fix:** Give `<summary>` a pointer cursor, a hover tint, and a visible keyboard focus ring.

### [Med] The two terminal states are dead ends

- **Id:** transcript-dead-end-error-states
- **Status:** fixed
- **Resolved:** `426f72d1e` — every status returns empty-state copy naming the consequence and the next step. Deliberately no controls: `invalid-token` has no in-app recovery and `error` already reconnects itself.
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `transcript-TranscriptApp-Invalid-token-1.png`, `transcript-TranscriptApp-Error-1.png` — one line of red text on an otherwise empty page
- **Source:** `client/transcript/components/StatusBanner.svelte:11-12`
- **Suggested fix:** Pair each with a next step — how to obtain a fresh link for `invalid-token`, and a manual retry for `error`.

### [Low] The timeline rail is effectively invisible

- **Id:** transcript-timeline-rail-invisible
- **Status:** fixed
- **Resolved:** `92a54ebc1` — the rail moved from `--border` to `--strong`.
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `transcript-TimelineEvent-Plan-1.png` — the 2px left border is barely separable from the background
- **Source:** `client/transcript/components/TimelineEvent.svelte:45` — `border-left: 2px solid var(--border)`
- **Suggested fix:** Strengthen the rail or vary it per event type so the timeline reads as a sequence of distinct entries.

### [Low] Unrecognised payloads dump JSON to end users

- **Id:** transcript-unknown-payload-raw-json
- **Status:** fixed
- **Resolved:** `92a54ebc1` — the raw payload moved behind an `unrecognised event` disclosure, collapsed by default. The `raw` fallback itself is unchanged and stays deliberate.
- **Dimension:** 5. Content & language
- **Where visible:** `transcript-TimelineEvent-Unknown-shape-raw-fallback-1.png`
- **Source:** `client/transcript/components/TimelineEvent.svelte:36-37`
- **Suggested fix:** Replace the bare dump with a neutral one-line summary, keeping the JSON behind a disclosure for operators.

### [Low] Three banner states share identical chrome

- **Id:** transcript-banner-status-undifferentiated
- **Status:** fixed
- **Resolved:** `c889e5bce` — `bannerFor` gives each status its own tone; `error` is `warn` (it self-heals) and `invalid-token` stays `danger` (it is terminal).
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `transcript-TranscriptApp-Connecting-1.png`, `-Finished-1.png`, `-Recording-disabled-1.png` are visually the same chip
- **Source:** `client/transcript/components/StatusBanner.svelte:28-34` — only `live`, `invalid-token`, and `error` get a modifier
- **Suggested fix:** Differentiate the neutral states, particularly "Transcript not retained", which is a caveat rather than a progress note.

### [Low] The longest text blocks use the dimmest text token

- **Id:** transcript-dim-text-contrast
- **Status:** fixed
- **Resolved:** `92a54ebc1` — re-scoped before fixing. The accessibility framing was wrong: `client/shared/tokens.css:21` documents `--text-dim` at 5.69:1 on `--bg`, which clears WCAG SC 1.4.3. The real defect was hierarchy — the longest bodies (`.tx-thought pre`, `.tx-raw`) used the most recessive token. Both moved to `--text-muted`; `--text-dim` is now reserved for short labels.
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `transcript-TimelineEvent-Plan-1.png` — the plan body is low-contrast grey on the near-black surface
- **Source:** `client/transcript/components/TimelineEvent.svelte:59-64` — `.tx-thought pre`, `.tx-plan`, `.tx-raw` are all `var(--text-dim)`
- **Suggested fix:** Reserve `--text-dim` for secondary labels and render multi-line bodies at the normal text colour.

### [Low] Live events append with no scroll cue

- **Id:** transcript-no-live-scroll-affordance
- **Status:** fixed
- **Resolved:** `060f69111` — `shouldFollow` plus an `$effect.pre`/`$effect` pair follows the live tail only while the reader is already at the bottom.
- **Dimension:** 4. Feedback & state
- **Where visible:** Not visible in a static shot; applies while `status === 'live'`
- **Source:** `client/transcript/TranscriptApp.svelte:19-23` — events append with no scroll anchoring, and nothing in `client/transcript/` handles scroll position
- **Suggested fix:** Follow the tail while the reader is at the bottom, and surface a "new events" affordance when they have scrolled away.
