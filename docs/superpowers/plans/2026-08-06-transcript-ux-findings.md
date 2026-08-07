<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# TranscriptApp UX Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four High findings and the story-coverage gap from the TranscriptApp UX review, so the coding-session transcript viewer stops rendering false or unreadable content.

**Architecture:** A pure mapper (`describe-event.ts`) narrows the untyped event payload into a discriminated union; a second pure module (`empty-state.ts`) maps session status to empty-state copy. The Svelte components render those typed shapes and hold no payload-probing logic. A new presentational `TranscriptView.svelte` owns all markup so it can be storied without network or `EventSource`.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), Zod v4, Storybook + `@crvy/strybk` screenshots, Playwright.

**Spec:** [`docs/superpowers/specs/2026-08-06-transcript-ux-findings-design.md`](../specs/2026-08-06-transcript-ux-findings-design.md)

## Global Constraints

- Strict TypeScript. **Use `.js` extensions in import paths**, always.
- **Never add lint-disable or type-ignore comments** — the hook policy blocks them. Fix the underlying issue.
- A `max-lines` / `max-lines-per-function` failure is a **design signal**: split the file or extract functions. Do not delete blank lines or compress formatting to pass.
- Formatter is **oxfmt** via `bun run format`, not prettier.
- Client tests MUST be run as `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`. A bare `bun test tests/client/...` matches nothing and reports success **without executing**.
- Shell is **fish**. Never pass `--include=*.ext` to `grep` — it errors with `no matches found`.
- Never pass `--no-verify` to `git commit`.
- `docs/ux-reviews/_BACKLOG.md` is generated. Never hand-edit it; regenerate with `bun run ux:backlog`.
- Never hand-edit inside `@generated-begin` / `@generated-end auto-screenshots` regions of `tests/visual/**` specs.
- Component `.svelte` files under `client/transcript/` carry **no** license header (match `StatusBanner.svelte`). `.stories.svelte` and `.ts` files **do** carry one; `bun run license:headers` stamps them.
- Error extraction idiom: `error instanceof Error ? error.message : String(error)`.
- `bun shoot` requires Storybook running in another terminal: `bun storybook`.

**Colour tokens available** (`client/shared/tokens.css`): `--accent` `#52e08a`, `--warn` `#e0b452`, `--danger` `#ff5d5d`, `--info` `#6cb6ff`, `--text` `#e6efe8`, `--text-muted` `#9aa79d`, `--text-dim` `#828d84`, `--border` `#222a24`, `--surface-1` `#111512`. There is **no** `--space-*` scale; only `--radius: 6px`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `client/transcript/describe-event.ts` (new) | Pure. Narrows one `TranscriptEvent`'s untyped payload into `DescribedEvent`. |
| `client/transcript/empty-state.ts` (new) | Pure. Maps `ViewerStatus` → empty-state copy or `null`. |
| `client/transcript/TranscriptView.svelte` (new) | Presentational. Props `{ events, status }`. Owns wrapper, header, timeline, empty branch. |
| `client/transcript/TranscriptApp.svelte` (modify) | State-wiring only: build state, `onMount(load)`, render `TranscriptView`. |
| `client/transcript/components/TimelineEvent.svelte` (modify) | Renders one `DescribedEvent`. No `payload[...]` access. |
| `client/transcript/components/StatusBanner.stories.svelte` (new) | The six banner states, honestly titled. |
| `client/transcript/TranscriptView.stories.svelte` (new) | Composed viewer states. |
| `client/transcript/TranscriptApp.stories.svelte` (delete) | Mis-titled — renders `StatusBanner`, not the app. |
| `client/transcript/components/TimelineEvent.stories.svelte` (modify) | Add `Prompt` and `Tool call pending`. |
| `tests/client/transcript/describe-event.test.ts` (new) | Table-driven unit tests for the mapper. |
| `tests/client/transcript/empty-state.test.ts` (new) | Table-driven unit tests for the status map. |

**Unchanged, do not touch:** `transcript.svelte.ts`, `fetchers.ts`, `sse.ts`, `stitch.ts`, `fetcher-schemas.ts`, `index.ts`, `StatusBanner.svelte`, `client/shared/ui/status-tone.ts`.

---

### Task 1: The event mapper

**Files:**

- Create: `client/transcript/describe-event.ts`
- Test: `tests/client/transcript/describe-event.test.ts`

**Interfaces:**

