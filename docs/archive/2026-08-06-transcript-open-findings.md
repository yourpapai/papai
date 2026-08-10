<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# TranscriptApp Open Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all eleven findings still `open` in `docs/ux-reviews/TranscriptApp.md`, leaving that review with none.

**Architecture:** Five vertical slices plus a bookkeeping task. Each slice pairs a pure, table-driven module with the Svelte component that consumes it, so branching logic stays exhaustively unit-testable without mounting a component. Pure modules must ship in the same commit as their consumer — `knip --strict` analyses production entry points only, so a module imported solely by its own test fails the write hook as an unused file.

**Tech Stack:** Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`, `$effect.pre`), TypeScript (strict), Bun test runner, Storybook + `@crvy/strybk`, Playwright for screenshots, oxlint + oxfmt.

**Spec:** [`docs/superpowers/specs/2026-08-06-transcript-open-findings-design.md`](../specs/2026-08-06-transcript-open-findings-design.md)

## Global Constraints

- Strict TypeScript; **use `.js` extensions in import paths**, always.
- **Never add lint-disable or type-ignore comments** — a hook blocks them; fix the underlying issue.
- A `max-lines` / `max-lines-per-function` failure is a design signal: split the file or extract functions. Do not delete blank lines or compress formatting to pass.
- The formatter is **oxfmt** via `bun run format`, not prettier.
- **Do not modify `client/shared/ui/status-tone.ts`** — `client/settings/fetcher-schemas-analytics.ts:75` consumes the same enum and would be silently recoloured.
- **Do not modify any `client/shared/ui/` primitive.** They are consumed as-is.
- **Never hand-edit `docs/ux-reviews/_BACKLOG.md`** — it is generated; regenerate with `bun run ux:backlog`.
- **Never hand-edit inside `@generated-begin` / `@generated-end auto-screenshots` regions** in `tests/visual/**`.
- **Never pass `--no-verify` to `git commit`.**
- Every new `.ts` file needs the four-line SPDX header (the `license-headers` commit check enforces it). `.svelte` files under `client/transcript/components/` carry no header — match the neighbours.
- Client tests MUST run as `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`. A bare `bun test tests/client/...` matches nothing and reports success **without executing**.
- `pinDefaultViewport()` must be present in every file under `tests/visual/**`, below the `@generated-end auto-screenshots` marker. This is a repo-wide invariant (commit `f81c604a0`); do not remove it from any spec.
- Screenshot baselines under `.storybook-shots/` are **gitignored** — re-shooting never produces a commit. The generated spec files under `tests/visual/` **are** tracked and must be committed when stories change.

---

## File Structure

**New files**

| Path | Responsibility |
| --- | --- |
| `client/transcript/banner.ts` | `ViewerStatus` → banner label, tone, dot. Pure lookup table. |
| `client/transcript/format-ts.ts` | Event `ts` string → `HH:MM:SS` display string. Pure. |
| `client/transcript/autoscroll.ts` | "Is the viewport near the bottom?" arithmetic. Pure. |
| `tests/client/transcript/banner.test.ts` | Covers all six statuses. |
| `tests/client/transcript/format-ts.test.ts` | Valid, malformed, and boundary inputs. |
| `tests/client/transcript/autoscroll.test.ts` | Boundary arithmetic. |

**Modified files**

| Path | Change |
| --- | --- |
| `client/transcript/components/StatusBanner.svelte` | Rebuilt on the shared `Pill`; bespoke styles deleted. |
| `client/transcript/components/TimelineEvent.svelte` | Timestamp column; raw payload disclosure; token + hierarchy styling. |
| `client/transcript/TranscriptView.svelte` | Non-nullable empty state; `role="log"`; follow-the-tail effects. |
| `client/transcript/empty-state.ts` | Three `null` entries become real copy; return type narrows. |
| `client/transcript/transcript.css` | Spacing literals → tokens. |
| `playwright.config.ts` | `timezoneId: 'UTC'` so timestamp baselines are deterministic. |
| `tests/client/transcript/empty-state.test.ts` | Three `null` assertions become copy assertions. |
| `client/transcript/TranscriptView.stories.svelte` | Real `ts` values; two new terminal-state stories. |
| `client/transcript/components/TimelineEvent.stories.svelte` | Real `ts` values. |
| `docs/ux-reviews/TranscriptApp.md` | Eleven findings marked `fixed`. |

**Untouched:** `transcript.svelte.ts`, `fetchers.ts`, `sse.ts`, `stitch.ts`, `fetcher-schemas.ts`, `describe-event.ts`, `TranscriptApp.svelte`, `index.ts`. No state, network, or schema change anywhere in this project.

---

## Task 1: Banner rebuilt on shared primitives

Closes `transcript-no-design-system-primitives` and `transcript-banner-status-undifferentiated`.

**Files:**
- Create: `client/transcript/banner.ts`
- Create: `tests/client/transcript/banner.test.ts`
- Modify: `client/transcript/components/StatusBanner.svelte` (full rewrite, currently 30 lines)

**Interfaces:**
- Consumes: `ViewerStatus` from `client/transcript/transcript.svelte.ts` — the union `'connecting' | 'live' | 'finished' | 'recording-disabled' | 'invalid-token' | 'error'`. `StatusTone` from `client/shared/ui/status-tone.ts` — `'accent' | 'warn' | 'danger' | 'info' | 'neutral' | 'mute'`. `Pill` from `client/shared/ui/Pill.svelte`, whose props are `{ children: Snippet; tone?: Tone; dot?: boolean; id?: string }`.
- Produces: `bannerFor(status: ViewerStatus): BannerCopy` and `interface BannerCopy { label: string; tone: StatusTone; dot: boolean }`. No later task imports these.

**Background:** `StatusBanner.svelte` today is a bespoke 30-line component with its own `<style>` block, a hardcoded `border-radius: 6px`, and a literal `●` character embedded in the `live` copy string. It renders `error` and `invalid-token` in the same `--danger` red. Those are not the same thing: `error` self-heals (the native `EventSource` reconnects and `resync()` backfills the gap — see `client/transcript/transcript.svelte.ts:39-54`), while `invalid-token` is terminal with no in-app recovery.

- [ ] **Step 1: Write the failing test**

Create `tests/client/transcript/banner.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { bannerFor } from '../../../client/transcript/banner.js'
import type { ViewerStatus } from '../../../client/transcript/transcript.svelte.js'

const ALL: ViewerStatus[] = ['connecting', 'live', 'finished', 'recording-disabled', 'invalid-token', 'error']

describe('bannerFor', () => {
  test('connecting is informational with no dot', () => {
    expect(bannerFor('connecting')).toEqual({ label: 'Connecting…', tone: 'info', dot: false })
  })

  test('live is the only status carrying a dot', () => {
    expect(bannerFor('live')).toEqual({ label: 'Live', tone: 'accent', dot: true })
  })

  test('finished is neutral', () => {
    expect(bannerFor('finished')).toEqual({ label: 'Session finished', tone: 'neutral', dot: false })
  })

  test('recording-disabled warns that nothing is retained', () => {
    expect(bannerFor('recording-disabled')).toEqual({
      label: 'Live only — not retained',
      tone: 'warn',
      dot: false,
    })
  })

  test('invalid-token is the terminal failure and keeps danger', () => {
    expect(bannerFor('invalid-token')).toEqual({
      label: 'Link invalid or expired',
      tone: 'danger',
      dot: false,
    })
  })

  test('error is warn, not danger, because the stream reconnects on its own', () => {
    expect(bannerFor('error')).toEqual({ label: 'Reconnecting…', tone: 'warn', dot: false })
  })

  test('error and invalid-token do not share a tone', () => {
    expect(bannerFor('error').tone).not.toBe(bannerFor('invalid-token').tone)
  })

  test('no label embeds a status glyph — the Dot primitive owns that', () => {
    for (const status of ALL) expect(bannerFor(status).label).not.toContain('●')
  })

  test('exactly one status carries a dot', () => {
    expect(ALL.filter((s) => bannerFor(s).dot)).toEqual(['live'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/banner.test.ts
```

Expected: FAIL with `Cannot find module '../../../client/transcript/banner.js'`.

- [ ] **Step 3: Write the implementation**

Create `client/transcript/banner.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StatusTone } from '../shared/ui/status-tone.js'
import type { ViewerStatus } from './transcript.svelte.js'

export interface BannerCopy {
  label: string
  tone: StatusTone
  dot: boolean
}

/**
 * Banner copy per viewer status.
 *
 * `error` is deliberately `warn` rather than `danger`: the native EventSource reconnects by
 * itself and `resync()` backfills the gap, so the state is transient and the user needs to do
 * nothing. `invalid-token` keeps `danger` because it is terminal — the viewer cannot mint a new
 * link. Those two rendering identically was the reported defect.
 *
 * Typed as a total Record so adding a ViewerStatus is a compile error rather than a silent
 * fall-through.
 */
