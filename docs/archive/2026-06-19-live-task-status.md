<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Live Task Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the bot processes a turn, show a single ephemeral status message (alongside `Typing…`) that updates in place to reflect the currently executing task, then delete it when the real reply posts.

**Architecture:** A new optional `StatusHandle` capability on `ReplyFn` (`createStatus → { update, dismiss }`), implemented per provider with native edit/delete primitives (Telegram/Discord/Mattermost; Kontur Talk omits it). A dedicated `LiveStatusReporter` owns the handle's lifecycle, driven by the existing `experimental_onToolCallStart`/`onToolCallFinish` hooks and created/dismissed in `callLlm` from the **unwrapped** reply so the typing heartbeat is unaffected. Status content comes from a pure label+allowlisted-argument registry with a humanized fallback for MCP/plugin/unmapped tools.

**Tech Stack:** TypeScript (strict, `.js` import paths), Bun test runner (`bun:test`), DI-first tests, existing chat-provider adapters (Grammy / discord.js / Mattermost REST / Kontur Talk REST).

**Spec:** `docs/superpowers/specs/2026-06-19-live-task-status-design.md`

**Branch:** `feat/live-task-status` (already checked out).

> **Note on the anti-flicker behavior:** the spec mentions a "~600ms minimum update interval". During planning this was replaced with a **deterministic dedup-by-equality guard** (skip an edit when the rendered text is unchanged). A correct time-based throttle needs a trailing-edge timer (or it leaves stale text) and would force wall-clock timing assertions, which this repo forbids in tests. Dedup-by-equality removes all redundant edits (the common `Thinking… → Thinking…` churn) with zero timing. True time-based coalescing of rapid _distinct_ labels is a possible future refinement.

---

## File Structure

**New files:**

- `src/chat/status-handle.ts` — the `StatusHandle` type (mirrors `src/chat/prompt-handle.ts`; type-only).
- `src/live-status/tool-status-labels.ts` — pure label + allowlisted-argument registry and `formatToolStatus`.
- `src/live-status/reporter.ts` — `LiveStatusReporter` (lifecycle: start / onToolStart / onToolFinish / dismiss).
- `tests/live-status/tool-status-labels.test.ts`
- `tests/live-status/reporter.test.ts`

**Modified files:**

- `src/chat/types.ts` — re-export `StatusHandle`; add optional `createStatus` to `ReplyFn`.
- `src/chat/telegram/reply-fn-builder.ts` + `tests/chat/telegram/reply-fn-builder.test.ts`
- `src/chat/discord/reply-helpers.ts` + `tests/chat/discord/reply-helpers.test.ts`
- `src/chat/mattermost/reply-helpers.ts` + `tests/chat/mattermost/reply-helpers.test.ts`
- `tests/chat/kontur-talk/reply-helpers.test.ts` (assert no `createStatus`)
- `tests/reply-typing-heartbeat.test.ts` (assert `createStatus` passes through un-wrapped)
- `src/llm-orchestrator-types.ts` — add `liveStatus` to `InvokeModelArgs` and `ToolCallContext`.
- `src/llm-orchestrator-invoke.ts` + `tests/llm-orchestrator-invoke.test.ts` — set `ctx.liveStatus`; drive it from the hooks.
- `src/llm-orchestrator.ts` + `tests/llm-orchestrator.test.ts` — create the reporter and dismiss it in `callLlm`.

---

## Task 1: `StatusHandle` type + `ReplyFn.createStatus`

**Files:**

- Create: `src/chat/status-handle.ts`
- Modify: `src/chat/types.ts:227-250`

These are **type-only** changes (no runtime logic), mirroring the existing pure-type file `src/chat/prompt-handle.ts` which has no dedicated test. There is nothing to assert at runtime, so this task has no test of its own; it is exercised by every later task. If the TDD write-hook flags the type-only file, proceed — `prompt-handle.ts` is the established precedent for a type-only module.

- [ ] **Step 1: Create the `StatusHandle` type**

Create `src/chat/status-handle.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Detached control over an ephemeral status message: edit it in place or delete it. */
export type StatusHandle = {
  /** Edit the status message in place. Best-effort; never throws. */
  update: (text: string) => Promise<void>
  /** Delete the status message. Best-effort; never throws. */
  dismiss: () => Promise<void>
}
```

- [ ] **Step 2: Re-export `StatusHandle` and add `createStatus` to `ReplyFn`**

In `src/chat/types.ts`, just below the existing `PromptHandle` import/re-export (around line 229-230), add the `StatusHandle` import and re-export:

```typescript
import type { PromptHandle } from './prompt-handle.js'
export type { PromptHandle } from './prompt-handle.js'
import type { StatusHandle } from './status-handle.js'
export type { StatusHandle } from './status-handle.js'
```

Then add `createStatus` to the **optional** half of `ReplyFn` (the `Partial<{ ... }>` block, after `embed`):

```typescript
  /** Optional: send a structured embed. Only Discord implements this today. */
  embed: (options: EmbedOptions) => Promise<void>
  /**
   * Optional: post an ephemeral status message and return a handle to update/delete it.
   * Returns undefined when the platform cannot create one (e.g. Kontur Talk) or the send fails.
   */
  createStatus: (initialText: string) => Promise<StatusHandle | undefined>
}>
```

- [ ] **Step 3: Typecheck**

Run: `bun typecheck`
Expected: PASS (no usages yet; types resolve).