- Consumes: `TranscriptEvent` from `client/transcript/fetcher-schemas.js` (`{ seq: number; ts: string; type: 'prompt'|'update'|'permission_request'|'permission_decision'|'result'; payload: unknown }`); `statusTone(status: string): StatusTone` and `type StatusTone = 'accent'|'warn'|'danger'|'info'|'neutral'|'mute'` from `client/shared/ui/status-tone.js`.
- Produces: `describeEvent(event: TranscriptEvent): DescribedEvent`, the `DescribedEvent` union, and `interface PlanEntry { content: string; status: string; mark: string }`. Task 3 renders these.

**Behaviour notes for the implementer:**

- `statusTone()` has **no** entry for `completed` or `in_progress`, so both return `'neutral'`. A local two-key override supplies `accent` / `info`. Do **not** edit `client/shared/ui/status-tone.ts` — `client/settings/fetcher-schemas-analytics.ts:75` uses that same enum and would be recoloured.
- The `prompt` payload shape is **unverified**: it originates in the external `magi` service and no fixture exists in this repo. Probe order `prompt → text → content` is a deliberate guess; the `raw` fallback is what makes a wrong guess safe.
- Empty `entries: []` on a plan returns `raw`, not an empty checklist — an empty list would render as nothing at all and hide the event.

- [ ] **Step 1: Write the failing test**

Create `tests/client/transcript/describe-event.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { describeEvent } from '../../../client/transcript/describe-event.js'
import type { TranscriptEvent } from '../../../client/transcript/fetcher-schemas.js'

const ev = (type: TranscriptEvent['type'], payload: unknown): TranscriptEvent => ({
  seq: 1,
  ts: 't',
  type,
  payload,
})

const update = (payload: Record<string, unknown>): TranscriptEvent => ev('update', payload)

describe('describeEvent — prompt', () => {
  test.each(['prompt', 'text', 'content'])('reads the body from payload.%s', (field) => {
    expect(describeEvent(ev('prompt', { [field]: 'ship it' }))).toEqual({ kind: 'prompt', body: 'ship it' })
  })

  test('prefers prompt over text over content', () => {
    const described = describeEvent(ev('prompt', { prompt: 'a', text: 'b', content: 'c' }))
    expect(described).toEqual({ kind: 'prompt', body: 'a' })
  })

  test('falls back to raw when the body is not a string', () => {
    expect(describeEvent(ev('prompt', { prompt: { nested: true } })).kind).toBe('raw')
  })

  test('falls back to raw when no known field is present', () => {
    expect(describeEvent(ev('prompt', { unexpected: 'x' })).kind).toBe('raw')
  })
})

describe('describeEvent — message and thought', () => {
  test('reads a message body from content', () => {
    expect(describeEvent(update({ sessionUpdate: 'agent_message_chunk', content: 'hi' }))).toEqual({
      kind: 'message',
      body: 'hi',
    })
  })

  test('reads a message body from text when content is absent', () => {
    expect(describeEvent(update({ sessionUpdate: 'agent_message_chunk', text: 'hi' }))).toEqual({
      kind: 'message',
      body: 'hi',
    })
  })

  test('reads a thought body', () => {
    expect(describeEvent(update({ sessionUpdate: 'agent_thought_chunk', content: 'hmm' }))).toEqual({
      kind: 'thought',
      body: 'hmm',
    })
  })

  test('falls back to raw when a message body is not a string', () => {
    expect(describeEvent(update({ sessionUpdate: 'agent_message_chunk', content: 42 })).kind).toBe('raw')
  })
})

describe('describeEvent — tool', () => {
  const tool = (status: unknown): TranscriptEvent =>
    update({ sessionUpdate: 'tool_call', title: 'run tests', status })

  test.each([
    ['completed', 'accent', '✔'],
    ['failed', 'danger', '✖'],
    ['in_progress', 'info', '▸'],
    ['pending', 'warn', '·'],
  ])('maps status %s to tone %s and glyph %s', (status, tone, glyph) => {
    expect(describeEvent(tool(status))).toEqual({ kind: 'tool', title: 'run tests', status, tone, glyph })
  })

  test('an unmapped status is neutral with the default glyph', () => {
    expect(describeEvent(tool('weird'))).toEqual({
      kind: 'tool',
      title: 'run tests',
      status: 'weird',
      tone: 'neutral',
      glyph: '·',
    })
  })

  test('a missing status yields an empty status string, not the text undefined', () => {
    const described = describeEvent(update({ sessionUpdate: 'tool_call', title: 'run tests' }))
    expect(described).toEqual({ kind: 'tool', title: 'run tests', status: '', tone: 'neutral', glyph: '·' })
  })

  test('falls back to toolCallId then the literal tool for the title', () => {
    expect(describeEvent(update({ sessionUpdate: 'tool_call', toolCallId: 'tc-1' })).title).toBe('tc-1')
    expect(describeEvent(update({ sessionUpdate: 'tool_call' })).title).toBe('tool')
  })

  test('tool_call_update takes the same branch as tool_call', () => {
    expect(describeEvent(update({ sessionUpdate: 'tool_call_update', title: 't', status: 'failed' })).kind).toBe('tool')
  })
})

describe('describeEvent — plan', () => {
  const plan = (entries: unknown): TranscriptEvent => update({ sessionUpdate: 'plan', entries })

  test('maps entries to content, status, and a checklist mark', () => {
    const described = describeEvent(
      plan([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ]),
    )
    expect(described).toEqual({
      kind: 'plan',
      entries: [
        { content: 'a', status: 'completed', mark: '[x]' },
        { content: 'b', status: 'in_progress', mark: '[~]' },
        { content: 'c', status: 'pending', mark: '[ ]' },
      ],
    })
  })

  test('defaults a missing entry status to pending', () => {
    expect(describeEvent(plan([{ content: 'a' }])).entries).toEqual([
      { content: 'a', status: 'pending', mark: '[ ]' },
    ])
  })

  test.each([
    ['a non-array entries', 'not-an-array'],
    ['an empty entries array', []],
    ['an entry that is not an object', ['a']],
    ['an entry with no content', [{ status: 'pending' }]],
    ['an entry whose content is not a string', [{ content: 7 }]],
  ])('falls back to raw for %s', (_label, entries) => {
    expect(describeEvent(plan(entries)).kind).toBe('raw')
  })
})

describe('describeEvent — permission, result, raw', () => {
  test('permission_request is undecided', () => {
    expect(describeEvent(ev('permission_request', {}))).toEqual({ kind: 'permission', decided: false })
  })

  test('permission_decision is decided', () => {
    expect(describeEvent(ev('permission_decision', {}))).toEqual({ kind: 'permission', decided: true })
  })

  test('result carries the stop reason', () => {
    expect(describeEvent(ev('result', { stopReason: 'end_turn' }))).toEqual({
      kind: 'result',
      stopReason: 'end_turn',
    })
  })

  test('a missing stop reason is an empty string, not the text undefined', () => {
    expect(describeEvent(ev('result', {}))).toEqual({ kind: 'result', stopReason: '' })
  })

  test('an unknown sessionUpdate falls back to pretty-printed raw JSON', () => {
    const described = describeEvent(update({ sessionUpdate: 'available_commands_update', availableCommands: [] }))
    expect(described).toEqual({
      kind: 'raw',
      json: JSON.stringify({ sessionUpdate: 'available_commands_update', availableCommands: [] }, null, 2),
    })
  })

  test('a null payload renders as an empty object rather than throwing', () => {
    expect(describeEvent(ev('update', null))).toEqual({ kind: 'raw', json: '{}' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/describe-event.test.ts
```