const COPY: Record<ViewerStatus, BannerCopy> = {
  connecting: { label: 'Connecting…', tone: 'info', dot: false },
  live: { label: 'Live', tone: 'accent', dot: true },
  finished: { label: 'Session finished', tone: 'neutral', dot: false },
  'recording-disabled': { label: 'Live only — not retained', tone: 'warn', dot: false },
  'invalid-token': { label: 'Link invalid or expired', tone: 'danger', dot: false },
  error: { label: 'Reconnecting…', tone: 'warn', dot: false },
}

export function bannerFor(status: ViewerStatus): BannerCopy {
  return COPY[status]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/banner.test.ts
```

Expected: `9 pass, 0 fail`.

- [ ] **Step 5: Rewrite StatusBanner on the shared Pill**

Replace the entire contents of `client/transcript/components/StatusBanner.svelte` with:

```svelte
<script lang="ts">
  import Pill from '../../shared/ui/Pill.svelte'
  import { bannerFor } from '../banner.js'
  import type { ViewerStatus } from '../transcript.svelte.js'

  let { status }: { status: ViewerStatus } = $props()

  const banner = $derived(bannerFor(status))
</script>

<div class="tx-banner" role="status">
  <Pill tone={banner.tone} dot={banner.dot}>{banner.label}</Pill>
</div>
```

```svelte
<style>
  /* Layout only. Every visual property now comes from Pill. */
  .tx-banner {
    display: inline-block;
  }
</style>
```

Append that `<style>` block to the same file. Notes:

- `Pill` takes its content as an implicit `children` snippet — `<Pill …>{banner.label}</Pill>` is the form used by `client/shared/ui/StatusPill.svelte`. Do not write an explicit `{#snippet children()}`.
- `Pill` renders `Dot` itself when `dot` is true, with a glow for `accent`. Do not import `Dot`.
- `role="status"` goes on the wrapper, not on `Pill` — `Pill` has no `role` prop and must not be modified.
- The `TEXT` record, the `.tx-banner--*` modifier classes, and the `border-radius: 6px` literal are all deleted, not migrated.

- [ ] **Step 6: Verify the whole client transcript suite and the linters**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/
bun run lint && bun run typecheck && bun run knip
```

Expected: all transcript suites pass; lint, typecheck, and knip all clean. `knip` matters here — `banner.ts` gains its production consumer in Step 5 of this same task, which is why the module and the rewrite must not be split across commits.

- [ ] **Step 7: Re-shoot the banner stories and look at them**

Storybook must be running (`bun storybook`, port 6006). Run:

```bash
bun run format
bun shoot -g StatusBanner
```

Expected: 6 tests pass. Then read at least `.storybook-shots/tests/visual/transcript/components/StatusBanner.spec.ts/Live.png` and `Error.png` with the Read tool and confirm by eye: `Live` shows a green dot plus the word `Live` with no `●` character, and `Error` is amber, visibly different from `Invalid token`'s red.

- [ ] **Step 8: Commit**

```bash
git add client/transcript/banner.ts tests/client/transcript/banner.test.ts client/transcript/components/StatusBanner.svelte
git commit -m "feat(transcript): rebuild the status banner on the shared Pill primitive"
```

---

## Task 2: Event timestamps

Closes `transcript-no-timestamps`.

**Files:**
- Create: `client/transcript/format-ts.ts`
- Create: `tests/client/transcript/format-ts.test.ts`
- Modify: `client/transcript/components/TimelineEvent.svelte` (full rewrite)
- Modify: `playwright.config.ts` (the `use` block, around line 33)
- Modify: `client/transcript/components/TimelineEvent.stories.svelte` (12 `ts` values)
- Modify: `client/transcript/TranscriptView.stories.svelte` (7 `ts` values)

**Interfaces:**
- Consumes: `TranscriptEvent` from `client/transcript/fetcher-schemas.ts` — `{ seq: number; ts: string; type: …; payload: unknown }`. `describeEvent` from `client/transcript/describe-event.ts`, already imported by `TimelineEvent.svelte`.
- Produces: `formatEventTime(ts: string): string`. No later task imports it. Task 5 restyles the `.tx-ev__time` and `.tx-ev__body` classes introduced here.

**Background:** `TranscriptEventSchema` already declares `ts: z.string()` (`client/transcript/fetcher-schemas.ts:18`). The field arrives on every event and has simply never been read. Nothing on the wire changes.

- [ ] **Step 1: Write the failing test**

Create `tests/client/transcript/format-ts.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatEventTime } from '../../../client/transcript/format-ts.js'

describe('formatEventTime', () => {
  // Inputs are built from LOCAL date parts and asserted against those same local parts, so
  // these assertions hold in any timezone. Never hardcode a UTC literal here.
  test('renders a parseable timestamp as 24-hour HH:MM:SS', () => {
    const at = new Date(2026, 7, 6, 14, 23, 5)
    expect(formatEventTime(at.toISOString())).toBe('14:23:05')
  })

  test('zero-pads single-digit hours, minutes, and seconds', () => {
    const at = new Date(2026, 7, 6, 4, 3, 9)
    expect(formatEventTime(at.toISOString())).toBe('04:03:09')
  })

  test('renders midnight as 00:00:00 rather than blank', () => {
    const at = new Date(2026, 7, 6, 0, 0, 0)
    expect(formatEventTime(at.toISOString())).toBe('00:00:00')
  })

  test('always renders exactly eight characters', () => {
    const at = new Date(2026, 11, 31, 23, 59, 59)
    expect(formatEventTime(at.toISOString())).toHaveLength(8)
  })

  test('returns an empty string for an unparseable value', () => {
    expect(formatEventTime('t')).toBe('')
  })

  test('returns an empty string for an empty input', () => {
    expect(formatEventTime('')).toBe('')
  })

  test('never returns the literal text Invalid Date', () => {
    expect(formatEventTime('not-a-timestamp')).not.toContain('Invalid')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/format-ts.test.ts
```

Expected: FAIL with `Cannot find module '../../../client/transcript/format-ts.js'`.

- [ ] **Step 3: Write the implementation**

Create `client/transcript/format-ts.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Render an event's wall-clock time as a fixed 24-hour `HH:MM:SS` in the viewer's local zone.
 *
 * Deliberately NOT `toLocaleTimeString`: its output varies with the runtime's ICU locale data,
 * which would make every screenshot baseline containing a timestamp differ between machines.
 *
 * `ts` arrives as `z.string()` with no format guarantee (it originates in magi), so an
 * unparseable value returns '' — a blank column reads as "unknown", where the literal text
 * "Invalid Date" reads as a bug in the viewer.
 */
export function formatEventTime(ts: string): string {
  const at = new Date(ts)
  if (Number.isNaN(at.getTime())) return ''
  return at.toTimeString().slice(0, 8)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/format-ts.test.ts
```

Expected: `7 pass, 0 fail`.

- [ ] **Step 5: Add the timestamp column to TimelineEvent**

Replace the entire contents of `client/transcript/components/TimelineEvent.svelte` with the following. The markup change is structural: the event now has a fixed-width time gutter and a body column, so every existing branch moves inside `.tx-ev__body`. The `<style>` block is carried over unchanged apart from the three new rules at the top — Task 5 rewrites the rest of it.

```svelte
<script lang="ts">
  import { describeEvent } from '../describe-event.js'
  import type { TranscriptEvent } from '../fetcher-schemas.js'
  import { formatEventTime } from '../format-ts.js'

  let { event }: { event: TranscriptEvent } = $props()

  const described = $derived(describeEvent(event))
  const at = $derived(formatEventTime(event.ts))
</script>

<div class="tx-ev tx-ev--{event.type}">
  <time class="tx-ev__time" datetime={event.ts}>{at}</time>
  <div class="tx-ev__body">
    {#if described.kind === 'prompt'}
      <div class="tx-prompt">
        <span class="tx-prompt__who">you</span>
        <span class="tx-prompt__body">{described.body}</span>
      </div>
    {:else if described.kind === 'message'}
      <div class="tx-msg">{described.body}</div>
    {:else if described.kind === 'thought'}
      <details class="tx-thought">
        <summary>thinking</summary>
        <pre>{described.body}</pre>
      </details>
    {:else if described.kind === 'tool'}
      <div class="tx-tool tx-tool--{described.tone}">
        <span class="tx-tool__glyph" aria-hidden="true">{described.glyph}</span>
        <span class="tx-tool__name">{described.title}</span>
        <span class="tx-tool__status">{described.status}</span>
      </div>
    {:else if described.kind === 'plan'}
      <ul class="tx-plan">
        {#each described.entries as entry, index (index)}
          <li class="tx-plan__item tx-plan__item--{entry.status}">
            <span class="tx-plan__mark" aria-hidden="true">{entry.mark}</span>
            <span class="tx-plan__text">{entry.content}</span>
          </li>
        {/each}
      </ul>
    {:else if described.kind === 'permission'}
      {#if described.decided}
        <div class="tx-perm tx-perm--decided">decision recorded in chat</div>
      {:else}
        <div class="tx-perm">🔒 asked for permission — approve or deny in chat</div>
      {/if}
    {:else if described.kind === 'result'}
      <div class="tx-result">✔ finished — {described.stopReason}</div>
    {:else}
      <pre class="tx-raw">{described.json}</pre>
    {/if}
  </div>
</div>
```

```svelte
<style>
  .tx-ev {
    display: flex;
    /* New rule, so it takes a token immediately. The pre-existing literals below
       (padding, --border) are migrated in a later task, not here. */
    gap: var(--s3);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    border-left: 2px solid var(--border);
    padding: 0.3rem 0.7rem;
  }
  .tx-ev__time {
    flex: none;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .tx-ev__body {
    flex: 1;
    min-width: 0;
  }
  .tx-ev--prompt {
    border-left-color: var(--accent-dim);
  }
  .tx-msg {
    white-space: pre-wrap;
  }
  .tx-prompt {
    display: flex;
    gap: 0.5rem;
  }
  .tx-prompt__who {
    color: var(--text-dim);
    flex: none;
  }
  .tx-prompt__body {
    white-space: pre-wrap;
    color: var(--text);
  }
  .tx-tool {
    display: flex;
    gap: 0.5rem;
  }
  .tx-tool__glyph {
    flex: none;
  }
  .tx-tool--accent {
    color: var(--accent);
  }
  .tx-tool--warn {
    color: var(--warn);
  }
  .tx-tool--danger {
    color: var(--danger);
  }
  .tx-tool--info {
    color: var(--info);
  }
  .tx-tool--neutral {
    color: var(--text-muted);
  }
  .tx-tool--mute {
    color: var(--text-dim);
  }
  .tx-perm {
    color: var(--danger);
  }
  .tx-plan {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tx-plan__item {
    display: flex;
    gap: 0.5rem;
    color: var(--text-muted);
  }
  .tx-plan__mark {
    flex: none;
  }
  .tx-plan__item--completed {
    color: var(--accent);
  }
  .tx-plan__item--in_progress {
    color: var(--info);
  }
  .tx-thought pre,
  .tx-raw {
    white-space: pre-wrap;
    color: var(--text-dim);
  }
</style>
```

`min-width: 0` on `.tx-ev__body` is load-bearing: without it a flex child refuses to shrink below its content width and the long-message story overflows horizontally.

- [ ] **Step 6: Pin the browser timezone**

In `playwright.config.ts`, find the `use` block (around line 33):

```ts
  use: {
    baseURL: STORYBOOK_URL,
  },
```

Replace it with:

```ts
  use: {
    baseURL: STORYBOOK_URL,
    // Timestamps render in local time. Without a pinned zone the same fixture produces a
    // different baseline on every machine and in CI.
    timezoneId: 'UTC',
  },
```

- [ ] **Step 7: Give the story fixtures real timestamps**

Every fixture currently uses `ts: 't'`, which `formatEventTime` maps to `''` — leaving the new column blank in every screenshot and making the shots worthless as verification.

In `client/transcript/components/TimelineEvent.stories.svelte`, replace all 12 occurrences of `ts: 't',` with ascending times matching each story's `seq`, in `seq` order top to bottom:

```
seq 1  -> ts: '2026-08-06T14:23:05.000Z',
seq 2  -> ts: '2026-08-06T14:23:11.000Z',
seq 3  -> ts: '2026-08-06T14:23:18.000Z',
seq 4  -> ts: '2026-08-06T14:23:24.000Z',
seq 5  -> ts: '2026-08-06T14:23:31.000Z',
seq 6  -> ts: '2026-08-06T14:23:37.000Z',
seq 7  -> ts: '2026-08-06T14:23:44.000Z',
seq 8  -> ts: '2026-08-06T14:23:50.000Z',
seq 9  -> ts: '2026-08-06T14:23:57.000Z',
seq 10 -> ts: '2026-08-06T14:24:03.000Z',
seq 11 -> ts: '2026-08-06T14:24:10.000Z',
seq 12 -> ts: '2026-08-06T14:24:16.000Z',
```

In `client/transcript/TranscriptView.stories.svelte`, the `SESSION` fixture has 7 events with `seq` 1–7; replace each `ts: 't',` the same way:

```
seq 1 -> ts: '2026-08-06T14:23:05.000Z',
seq 2 -> ts: '2026-08-06T14:23:11.000Z',
seq 3 -> ts: '2026-08-06T14:23:18.000Z',
seq 4 -> ts: '2026-08-06T14:23:24.000Z',
seq 5 -> ts: '2026-08-06T14:23:31.000Z',
seq 6 -> ts: '2026-08-06T14:23:37.000Z',
seq 7 -> ts: '2026-08-06T14:23:44.000Z',
```

With `timezoneId: 'UTC'` these render as `14:23:05`, `14:23:11`, and so on.

- [ ] **Step 8: Verify tests, linters, and screenshots**

Run:

```bash
bun run format
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/
bun run lint && bun run typecheck && bun run knip
bun shoot -g TimelineEvent
bun shoot -g TranscriptView
```

Expected: transcript suites pass; lint/typecheck/knip clean; 12 TimelineEvent shots and 6 TranscriptView shots pass (5 generated plus the manual `TranscriptView — populated, narrow` test below the generated region).

Baselines land at `.storybook-shots/<story-path>/<SpecFile>/transcript-<Component>-<Story>-1.png` — note this is **not** the `tests/visual/…` path. Read these two with the Read tool:

```
.storybook-shots/transcript/components/TimelineEvent.spec.ts/transcript-TimelineEvent-Long-message-overflow-1.png
.storybook-shots/transcript/components/TimelineEvent.spec.ts/transcript-TimelineEvent-Plan-1.png
``` Confirm: a `14:2X:XX` timestamp is visible at the left of each row, the long message wraps instead of overflowing horizontally, and the plan checklist still aligns under the body column.

- [ ] **Step 9: Commit**

```bash
git add client/transcript/format-ts.ts tests/client/transcript/format-ts.test.ts \
  client/transcript/components/TimelineEvent.svelte playwright.config.ts \
  client/transcript/components/TimelineEvent.stories.svelte client/transcript/TranscriptView.stories.svelte
git commit -m "feat(transcript): render event timestamps in the timeline"
```

---

## Task 3: Terminal-state copy

Closes `transcript-dead-end-error-states`.

**Files:**
- Modify: `client/transcript/empty-state.ts` (full rewrite)
- Modify: `tests/client/transcript/empty-state.test.ts` (full rewrite)
- Modify: `client/transcript/TranscriptView.svelte`
- Modify: `client/transcript/TranscriptView.stories.svelte` (add two stories)
- Modify: `tests/visual/transcript/TranscriptView.spec.ts` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: `EmptyState` from `client/shared/ui/EmptyState.svelte`, props `{ title: string; icon?: string; hint?: string; action?: Snippet }`.
- Produces: `emptyStateFor(status: ViewerStatus): EmptyStateCopy` — note the return type is now **non-nullable**. `interface EmptyStateCopy { title: string; hint?: string }` is unchanged. Task 4 edits the same `TranscriptView.svelte`.

**Background:** `emptyStateFor` currently returns `null` for `recording-disabled`, `invalid-token`, and `error`, on the reasoning that the banner already carries the message. This task reverses that: with zero events the page is one small pill on empty space, and a pill has no room to say what to do next. The banner stays the terse persistent status chip; the empty state carries the explanation.

**No buttons.** `invalid-token` has no in-app recovery — transcript links are minted by magi and posted into chat by the bot (`plugins/acp/index.ts:141`), so the viewer cannot mint one. `error` already reconnects on its own, so a retry control would misattribute work the browser is doing. Leave `EmptyState`'s `action` snippet unused.

- [ ] **Step 1: Rewrite the test to assert the new copy**

Replace the entire contents of `tests/client/transcript/empty-state.test.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { emptyStateFor } from '../../../client/transcript/empty-state.js'
import type { ViewerStatus } from '../../../client/transcript/transcript.svelte.js'

const ALL: ViewerStatus[] = ['connecting', 'live', 'finished', 'recording-disabled', 'invalid-token', 'error']

describe('emptyStateFor', () => {
  test('connecting explains that the transcript is still loading', () => {
    expect(emptyStateFor('connecting')).toEqual({ title: 'Loading the transcript…' })
  })

  test('live says the session is running and carries a hint', () => {
    expect(emptyStateFor('live')).toEqual({ title: 'Session is running', hint: 'No output yet.' })
  })

  test('finished says the session produced nothing', () => {
    expect(emptyStateFor('finished')).toEqual({ title: 'This session produced no output' })
  })

  test('recording-disabled explains that nothing is retained', () => {
    expect(emptyStateFor('recording-disabled')).toEqual({
      title: 'Live output only',
      hint: 'Nothing is retained for this session. Output appears as it happens and is gone on reload.',
    })
  })

  test('invalid-token points the reader back to chat for a new link', () => {
    expect(emptyStateFor('invalid-token')).toEqual({
      title: 'This link is no longer valid',
      hint: 'Transcript links expire when the session ends or the link is revoked. Ask the bot for a new link in your chat.',
    })
  })

  test('error says reconnection is automatic, so the reader does nothing', () => {
    expect(emptyStateFor('error')).toEqual({
      title: 'Connection lost',
      hint: 'Reconnecting automatically — the page will fill in on its own.',
    })
  })

  test('every status returns copy — no status is a dead end', () => {
    for (const status of ALL) {
      expect(emptyStateFor(status).title.length).toBeGreaterThan(0)
    }
  })

  test('every terminal status carries a hint telling the reader what happens next', () => {
    for (const status of ['recording-disabled', 'invalid-token', 'error'] as const) {
      expect(emptyStateFor(status).hint).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/empty-state.test.ts
```

Expected: FAIL — the three terminal-status tests report `received: null`.

- [ ] **Step 3: Fill in the terminal copy**

Replace the entire contents of `client/transcript/empty-state.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ViewerStatus } from './transcript.svelte.js'

export interface EmptyStateCopy {
  title: string
  hint?: string
}

/**
 * Copy for a transcript with zero events, per status.
 *
 * Every status returns copy. With no events the page is otherwise a single status pill on empty
 * space, and a pill has no room to say what happens next — the banner states the condition, this
 * states the consequence.
 *
 * No status offers an action. `invalid-token` has no in-app recovery (links are minted by magi
 * and posted into chat by the bot), and `error` already reconnects by itself, so a retry control
 * would claim credit for work the browser is doing.
 */
const COPY: Record<ViewerStatus, EmptyStateCopy> = {
  connecting: { title: 'Loading the transcript…' },
  live: { title: 'Session is running', hint: 'No output yet.' },
  finished: { title: 'This session produced no output' },
  'recording-disabled': {
    title: 'Live output only',
    hint: 'Nothing is retained for this session. Output appears as it happens and is gone on reload.',
  },
  'invalid-token': {
    title: 'This link is no longer valid',
    hint: 'Transcript links expire when the session ends or the link is revoked. Ask the bot for a new link in your chat.',
  },
  error: {
    title: 'Connection lost',
    hint: 'Reconnecting automatically — the page will fill in on its own.',
  },
}

export function emptyStateFor(status: ViewerStatus): EmptyStateCopy {
  return COPY[status]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/empty-state.test.ts
```

Expected: `8 pass, 0 fail`.

- [ ] **Step 5: Drop the null branch from TranscriptView**

In `client/transcript/TranscriptView.svelte`, change the derived line from:

```svelte
  const empty = $derived(events.length === 0 ? emptyStateFor(status) : null)
```

to:

```svelte
  const empty = $derived(emptyStateFor(status))
```

and change the template's empty branch from:

```svelte
  {:else if empty !== null}
    <EmptyState title={empty.title} hint={empty.hint} />
  {/if}
```

to:

```svelte
  {:else}
    <EmptyState title={empty.title} hint={empty.hint} />
  {/if}
```

`emptyStateFor` is a total lookup now, so the null guard is dead code and `tsgo` will reject `empty !== null` as an unnecessary comparison.

- [ ] **Step 6: Add stories for the two uncovered terminal states**

`TranscriptView.stories.svelte` already has `Empty invalid token`. Append two more at the end of the file, after that story:

```svelte
<Story name="Empty recording disabled" args={{ events: [], status: 'recording-disabled' }} />

<Story name="Empty error" args={{ events: [], status: 'error' }} />
```

- [ ] **Step 7: Regenerate the visual spec**

Run:

```bash
bun run shoot:gen
```

This rewrites the `@generated-begin` / `@generated-end auto-screenshots` region of `tests/visual/transcript/TranscriptView.spec.ts` to include the two new stories. Do not hand-edit inside that region.

Then verify the invariant survived:

```bash
grep -c pinDefaultViewport tests/visual/transcript/TranscriptView.spec.ts
```

Expected: `2` (the import and the call), both below `@generated-end auto-screenshots`. If the count is `0`, append these two lines to the end of the file:

```ts
import { pinDefaultViewport } from '../../support/viewport.js'

pinDefaultViewport()
```

- [ ] **Step 8: Verify tests, linters, and screenshots**

Run:

```bash
bun run format
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/
bun run lint && bun run typecheck && bun run knip
bun shoot -g TranscriptView
```

Expected: transcript suites pass; lint/typecheck/knip clean; 8 screenshot tests pass (5 existing generated, 2 new, plus the manual `TranscriptView — populated, narrow` test below the generated region). Then read these two with the Read tool:

```
.storybook-shots/transcript/TranscriptView.spec.ts/transcript-TranscriptView-Empty-invalid-token-1.png
.storybook-shots/transcript/TranscriptView.spec.ts/transcript-TranscriptView-Empty-error-1.png
```

Confirm each shows a banner plus a titled empty state with a hint below it — not a blank page.

- [ ] **Step 9: Commit**

```bash
git add client/transcript/empty-state.ts tests/client/transcript/empty-state.test.ts \
  client/transcript/TranscriptView.svelte client/transcript/TranscriptView.stories.svelte \
  tests/visual/transcript/TranscriptView.spec.ts
git commit -m "feat(transcript): give every terminal state copy that says what happens next"
```

---

## Task 4: Announcements and follow-the-tail

Closes `transcript-no-aria-live` and `transcript-no-live-scroll-affordance`.

**Files:**
- Create: `client/transcript/autoscroll.ts`
- Create: `tests/client/transcript/autoscroll.test.ts`
- Modify: `client/transcript/TranscriptView.svelte`

**Interfaces:**
- Consumes: `emptyStateFor(status: ViewerStatus): EmptyStateCopy` (non-nullable, from Task 3).
- Produces: `shouldFollow(scrollY: number, innerHeight: number, scrollHeight: number, slack?: number): boolean`. No later task imports it.

- [ ] **Step 1: Write the failing test**

Create `tests/client/transcript/autoscroll.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { shouldFollow } from '../../../client/transcript/autoscroll.js'

describe('shouldFollow', () => {
  test('follows when the viewport is flush with the bottom', () => {
    expect(shouldFollow(900, 100, 1000)).toBe(true)
  })

  test('does not follow when the reader has scrolled well up', () => {
    expect(shouldFollow(0, 100, 5000)).toBe(false)
  })

  test('follows exactly at the slack boundary', () => {
    expect(shouldFollow(836, 100, 1000)).toBe(true)
  })

  test('stops following one pixel past the slack boundary', () => {
    expect(shouldFollow(835, 100, 1000)).toBe(false)
  })

  test('honours a custom slack', () => {
    expect(shouldFollow(800, 100, 1000, 200)).toBe(true)
    expect(shouldFollow(800, 100, 1000)).toBe(false)
  })

  test('follows on a page shorter than the viewport, where there is nothing to scroll', () => {
    expect(shouldFollow(0, 1000, 500)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/autoscroll.test.ts
```

Expected: FAIL with `Cannot find module '../../../client/transcript/autoscroll.js'`.

- [ ] **Step 3: Write the implementation**

Create `client/transcript/autoscroll.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Pixels of gap from the bottom still treated as "reading the live tail". */
const DEFAULT_SLACK = 64

/**
 * True when the viewport sits within `slack` pixels of the bottom of the page.
 *
 * Callers must measure BEFORE new content renders. Once an event is appended, a reader who was
 * pinned to the bottom sits one event-height above it, and a post-render measurement would read
 * that as a deliberate scroll-up and stop following.
 */
export function shouldFollow(
  scrollY: number,
  innerHeight: number,
  scrollHeight: number,
  slack: number = DEFAULT_SLACK,
): boolean {
  return scrollY + innerHeight >= scrollHeight - slack
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/autoscroll.test.ts
```

Expected: `6 pass, 0 fail`.

- [ ] **Step 5: Wire the live region and the follow effects**

Replace the entire contents of `client/transcript/TranscriptView.svelte` with:

```svelte
<script lang="ts">
  import EmptyState from '../shared/ui/EmptyState.svelte'
  import { shouldFollow } from './autoscroll.js'
  import StatusBanner from './components/StatusBanner.svelte'
  import TimelineEvent from './components/TimelineEvent.svelte'
  import { emptyStateFor } from './empty-state.js'
  import type { TranscriptEvent } from './fetcher-schemas.js'
  import type { ViewerStatus } from './transcript.svelte.js'

  let { events, status }: { events: TranscriptEvent[]; status: ViewerStatus } = $props()

  const empty = $derived(emptyStateFor(status))

  let follow = $state(true)

  // Measure BEFORE the DOM updates. After the new events render, a reader who was pinned to the
  // bottom is suddenly one event-height away from it, and a post-update measurement would read
  // that as "scrolled up" and refuse to follow.
  $effect.pre(() => {
    void events.length
    follow = shouldFollow(window.scrollY, window.innerHeight, document.body.scrollHeight)
  })

  // Instant, never smooth: that sidesteps prefers-reduced-motion rather than special-casing it.
  $effect(() => {
    void events.length
    if (status === 'live' && follow) window.scrollTo({ top: document.body.scrollHeight })
  })
</script>

<main class="tx-wrap">
  <header>
    <h1>Coding session</h1>
    <StatusBanner {status} />
  </header>
  {#if events.length > 0}
    <div class="tx-timeline" role="log" aria-live={status === 'live' ? 'polite' : 'off'}>
      {#each events as event (event.seq)}
        <TimelineEvent {event} />
      {/each}
    </div>
  {:else}
    <EmptyState title={empty.title} hint={empty.hint} />
  {/if}
</main>
```

Three things are deliberate:

- `role="log"` is the ARIA role for an append-only chronological feed, which is exactly what a transcript timeline is.
- `aria-live` is gated to the `live` status. The history bulk-load lands during `connecting`; without the gate a screen reader would read the entire backlog aloud on page open.
- `void events.length` appears in both effects so the length is always a tracked dependency, including on the branch where `status !== 'live'` short-circuits before any geometry is read.

- [ ] **Step 6: Verify tests, linters, and screenshots**

Run:

```bash
bun run format
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/
bun run lint && bun run typecheck && bun run knip
bun shoot -g TranscriptView
```

Expected: transcript suites pass; lint/typecheck/knip clean; 8 screenshot tests pass. The shots should be unchanged from Task 3 — `role` and `aria-live` are not visual. If any shot differs, the markup changed in a way this task did not intend; investigate before committing.

- [ ] **Step 7: Commit**

```bash
git add client/transcript/autoscroll.ts tests/client/transcript/autoscroll.test.ts client/transcript/TranscriptView.svelte
git commit -m "feat(transcript): announce streamed events and follow the live tail"
```

---

## Task 5: Presentation pass

Closes `transcript-hardcoded-spacing`, `transcript-no-focus-visible`, `transcript-timeline-rail-invisible`, `transcript-dim-text-contrast`, and `transcript-unknown-payload-raw-json`.

**Files:**
- Modify: `client/transcript/transcript.css` (full rewrite, currently 2 rules)
- Modify: `client/transcript/components/TimelineEvent.svelte` (the raw branch and the `<style>` block)

**Interfaces:**
- Consumes: the `.tx-ev__time` / `.tx-ev__body` classes introduced in Task 2, and the `.tx-raw` class that has existed since the mapper landed.
- Produces: nothing importable. Final task before bookkeeping.

**Background — the token scale exists.** `client/shared/tokens.css` carries `--s1: 4px` through `--s9: 48px` on a 4px base, plus `--gap-group/section/field/inline/tight`, `--radius*`, `--row-h`, `--control-h-*`, `--content-max: 760px`, and `--table-max: 1100px`. An earlier spec claimed no scale existed; it searched for a `--space-*` prefix that this repo does not use.

- [ ] **Step 1: Migrate the page-level spacing**

Replace the entire contents of `client/transcript/transcript.css` with:

```css
/* 860px is deliberate and deliberately not a token. --content-max (760px) is tuned for prose and
   --table-max (1100px) for wide tables; this view renders monospace tool output and raw JSON,
   which wants a width between them. One consumer does not justify minting a token. */
.tx-wrap {
  max-width: 860px;
  margin: 0 auto;
  padding: var(--s6) var(--s4) var(--s9);
}

.tx-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--s3);
}
```

`1.5rem` → `--s6` (24px, exact), `1rem` → `--s4` (16px, exact), `4rem` → `--s9` (48px, down from 64px), `0.75rem` → `--s3` (12px, exact).

- [ ] **Step 2: Put unrecognised payloads behind a disclosure**

In `client/transcript/components/TimelineEvent.svelte`, change the final `{:else}` branch from:

```svelte
    {:else}
      <pre class="tx-raw">{described.json}</pre>
    {/if}
```

to:

```svelte
    {:else}
      <details class="tx-raw-wrap">
        <summary>unrecognised event</summary>
        <pre class="tx-raw">{described.json}</pre>
      </details>
    {/if}
```

The `raw` branch of `describeEvent` is unchanged and stays the deliberate terminal fallback — payloads originate in magi typed as `z.unknown()`, so a shape the mapper does not recognise must still be inspectable. This only stops it dumping full-height JSON inline by default.

- [ ] **Step 3: Rewrite the style block**

Replace the entire `<style>` block of `client/transcript/components/TimelineEvent.svelte` with:

```svelte
<style>
  .tx-ev {
    display: flex;
    gap: var(--s3);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    /* --border is invisible against --bg at 2px; --strong is the token that reads as a rail. */
    border-left: 2px solid var(--strong);
    padding: var(--s1) var(--s3);
  }
  .tx-ev__time {
    flex: none;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .tx-ev__body {
    flex: 1;
    min-width: 0;
  }
  .tx-ev--prompt {
    border-left-color: var(--accent-dim);
  }
  .tx-msg {
    white-space: pre-wrap;
  }
  .tx-prompt {
    display: flex;
    gap: var(--s2);
  }
  .tx-prompt__who {
    color: var(--text-dim);
    flex: none;
  }
  .tx-prompt__body {
    white-space: pre-wrap;
    color: var(--text);
  }
  .tx-tool {
    display: flex;
    gap: var(--s2);
  }
  .tx-tool__glyph {
    flex: none;
  }
  .tx-tool--accent {
    color: var(--accent);
  }
  .tx-tool--warn {
    color: var(--warn);
  }
  .tx-tool--danger {
    color: var(--danger);
  }
  .tx-tool--info {
    color: var(--info);
  }
  .tx-tool--neutral {
    color: var(--text-muted);
  }
  .tx-tool--mute {
    color: var(--text-dim);
  }
  .tx-perm {
    color: var(--danger);
  }
  .tx-plan {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tx-plan__item {
    display: flex;
    gap: var(--s2);
    color: var(--text-muted);
  }
  .tx-plan__mark {
    flex: none;
  }
  .tx-plan__item--completed {
    color: var(--accent);
  }
  .tx-plan__item--in_progress {
    color: var(--info);
  }
  /* The two longest bodies previously used --text-dim, the most recessive token, which inverted
     hierarchy. --text-dim is now reserved for short labels: the time gutter and the "you" tag. */
  .tx-thought pre,
  .tx-raw {
    white-space: pre-wrap;
    color: var(--text-muted);
  }
  /* The only interactive controls in the viewer. Both disclosures share these rules. */
  .tx-thought summary,
  .tx-raw-wrap summary {
    cursor: pointer;
    color: var(--text-muted);
  }
  .tx-thought summary:hover,
  .tx-raw-wrap summary:hover {
    color: var(--text);
  }
  .tx-thought summary:focus-visible,
  .tx-raw-wrap summary:focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
</style>
```

- [ ] **Step 4: Verify tests, linters, and screenshots**

Run:

```bash
bun run format
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/
bun run lint && bun run typecheck && bun run knip
bun shoot -g TimelineEvent
bun shoot -g TranscriptView
```

Expected: transcript suites pass; lint/typecheck/knip clean; 12 and 8 screenshot tests pass.

- [ ] **Step 5: Read the screenshots and confirm each fix by eye**

Read these four PNGs with the Read tool and check the stated property:

| File under `.storybook-shots/transcript/` | Confirm |
| --- | --- |
| `components/TimelineEvent.spec.ts/transcript-TimelineEvent-Unknown-shape-raw-fallback-1.png` | Shows a collapsed `unrecognised event` disclosure, not a JSON dump |
| `components/TimelineEvent.spec.ts/transcript-TimelineEvent-Thought-1.png` | The `thinking` body is legibly brighter than before, and the summary is distinguishable from it |
| `components/TimelineEvent.spec.ts/transcript-TimelineEvent-Plan-1.png` | The left rail is visible against the background |
| `TranscriptView.spec.ts/transcript-TranscriptView-Populated-1.png` | Timeline spacing is unchanged in feel; the page bottom padding is slightly tighter |

`:focus-visible` cannot be verified from a screenshot — Playwright's programmatic `.focus()` does not trigger it. Confirm the rule exists in the stylesheet instead; that is what the finding asked for.

- [ ] **Step 6: Commit**

```bash
git add client/transcript/transcript.css client/transcript/components/TimelineEvent.svelte
git commit -m "style(transcript): migrate spacing to tokens and fix rail, focus, and hierarchy"
```

---

## Task 6: Close the findings

**Files:**
- Modify: `docs/ux-reviews/TranscriptApp.md` (eleven findings)
- Modify: `docs/ux-reviews/_BACKLOG.md` (generated — never hand-edited)

**Interfaces:**
- Consumes: the commit hashes produced by Tasks 1–5.
- Produces: nothing importable.

**Background — the parser contract.** Every finding carries `- **Id:**` and `- **Status:**` as its first two bullets. `Status` is one of `open | fixed | superseded | wont-fix | deferred`. Any non-`open` status **requires** a `- **Resolved:**` line or `parseFindings` throws. Ids are never reused, renamed, or deleted. There is no `partial` status.

- [ ] **Step 1: Collect the commit hashes**

Run:

```bash
git log --oneline -6
```

Record the hash for each of Tasks 1–5. The `Resolved:` lines below cite them.

- [ ] **Step 2: Mark the eleven findings fixed**

In `docs/ux-reviews/TranscriptApp.md`, for each id below: change its `- **Status:** open` to `- **Status:** fixed` and add a `- **Resolved:**` line immediately after the `- **Status:**` line. Substitute the real hash for `<taskN>`.

| Id | Resolved line |
| --- | --- |
| `transcript-no-design-system-primitives` | `- **Resolved:** \`<task1>\` — StatusBanner rebuilt on the shared \`Pill\`/\`Dot\`; the bespoke style block and the literal \`●\` are gone.` |
| `transcript-banner-status-undifferentiated` | `- **Resolved:** \`<task1>\` — \`bannerFor\` gives each status its own tone; \`error\` is \`warn\` (it self-heals) and \`invalid-token\` stays \`danger\` (it is terminal).` |
| `transcript-no-timestamps` | `- **Resolved:** \`<task2>\` — \`formatEventTime\` renders the existing \`ts\` field as \`HH:MM:SS\` in a time gutter. \`playwright.config.ts\` pins \`timezoneId: 'UTC'\` so baselines are machine-independent.` |
| `transcript-dead-end-error-states` | `- **Resolved:** \`<task3>\` — every status returns empty-state copy naming the consequence and the next step. Deliberately no controls: \`invalid-token\` has no in-app recovery and \`error\` already reconnects itself.` |
| `transcript-no-aria-live` | `- **Resolved:** \`<task4>\` — the timeline is \`role="log"\` with \`aria-live\` gated to the \`live\` status, so the history bulk-load is not read aloud on open.` |
| `transcript-no-live-scroll-affordance` | `- **Resolved:** \`<task4>\` — \`shouldFollow\` plus an \`$effect.pre\`/\`$effect\` pair follows the live tail only while the reader is already at the bottom.` |
| `transcript-hardcoded-spacing` | `- **Resolved:** \`<task5>\` — every gap and padding now uses the \`--s*\` scale. \`max-width: 860px\` stays a documented literal: \`--content-max\` is 760px and \`--table-max\` 1100px, and neither suits a monospace view.` |
| `transcript-no-focus-visible` | `- **Resolved:** \`<task5>\` — both \`<summary>\` disclosures gained \`cursor\`, \`:hover\`, and \`:focus-visible\` rules using \`--focus-ring\`.` |
| `transcript-timeline-rail-invisible` | `- **Resolved:** \`<task5>\` — the rail moved from \`--border\` to \`--strong\`.` |
| `transcript-unknown-payload-raw-json` | `- **Resolved:** \`<task5>\` — the raw payload moved behind an \`unrecognised event\` disclosure, collapsed by default. The \`raw\` fallback itself is unchanged and stays deliberate.` |
| `transcript-dim-text-contrast` | see Step 3 |

- [ ] **Step 3: Re-scope the dim-text finding as well as closing it**

`transcript-dim-text-contrast` needs two edits beyond the status change. Change its `- **Dimension:**` line from:

```
- **Dimension:** 6. Accessibility
```

to:

```
- **Dimension:** 1. Visual hierarchy & scanning
```

and use this `Resolved:` line, which must record the false premise:

```
- **Resolved:** `<task5>` — re-scoped before fixing. The accessibility framing was wrong: `client/shared/tokens.css:21` documents `--text-dim` at 5.69:1 on `--bg`, which clears WCAG SC 1.4.3. The real defect was hierarchy — the longest bodies (`.tx-thought pre`, `.tx-raw`) used the most recessive token. Both moved to `--text-muted`; `--text-dim` is now reserved for short labels.
```

Without that note the next reviewer re-files this as a contrast bug and re-litigates a settled question.

- [ ] **Step 4: Verify no finding is left open and none lost its Resolved line**

Run:

```bash
grep -c '^- \*\*Status:\*\* open' docs/ux-reviews/TranscriptApp.md
grep -c '^- \*\*Status:\*\* fixed' docs/ux-reviews/TranscriptApp.md
grep -c '^- \*\*Resolved:\*\*' docs/ux-reviews/TranscriptApp.md
```

Expected: `0` open, `16` fixed (the 5 closed by the predecessor project plus these 11), and `16` resolved lines. If open is non-zero or the fixed and resolved counts differ, a finding was missed.

- [ ] **Step 5: Regenerate the backlog and run the full gate**

Run:

```bash
bun run ux:backlog
bun run format
bun run check:full
```

Expected: `check:full` reports 12/12 green. `docs/ux-reviews/_BACKLOG.md` is regenerated by the first command — never hand-edit it.

Three suites in this repo are known to flake under parallel worker contention: `tests/review-loop/worktree.test.ts`, `tests/scripts/test-stories.test.ts`, and the story-manifest suite. If one of those fails, re-run it in isolation before treating it as a real regression.

- [ ] **Step 6: Commit**

```bash
git add docs/ux-reviews/TranscriptApp.md docs/ux-reviews/_BACKLOG.md
git commit -m "docs(ux): close the eleven open TranscriptApp findings"
```

---

## Final verification

After Task 6, confirm the whole branch:

```bash
bun run check:full
bun run knip
find tests/visual -name '*.spec.ts' | wc -l
grep -rl pinDefaultViewport tests/visual | wc -l
```

The last two counts must be equal. A visual spec without `pinDefaultViewport()` silently records desktop-intent baselines at whatever width leaked from the previous test in its worker — this exact regression escaped a task review in the predecessor project and was caught only by the final whole-branch review.