- [ ] **Step 4: Commit**

```bash
git add src/chat/status-handle.ts src/chat/types.ts
git commit -m "feat(chat): add StatusHandle capability to ReplyFn"
```

---

## Task 2: Tool-status label registry

**Files:**

- Create: `src/live-status/tool-status-labels.ts`
- Test: `tests/live-status/tool-status-labels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/live-status/tool-status-labels.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatToolStatus } from '../../src/live-status/tool-status-labels.js'

describe('formatToolStatus', () => {
  test('web_fetch shows the host without quotes', () => {
    expect(formatToolStatus('web_fetch', { url: 'https://example.com/path?q=1' })).toBe('🌐 Fetching example.com…')
  })

  test('falls back to the raw value when the url is unparseable', () => {
    expect(formatToolStatus('web_fetch', { url: 'not a url' })).toBe('🌐 Fetching not a url…')
  })

  test('search_memory quotes the query argument', () => {
    expect(formatToolStatus('search_memory', { query: 'budget' })).toBe('🔍 Searching memory: "budget"…')
  })

  test('create_task quotes the title argument', () => {
    expect(formatToolStatus('create_task', { title: 'Buy milk' })).toBe('📝 Creating task: "Buy milk"…')
  })

  test('mapped tool with no extractable argument omits the argument', () => {
    expect(formatToolStatus('create_task', {})).toBe('📝 Creating task…')
  })

  test('collapses whitespace and truncates long arguments to 40 chars', () => {
    const long = `${'a'.repeat(50)}`
    const result = formatToolStatus('search_memory', { query: `  multi\nline   ${long}` })
    expect(result.startsWith('🔍 Searching memory: "multi line ')).toBe(true)
    expect(result.endsWith('…"…')).toBe(true)
  })

  test('plugin tool falls back to humanized last segment', () => {
    expect(formatToolStatus('plugin_audio-transcribe__transcribe', { audioId: 'x' })).toBe('⚙️ Running transcribe…')
  })

  test('mcp tool falls back to humanized last segment', () => {
    expect(formatToolStatus('mcp_server__do_thing', {})).toBe('⚙️ Running do thing…')
  })

  test('unmapped core tool falls back to humanized full name', () => {
    expect(formatToolStatus('add_watcher', {})).toBe('⚙️ Running add watcher…')
  })

  test('never returns the argument when input is not a record', () => {
    expect(formatToolStatus('search_memory', 'budget')).toBe('🔍 Searching memory…')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/live-status/tool-status-labels.test.ts`
Expected: FAIL — cannot find module `../../src/live-status/tool-status-labels.js`.

- [ ] **Step 3: Write the implementation**

Create `src/live-status/tool-status-labels.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * A status entry for a tool. The optional `arg` extractor is the allowlist: only the
 * single field it reads is ever surfaced. `quote: false` renders the value bare
 * (used for hosts); otherwise it is wrapped in quotes.
 */
export type ToolStatusEntry = {
  emoji: string
  label: string
  quote?: boolean
  arg?: (input: unknown) => string | undefined
}

const MAX_ARG_LENGTH = 40

const asRecord = (input: unknown): Record<string, unknown> | undefined =>
  typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined

/** Return the first non-empty string field among `keys`, or undefined. */
const getStringField = (input: unknown, keys: readonly string[]): string | undefined => {
  const record = asRecord(input)
  if (record === undefined) return undefined
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/** Extract the host of a `url` field; fall back to the raw value when it does not parse. */
const hostOf = (input: unknown): string | undefined => {
  const url = getStringField(input, ['url'])
  if (url === undefined) return undefined
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Collapse whitespace, trim, and truncate to MAX_ARG_LENGTH with an ellipsis. */
export const sanitizeArg = (value: string): string => {
  const collapsed = value.replace(/\s+/gu, ' ').trim()
  return collapsed.length > MAX_ARG_LENGTH ? `${collapsed.slice(0, MAX_ARG_LENGTH)}…` : collapsed
}

const REGISTRY: Record<string, ToolStatusEntry> = {
  web_fetch: { emoji: '🌐', label: 'Fetching', quote: false, arg: hostOf },
  fetch_chat_link: { emoji: '🔗', label: 'Reading link', quote: false, arg: hostOf },
  search_memory: { emoji: '🔍', label: 'Searching memory', arg: (i) => getStringField(i, ['query']) },
  list_memory: { emoji: '🧠', label: 'Recalling memory' },
  remember_memory: { emoji: '🧠', label: 'Saving a memory' },
  search_memos: { emoji: '🔍', label: 'Searching memos', arg: (i) => getStringField(i, ['query']) },
  save_memo: { emoji: '📌', label: 'Saving a memo' },
  list_memos: { emoji: '📒', label: 'Listing memos' },
  create_task: { emoji: '📝', label: 'Creating task', arg: (i) => getStringField(i, ['title', 'name']) },
  update_task: { emoji: '✏️', label: 'Updating task' },
  delete_task: { emoji: '🗑️', label: 'Deleting task' },
  get_task: { emoji: '📄', label: 'Reading task' },
  list_tasks: { emoji: '📋', label: 'Listing tasks' },
  search_tasks: { emoji: '🔍', label: 'Searching tasks', arg: (i) => getStringField(i, ['query', 'text']) },
  count_tasks: { emoji: '🔢', label: 'Counting tasks' },
  add_comment: { emoji: '💬', label: 'Adding a comment' },
  create_project: { emoji: '📁', label: 'Creating project', arg: (i) => getStringField(i, ['name', 'title']) },
  list_projects: { emoji: '📁', label: 'Listing projects' },
  list_files: { emoji: '📎', label: 'Listing files' },
  search_staged_files: { emoji: '📎', label: 'Searching files', arg: (i) => getStringField(i, ['query']) },
  upload_attachment: { emoji: '📤', label: 'Attaching a file' },
  resolve_staged_file: { emoji: '📎', label: 'Attaching a file' },
  create_recurring_task: { emoji: '🔁', label: 'Scheduling a recurring task' },
  lookup_group_history: { emoji: '🕘', label: 'Checking history' },
  find_user: { emoji: '👤', label: 'Looking up a user' },
  get_current_time: { emoji: '🕒', label: 'Checking the time' },
}

/** Humanize a tool id for the fallback: last `__` segment (MCP/plugin) or stripped prefix, spaced + lowercased. */
const humanizeToolName = (toolName: string): string => {
  const base = toolName.includes('__')
    ? toolName.slice(toolName.lastIndexOf('__') + 2)
    : toolName.replace(/^(?:mcp|plugin)_/u, '')
  return base.replace(/[_-]+/gu, ' ').trim().toLowerCase()
}

/** Render the status line for a tool call (without the parallel "(+n)" suffix, which the reporter adds). */
export const formatToolStatus = (toolName: string, input: unknown): string => {
  const entry = REGISTRY[toolName]
  if (entry === undefined) {
    return `⚙️ Running ${humanizeToolName(toolName)}…`
  }
  const rawArg = entry.arg === undefined ? undefined : entry.arg(input)
  if (rawArg === undefined || rawArg.trim() === '') {
    return `${entry.emoji} ${entry.label}…`
  }
  const arg = sanitizeArg(rawArg)
  const middle = entry.quote === false ? ` ${arg}` : `: "${arg}"`
  return `${entry.emoji} ${entry.label}${middle}…`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/live-status/tool-status-labels.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/live-status/tool-status-labels.ts tests/live-status/tool-status-labels.test.ts
git commit -m "feat(live-status): tool status label + argument registry"
```