Expected: FAIL — `Cannot find module '../../../client/transcript/describe-event.js'`.

- [ ] **Step 3: Write the implementation**

Create `client/transcript/describe-event.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StatusTone } from '../shared/ui/status-tone.js'
import { statusTone } from '../shared/ui/status-tone.js'
import type { TranscriptEvent } from './fetcher-schemas.js'

export interface PlanEntry {
  content: string
  status: string
  mark: string
}

export type DescribedEvent =
  | { kind: 'prompt'; body: string }
  | { kind: 'message'; body: string }
  | { kind: 'thought'; body: string }
  | { kind: 'tool'; title: string; status: string; tone: StatusTone; glyph: string }
  | { kind: 'plan'; entries: PlanEntry[] }
  | { kind: 'permission'; decided: boolean }
  | { kind: 'result'; stopReason: string }
  | { kind: 'raw'; json: string }

/** statusTone() has no entry for these two, so both would fall through to 'neutral'. */
const TOOL_TONE: Record<string, StatusTone> = { completed: 'accent', in_progress: 'info' }

const TOOL_GLYPH: Record<string, string> = { completed: '✔', failed: '✖', in_progress: '▸' }

const PLAN_MARK: Record<string, string> = { completed: '[x]', in_progress: '[~]' }

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function raw(payload: unknown): DescribedEvent {
  return { kind: 'raw', json: JSON.stringify(payload ?? {}, null, 2) }
}

function describeTool(payload: Record<string, unknown>): DescribedEvent {
  const status = asString(payload['status']) ?? ''
  return {
    kind: 'tool',
    title: asString(payload['title']) ?? asString(payload['toolCallId']) ?? 'tool',
    status,
    tone: TOOL_TONE[status] ?? statusTone(status),
    glyph: TOOL_GLYPH[status] ?? '·',
  }
}

function toPlanEntry(item: unknown): PlanEntry | null {
  if (typeof item !== 'object' || item === null) return null
  const content = asString((item as Record<string, unknown>)['content'])
  if (content === null) return null
  const status = asString((item as Record<string, unknown>)['status']) ?? 'pending'
  return { content, status, mark: PLAN_MARK[status] ?? '[ ]' }
}

function describePlan(payload: Record<string, unknown>): DescribedEvent {
  const source = payload['entries']
  if (!Array.isArray(source) || source.length === 0) return raw(payload)
  const entries: PlanEntry[] = []
  for (const item of source) {
    const entry = toPlanEntry(item)
    if (entry === null) return raw(payload)
    entries.push(entry)
  }
  return { kind: 'plan', entries }
}

function describeUpdate(payload: Record<string, unknown>): DescribedEvent {
  const kind = asString(payload['sessionUpdate']) ?? ''
  const body = asString(payload['content']) ?? asString(payload['text'])
  if (kind === 'agent_message_chunk') return body === null ? raw(payload) : { kind: 'message', body }
  if (kind === 'agent_thought_chunk') return body === null ? raw(payload) : { kind: 'thought', body }
  if (kind === 'tool_call' || kind === 'tool_call_update') return describeTool(payload)
  if (kind === 'plan') return describePlan(payload)
  return raw(payload)
}

/**
 * Narrow one transcript event's untyped payload into a shape the timeline can render.
 *
 * The payload originates in the external magi service and arrives as `z.unknown()`, so
 * every field access here is a probe with a fallback. The `raw` kind is the terminal
 * fallback: an unrecognised or malformed shape degrades to pretty-printed JSON rather
 * than throwing or rendering a misleading branch.
 */
export function describeEvent(event: TranscriptEvent): DescribedEvent {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  if (event.type === 'prompt') {
    const body = asString(payload['prompt']) ?? asString(payload['text']) ?? asString(payload['content'])
    return body === null ? raw(payload) : { kind: 'prompt', body }
  }
  if (event.type === 'permission_request') return { kind: 'permission', decided: false }
  if (event.type === 'permission_decision') return { kind: 'permission', decided: true }
  if (event.type === 'result') return { kind: 'result', stopReason: asString(payload['stopReason']) ?? '' }
  return describeUpdate(payload)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/describe-event.test.ts
```

Expected: PASS, 0 fail.

- [ ] **Step 5: Verify lint, types, and format**

```bash
bun run lint && bun run typecheck && bun run format
```

Expected: all clean. If `max-lines` fires on `describe-event.ts`, split the per-kind helpers into a sibling module — do not compress formatting.

- [ ] **Step 6: Commit**

```bash
git add client/transcript/describe-event.ts tests/client/transcript/describe-event.test.ts
git commit -m "feat(transcript): add pure describeEvent payload mapper"
```

---

### Task 2: The empty-state map

**Files:**

- Create: `client/transcript/empty-state.ts`
- Test: `tests/client/transcript/empty-state.test.ts`

**Interfaces:**

- Consumes: `type ViewerStatus = 'connecting' | 'live' | 'finished' | 'recording-disabled' | 'invalid-token' | 'error'` from `client/transcript/transcript.svelte.js`. Import it **type-only** (`import type`) so the runes module is never pulled in at runtime.
- Produces: `emptyStateFor(status: ViewerStatus): EmptyStateCopy | null` and `interface EmptyStateCopy { title: string; hint?: string }`. Task 4 renders these.

**Behaviour note:** the three `null` statuses are deliberate. Under `invalid-token` the banner already reads "This link is invalid or has expired"; a second empty-state block beneath it would only dilute the message. Same for `error` ("Temporarily unavailable — retrying") and `recording-disabled` ("Transcript not retained — live only").

- [ ] **Step 1: Write the failing test**

Create `tests/client/transcript/empty-state.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { emptyStateFor } from '../../../client/transcript/empty-state.js'

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

  test.each(['recording-disabled', 'invalid-token', 'error'] as const)(
    'returns null for %s, because the banner already carries the whole message',
    (status) => {
      expect(emptyStateFor(status)).toBeNull()
    },
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/empty-state.test.ts
```

Expected: FAIL — `Cannot find module '../../../client/transcript/empty-state.js'`.

- [ ] **Step 3: Write the implementation**

Create `client/transcript/empty-state.ts`:

```typescript
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
 * `null` means render nothing: for these three statuses the banner already states the
 * whole situation, and a second block beneath it would only dilute the message.
 */
const COPY: Record<ViewerStatus, EmptyStateCopy | null> = {
  connecting: { title: 'Loading the transcript…' },
  live: { title: 'Session is running', hint: 'No output yet.' },
  finished: { title: 'This session produced no output' },
  'recording-disabled': null,
  'invalid-token': null,
  error: null,
}

export function emptyStateFor(status: ViewerStatus): EmptyStateCopy | null {
  return COPY[status]
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/empty-state.test.ts
```

Expected: PASS, 0 fail.

- [ ] **Step 5: Verify lint, types, and format**

```bash
bun run lint && bun run typecheck && bun run format
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add client/transcript/empty-state.ts tests/client/transcript/empty-state.test.ts
git commit -m "feat(transcript): add empty-state copy map keyed by viewer status"
```

---

### Task 3: Render the timeline from the union

**Files:**

- Modify: `client/transcript/components/TimelineEvent.svelte` (replace whole file)
- Modify: `client/transcript/components/TimelineEvent.stories.svelte` (append two stories)

**Interfaces:**

- Consumes: `describeEvent(event: TranscriptEvent): DescribedEvent` and `interface PlanEntry { content: string; status: string; mark: string }` from `client/transcript/describe-event.js` (Task 1). Union members: `{kind:'prompt',body}`, `{kind:'message',body}`, `{kind:'thought',body}`, `{kind:'tool',title,status,tone,glyph}`, `{kind:'plan',entries}`, `{kind:'permission',decided}`, `{kind:'result',stopReason}`, `{kind:'raw',json}`.
- Produces: nothing consumed by later tasks except the rendered classes `.tx-ev`, `.tx-prompt`, `.tx-msg`, `.tx-thought`, `.tx-tool`, `.tx-plan`, `.tx-perm`, `.tx-result`, `.tx-raw`.

**Notes for the implementer:**

- `TimelineEvent.svelte` has **no** license header today. Keep it that way — it matches `StatusBanner.svelte`.
- `described` must be `$derived`, so `describeEvent` runs once per event rather than once per branch test.
- The tool row's glyph and the plan marks are `aria-hidden="true"`: they are decorative duplicates of the adjacent text, and a screen reader should hear `run tests failed`, not `✖ run tests failed`.
- Tone classes must cover all six `StatusTone` values. `neutral` maps to `--text-muted` and `mute` to `--text-dim`, matching `client/shared/ui/Pill.svelte`.

- [ ] **Step 1: Replace `TimelineEvent.svelte`**

Overwrite `client/transcript/components/TimelineEvent.svelte` with:

```svelte
<script lang="ts">
  import { describeEvent } from '../describe-event.js'
  import type { TranscriptEvent } from '../fetcher-schemas.js'

  let { event }: { event: TranscriptEvent } = $props()

  const described = $derived(describeEvent(event))
</script>

<div class="tx-ev tx-ev--{event.type}">
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

<style>
  .tx-ev {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    border-left: 2px solid var(--border);
    padding: 0.3rem 0.7rem;
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

- [ ] **Step 2: Append the two new stories**

Append to `client/transcript/components/TimelineEvent.stories.svelte`, after the existing `Tool call failed` story:

```svelte
<Story
  name="Prompt"
  args={{
    event: {
      seq: 11,
      ts: 't',
      type: 'prompt',
      payload: { prompt: 'The D7 retention figure looks off by one bucket — can you check the window boundary?' },
    },
  }}
/>

<Story
  name="Tool call pending"
  args={{
    event: {
      seq: 12,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'tool_call', title: 'read rollup-window-boundaries.ts', status: 'in_progress' },
    },
  }}