---

## Task 3: `LiveStatusReporter`

**Files:**

- Create: `src/live-status/reporter.ts`
- Test: `tests/live-status/reporter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/live-status/reporter.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ReplyFn, StatusHandle } from '../../src/chat/types.js'
import { createLiveStatusReporter } from '../../src/live-status/reporter.js'
import { flushMicrotasks } from '../utils/test-helpers.js'

type Recorder = {
  reply: ReplyFn
  created: string[]
  updates: string[]
  dismissed: number
}

function makeReply(overrides?: Partial<{ createStatus: ReplyFn['createStatus'] }>): Recorder {
  const created: string[] = []
  const updates: string[] = []
  let dismissed = 0
  const handle: StatusHandle = {
    update: (text: string) => {
      updates.push(text)
      return Promise.resolve()
    },
    dismiss: () => {
      dismissed += 1
      return Promise.resolve()
    },
  }
  const reply = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {},
    buttons: () => Promise.resolve(undefined),
    createStatus: (initialText: string) => {
      created.push(initialText)
      return Promise.resolve(handle)
    },
    ...overrides,
  } as unknown as ReplyFn
  return {
    reply,
    created,
    get updates() {
      return updates
    },
    get dismissed() {
      return dismissed
    },
  } as unknown as Recorder
}

describe('createLiveStatusReporter', () => {
  test('start creates the status with the Thinking placeholder', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    expect(rec.created).toEqual(['💭 Thinking…'])
  })

  test('onToolStart updates to the tool label', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'Buy milk' } })
    await flushMicrotasks()
    expect(rec.updates).toEqual(['📝 Creating task: "Buy milk"…'])
  })

  test('parallel tool starts render a (+n) suffix; finishing returns to a single label then Thinking', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'search_memory', input: { query: 'a' } })
    reporter.onToolStart({ toolName: 'create_task', input: { title: 'b' } })
    reporter.onToolFinish()
    reporter.onToolFinish()
    await flushMicrotasks()
    expect(rec.updates).toEqual([
      '🔍 Searching memory: "a"…',
      '📝 Creating task: "b"… (+1)',
      '📝 Creating task: "b"…',
      '💭 Thinking…',
    ])
  })

  test('does not emit redundant updates for unchanged text', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    // No tools ever start: render() stays "Thinking…" which equals the created text → no update.
    reporter.onToolFinish()
    await flushMicrotasks()
    expect(rec.updates).toEqual([])
  })

  test('dismiss deletes the status exactly once', async () => {
    const rec = makeReply()
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    await reporter.dismiss()
    await reporter.dismiss()
    expect(rec.dismissed).toBe(1)
  })

  test('is a no-op when the platform has no createStatus', async () => {
    const rec = makeReply({ createStatus: undefined })
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: {} })
    reporter.onToolFinish()
    await reporter.dismiss()
    expect(rec.updates).toEqual([])
    expect(rec.dismissed).toBe(0)
  })

  test('swallows a rejecting createStatus', async () => {
    const rec = makeReply({ createStatus: () => Promise.reject(new Error('boom')) })
    const reporter = createLiveStatusReporter(rec.reply)
    await reporter.start()
    reporter.onToolStart({ toolName: 'create_task', input: {} })
    await reporter.dismiss()
    expect(rec.dismissed).toBe(0)
  })
})
```