/>
```

- [ ] **Step 3: Verify lint, types, and format**

```bash
bun run lint && bun run typecheck && bun run format
```

Expected: all clean.

- [ ] **Step 4: Regenerate the visual spec and re-shoot**

With Storybook already running (`bun storybook` in another terminal):

```bash
bun run shoot:gen
bun shoot -g TimelineEvent
```

Expected: `shoot:gen` reports generated files; `bun shoot -g TimelineEvent` passes with 12 stories.

- [ ] **Step 5: Read the new shots and confirm the three High fixes**

```bash
ls .storybook-shots/transcript/components/TimelineEvent.spec.ts/
```

Read these three PNGs with the Read tool and confirm each visually:

- `transcript-TimelineEvent-Prompt-1.png` — shows the prompt text with a `you` label, not JSON.
- `transcript-TimelineEvent-Tool-call-failed-1.png` — red with `✖`, clearly distinct from `transcript-TimelineEvent-Tool-call-1.png`, which stays green with `✔`.
- `transcript-TimelineEvent-Plan-1.png` — three checklist rows (`[x]`, `[~]`, `[ ]`), no braces or quoted keys.

- [ ] **Step 6: Commit**

```bash
git add client/transcript/components/TimelineEvent.svelte client/transcript/components/TimelineEvent.stories.svelte tests/visual/transcript/components/TimelineEvent.spec.ts
git commit -m "fix(transcript): render prompt, plan, and tool status from the typed union"
```

---

### Task 4: Split out TranscriptView and fix the story titles

**Files:**

- Create: `client/transcript/TranscriptView.svelte`
- Create: `client/transcript/TranscriptView.stories.svelte`
- Create: `client/transcript/components/StatusBanner.stories.svelte`
- Modify: `client/transcript/TranscriptApp.svelte` (replace whole file)
- Delete: `client/transcript/TranscriptApp.stories.svelte`
- Delete: `tests/visual/transcript/TranscriptApp.spec.ts`

**Interfaces:**

- Consumes: `emptyStateFor(status: ViewerStatus): EmptyStateCopy | null` from `client/transcript/empty-state.js` (Task 2); `TimelineEvent` from `client/transcript/components/TimelineEvent.svelte` (Task 3); `EmptyState` from `client/shared/ui/EmptyState.svelte` with props `{ title: string; icon?: string; hint?: string; action?: Snippet }`; `createTranscriptState(token: string): TranscriptState` from `client/transcript/transcript.svelte.js`.
- Produces: `TranscriptView.svelte` with props `{ events: TranscriptEvent[]; status: ViewerStatus }`.

**Notes for the implementer:**

- Story titles **must** begin with `transcript/`. `.storybook/preview.ts` resolves the per-app stylesheet from the title's first segment via `client/stories/app-area.ts`; any other prefix silently loads base+tokens only and the shots come out unstyled.
- `.stories.svelte` files **do** carry the four-line HTML-comment license header. `bun run license:headers` stamps them; `shoot:gen` runs it automatically.
- `client/transcript/index.ts` is untouched: `TranscriptApp` keeps `token` as its only prop.

- [ ] **Step 1: Create `TranscriptView.svelte`**

Create `client/transcript/TranscriptView.svelte`:

```svelte
<script lang="ts">
  import EmptyState from '../shared/ui/EmptyState.svelte'
  import StatusBanner from './components/StatusBanner.svelte'
  import TimelineEvent from './components/TimelineEvent.svelte'
  import { emptyStateFor } from './empty-state.js'
  import type { TranscriptEvent } from './fetcher-schemas.js'
  import type { ViewerStatus } from './transcript.svelte.js'

  let { events, status }: { events: TranscriptEvent[]; status: ViewerStatus } = $props()

  const empty = $derived(events.length === 0 ? emptyStateFor(status) : null)
</script>

<main class="tx-wrap">
  <header>
    <h1>Coding session</h1>
    <StatusBanner {status} />
  </header>
  {#if events.length > 0}
    <div class="tx-timeline">
      {#each events as event (event.seq)}
        <TimelineEvent {event} />
      {/each}
    </div>
  {:else if empty !== null}
    <EmptyState title={empty.title} hint={empty.hint} />
  {/if}
</main>
```

- [ ] **Step 2: Replace `TranscriptApp.svelte`**

Overwrite `client/transcript/TranscriptApp.svelte` with:

```svelte
<script lang="ts">
  import { onMount } from 'svelte'

  import TranscriptView from './TranscriptView.svelte'
  import { createTranscriptState } from './transcript.svelte.js'

  let { token }: { token: string } = $props()
  const state = createTranscriptState(token)

  onMount(() => {
    void state.load()
  })
</script>

<TranscriptView events={state.events} status={state.status} />
```

- [ ] **Step 3: Move the banner stories to an honest title**

Create `client/transcript/components/StatusBanner.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import StatusBanner from './StatusBanner.svelte'

  const { Story } = defineMeta({ title: 'transcript/StatusBanner', component: StatusBanner })
</script>

<Story name="Connecting" args={{ status: 'connecting' }} />

<Story name="Live" args={{ status: 'live' }} />

<Story name="Finished" args={{ status: 'finished' }} />

<Story name="Recording disabled" args={{ status: 'recording-disabled' }} />

<Story name="Invalid token" args={{ status: 'invalid-token' }} />

<Story name="Error" args={{ status: 'error' }} />
```

Then delete the mis-titled file and its generated spec:

```bash
git rm client/transcript/TranscriptApp.stories.svelte tests/visual/transcript/TranscriptApp.spec.ts
rm -rf .storybook-shots/transcript/TranscriptApp.spec.ts
```

- [ ] **Step 4: Create the composed-viewer stories**

Create `client/transcript/TranscriptView.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import TranscriptView from './TranscriptView.svelte'
  import type { TranscriptEvent } from './fetcher-schemas.js'

  const { Story } = defineMeta({ title: 'transcript/TranscriptView', component: TranscriptView })

  const SESSION: TranscriptEvent[] = [
    {
      seq: 1,
      ts: 't',
      type: 'prompt',
      payload: { prompt: 'The D7 retention figure looks off by one bucket — can you check the window boundary?' },
    },
    {
      seq: 2,
      ts: 't',
      type: 'update',
      payload: {
        sessionUpdate: 'agent_thought_chunk',
        content: 'The D1 and D7 figures disagree by exactly one bucket, which smells like an inclusive window edge.',
      },
    },
    {
      seq: 3,
      ts: 't',
      type: 'update',
      payload: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Reproduce the off-by-one', status: 'completed' },
          { content: 'Fix the window boundary', status: 'in_progress' },
          { content: 'Add a regression test', status: 'pending' },
        ],
      },
    },
    {
      seq: 4,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'tool_call', title: 'read rollup-window-boundaries.ts', status: 'completed' },
    },
    {
      seq: 5,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'tool_call', title: 'run analytics tests', status: 'failed' },
    },
    {
      seq: 6,
      ts: 't',
      type: 'update',
      payload: { sessionUpdate: 'agent_message_chunk', content: 'The boundary was inclusive on both ends. Fixed.' },
    },
    { seq: 7, ts: 't', type: 'result', payload: { stopReason: 'end_turn' } },
  ]
</script>

<Story name="Populated" args={{ events: SESSION, status: 'finished' }} />

<Story name="Empty connecting" args={{ events: [], status: 'connecting' }} />

<Story name="Empty live" args={{ events: [], status: 'live' }} />

<Story name="Empty finished" args={{ events: [], status: 'finished' }} />

<Story name="Empty invalid token" args={{ events: [], status: 'invalid-token' }} />
```

- [ ] **Step 5: Verify lint, types, and format**

```bash
bun run lint && bun run typecheck && bun run format
```

Expected: all clean.

- [ ] **Step 6: Generate specs and add the narrow-viewport shot**

```bash
bun run shoot:gen
```

This creates `tests/visual/transcript/TranscriptView.spec.ts` and `tests/visual/transcript/components/StatusBanner.spec.ts`. The generator emits `import { test, expect, switchStory } from '@crvy/strybk'` at the top, so no import changes are needed there.

Append this **below** the `// @generated-end auto-screenshots` marker in `tests/visual/transcript/TranscriptView.spec.ts` — never inside the generated region:

```typescript
import { pinDefaultViewport } from '../support/viewport.js'

pinDefaultViewport()

test('TranscriptView — populated, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'transcript-transcriptview--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})
```

`pinDefaultViewport()` is **mandatory** here, not decoration. `sharedPage` is worker-scoped and its viewport is never reset between tests, so a `setViewportSize` call leaks 640px into whichever test runs next in that worker and silently records a desktop-intent baseline at a narrow size. `tests/visual/support/viewport.ts` documents this; every spec in the repo that calls `setViewportSize` pins first.

`tests/visual/transcript/components/StatusBanner.spec.ts` needs the same two lines appended (path `'../../support/viewport.js'` — one level deeper) only if you add a viewport-changing test to it. This plan does not, so leave it as generated.

- [ ] **Step 7: Shoot and confirm**

```bash
bun shoot -g TranscriptView
bun shoot -g StatusBanner
```

Expected: `TranscriptView` passes with 6 shots (5 stories + the narrow one); `StatusBanner` passes with 6.

Read these PNGs with the Read tool and confirm:

- `.storybook-shots/transcript/TranscriptView.spec.ts/transcript-TranscriptView-Populated-1.png` — heading, banner, and a seven-event timeline where the prompt, the plan checklist, and the red failed tool call are all legible.
- `…-Empty-live-1.png` — "Session is running" with the hint, not a blank page.
- `…-Empty-invalid-token-1.png` — the banner alone, **nothing** below it.
- `…-TranscriptView-populated-narrow-1.png` — no horizontal overflow at 640px.

- [ ] **Step 8: Commit**

```bash
git add -A client/transcript tests/visual/transcript
git commit -m "feat(transcript): split out TranscriptView, add empty states and real stories"
```