> `flushMicrotasks` already exists in `tests/utils/test-helpers.ts` (imported by the orchestrator suite). `onToolStart`/`onToolFinish` are synchronous and fire-and-forget the `update`, so the test awaits a microtask flush before asserting.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/live-status/reporter.test.ts`
Expected: FAIL — cannot find module `../../src/live-status/reporter.js`.

- [ ] **Step 3: Write the implementation**

Create `src/live-status/reporter.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn, StatusHandle } from '../chat/types.js'
import { formatToolStatus } from './tool-status-labels.js'

const THINKING = '💭 Thinking…'

/** Owns a single ephemeral status message for one turn. All methods are best-effort and never throw. */
export type LiveStatusReporter = {
  /** Create the status message (Thinking placeholder). Safe to await even when unsupported. */
  start: () => Promise<void>
  /** A tool started executing. */
  onToolStart: (event: { toolName: string; input: unknown }) => void
  /** A tool finished executing. */
  onToolFinish: () => void
  /** Delete the status message. Idempotent. */
  dismiss: () => Promise<void>
}

export function createLiveStatusReporter(reply: ReplyFn): LiveStatusReporter {
  let handle: StatusHandle | undefined
  let inFlight = 0
  let lastStartLabel = THINKING
  let lastRendered: string | undefined

  const render = (): string => {
    if (inFlight <= 0) return THINKING
    if (inFlight === 1) return lastStartLabel
    return `${lastStartLabel} (+${inFlight - 1})`
  }

  const apply = (): void => {
    if (handle === undefined) return
    const text = render()
    if (text === lastRendered) return
    lastRendered = text
    void handle.update(text).catch(() => undefined)
  }

  return {
    start: async (): Promise<void> => {
      if (reply.createStatus === undefined) return
      handle = await reply.createStatus(THINKING).catch(() => undefined)
      if (handle !== undefined) lastRendered = THINKING
    },
    onToolStart: (event): void => {
      inFlight += 1
      lastStartLabel = formatToolStatus(event.toolName, event.input)
      apply()
    },
    onToolFinish: (): void => {
      inFlight = Math.max(0, inFlight - 1)
      apply()
    },
    dismiss: async (): Promise<void> => {
      if (handle === undefined) return
      const current = handle
      handle = undefined
      await current.dismiss().catch(() => undefined)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/live-status/reporter.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/live-status/reporter.ts tests/live-status/reporter.test.ts
git commit -m "feat(live-status): LiveStatusReporter lifecycle"
```

---

## Task 4: Telegram `createStatus`

**Files:**

- Modify: `src/chat/telegram/reply-fn-builder.ts:64-86`
- Test: `tests/chat/telegram/reply-fn-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block inside `tests/chat/telegram/reply-fn-builder.test.ts` (after the existing top-level `describe('buildTelegramReplyFn', ...)`, at the end of the file). Add the imports at the top: `import type { Context } from 'grammy'` and ensure `buildTelegramReplyFn` is already imported (it is).

```typescript
describe('buildTelegramReplyFn createStatus', () => {
  beforeEach(() => {
    mockLogger()
  })

  function makeApi(): {
    api: { editMessageText: typeof noopEdit; deleteMessage: typeof noopDelete }
    edits: Array<[number, number, string]>
    deletes: Array<[number, number]>
  } {
    const edits: Array<[number, number, string]> = []
    const deletes: Array<[number, number]> = []
    const noopEdit = (chatId: number, messageId: number, text: string): Promise<unknown> => {
      edits.push([chatId, messageId, text])
      return Promise.resolve()
    }
    const noopDelete = (chatId: number, messageId: number): Promise<unknown> => {
      deletes.push([chatId, messageId])
      return Promise.resolve()
    }
    return { api: { editMessageText: noopEdit, deleteMessage: noopDelete }, edits, deletes }
  }

  test('creates, updates, and dismisses a status message', async () => {
    const { api, edits, deletes } = makeApi()
    const ctx = {
      chat: { id: 99, type: 'private' },
      message: { message_id: 321 },
      reply: (_text: string) => Promise.resolve({ message_id: 555, chat: { id: 99 } }),
      replyWithChatAction: () => Promise.resolve(),
    } as unknown as Context

    const reply = buildTelegramReplyFn(ctx, undefined, false, api)
    assert(reply.createStatus !== undefined, 'expected createStatus')

    const handle = await reply.createStatus('💭 Thinking…')
    assert(handle !== undefined, 'expected a status handle')
    await handle.update('📝 Creating task…')
    await handle.dismiss()

    expect(edits).toEqual([[99, 555, '📝 Creating task…']])
    expect(deletes).toEqual([[99, 555]])
  })

  test('returns undefined when the send fails', async () => {
    const { api } = makeApi()
    const ctx = {
      chat: { id: 99, type: 'private' },
      message: { message_id: 321 },
      reply: () => Promise.reject(new Error('send failed')),
      replyWithChatAction: () => Promise.resolve(),
    } as unknown as Context

    const reply = buildTelegramReplyFn(ctx, undefined, false, api)
    assert(reply.createStatus !== undefined, 'expected createStatus')
    expect(await reply.createStatus('💭 Thinking…')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/telegram/reply-fn-builder.test.ts`
Expected: FAIL — `reply.createStatus` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/chat/telegram/reply-fn-builder.ts`, add the `StatusHandle` import:

```typescript
import type { ReplyFn, ReplyOptions, StatusHandle } from '../types.js'
```

Then add a `createStatus` property to the `replyFn` object literal, immediately after the `buttons` method (after line 85, before the closing `}` of the object at line 86):

```typescript
    buttons: async (content: string, opts) => {
      const sent = await sendButtonReply(ctx, content, buildReplyParams, opts)
      return buildTelegramPromptHandle(api, sent.chat.id, sent.message_id)
    },
    createStatus: async (initialText: string): Promise<StatusHandle | undefined> => {
      const sent = await ctx.reply(initialText, { reply_parameters: buildReplyParams() }).catch((err: unknown) => {
        log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to create status message')
        return undefined
      })
      if (sent === undefined) return undefined
      const statusChatId = sent.chat.id
      const statusMessageId = sent.message_id
      return {
        update: async (text: string): Promise<void> => {
          await api.editMessageText(statusChatId, statusMessageId, text).catch(() => undefined)
        },
        dismiss: async (): Promise<void> => {
          await api.deleteMessage(statusChatId, statusMessageId).catch(() => undefined)
        },
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/telegram/reply-fn-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/telegram/reply-fn-builder.ts tests/chat/telegram/reply-fn-builder.test.ts
git commit -m "feat(chat/telegram): createStatus implementation"
```

---

## Task 5: Discord `createStatus`

**Files:**

- Modify: `src/chat/discord/reply-helpers.ts:181-215`
- Test: `tests/chat/discord/reply-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `tests/chat/discord/reply-helpers.test.ts` (end of file). Reuse the file's existing imports of `createDiscordReplyFn` and `mockLogger`; if `mockLogger` is not yet imported there, add `import { mockLogger } from '../../utils/test-helpers.js'`.

```typescript
describe('createDiscordReplyFn createStatus', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('creates, updates, and dismisses a status message', async () => {
    const edits: Array<{ content?: string }> = []
    let deleted = 0
    const sent = {
      id: 'msg-1',
      edit: (arg: { content?: string }) => {
        edits.push(arg)
        return Promise.resolve(undefined)
      },
      delete: () => {
        deleted += 1
        return Promise.resolve(undefined)
      },
    }
    const channel = {
      id: 'chan-1',
      send: () => Promise.resolve(sent),
      sendTyping: () => Promise.resolve(),
    }

    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    if (reply.createStatus === undefined) throw new Error('expected createStatus')

    const handle = await reply.createStatus('💭 Thinking…')
    if (handle === undefined) throw new Error('expected a status handle')
    await handle.update('📝 Creating task…')
    await handle.dismiss()

    expect(edits).toEqual([{ content: '📝 Creating task…' }])
    expect(deleted).toBe(1)
  })

  test('returns undefined when send fails', async () => {
    const channel = {
      id: 'chan-1',
      send: () => Promise.reject(new Error('send failed')),
      sendTyping: () => Promise.resolve(),
    }
    const reply = createDiscordReplyFn({ channel, replyToMessageId: undefined })
    if (reply.createStatus === undefined) throw new Error('expected createStatus')
    expect(await reply.createStatus('💭 Thinking…')).toBeUndefined()
  })
})
```

> The `channel` literal is structurally a `SendableChannel`; if TypeScript needs a nudge in this suite, follow the file's existing casting style for channel mocks.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/discord/reply-helpers.test.ts`
Expected: FAIL — `reply.createStatus` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/chat/discord/reply-helpers.ts`, add `StatusHandle` to the type import:

```typescript
import type { ButtonReplyOptions, EmbedOptions, PromptHandle, ReplyFn, ReplyOptions, StatusHandle } from '../types.js'
```

Then add `createStatus` to the `reply` object in `createDiscordReplyFn`, after the `embed` method (after line 207, before the object's closing brace at line 208):

```typescript
    embed: async (options: EmbedOptions): Promise<void> => {
      const embed = createEmbedPayload(options)
      const sent = await channel.send({ embeds: [embed] })
      sentMessages.push(sent)
    },
    createStatus: async (initialText: string): Promise<StatusHandle | undefined> => {
      const sent = await channel.send({ content: initialText }).catch(() => undefined)
      if (sent === undefined) return undefined
      return {
        update: async (text: string): Promise<void> => {
          await sent.edit({ content: text }).catch(() => undefined)
        },
        dismiss: async (): Promise<void> => {
          await sent.delete().catch(() => undefined)
        },
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/discord/reply-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/discord/reply-helpers.ts tests/chat/discord/reply-helpers.test.ts
git commit -m "feat(chat/discord): createStatus implementation"
```

---

## Task 6: Mattermost `createStatus`

**Files:**

- Modify: `src/chat/mattermost/reply-helpers.ts:139-185`
- Test: `tests/chat/mattermost/reply-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `tests/chat/mattermost/reply-helpers.test.ts` (end of file). It reuses the existing `makeReplyFn` helper defined in that file's top-level `describe`, so add it as a nested `describe` **inside** the existing `describe('createMattermostReplyFn', ...)` block (so `makeReplyFn` is in scope):

```typescript
describe('createStatus', () => {
  test('posts the status then updates and dismisses it', async () => {
    const { reply, apiCalls } = makeReplyFn()
    if (reply.createStatus === undefined) throw new Error('expected createStatus')

    const handle = await reply.createStatus('💭 Thinking…')
    if (handle === undefined) throw new Error('expected a status handle')
    await handle.update('📝 Creating task…')
    await handle.dismiss()

    const post = apiCalls.find((c) => c.method === 'POST' && c.path === '/api/v4/posts')
    expect(post).toBeDefined()
    expect((post?.body as { message: string }).message).toBe('💭 Thinking…')

    const patch = apiCalls.find((c) => c.method === 'PUT' && c.path === '/api/v4/posts/post-1/patch')
    expect(patch).toBeDefined()
    expect((patch?.body as { message: string }).message).toBe('📝 Creating task…')

    const del = apiCalls.find((c) => c.method === 'DELETE' && c.path === '/api/v4/posts/post-1')
    expect(del).toBeDefined()
  })
})
```

> The existing `makeReplyFn`'s `apiFetch` returns `{ id: 'post-1' }` for every call, so the created post id is `post-1`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/mattermost/reply-helpers.test.ts`
Expected: FAIL — `reply.createStatus` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/chat/mattermost/reply-helpers.ts`, add `StatusHandle` to the type import:

```typescript
import type {
  ButtonReplyOptions,
  DeferredDeliveryTarget,
  PromptHandle,
  ReplyFn,
  ReplyOptions,
  StatusHandle,
} from '../types.js'
```

Then add `createStatus` to the returned object of `createMattermostReplyFn`, after the `buttons` property (after line 183, before the object's closing brace at line 184):

```typescript
    buttons: createButtonsReply(
      post,
      platformInstanceId,
      channelId,
      callbackBaseUrl,
      createActionContext,
      threadId,
      apiFetch,
    ),
    createStatus: async (initialText: string): Promise<StatusHandle | undefined> => {
      const createdId = await post(initialText)
      if (createdId === undefined) return undefined
      return {
        update: async (text: string): Promise<void> => {
          await apiFetch('PUT', `/api/v4/posts/${createdId}/patch`, { message: text, props: {} }).catch(() => undefined)
        },
        dismiss: async (): Promise<void> => {
          await apiFetch('DELETE', `/api/v4/posts/${createdId}`, undefined).catch(() => undefined)
        },
      }
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/mattermost/reply-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/mattermost/reply-helpers.ts tests/chat/mattermost/reply-helpers.test.ts
git commit -m "feat(chat/mattermost): createStatus implementation"
```

---

## Task 7: Kontur Talk omits `createStatus` + heartbeat passthrough

**Files:**

- Test only: `tests/chat/kontur-talk/reply-helpers.test.ts`
- Test only: `tests/reply-typing-heartbeat.test.ts`

No source change for Kontur Talk — confirming the absence is the contract. The heartbeat test confirms `createStatus` is not wrapped by the stop-wrapper, so a status send never cancels typing.

- [ ] **Step 1: Add the Kontur Talk assertion**

Append to `tests/chat/kontur-talk/reply-helpers.test.ts` (inside its existing `describe('createKonturTalkReplyFn', ...)`, or as a new `describe` reusing the file's construction pattern):

```typescript
test('does not provide createStatus (no edit/delete API)', () => {
  const reply = createKonturTalkReplyFn({
    roomId: 'room-1',
    apiFetch: () => Promise.resolve({}),
  })
  expect(reply.createStatus).toBeUndefined()
})
```

> Match the file's existing import of `createKonturTalkReplyFn` and its `apiFetch` shape `(method, path, body) => Promise<unknown>`.

- [ ] **Step 2: Add the heartbeat passthrough assertion**

Append to `tests/reply-typing-heartbeat.test.ts`:

```typescript
test('createStatus is passed through un-wrapped (does not stop typing)', async () => {
  let typingCalls = 0
  let createStatusCalls = 0
  const reply = {
    text: () => Promise.resolve(),
    formatted: () => Promise.resolve(),
    typing: () => {
      typingCalls += 1
    },
    buttons: () => Promise.resolve(undefined),
    createStatus: () => {
      createStatusCalls += 1
      return Promise.resolve(undefined)
    },
  } as unknown as import('../src/chat/types.js').ReplyFn

  await withReplyTypingHeartbeat(reply, async (wrapped) => {
    // The wrapper must not replace createStatus, so the reference is preserved.
    expect(wrapped.createStatus).toBe(reply.createStatus)
    await wrapped.createStatus?.('💭 Thinking…')
  })

  // Typing fired at least once on entry; createStatus did not interfere.
  expect(typingCalls).toBeGreaterThanOrEqual(1)
  expect(createStatusCalls).toBe(1)
})
```

> `withReplyTypingHeartbeat` is already imported by this suite. The key assertion is `wrapped.createStatus === reply.createStatus` — proving the stop-wrapper spreads it through unchanged (it is not in the hooked-method list), so calling it never triggers the typing `stop()`.

- [ ] **Step 3: Run both tests**

Run: `bun test tests/chat/kontur-talk/reply-helpers.test.ts tests/reply-typing-heartbeat.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/chat/kontur-talk/reply-helpers.test.ts tests/reply-typing-heartbeat.test.ts
git commit -m "test(live-status): kontur omits createStatus; heartbeat passthrough"
```

---

## Task 8: Wire the reporter into the tool-call hooks

**Files:**

- Modify: `src/llm-orchestrator-types.ts:55-85`
- Modify: `src/llm-orchestrator-invoke.ts:102-115, 159-177, 249-257`
- Test: `tests/llm-orchestrator-invoke.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/llm-orchestrator-invoke.test.ts`, add a `liveStatus` spy helper and two assertions. First, add this helper near `createReporterSpy` (after line 44):

```typescript
function createLiveStatusSpy(): {
  liveStatus: import('../src/live-status/reporter.js').LiveStatusReporter
  starts: Array<{ toolName: string; input: unknown }>
  finishes: number
} {
  const starts: Array<{ toolName: string; input: unknown }> = []
  let finishes = 0
  return {
    starts,
    get finishes() {
      return finishes
    },
    liveStatus: {
      start: () => Promise.resolve(),
      onToolStart: (event) => {
        starts.push(event)
      },
      onToolFinish: () => {
        finishes += 1
      },
      dismiss: () => Promise.resolve(),
    },
  } as never
}
```

Then add a new `describe` block (end of file):

```typescript
describe('live status wiring', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('handleToolCallStart forwards to liveStatus.onToolStart', () => {
    const spy = createLiveStatusSpy()
    const ctx: ToolCallContext = { ...baseContext(), liveStatus: spy.liveStatus }
    handleToolCallStart(ctx, {
      toolCall: { toolName: 'create_task', toolCallId: 'c1', input: { title: 'X' } },
    })
    expect(spy.starts).toEqual([{ toolName: 'create_task', input: { title: 'X' } }])
  })

  test('handleToolCallFinishEvent forwards to liveStatus.onToolFinish', () => {
    const spy = createLiveStatusSpy()
    const ctx: ToolCallContext = { ...baseContext(), liveStatus: spy.liveStatus }
    handleToolCallFinishEvent(ctx, {
      toolCall: { toolName: 'create_task', toolCallId: 'c1', input: { title: 'X' } },
      durationMs: 1,
      success: true,
      output: {},
    })
    expect(spy.finishes).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator-invoke.test.ts`
Expected: FAIL — `ToolCallContext` has no `liveStatus` (type error) and/or the spy is never called.

- [ ] **Step 3: Add `liveStatus` to the types**

In `src/llm-orchestrator-types.ts`, add the import near the other type imports (after line 13):

```typescript
import type { LiveStatusReporter } from './live-status/reporter.js'
```

Extend `InvokeModelArgs` (line 66-67) — add the `liveStatus` member to its intersection:

```typescript
} & Partial<Record<'progressReporter', AiProgressReporter>> &
  Partial<Record<'disclosure', DisclosureSession>> &
  Partial<Record<'liveStatus', LiveStatusReporter>>
```

Extend `ToolCallContext` (line 85):

```typescript
} & Partial<Record<'progressReporter', AiProgressReporter>> &
  Partial<Record<'liveStatus', LiveStatusReporter>>
```

- [ ] **Step 4: Set `ctx.liveStatus` and drive it from the hooks**

In `src/llm-orchestrator-invoke.ts`:

(a) In `invokeModel`, where `ctx` is built (line 249-257), add `liveStatus`:

```typescript
const ctx: ToolCallContext = {
  contextId,
  chatUserId,
  contextType,
  model: mainModel,
  modelRole: 'main',
  turnId,
  progressReporter: args.progressReporter,
  liveStatus: args.liveStatus,
}
```

(b) In `handleToolCallStart` (line 102-115), after `reportToolStarted(ctx, event)`:

```typescript
export const handleToolCallStart = (ctx: ToolCallContext, event: ToolCallStartEvent): void => {
  emitUser(
    'tool:request',
    ctx.contextId,
    {
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      argsBytes: safeByteLength(event.toolCall.input),
      ...contextEnvelope(ctx),
    },
    ctx.turnId,
  )
  reportToolStarted(ctx, event)
  ctx.liveStatus?.onToolStart({ toolName: event.toolCall.toolName, input: event.toolCall.input })
}
```

(c) In `handleToolCallFinishEvent` (line 159-177), after `reportToolFinished(ctx, event)`:

```typescript
emitFailureClassified(ctx, event)
reportToolFinished(ctx, event)
ctx.liveStatus?.onToolFinish()
handleToolCallFinish(ctx.contextId, undefined, event)
```

> `onToolStart`/`onToolFinish` are best-effort by construction (they fire-and-forget a `.catch`-guarded `update`), so no extra try/catch is needed here.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/llm-orchestrator-invoke.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/llm-orchestrator-types.ts src/llm-orchestrator-invoke.ts tests/llm-orchestrator-invoke.test.ts
git commit -m "feat(live-status): drive reporter from tool-call hooks"
```

---

## Task 9: Create and dismiss the reporter in `callLlm`

**Files:**

- Modify: `src/llm-orchestrator.ts:139-181`
- Test: `tests/llm-orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/llm-orchestrator.test.ts` (place it after the existing `seedSystemLlmConfig`/`seedConfig` helpers, e.g. near other `processMessage` tests). It seeds config explicitly so it does not depend on a shared `beforeEach`:

```typescript
test('callLlm creates a live status, updates it on a tool call, and dismisses it', async () => {
  await setupTestDb()
  seedCommonTestPlatformInstances()
  resetSystemConfigCacheForTesting()
  seedSystemLlmConfig()
  seedConfig()

  const created: string[] = []
  const updates: string[] = []
  let dismissed = 0
  const { reply: base } = createMockReply()
  const reply: ReplyFn = {
    ...base,
    createStatus: (initialText: string) => {
      created.push(initialText)
      return Promise.resolve({
        update: (text: string) => {
          updates.push(text)
          return Promise.resolve()
        },
        dismiss: () => {
          dismissed += 1
          return Promise.resolve()
        },
      })
    },
  }

  const generateText = ((opts: Parameters<LlmOrchestratorDeps['generateText']>[0]) => {
    const event = { toolCall: { toolName: 'create_task', toolCallId: 'c1', input: { title: 'X' } } }
    opts.experimental_onToolCallStart?.(event)
    opts.experimental_onToolCallFinish?.({ ...event, durationMs: 1, success: true, output: {} })
    return defaultGenerateTextResult()
  }) as LlmOrchestratorDeps['generateText']

  const deps: LlmOrchestratorDeps = {
    ...defaultDeps,
    buildOpenAI: buildMockOpenAI,
    resolve: () => createMockProvider(),
    generateText,
  }

  await processMessage(reply, CTX_ID, 'user-1', null, 'do it', 'dm', undefined, deps)

  expect(created).toEqual(['💭 Thinking…'])
  expect(updates).toContain('📝 Creating task: "X"…')
  expect(dismissed).toBeGreaterThanOrEqual(1)
})
```

> `createMockProvider`, `createMockReply`, `setupTestDb`, `seedCommonTestPlatformInstances`, `resetSystemConfigCacheForTesting`, `buildMockOpenAI`, `defaultGenerateTextResult`, `seedSystemLlmConfig`, `seedConfig`, and `CTX_ID` are all already defined/imported in this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator.test.ts -t 'callLlm creates a live status'`
Expected: FAIL — `createStatus` is never called (`created` is empty), because `callLlm` does not yet build the reporter.

- [ ] **Step 3: Write the implementation**

In `src/llm-orchestrator.ts`, add the import (with the other local imports, e.g. after the `invokeModelWithTyping` import on line 20):

```typescript
import { createLiveStatusReporter } from './live-status/reporter.js'
```

Replace the body of `callLlm` from the `progressReporter` line through `return result` (lines 159-180) with the reporter-wrapped version:

```typescript
const progressReporter = createProgressReporterForContext(reply, contextId)
const liveStatus = createLiveStatusReporter(reply)
await liveStatus.start()
try {
  const result = await invokeModelWithTyping(reply, {
    contextId,
    chatUserId,
    contextType,
    mainModel,
    model,
    provider,
    tools,
    enabledToolNames,
    messages: validatedMessages,
    deps,
    progressReporter,
    disclosure,
    turnId,
    liveStatus,
  })
  const toolCallCount = result.toolCalls === undefined ? undefined : result.toolCalls.length
  log.debug({ contextId, toolCalls: toolCallCount, usage: result.usage }, 'LLM response received')
  progressReporter.reasoning(result.reasoningText, result.reasoning)
  persistFactsFromResults(contextId, result)
  await liveStatus.dismiss()
  await sendLlmResponse(reply, contextId, result, progressReporter)
  return result
} finally {
  await liveStatus.dismiss()
}
```

> `liveStatus.dismiss()` is idempotent, so the explicit pre-`sendLlmResponse` call removes the status the moment before the real answer posts, and the `finally` is the safety net on error/abort paths.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/llm-orchestrator.test.ts -t 'callLlm creates a live status'`
Expected: PASS.

- [ ] **Step 5: Run the full orchestrator suite to check for regressions**

Run: `bun test tests/llm-orchestrator.test.ts tests/llm-orchestrator-invoke.test.ts`
Expected: PASS (existing tests unaffected — the new arg is optional and dismiss is best-effort).

- [ ] **Step 6: Commit**

```bash
git add src/llm-orchestrator.ts tests/llm-orchestrator.test.ts
git commit -m "feat(live-status): create and dismiss reporter in callLlm"
```

---

## Task 10: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck and lint**

Run: `bun typecheck && bun lint`
Expected: PASS.

- [ ] **Step 2: Run the affected test areas**

Run: `bun test tests/live-status tests/chat tests/llm-orchestrator.test.ts tests/llm-orchestrator-invoke.test.ts tests/reply-typing-heartbeat.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full server-side suite**

Run: `bun run test`
Expected: PASS. (On a clean checkout, run `bun build:client` once first per the repo's debug-server suites.)

- [ ] **Step 4: Final commit if anything was adjusted**

```bash
git add -A
git commit -m "test(live-status): full-suite verification adjustments"
```

(Skip if there is nothing to commit.)

---

## Self-Review Notes

- **Spec coverage:** lifecycle (update-in-place + delete) → Tasks 1/3/9; label+allowlisted arg + fallback → Task 2; always-on (no setting) → Task 9 (no config gate added); Thinking-between-tools → Task 3 (`THINKING` placeholder + render); per-provider impl → Tasks 4-7 (Kontur omitted); heartbeat coexistence → Tasks 7/9 (unwrapped reply + passthrough test); parallel-tool `(+n)` → Task 3.
- **Anti-flicker:** deviates from the spec's "~600ms" wording — replaced with deterministic dedup-by-equality (documented in the header note) to keep tests timing-free.
- **Type consistency:** `StatusHandle` = `{ update, dismiss }` everywhere; `LiveStatusReporter` = `{ start, onToolStart, onToolFinish, dismiss }`; `onToolStart` event = `{ toolName, input }` (matches the call sites in Task 8); `createStatus(initialText) → Promise<StatusHandle | undefined>` on every provider.
- **No placeholders:** every step ships complete code or an exact command.