---

### Task 5: Close the findings and fix the red backlog test

**Files:**

- Modify: `tests/scripts/ux-backlog.test.ts:232`
- Modify: `docs/ux-reviews/TranscriptApp.md`
- Regenerate: `docs/ux-reviews/_BACKLOG.md`

**Interfaces:**

- Consumes: nothing from earlier tasks except the commit SHAs they produced. Collect them with `git log --oneline -5`.
- Produces: nothing.

**Context:** `tests/scripts/ux-backlog.test.ts:232` asserts `toHaveLength(21)`, but writing the TranscriptApp review brought the count to 22. **That test is red on this branch right now**, before any of this plan's changes. The parser in `scripts/ux-backlog-lib.ts` throws when a finding's `Status` is anything other than `open` without a `**Resolved:**` line, so the bookkeeping below is enforced, not optional.

- [ ] **Step 1: Fix the review-count assertion**

In `tests/scripts/ux-backlog.test.ts`, change:

```typescript
    expect(reviews).toHaveLength(21)
```

to:

```typescript
    expect(reviews).toHaveLength(22)
```

- [ ] **Step 2: Run the backlog test to confirm it still fails on backlog currency**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: the `covers every review document` test now PASSES; `is current — regenerating in memory reproduces it exactly` still FAILS until Step 4 regenerates the file. That is the correct intermediate state.

- [ ] **Step 3: Mark the five findings fixed**

Collect the SHAs first:

```bash
git log --oneline -5
```

In `docs/ux-reviews/TranscriptApp.md`, for each of the five findings below, change `- **Status:** open` to `- **Status:** fixed` and insert a `- **Resolved:**` line directly after it. Use the actual SHA of the commit that closed each one.

- `transcript-prompt-raw-json` (Task 3's commit):

```markdown
- **Status:** fixed
- **Resolved:** <task-3-sha> — `describeEvent` gives `prompt` its own branch. The field probe order (`prompt` → `text` → `content`) is a guess: no `prompt` fixture exists in this repo and the payload originates in magi, so this must be re-verified against a real magi payload. A wrong guess degrades to the `raw` fallback rather than breaking.
```

- `transcript-tool-failure-reads-as-success` (Task 3's commit):

```markdown
- **Status:** fixed
- **Resolved:** <task-3-sha> — tool rows take colour from a `StatusTone` and carry a status glyph, so failed reads red with `✖` and completed green with `✔`.
```

- `transcript-plan-raw-json` (Task 3's commit):

```markdown
- **Status:** fixed
- **Resolved:** <task-3-sha> — plans render as a checklist with per-entry `[x]` / `[~]` / `[ ]` marks.
```

- `transcript-no-empty-state` (Task 4's commit):

```markdown
- **Status:** fixed
- **Resolved:** <task-4-sha> — `emptyStateFor()` supplies status-aware copy rendered through the shared `EmptyState`; the three statuses whose banner already says everything render nothing.
```

- `transcript-app-story-renders-banner` (Task 4's commit):

```markdown
- **Status:** fixed
- **Resolved:** <task-4-sha> — the banner states moved to `transcript/StatusBanner` and the composed viewer is storied as `transcript/TranscriptView` with populated, empty, and 640px shots.
```

Leave the other eleven findings `open` and untouched.

- [ ] **Step 4: Regenerate the backlog and format**

```bash
bun run ux:backlog
bun run format
```

Expected: a line of the form `wrote docs/ux-reviews/_BACKLOG.md (22 sections, N findings)`. The section count must read **22**. If `ux:backlog` throws instead, a finding was set to `fixed` without a `- **Resolved:**` line — the parser enforces that pairing.

- [ ] **Step 5: Run the backlog test to verify it passes**

```bash
bun test tests/scripts/ux-backlog.test.ts
```

Expected: PASS, 0 fail.

- [ ] **Step 6: Full verification**

```bash
bun run check:full
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/transcript/
```

Expected: `check:full` green, all transcript client tests pass.

`check:full` runs `bun test --parallel`. This repo has a known pre-existing flake there: several review-loop / story-runner / analytics harness suites time out at ~5s under CPU contention. If the `test` step fails, re-run serially with `bun test` and confirm 0 failures before treating it as a real regression. Any failure in `client/` or `tests/client/` is **not** the flake.

- [ ] **Step 7: Commit**

```bash
git add tests/scripts/ux-backlog.test.ts docs/ux-reviews/TranscriptApp.md docs/ux-reviews/_BACKLOG.md
git commit -m "docs(ux): close five TranscriptApp findings, fix review-count assertion"
```
