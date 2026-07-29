<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Message edit handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Handle incoming user-message edits across Telegram, Discord, and Mattermost with a window-dependent policy (steer during a run, regenerate/ask after reply, silent history-only for old edits), reusing existing steer, `message_metadata`, and side-effect-reporting machinery.

**Architecture:** A distinct `ChatProvider.onMessageEdit?` handler delivers edits (structurally bypassing the coalescing queue). A pure `classifyEdit` routes each edit to W1/W2/W3 based on run state + message identity + a `message_metadata` "later user message" check. Originating `messageId`s are preserved through coalescing and stored on the user turn (`providerOptions.papai`) so an edit can find and mutate `conversation_history`. A new `LastTurnRegistry` captures the just-finished turn's effects + reply target for W2.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Vercel AI SDK v7 (`ModelMessage`), `bun:test`. DI-first tests; `bun run test` / `bun test <path> -t <name>`.

## Global Constraints

- Runtime **Bun**; validation **Zod v4**; LLM via **Vercel AI SDK v7**; chat via Grammy / discord.js / Mattermost WS / Kontur Talk poll.
- **Use `.js` extension in import paths.** Strict TypeScript.
- **Never add `lint-disable` / `type-ignore` comments** — hook policy blocks them.
- `max-lines` / `max-lines-per-function` failures are a design signal — split files rather than compress.
- Logging: structured pino (`debug`/`info`/`warn`/`error`), never log tokens/keys/cookies.
- Capability-driven behavior only — **no `chat.name` checks** (`src/chat/CLAUDE.md`).
- Commits run the TDD write-hook pipeline automatically (lint + typecheck + format:check + license-headers); tests are run manually in each task.
- Test preload `tests/mock-reset.ts` resets mocks per test; do not add per-file `afterAll(() => mock.restore())`.
- Kontur Talk is **out of scope** for inbound edits in v1 (capability absent, no subscription).

---

## File Structure

New files (feature-local under `src/message-edit/` and `src/run-control/`):

- `src/message-edit/classify.ts` — pure `classifyEdit(...)`.
- `src/message-edit/handle.ts` — `onIncomingEdit` dispatch (guards, baseline history mutation, W1/W2/W3 routing).
- `src/message-edit/segments.ts` — pure `formatMessageSegment` (factored from the queue) + `rebuildCoalescedText`.
- `src/run-control/last-turn-registry.ts` — in-memory `LastTurnRegistry` + `LastTurn` type.

Modified files:

- `src/chat/types.ts` — add `'messages.edit.inbound'` capability; `IncomingMessage.editedAt?`; `ChatProvider.onMessageEdit?`; `ReplyFn.editReply?`.
- `src/chat/{telegram,discord,mattermost,kontur-talk}/metadata.ts` — capability sets.
- `src/message-queue/types.ts`, `src/message-queue/queue.ts`, `src/bot.ts` — preserve `messageId(s)` through coalescing into `processMessage`.
- `src/llm-orchestrator-process-args.ts`, `src/llm-orchestrator.ts`, `src/llm-orchestrator-history.ts`, `src/llm-orchestrator-attachments.ts` — thread originating `messageIds` into `RunControl` + attach `providerOptions.papai` on the user turn.
- `src/run-control/types.ts`, `src/run-control/registry.ts` — `RunControl.originatingMessageIds`; capture `LastTurn` on `end()`.
- `src/history.ts` — `applyEditToHistory`.
- `src/chat/router.ts`, `src/chat/router-helpers.ts` — `onMessageEdit` fan-out.
- `src/chat/interaction-router.ts` — `edit:` prefix branch.
- `src/chat/{telegram,discord,mattermost}/{index.ts,reply-helpers.ts,reply-fn-builder.ts}` — edit-event subscription + reply-target capture + `editReply`.
- `src/bot.ts` — `setupBot` wires `onMessageEdit`; `onIncomingEdit` import.

---

## Task 1: Add capability + `IncomingMessage.editedAt`

**Files:**
- Modify: `src/chat/types.ts:47-57` (capability union), `src/chat/types.ts:128-157` (`IncomingMessage`), `src/chat/types.ts:212-235` (`ReplyFn`), `src/chat/types.ts:244-277` (`ChatProvider`)
- Modify: `src/chat/telegram/metadata.ts:8-17`, `src/chat/discord/metadata.ts:8-15`, `src/chat/mattermost/metadata.ts:8-17` (capability sets)
- Test: `tests/chat/types.test.ts` (or adjacent) — `tests/message-edit/capability.test.ts`

**Interfaces:**
- Produces: `ChatCapability` now includes `'messages.edit.inbound'`; `IncomingMessage` has `editedAt?: number`; `ChatProvider` has optional `onMessageEdit?: (handler) => void`; `ReplyFn` has optional `editReply?: (target, markdown) => Promise<void>`.

- [ ] **Step 1: Write failing test**

Create `tests/message-edit/capability.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { telegramCapabilities } from '../../src/chat/telegram/metadata.js'
import { discordCapabilities } from '../../src/chat/discord/metadata.js'
import { mattermostCapabilities } from '../../src/chat/mattermost/metadata.js'
import { konturTalkCapabilities } from '../../src/chat/kontur-talk/metadata.js'

describe('messages.edit.inbound capability', () => {
  it('present on telegram, discord, mattermost', () => {
    expect(telegramCapabilities.has('messages.edit.inbound')).toBe(true)
    expect(discordCapabilities.has('messages.edit.inbound')).toBe(true)
    expect(mattermostCapabilities.has('messages.edit.inbound')).toBe(true)
  })
  it('absent on kontur-talk', () => {
    expect(konturTalkCapabilities.has('messages.edit.inbound')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-edit/capability.test.ts`
Expected: FAIL — `messages.edit.inbound` not in the sets.

- [ ] **Step 3: Implement**

In `src/chat/types.ts`, add to the `ChatCapability` union (after `'messages.reply-context'`):

```typescript
  | 'messages.edit.inbound'
```

Add `editedAt` to the `Partial<{...}>` block of `IncomingMessage` (the block starting `contextName` … `isReplyToBot`):

```typescript
  editedAt: number
```

Add to the optional `Partial<{...}>` block of `ReplyFn` (after `createStatus`):

```typescript
  editReply: (target: ReplyTarget, markdown: string) => Promise<void>
```

Add to `ChatProvider`'s optional `Partial<{...}>` block (after `onInteraction`):

```typescript
  onMessageEdit: (handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>) => void
```

Also add the `ReplyTarget` type near the other shared types in `src/chat/types.ts` (before `ReplyFn`):

```typescript
/** Opaque platform handle to a sent message the bot can later edit. */
export type ReplyTarget = { readonly platform: 'telegram' | 'discord' | 'mattermost'; readonly ref: unknown }
```

Add `'messages.edit.inbound'` to the capability arrays in:
- `src/chat/telegram/metadata.ts` (inside the `new Set<ChatCapability>([...])`)
- `src/chat/discord/metadata.ts`
- `src/chat/mattermost/metadata.ts`

Leave `src/chat/kontur-talk/metadata.ts` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-edit/capability.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/chat/types.ts src/chat/telegram/metadata.ts src/chat/discord/metadata.ts src/chat/mattermost/metadata.ts tests/message-edit/capability.test.ts
git commit -m "feat(chat): add messages.edit.inbound capability + IncomingMessage.editedAt"
```

---

## Task 2: Preserve `messageId(s)` through the coalescing queue

**Files:**
- Modify: `src/message-queue/types.ts:18-42`
- Modify: `src/message-queue/queue.ts:154-214` (`collectMessageContent`, `flush`)
- Modify: `src/bot.ts:193-208` (enqueue payload), `src/bot.ts:128-157` (`processCoalescedMessage`)
- Test: `tests/message-queue/queue.test.ts`

**Interfaces:**
- Produces: `QueueItem.messageId?: string`; `CoalescedItem.messageIds: readonly string[]`. The `processCoalescedMessage`/`processMessage` call chain receives them (consumed by Task 3).

- [ ] **Step 1: Write failing test**

Add to `tests/message-queue/queue.test.ts`:

```typescript
it('preserves originating messageIds through coalescing', async () => {
  const queue = new MessageQueue('ctx-1', mockLogger(), 0)
  const received: string[][] = []
  queue.setHandler(async (item) => { received.push([...item.messageIds]) })
  queue.enqueue({ text: 'a', userId: 'u', username: null, storageContextId: 'ctx-1', contextType: 'dm', configContextId: undefined, newAttachmentIds: [], voiceStagedIds: [], messageId: 'm1' }, createMockReply())
  queue.enqueue({ text: 'b', userId: 'u', username: null, storageContextId: 'ctx-1', contextType: 'dm', configContextId: undefined, newAttachmentIds: [], voiceStagedIds: [], messageId: 'm2' }, createMockReply())
  await queue.flushNow() // or the test's existing flush helper
  expect(received[0]).toEqual(['m1', 'm2'])
})
```

Use the existing `createMockReply()` and the flush helper already used in this file (match the file's current pattern; if the file exposes a synchronous flush test path, use it).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-queue/queue.test.ts -t "originating messageIds"`
Expected: FAIL — `messageIds` not on `CoalescedItem` / `messageId` not on `QueueItem`.

- [ ] **Step 3: Implement**

In `src/message-queue/types.ts`, add to `QueueItem`:

```typescript
  messageId?: string
```

Add to `CoalescedItem`:

```typescript
  messageIds: readonly string[]
```

In `src/message-queue/queue.ts` `collectMessageContent` (line 154), also collect ids:

```typescript
  private collectMessageContent(isThread: boolean): {
    texts: string[]
    attachmentIds: string[]
    voiceStagedIds: string[]
    messageIds: string[]
  } {
    const texts: string[] = []
    const attachmentIds: string[] = []
    const voiceStagedIds: string[] = []
    const messageIds: string[] = []
    for (const msg of this.messages) {
      if (isThread && msg.item.username !== null) {
        texts.push(`[@${msg.item.username}]: ${msg.item.text}`)
      } else {
        texts.push(msg.item.text)
      }
      attachmentIds.push(...msg.item.newAttachmentIds)
      voiceStagedIds.push(...msg.item.voiceStagedIds)
      if (msg.item.messageId !== undefined) messageIds.push(msg.item.messageId)
    }
    return { texts, attachmentIds, voiceStagedIds, messageIds }
  }
```

In `flush()` (line 174), destructure `messageIds` from `collectMessageContent` and add to `result`:

```typescript
    const { texts, attachmentIds, voiceStagedIds, messageIds } = this.collectMessageContent(isThread)
    const text = isDm ? texts.join('\n\n') : texts.join('\n')

    const turnId = randomUUID()

    const result: CoalescedItem = {
      text,
      // ...existing fields...
      messageIds,
    }
```

In `src/bot.ts` `handleMessage` enqueue payload (line 194-205), add `messageId: msg.messageId`:

```typescript
    queueMessage(
      {
        text: steerText,
        userId: msg.user.id,
        username: msg.user.username,
        storageContextId: auth.storageContextId,
        configContextId: auth.configContextId,
        contextType: msg.contextType,
        newAttachmentIds,
        voiceStagedIds,
        actorRole: auth.isGuest === true ? 'guest' : 'member',
        messageId: msg.messageId,
      },
      reply,
      (coalescedItem): Promise<void> => processCoalescedMessage(coalescedItem, deps),
    )
```

In `processCoalescedMessage` (line 128-157), pass `coalescedItem.messageIds` into `deps.processMessage` as a new trailing-ish argument — see Task 3 for the `processMessage` signature change. For this task, only ensure the `CoalescedItem` carries `messageIds` (the `processMessage` plumbing is Task 3). Leave the `processMessage` call unchanged here; Task 3 edits it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-queue/queue.test.ts -t "originating messageIds"`
Expected: PASS.

- [ ] **Step 5: Run typecheck + message-queue suite**

Run: `bun run typecheck && bun test tests/message-queue/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/message-queue/types.ts src/message-queue/queue.ts src/bot.ts tests/message-queue/queue.test.ts
git commit -m "feat(queue): preserve originating messageIds through coalescing"
```

---

## Task 3: `RunControl.originatingMessageIds` + thread through `processMessage`

**Files:**
- Modify: `src/run-control/types.ts:15-23`, `src/run-control/registry.ts:15-28`
- Modify: `src/llm-orchestrator-process-args.ts` (`ProcessMessageFn`/args), `src/llm-orchestrator.ts:247-293` (`processMessage`), `src/llm-orchestrator.ts:210-245` (`runTurn`, `begin()` call), `src/bot.ts:128-157` (`processCoalescedMessage`)
- Test: `tests/run-control/process-message-lifecycle.test.ts`

**Interfaces:**
- Produces: `RunControl.originatingMessageIds: readonly string[]`; `RunRegistry.begin(contextId, { turnId, reply, originatingMessageIds })`.

- [ ] **Step 1: Write failing test**

Add to `tests/run-control/registry.test.ts`:

```typescript
it('records originatingMessageIds on the run', () => {
  const r = new RunRegistry()
  const run = r.begin('ctx', { turnId: 't1', reply: createMockReply(), originatingMessageIds: ['m1', 'm2'] })
  expect(run.originatingMessageIds).toEqual(['m1', 'm2'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run-control/registry.test.ts -t "originatingMessageIds"`
Expected: FAIL — `originatingMessageIds` not accepted by `begin`.

- [ ] **Step 3: Implement**

In `src/run-control/types.ts`, add to `RunControl`:

```typescript
  readonly originatingMessageIds: readonly string[]
```

In `src/run-control/registry.ts` `begin()`:

```typescript
  begin(contextId: string, opts: { turnId: string; reply: ReplyFn; originatingMessageIds: readonly string[] }): RunControl {
    const run: RunControl = {
      contextId,
      turnId: opts.turnId,
      reply: opts.reply,
      abortController: new AbortController(),
      steerQueue: [],
      stopRequested: false,
      completedEffects: [],
      originatingMessageIds: opts.originatingMessageIds,
    }
    this.runs.set(contextId, run)
    log.debug({ contextId, turnId: opts.turnId }, 'Run started')
    return run
  }
```

Thread the ids through the orchestrator. In `src/llm-orchestrator-process-args.ts`, add `originatingMessageIds` to the `ProcessMessageFn` args type (the file's existing param list — add `originatingMessageIds: readonly string[]` before `turnId` or at the documented position; match the existing tuple ordering and the `processMessage` destructure).

In `src/llm-orchestrator.ts` `processMessage` (line 247), accept `originatingMessageIds` and pass it into `runTurn` → `runRegistry.begin`. Concretely: add `originatingMessageIds` to the destructured `rest` (or the explicit params, matching the file's style) and into the `runTurn({ ... })` call object; in `runTurn`, pass it to `runRegistry.begin(contextId, { turnId: resolvedTurnId, reply, originatingMessageIds })`.

In `src/bot.ts` `processCoalescedMessage` (line 137), add `coalescedItem.messageIds` to the `deps.processMessage(...)` call at the correct argument position established above.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/run-control/registry.test.ts -t "originatingMessageIds"`
Expected: PASS.

- [ ] **Step 5: Run orchestrator + run-control suites**

Run: `bun run typecheck && bun test tests/run-control/`
Expected: PASS (update any existing `begin()` call sites that now require `originatingMessageIds` — e.g. tests that construct runs directly — by passing `originatingMessageIds: []`).

- [ ] **Step 6: Commit**

```bash
git add src/run-control/types.ts src/run-control/registry.ts src/llm-orchestrator-process-args.ts src/llm-orchestrator.ts src/bot.ts tests/run-control/registry.test.ts
git commit -m "feat(run-control): record originatingMessageIds on RunControl"
```

---

## Task 4: Store `messageIds`+segments on the user turn + `applyEditToHistory`

**Files:**
- Create: `src/message-edit/segments.ts`
- Modify: `src/message-queue/queue.ts:154-172` (reuse `formatMessageSegment`), `src/message-queue/types.ts` (add `segments` to `CoalescedItem`)
- Modify: `src/llm-orchestrator-history.ts`, `src/llm-orchestrator-attachments.ts:89-113` (attach `providerOptions.papai`)
- Modify: `src/history.ts` (add `applyEditToHistory`)
- Test: `tests/message-edit/segments.test.ts`, `tests/history-edit.test.ts`

**Interfaces:**
- Produces: `formatMessageSegment(text, username, isThread): string`; `rebuildCoalescedText(segments, { isThread, isDm }): string`; `applyEditToHistory(contextId, messageId, newText): boolean`.
- The user `ModelMessage` now carries `providerOptions: { papai: { messageIds: string[]; segments: { messageId: string; text: string; username: string | null }[]; isThread: boolean; isDm: boolean } }`.

- [ ] **Step 1: Write failing test for `formatMessageSegment` + `rebuildCoalescedText`**

`tests/message-edit/segments.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { formatMessageSegment, rebuildCoalescedText } from '../../src/message-edit/segments.js'

describe('formatMessageSegment', () => {
  it('prefixes group thread with @username', () => {
    expect(formatMessageSegment('hi', 'alice', true)).toBe('[@alice]: hi')
  })
  it('no prefix when username null', () => {
    expect(formatMessageSegment('hi', null, true)).toBe('hi')
  })
  it('no prefix in DM', () => {
    expect(formatMessageSegment('hi', 'alice', false)).toBe('hi')
  })
})

describe('rebuildCoalescedText', () => {
  const segments = [
    { messageId: 'm1', text: 'hi', username: 'alice' as const },
    { messageId: 'm2', text: 'there', username: 'alice' as const },
  ]
  it('joins DM with double newline', () => {
    expect(rebuildCoalescedText(segments, { isThread: false, isDm: true })).toBe('hi\n\nthere')
  })
  it('joins group thread with single newline + prefix', () => {
    expect(rebuildCoalescedText(segments, { isThread: true, isDm: false })).toBe('[@alice]: hi\n[@alice]: there')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-edit/segments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `segments.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

export type MessageSegment = { messageId: string; text: string; username: string | null }

export function formatMessageSegment(text: string, username: string | null, isThread: boolean): string {
  if (isThread && username !== null) return `[@${username}]: ${text}`
  return text
}

export function rebuildCoalescedText(segments: readonly MessageSegment[], opts: { isThread: boolean; isDm: boolean }): string {
  const formatted = segments.map((s) => formatMessageSegment(s.text, s.username, opts.isThread))
  return opts.isDm ? formatted.join('\n\n') : formatted.join('\n')
}
```

Refactor `src/message-queue/queue.ts` `collectMessageContent` to use `formatMessageSegment`:

```typescript
import { formatMessageSegment } from '../message-edit/segments.js'
// ...
      texts.push(formatMessageSegment(msg.item.text, msg.item.username, isThread))
```

Add `segments` to `CoalescedItem` in `src/message-queue/types.ts`:

```typescript
  segments: readonly { messageId: string; text: string; username: string | null }[]
```

In `flush()`, build segments from `this.messages`:

```typescript
    const segments = this.messages.map((m) => ({
      messageId: m.item.messageId ?? '',
      text: m.item.text,
      username: m.item.username,
    }))
```

and add `segments` to the `result` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-edit/segments.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing test for `applyEditToHistory`**

`tests/history-edit.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { appendHistory, applyEditToHistory, loadHistory } from '../src/history.js'
import { setupTestDb } from './utils/db-helpers.js' // use the repo's existing db helper name
import type { ModelMessage } from 'ai'

describe('applyEditToHistory', () => {
  beforeEach(() => setupTestDb())

  it('replaces the edited message text by messageId', () => {
    const userMsg: ModelMessage = {
      role: 'user',
      content: 'hello',
      providerOptions: { papai: { messageIds: ['m1'], segments: [{ messageId: 'm1', text: 'hello', username: null }], isThread: false, isDm: true } },
    } as ModelMessage
    appendHistory('ctx', [userMsg])
    const changed = applyEditToHistory('ctx', 'm1', 'hello (edited)')
    expect(changed).toBe(true)
    const history = loadHistory('ctx')
    const edited = history.find((m) => m.role === 'user')!
    expect((edited as { content: string }).content).toBe('hello (edited)')
  })

  it('no-op when messageId absent', () => {
    appendHistory('ctx', [{ role: 'user', content: 'hello' } as ModelMessage])
    expect(applyEditToHistory('ctx', 'missing', 'x')).toBe(false)
  })
})
```

(Adjust the db-helper import to the actual helper used in sibling tests, e.g. `tests/utils/test-helpers.ts` exposes `setupTestDb`.)

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/history-edit.test.ts`
Expected: FAIL — `applyEditToHistory` not exported.

- [ ] **Step 7: Implement `applyEditToHistory` in `src/history.ts`**

```typescript
import { rebuildCoalescedText, type MessageSegment } from './message-edit/segments.js'

type PapaiTurnMeta = {
  messageIds: string[]
  segments: MessageSegment[]
  isThread: boolean
  isDm: boolean
}

function papaiMeta(msg: ModelMessage): PapaiTurnMeta | undefined {
  const opts = (msg as { providerOptions?: { papai?: PapaiTurnMeta } }).providerOptions?.papai
  return opts
}

/** Mutate the stored user turn whose `messageIds` contains `messageId` to `newText`. Returns false if not found. */
export function applyEditToHistory(contextId: string, messageId: string, newText: string): boolean {
  const history = [...loadHistory(contextId)]
  let mutated = false
  const next = history.map((msg) => {
    if (mutated) return msg
    if (msg.role !== 'user') return msg
    const meta = papaiMeta(msg)
    if (meta === undefined || !meta.messageIds.includes(messageId)) return msg
    const segments = meta.segments.map((s) => (s.messageId === messageId ? { ...s, text: newText } : s))
    const content = rebuildCoalescedText(segments, { isThread: meta.isThread, isDm: meta.isDm })
    mutated = true
    return { ...msg, content, providerOptions: { ...(msg as ModelMessage).providerOptions, papai: { ...meta, segments } } }
  })
  if (!mutated) return false
  saveHistory(contextId, next)
  return true
}
```

(`loadHistory`/`saveHistory` already exist in `history.ts`; `saveHistory` writes the in-memory cache + DB.)

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/history-edit.test.ts`
Expected: PASS.

- [ ] **Step 9: Attach `providerOptions.papai` when building the user turn**

In `src/llm-orchestrator-attachments.ts`, the `historyMessage` is built (lines 103, 111, 131, 147) as `{ role: 'user', content } as ModelMessage`. The turn-builder functions (signatures at lines 89, 122) need the originating segments + isThread/isDm. Thread these from `buildHistory` (`src/llm-orchestrator-history.ts:17`), which receives them from `processMessage` (Task 3 carries `originatingMessageIds`; also pass `segments`, `isThread`, `isDm` — derive `isThread`/`isDm` from `contextType` + whether `contextId.includes(':')`, matching the queue's logic).

Concretely, in `buildHistory` compute:

```typescript
  const isDm = contextType === 'dm'
  const isThread = contextType === 'group' && contextId.includes(':')
```

and pass `segments`/`isThread`/`isDm` into `buildUserTurnMessages`, which adds to each `historyMessage`:

```typescript
  providerOptions: { papai: { messageIds: segments.map((s) => s.messageId), segments, isThread, isDm } }
```

If `segments` is empty (legacy/no messageId), omit `providerOptions.papai`.

Because `processMessage` doesn't currently carry `segments`, add it: thread `coalescedItem.segments` from `processCoalescedMessage` → `processMessage` → `buildHistory` (a new param, defaulting to `[]`).

- [ ] **Step 10: Run typecheck + history tests**

Run: `bun run typecheck && bun test tests/history-edit.test.ts tests/message-edit/segments.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/message-edit/segments.ts src/message-queue/queue.ts src/message-queue/types.ts src/llm-orchestrator-attachments.ts src/llm-orchestrator-history.ts src/llm-orchestrator.ts src/bot.ts src/history.ts tests/message-edit/segments.test.ts tests/history-edit.test.ts
git commit -m "feat(history): store turn segments for edit + applyEditToHistory"
```

---

## Task 5: `LastTurnRegistry`

**Files:**
- Create: `src/run-control/last-turn-registry.ts`
- Modify: `src/run-control/types.ts` (export `ReplyTarget` re-use from chat types), `src/llm-orchestrator.ts:210-245` (`runTurn` captures on end + evicts on begin)
- Test: `tests/run-control/last-turn-registry.test.ts`

**Interfaces:**
- Produces: `LastTurnRegistry` singleton `lastTurnRegistry` with `record(contextId, last)`, `get(contextId)`, `evict(contextId)`; `LastTurn = { originatingMessageIds, completedEffects, replyTarget, finishedAt }`.

- [ ] **Step 1: Write failing test**

`tests/run-control/last-turn-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'

describe('LastTurnRegistry', () => {
  beforeEach(() => lastTurnRegistry.clear())

  it('records and retrieves by contextId', () => {
    lastTurnRegistry.record('ctx', { originatingMessageIds: ['m1'], completedEffects: [], replyTarget: undefined, finishedAt: 1 })
    expect(lastTurnRegistry.get('ctx')?.originatingMessageIds).toEqual(['m1'])
  })
  it('evicts', () => {
    lastTurnRegistry.record('ctx', { originatingMessageIds: ['m1'], completedEffects: [], replyTarget: undefined, finishedAt: 1 })
    lastTurnRegistry.evict('ctx')
    expect(lastTurnRegistry.get('ctx')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/run-control/last-turn-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/run-control/last-turn-registry.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import type { EffectRecord } from './types.js'
import type { ReplyTarget } from '../chat/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'run-control:last-turn' })

export type LastTurn = {
  originatingMessageIds: readonly string[]
  completedEffects: ReadonlyArray<EffectRecord>
  replyTarget: ReplyTarget | undefined
  finishedAt: number
}

class LastTurnRegistry {
  private turns = new Map<string, LastTurn>()

  record(contextId: string, turn: LastTurn): void {
    this.turns.set(contextId, turn)
    log.debug({ contextId }, 'Last turn recorded')
  }
  get(contextId: string): LastTurn | undefined {
    return this.turns.get(contextId)
  }
  evict(contextId: string): void {
    this.turns.delete(contextId)
  }
  clear(): void {
    this.turns.clear()
  }
}

export const lastTurnRegistry = new LastTurnRegistry()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/run-control/last-turn-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `runTurn`**

In `src/llm-orchestrator.ts` `runTurn` `finally` block (line 241-243), after `leftover = runRegistry.end(contextId)`, record the last turn:

```typescript
    lastTurnRegistry.record(contextId, {
      originatingMessageIds: run.originatingMessageIds,
      completedEffects: run.completedEffects,
      replyTarget: run.replyTarget,
      finishedAt: Date.now(),
    })
```

And evict a stale last-turn when a new run begins — in `runRegistry.begin` (`src/run-control/registry.ts`), call `lastTurnRegistry.evict(contextId)` before `this.runs.set(...)` (import `lastTurnRegistry`).

Add `replyTarget: ReplyTarget | undefined` to `RunControl` (types.ts), defaulting to `undefined` in `begin()`; it is populated by the reply-target-capture wiring in Task 9. For now it stays `undefined`.

- [ ] **Step 6: Run run-control suite + typecheck**

Run: `bun run typecheck && bun test tests/run-control/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/run-control/last-turn-registry.ts src/run-control/registry.ts src/run-control/types.ts src/llm-orchestrator.ts tests/run-control/last-turn-registry.test.ts
git commit -m "feat(run-control): LastTurnRegistry captures finished turn state"
```

---

## Task 6: Pure `classifyEdit`

**Files:**
- Create: `src/message-edit/classify.ts`
- Test: `tests/message-edit/classify.test.ts`

**Interfaces:**
- Consumes: `RunControl` (`src/run-control/types.ts`), `LastTurn` (`src/run-control/last-turn-registry.ts`).
- Produces: `classifyEdit(input): 'w1' | 'w2' | 'w3'` where `input = { editedMessageId, activeRun, lastTurn, laterUserMessageExists }`.

- [ ] **Step 1: Write failing test**

`tests/message-edit/classify.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { classifyEdit } from '../../src/message-edit/classify.js'

const run = (originatingMessageIds: string[]) =>
  ({ originatingMessageIds }) as unknown as Parameters<typeof classifyEdit>[0]['activeRun']
const last = (originatingMessageIds: string[]) =>
  ({ originatingMessageIds, completedEffects: [] }) as unknown as Parameters<typeof classifyEdit>[0]['lastTurn']

describe('classifyEdit', () => {
  it('W1 when edit is the active run origin', () => {
    expect(classifyEdit({ editedMessageId: 'm1', activeRun: run(['m1']), lastTurn: undefined, laterUserMessageExists: false })).toBe('w1')
  })
  it('W3 when active run exists but edit is not its origin', () => {
    expect(classifyEdit({ editedMessageId: 'm9', activeRun: run(['m1']), lastTurn: undefined, laterUserMessageExists: false })).toBe('w3')
  })
  it('W2 when last turn origin and no later user message', () => {
    expect(classifyEdit({ editedMessageId: 'm1', activeRun: undefined, lastTurn: last(['m1']), laterUserMessageExists: false })).toBe('w2')
  })
  it('W3 when last turn origin but a later user message exists', () => {
    expect(classifyEdit({ editedMessageId: 'm1', activeRun: undefined, lastTurn: last(['m1']), laterUserMessageExists: true })).toBe('w3')
  })
  it('W3 when neither active run nor last turn match', () => {
    expect(classifyEdit({ editedMessageId: 'm1', activeRun: undefined, lastTurn: undefined, laterUserMessageExists: false })).toBe('w3')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-edit/classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/message-edit/classify.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import type { RunControl } from '../run-control/types.js'
import type { LastTurn } from '../run-control/last-turn-registry.js'

export type EditWindow = 'w1' | 'w2' | 'w3'

export type ClassifyEditInput = {
  editedMessageId: string
  activeRun: RunControl | undefined
  lastTurn: LastTurn | undefined
  laterUserMessageExists: boolean
}

export function classifyEdit(input: ClassifyEditInput): EditWindow {
  const { editedMessageId, activeRun, lastTurn, laterUserMessageExists } = input
  if (activeRun !== undefined) {
    return activeRun.originatingMessageIds.includes(editedMessageId) ? 'w1' : 'w3'
  }
  if (lastTurn !== undefined && lastTurn.originatingMessageIds.includes(editedMessageId) && !laterUserMessageExists) {
    return 'w2'
  }
  return 'w3'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-edit/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/message-edit/classify.ts tests/message-edit/classify.test.ts
git commit -m "feat(edit): pure classifyEdit window classifier"
```

---

## Task 7: `ChatProvider.onMessageEdit?` + ChatRouter fan-out + `setupBot` wiring

**Files:**
- Modify: `src/chat/router.ts:173-178, 257-267` (add `onMessageEdit` + `registerExistingHandlers`), `src/chat/router-helpers.ts:158-164` (reuse `routedMessageHandler`)
- Modify: `src/bot.ts:288-298` (`setupBot`)
- Test: `tests/chat/router.test.ts`

**Interfaces:**
- Produces: `ChatRouter.onMessageEdit(handler)` registers a fan-out that injects `platformInstanceId` (already declared on `ChatProvider` in Task 1).

- [ ] **Step 1: Write failing test**

Add to `tests/chat/router.test.ts` (follow its existing `FakeProvider` pattern):

```typescript
it('fans onMessageEdit to instances with platformInstanceId', async () => {
  const { router, instance, provider } = buildRouterWithInstance() // existing helper in this file
  const seen: string[] = []
  router.onMessageEdit(async (msg) => { seen.push(msg.platformInstanceId) })
  // invoke the provider's onMessageEdit registration captured via FakeProvider
  await provider.deliverEdit({ ...baseMsg, messageId: 'm1' })
  expect(seen).toEqual([instance.id])
})
```

(Use the `FakeProvider`'s existing message-deliver method as a template; add a `deliverEdit` that invokes whichever handler was passed to `onMessageEdit`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/router.test.ts -t "onMessageEdit"`
Expected: FAIL — `router.onMessageEdit` not a function.

- [ ] **Step 3: Implement**

In `src/chat/router.ts`, add a `private messageEditHandler` field (next to `messageHandler`) and a method mirroring `onMessage` (line 173):

```typescript
  onMessageEdit(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.messageEditHandler = handler
    for (const instance of this.instances.values()) {
      if (instance.provider.onMessageEdit !== undefined) {
        instance.provider.onMessageEdit(routedMessageHandler(instance.id, handler))
      }
    }
  }
```

In `registerExistingHandlers` (line 257), add:

```typescript
    if (this.messageEditHandler !== null && instance.provider.onMessageEdit !== undefined) {
      instance.provider.onMessageEdit(routedMessageHandler(instance.id, this.messageEditHandler))
    }
```

(`routedMessageHandler` already injects `platformInstanceId`; reuse it unchanged.)

In `src/bot.ts` `setupBot` (line 290-297), after the `chat.onMessage` wiring, add (capability-gated):

```typescript
  if (chat.onMessageEdit !== undefined) {
    chat.onMessageEdit((msg, reply): Promise<void> => onIncomingEdit(chat, msg, reply, deps))
  }
```

`onIncomingEdit` is implemented in Task 8; for this task add a placeholder import + stub in `bot.ts`:

```typescript
async function onIncomingEdit(_chat: ChatProvider, _msg: IncomingMessage, _reply: ReplyFn, _deps: BotDeps): Promise<void> {
  // implemented in Task 8
}
```

so this task typechecks. The wiring is exercised end-to-end in Task 8.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/router.test.ts -t "onMessageEdit"`
Expected: PASS.

- [ ] **Step 5: Run router suite + typecheck**

Run: `bun run typecheck && bun test tests/chat/router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/chat/router.ts src/bot.ts tests/chat/router.test.ts
git commit -m "feat(chat): router onMessageEdit fan-out + setupBot wiring"
```

---

## Task 8: `onIncomingEdit` — guards, baseline history mutation, W1 + W3 (W2 stubbed)

**Files:**
- Modify: `src/bot.ts` (replace the Task-7 stub `onIncomingEdit`)
- Create: `src/message-edit/handle.ts`
- Test: `tests/message-edit/handle.test.ts`

**Interfaces:**
- Consumes: `classifyEdit`, `applyEditToHistory`, `runRegistry`, `lastTurnRegistry`, `resolveMessageAuth`, `shouldIgnoreGroupMessage`, `cacheObservedIncomingMessage` (for the baseline metadata upsert), `getMessageByContext` (prior text + later-user-message check).

- [ ] **Step 1: Write failing test**

`tests/message-edit/handle.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { onIncomingEdit } from '../../src/message-edit/handle.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'
import { createMockChatForBot, createDmMessage, createMockReply } from '../utils/test-helpers.js' // adjust to real exports
import { setupTestDb } from '../utils/db-helpers.js'

describe('onIncomingEdit', () => {
  beforeEach(() => { setupTestDb(); runRegistry.clear(); lastTurnRegistry.clear() })

  it('skips command edits (no-op)', async () => {
    const calls: string[] = []
    const msg = { ...createDmMessage('/stop'), messageId: 'm1', text: '/stop', editedAt: 1 }
    await onIncomingEdit(createMockChatForBot(), msg as any, createMockReply(), {} as any)
    expect(calls.length).toBe(0)
  })

  it('W1 pushes a steer correction and corrects history', async () => {
    const reply = createMockReply()
    const run = runRegistry.begin('ctx', { turnId: 't', reply, originatingMessageIds: ['m1'] })
    // seed message_metadata + history with original text
    await onIncomingEdit(createMockChatForBot(), { ...createDmMessage('hello'), messageId: 'm1', text: 'hi', editedAt: 1, contextId: 'ctx' } as any, reply, {} as any)
    expect(run.steerQueue.some((s) => s.text.includes('hi'))).toBe(true)
  })
})
```

(Adjust helper imports to the repo's actual exports — `tests/utils/test-helpers.ts` provides factories; mirror `tests/bot.test.ts` usage.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-edit/handle.test.ts`
Expected: FAIL — `onIncomingEdit` not exported / stub.

- [ ] **Step 3: Implement `handle.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import type { ChatProvider, IncomingMessage, ReplyFn } from '../chat/types.js'
import { resolveMessageAuth, shouldIgnoreGroupMessage } from '../bot.js'
import { applyEditToHistory } from '../history.js'
import { cacheObservedIncomingMessage } from '../bot-message-caching.js'
import { runRegistry } from '../run-control/registry.js'
import { lastTurnRegistry, type LastTurn } from '../run-control/last-turn-registry.js'
import { classifyEdit } from './classify.js'
import { getMessageByContext } from '../message-cache/store.js'
import { messageMetadata } from '../db/schema.js'
import { getDrizzleDb } from '../db/db.js'
import { and, eq, gt } from 'drizzle-orm'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'message-edit' })

async function laterUserMessageExists(contextId: string, beforeTimestamp: number): Promise<boolean> {
  const row = getDrizzleDb()
    .select({ messageId: messageMetadata.messageId })
    .from(messageMetadata)
    .where(and(eq(messageMetadata.contextId, contextId), gt(messageMetadata.timestamp, beforeTimestamp)))
    .limit(1)
    .get()
  return row !== undefined
}

export async function onIncomingEdit(
  chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  deps: { processMessage?: (...args: never[]) => Promise<void> } & Record<string, unknown>,
): Promise<void> {
  const auth = resolveMessageAuth(msg)
  if (!auth.allowed) return
  if (shouldIgnoreGroupMessage(msg)) return
  if (msg.messageId === undefined) return
  if (msg.commandMatch !== undefined && msg.commandMatch !== '') return // command edit → no-op
  if (msg.text.length === 0) return

  // same-text skip
  const prior = getMessageByContext(auth.storageContextId, msg.messageId)
  if (prior !== undefined && prior.text === msg.text) return

  // baseline: correct message_metadata (upsert via the existing cache path) + conversation_history
  cacheObservedIncomingMessage(msg, auth)
  applyEditToHistory(auth.storageContextId, msg.messageId, msg.text)

  const activeRun = runRegistry.get(auth.storageContextId)
  const lastTurn = lastTurnRegistry.get(auth.storageContextId)
  const beforeTs = prior?.timestamp ?? 0
  const later = await laterUserMessageExists(auth.storageContextId, beforeTs)
  const window = classifyEdit({ editedMessageId: msg.messageId, activeRun, lastTurn, laterUserMessageExists: later })

  log.debug({ storageContextId: auth.storageContextId, messageId: msg.messageId, window }, 'Edit classified')

  if (window === 'w1' && activeRun !== undefined) {
    activeRun.steerQueue.push({ text: `⟲ Your earlier message was edited. New version:\n\n${msg.text}` })
    await reply.text('✋ folding that into the current run…')
    return
  }
  if (window === 'w2' && lastTurn !== undefined) {
    // Implemented in Tasks 10–11.
    await handleW2(chat, msg, reply, auth, lastTurn, deps as EditHandlerDeps)
    return
  }
  // w3: silent history-only (history already corrected above)
}

export type EditHandlerDeps = { processMessage: (...args: never[]) => Promise<void> }

// Stub replaced in Task 10.
async function handleW2(_chat: ChatProvider, _msg: IncomingMessage, _reply: ReplyFn, _auth: unknown, _last: LastTurn, _deps: EditHandlerDeps): Promise<void> {
  // noop until Tasks 10–11
}
```

Wire `onIncomingEdit` into `src/bot.ts` by replacing the Task-7 stub import: `import { onIncomingEdit } from './message-edit/handle.js'` and remove the local stub function.

**Note on `resolveMessageAuth`/`shouldIgnoreGroupMessage` exports:** these are currently non-exported in `bot.ts` (`src/bot.ts:56, 158`). Export them (`export function resolveMessageAuth...`, `export function shouldIgnoreGroupMessage...`) as part of this task so `handle.ts` can consume them.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-edit/handle.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck + bot suites**

Run: `bun run typecheck && bun test tests/bot.test.ts tests/message-edit/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/message-edit/handle.ts src/bot.ts tests/message-edit/handle.test.ts
git commit -m "feat(edit): onIncomingEdit guards + baseline history + W1/W3 dispatch"
```

---

## Task 9: Reply-target capture + `ReplyFn.editReply?` (Telegram, Discord, Mattermost)

**Files:**
- Modify: `src/chat/telegram/reply-helpers.ts:220-233` (`sendFormattedReply` returns sent id), `src/chat/telegram/reply-fn-builder.ts:76-116` (`formatted` builds a `ReplyTarget`; add `editReply`)
- Modify: `src/chat/discord/reply-helpers.ts:35-146, 181-227` (already tracks `sentMessages`; add `editReply`)
- Modify: `src/chat/mattermost/reply-helpers.ts:147-211` (`makePost` returns id already; capture in `formatted`; add `editReply`)
- Modify: `src/llm-orchestrator-send.ts` (record `replyTarget` onto the run)
- Test: `tests/chat/telegram/reply-helpers.test.ts`, `tests/chat/discord/reply-helpers.test.ts`, `tests/chat/mattermost/reply-helpers.test.ts`

**Interfaces:**
- Produces: each adapter's reply-fn attaches `editReply(target, markdown)`; the orchestrator stores the captured `ReplyTarget` on `RunControl.replyTarget`.

- [ ] **Step 1: Write failing test (Telegram)**

Add to `tests/chat/telegram/reply-helpers.test.ts`:

```typescript
it('sendFormattedReply returns the sent message id', async () => {
  const ctx = { reply: async () => ({ message_id: 42, chat: { id: 7 } }) }
  const sent = await sendFormattedReply(ctx as any, 'hello', () => ({}), undefined)
  expect((sent as { messageId: number }).messageId).toBe(42)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/telegram/reply-helpers.test.ts -t "sent message id"`
Expected: FAIL — `sendFormattedReply` returns `void`.

- [ ] **Step 3: Implement Telegram**

Change `sendFormattedReply` return type to capture the sent message:

```typescript
export async function sendFormattedReply(
  ctx: ReplyCapableContext,
  markdown: string,
  buildReplyParams: ReplyParamsBuilder,
  options: ReplyOptions | undefined,
): Promise<{ messageId: number; chatId: number }> {
  const formatted = formatLlmOutput(markdown)
  const replyParameters = options === undefined ? buildReplyParams() : buildReplyParams(options)
  const sent = (await ctx.reply(formatted.text, {
    entities: formatted.entities,
    reply_parameters: replyParameters,
    ...(options?.disableLinkPreview === true ? { link_preview_options: { is_disabled: true } } : {}),
  })) as { message_id: number; chat: { id: number } }
  return { messageId: sent.message_id, chatId: sent.chat.id }
}
```

In `reply-fn-builder.ts`, the `formatted` surface becomes:

```typescript
    formatted: async (markdown, options) => {
      const sent = await sendFormattedReply(ctx, markdown, buildReplyParams, options)
      lastReplyTarget = { platform: 'telegram', ref: sent }
    },
```

(add a `let lastReplyTarget: ReplyTarget | undefined` closure variable in `buildTelegramReplyFn`), and add the `editReply` surface:

```typescript
    editReply: async (target, markdown) => {
      const ref = target.ref as { messageId: number; chatId: number }
      const formatted = formatLlmOutput(markdown)
      await api.editMessageText(ref.chatId, ref.messageId, formatted.text, { entities: formatted.entities }).catch(() => undefined)
    },
```

- [ ] **Step 4: Run test to verify it passes + add Discord + Mattermost tests**

Run: `bun test tests/chat/telegram/reply-helpers.test.ts -t "sent message id"`
Expected: PASS.

Add analogous tests in `tests/chat/discord/reply-helpers.test.ts` (assert `editReply` calls the captured `BotMessage.edit`) and `tests/chat/mattermost/reply-helpers.test.ts` (assert `editReply` PATCHes `/api/v4/posts/<id>`).

- [ ] **Step 5: Implement Discord**

Discord already keeps `sentMessages: BotMessage[]`. In `createDiscordReplyFn`, add:

```typescript
    editReply: async (target, markdown) => {
      const ref = target.ref as BotMessage[]
      await redactMessages(channel.id, ref, markdown).catch(() => undefined)
    },
```

where `target.ref` is the `sentMessages` array captured at send time (set `lastReplyTarget = { platform: 'discord', ref: [...sentMessages] }` after `formatted` posts). `redactMessages` already edits each chunk in place.

- [ ] **Step 6: Implement Mattermost**

In `createMattermostReplyFn`, capture the post id from `makePost` in `formatted`:

```typescript
    formatted: async (markdown, options) => {
      const id = await post(markdown, options)
      lastReplyTarget = id === undefined ? undefined : { platform: 'mattermost', ref: id }
    },
```

and add:

```typescript
    editReply: async (target, markdown) => {
      const id = target.ref as string
      await apiFetch('PUT', `/api/v4/posts/${id}/patch`, { message: markdown }).catch(() => undefined)
    },
```

- [ ] **Step 7: Record `replyTarget` on the run**

In `src/llm-orchestrator-send.ts` `sendLlmResponse`, after `reply.formatted(...)` posts (the `beforeFirstMessage` hook area), record the adapter's last target onto the active run. Expose a small accessor on the reply-fn (`reply.lastReplyTarget?(): ReplyTarget | undefined`) that returns the closure variable, and in `sendLlmResponse`:

```typescript
  const run = runRegistry.get(contextId)
  if (run !== undefined && reply.lastReplyTarget !== undefined) run.replyTarget = reply.lastReplyTarget()
```

(Add `lastReplyTarget?: () => ReplyTarget | undefined` to the `ReplyFn` `Partial` block in `src/chat/types.ts`.)

- [ ] **Step 8: Run all reply-helper suites + typecheck**

Run: `bun run typecheck && bun test tests/chat/telegram/reply-helpers.test.ts tests/chat/discord/reply-helpers.test.ts tests/chat/mattermost/reply-helpers.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/chat/types.ts src/chat/telegram/reply-helpers.ts src/chat/telegram/reply-fn-builder.ts src/chat/discord/reply-helpers.ts src/chat/mattermost/reply-helpers.ts src/llm-orchestrator-send.ts tests/chat/telegram/reply-helpers.test.ts tests/chat/discord/reply-helpers.test.ts tests/chat/mattermost/reply-helpers.test.ts
git commit -m "feat(chat): reply-target capture + editReply on telegram/discord/mattermost"
```

---

## Task 10: W2 — regenerate when no side-effects

**Files:**
- Modify: `src/message-edit/handle.ts` (replace `handleW2` stub)
- Test: `tests/message-edit/handle-w2.test.ts`

**Interfaces:**
- Consumes: `lastTurnRegistry`, `runRegistry`, `processMessage` (via deps), `ReplyFn.editReply?`.

- [ ] **Step 1: Write failing test**

`tests/message-edit/handle-w2.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { onIncomingEdit } from '../../src/message-edit/handle.js'
import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { setupTestDb } from '../utils/db-helpers.js'
import { createMockChatForBot, createDmMessage, createMockReply } from '../utils/test-helpers.js'

describe('W2 no side-effects', () => {
  beforeEach(() => { setupTestDb(); runRegistry.clear(); lastTurnRegistry.clear() })

  it('regenerates and edits the old reply in place when completedEffects empty', async () => {
    const reply = createMockReply()
    const editedTarget = { platform: 'telegram', ref: { messageId: 99, chatId: 1 } }
    lastTurnRegistry.record('ctx', { originatingMessageIds: ['m1'], completedEffects: [], replyTarget: editedTarget, finishedAt: 1 })
    let processed = 0
    const chat = createMockChatForBot()
    await onIncomingEdit(chat, { ...createDmMessage('hi'), messageId: 'm1', text: 'hi (edited)', editedAt: 2, contextId: 'ctx' } as any, reply, { processMessage: async () => { processed++ } } as any)
    expect(processed).toBe(1)
    // a regeneration turn was started
    expect(runRegistry.get('ctx')).toBeUndefined() // completed synchronously in the stub
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/message-edit/handle-w2.test.ts`
Expected: FAIL — `handleW2` is the no-op stub.

- [ ] **Step 3: Implement `handleW2`**

In `src/message-edit/handle.ts`, replace the stub. The handler signature widens to accept `deps` with a `processMessage` callable and `chat`:

```typescript
type EditHandlerDeps = {
  processMessage: (...args: never[]) => Promise<void>
}

async function handleW2(
  _chat: ChatProvider,
  msg: IncomingMessage,
  reply: ReplyFn,
  auth: AuthorizationResult,
  last: LastTurn,
  deps: EditHandlerDeps,
): Promise<void> {
  if (last.completedEffects.length > 0) {
    // Side-effects branch — implemented in Task 11.
    return
  }
  // No side-effects: regenerate from the (already-corrected) history.
  await deps.processMessage(
    reply,
    auth.storageContextId,
    msg.user.id,
    msg.user.username,
    msg.text, // edited text; history was already mutated so the turn reads corrected context
    msg.contextType,
    auth.configContextId,
    {}, // deps
    [], // attachments
    undefined, // turnId (orchestrator generates a fresh one)
    auth.isGuest === true ? 'guest' : 'member',
  )
}
```

Thread `deps` from `onIncomingEdit`'s `deps` param into the `handleW2` call. If `reply.editReply` exists and `last.replyTarget` is set, the regenerated turn's own `formatted` will edit the old target — wire that by having the regeneration turn reuse `last.replyTarget` (the orchestrator's `sendLlmResponse` already records `run.replyTarget`; for the regen we seed it: after `runRegistry.begin` in the regen path, set `run.replyTarget = last.replyTarget`). Concretely, expose a helper or set it via `runRegistry.get(...)` immediately after kicking `processMessage` is not synchronous — instead pass the target into `processMessage` is over-broad.

**Simpler, correct approach for edit-in-place of the W2 regen:** have the W2 regen go through the normal `processMessage` path (which calls `reply.formatted`, posting a *new* reply), then additionally call `reply.editReply?.(last.replyTarget, <old reply redacted>)` — but that edits the OLD reply, not the new one. To truly edit-in-place, the regen must *replace* the old reply. Given complexity, **v1 W2 presentation decision: the regeneration posts via `reply.formatted` normally (a new reply) AND, if `reply.editReply` + `last.replyTarget` are available, redact the old reply to a short "⟲ superseded" marker.** This achieves "replace the old answer" semantics portably (edit-old + post-new) without a deep orchestrator refactor.

Update `handleW2` no-side-effects branch accordingly:

```typescript
  await deps.processMessage(/* ...as above... */)
  if (reply.editReply !== undefined && last.replyTarget !== undefined) {
    await reply.editReply(last.replyTarget, '⟲ Superseded by your edit.').catch(() => undefined)
  }
```

(Note: this adjusts the W2 presentation from "edit old reply in place with the NEW answer" to "post new answer + mark old as superseded". This is the pragmatic v1 given `formatted` posts new; the spec's pure edit-in-place is a future refinement once `formatted` can target an existing message. Document this in the task commit + update the spec's presentation note if needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/message-edit/handle-w2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/message-edit/handle.ts tests/message-edit/handle-w2.test.ts
git commit -m "feat(edit): W2 regenerate when no side-effects; supersede old reply"
```

---

## Task 11: W2 side-effects — ask-first prompt + `edit:` interaction-router prefix

**Files:**
- Modify: `src/chat/interaction-router.ts:16-89` (add `edit:` prefix branch)
- Modify: `src/message-edit/handle.ts` (`handleW2` side-effects branch)
- Test: `tests/chat/interaction-router.test.ts`, `tests/message-edit/handle-w2-sideeffects.test.ts`

**Interfaces:**
- Consumes: `lastTurnRegistry`, `interaction-router`, a new `editPromptStore` (pending edit prompts keyed by id, mirroring `peekPermissionRequest`).
- Produces: callbackData `edit:adjust:<id>` / `edit:note:<id>`.

- [ ] **Step 1: Write failing test for the router branch**

Add to `tests/chat/interaction-router.test.ts`:

```typescript
it('routes edit:adjust to the registered edit-adjust handler', async () => {
  const reply = createMockReply()
  let adjusted = false
  registerEditPrompt('e1', { contextId: 'ctx', editedText: 'x', onAdjust: async () => { adjusted = true } })
  const ok = await routeInteraction({ callbackData: 'edit:adjust:e1', sourceMessageText: '', user: { id: 'u', username: null, isAdmin: false }, contextId: 'ctx', contextType: 'dm', isMentioned: false, platformInstanceId: 'p' } as any, reply, { allowed: true, storageContextId: 'ctx' } as any)
  expect(ok).toBe(true)
  expect(adjusted).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/interaction-router.test.ts -t "edit:adjust"`
Expected: FAIL — no `edit:` handling.

- [ ] **Step 3: Implement edit-prompt store + router branch**

Create `src/message-edit/edit-prompt-store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

export type PendingEditPrompt = {
  contextId: string
  editedText: string
  onAdjust: () => Promise<void>
  onNote: () => Promise<void>
}

const pending = new Map<string, PendingEditPrompt>()

export function registerEditPrompt(id: string, prompt: PendingEditPrompt): void { pending.set(id, prompt) }
export function peekEditPrompt(id: string): PendingEditPrompt | undefined { return pending.get(id) }
export function resolveEditPrompt(id: string): PendingEditPrompt | undefined { const p = pending.get(id); pending.delete(id); return p }
```

In `src/chat/interaction-router.ts`, add near line 16:

```typescript
const EDIT_CALLBACK_PATTERN = /^edit:(adjust|note):([A-Za-z0-9_-]+)$/u
```

In `routeInteraction`, after the `permissionMatch` block (before the `log.debug` no-route line), add:

```typescript
  const editMatch = EDIT_CALLBACK_PATTERN.exec(interaction.callbackData)
  if (editMatch !== null) {
    const action = editMatch[1]!
    const id = editMatch[2]!
    const prompt = peekEditPrompt(id)
    if (prompt === undefined || prompt.contextId !== auth.storageContextId) {
      await reply.text('Action is no longer available.')
      return true
    }
    const resolved = resolveEditPrompt(id)
    if (resolved === undefined) {
      await reply.text('Action is no longer available.')
      return true
    }
    if (action === 'adjust') await resolved.onAdjust()
    else await resolved.onNote()
    return true
  }
```

- [ ] **Step 4: Run router test to verify it passes**

Run: `bun test tests/chat/interaction-router.test.ts -t "edit:adjust"`
Expected: PASS.

- [ ] **Step 5: Implement `handleW2` side-effects branch**

In `src/message-edit/handle.ts`, the side-effects branch:

```typescript
  if (last.completedEffects.length > 0) {
    const promptId = randomUUID()
    const summary = buildStopSummary(last.completedEffects, { forced: false })
    const promptText = `${summary}\nYour edit: "${msg.text}".\n[Adjust for me] / [Just note it]`
    registerEditPrompt(promptId, {
      contextId: auth.storageContextId,
      editedText: msg.text,
      onAdjust: async () => {
        await deps.processMessage(/* regenerate args as in no-side-effects branch */)
        if (reply.editReply !== undefined && last.replyTarget !== undefined) {
          await reply.editReply(last.replyTarget, '⟲ Superseded by your edit.').catch(() => undefined)
        }
        await reply.ephemeralConfirm?.('✏️ Adjusting…').catch(() => undefined)
      },
      onNote: async () => {
        await reply.ephemeralConfirm?.('✏️ Noted').catch(() => undefined)
      },
    })
    const handle = await reply.buttons(promptText, {
      buttons: [
        { text: 'Adjust for me', callbackData: `edit:adjust:${promptId}` },
        { text: 'Just note it', callbackData: `edit:note:${promptId}` },
      ],
    })
    // If the platform has no buttons (handle undefined), the edit is history-only (already done) — no further action.
    if (handle === undefined) log.debug({ storageContextId: auth.storageContextId }, 'No buttons available; edit left as history-only')
    return
  }
```

(Imports: `randomUUID` from `bun:bun`/`crypto`, `buildStopSummary` from `../run-control/summary.js`, `registerEditPrompt` from `./edit-prompt-store.js`.)

- [ ] **Step 6: Write + run handle side-effects test**

Add `tests/message-edit/handle-w2-sideeffects.test.ts` asserting: with a `lastTurn` whose `completedEffects` is non-empty, `onIncomingEdit` calls `reply.buttons` once with the two `edit:` callbackData values.

Run: `bun test tests/message-edit/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/message-edit/edit-prompt-store.ts src/message-edit/handle.ts src/chat/interaction-router.ts tests/chat/interaction-router.test.ts tests/message-edit/handle-w2-sideeffects.test.ts
git commit -m "feat(edit): W2 side-effects ask-first prompt + edit: router prefix"
```

---

## Task 12: Telegram edit-event subscription

**Files:**
- Modify: `src/chat/telegram/index.ts:95-123` (add `edited_message:text` handler), `src/chat/telegram/message-extraction.ts` (read edit_date / editedMessage)
- Test: `tests/chat/telegram/index.test.ts`

**Interfaces:**
- Consumes: `ChatProvider.onMessageEdit` (registered via Task 7's `setupBot` wiring).

- [ ] **Step 1: Write failing test**

Add to `tests/chat/telegram/index.test.ts` (follow its existing pattern of driving the provider's private handlers):

```typescript
it('delivers edited_message:text to onMessageEdit with editedAt', async () => {
  const provider = new TelegramChatProvider(/* minimal config per existing tests */)
  const edits: number[] = []
  provider.onMessageEdit(async (msg) => { if (msg.editedAt !== undefined) edits.push(msg.editedAt) })
  // drive the grammy bot's edited_message:text handler via the test's existing grammy-mock harness
  await deliverEditedMessage(provider, { message_id: 5, text: 'edited', edit_date: 123 })
  expect(edits).toEqual([123])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/telegram/index.test.ts -t "edited_message"`
Expected: FAIL — no edit handler.

- [ ] **Step 3: Implement**

In `src/chat/telegram/index.ts`, add inside `onMessage`'s scope (and store an `editHandler` field analogous to `messageHandler`):

```typescript
  onMessageEdit(handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>): void {
    this.bot.on('edited_message:text', async (ctx) => {
      const isAdmin = await this.checkAdminStatus(ctx)
      const msg = await this.extractMessage(ctx, isAdmin)
      if (msg === null) return
      const reply = this.buildReplyFn(ctx, msg.threadId, false)
      await handler({ ...msg, editedAt: ctx.editedMessage?.edit_date ?? 0 }, reply)
    })
  }
```

`extractMessage` reads `ctx.message.*`; for edits grammy exposes the payload under `ctx.editedMessage`. Extend `extractMessageIds` (`src/chat/telegram/message-extraction.ts:65`) to fall back to `ctx.editedMessage`:

```typescript
  const source = ctx.message ?? ctx.editedMessage
  const messageId = source?.message_id
  // ...use `source` for reply_to_message / quote as well
```

(Add `editedMessage?: MinimalMessage` to `MinimalContext`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/telegram/index.test.ts -t "edited_message"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/telegram/index.ts src/chat/telegram/message-extraction.ts tests/chat/telegram/index.test.ts
git commit -m "feat(telegram): subscribe edited_message:text → onMessageEdit"
```

---

## Task 13: Discord edit-event subscription

**Files:**
- Modify: `src/chat/discord/index.ts:172-295` (add `messageUpdate` listener + `onMessageEdit`)
- Test: `tests/chat/discord/index.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/chat/discord/index.test.ts` (using its fake-client harness):

```typescript
it('delivers messageUpdate to onMessageEdit', async () => {
  const { provider, client } = buildProviderWithFakeClient() // existing helper
  const edits: string[] = []
  provider.onMessageEdit(async (msg) => { edits.push(msg.text) })
  client.emit('messageUpdate', oldMsg, { ...oldMsg, id: 'm1', content: 'edited', author: { bot: false, id: 'u' }, channelId: 'c', type: 0 })
  expect(edits).toEqual(['edited'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/discord/index.test.ts -t "messageUpdate"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/chat/discord/index.ts`, store an `editHandler` and register it; in `start()`, add:

```typescript
    client.on('messageUpdate', (_old, newMsg) => {
      if (!isDispatchableMessage(newMsg)) return
      this.dispatchEdit(newMsg, client.user === null ? '' : client.user.id).catch((error: unknown) => {
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'messageUpdate dispatch failed')
      })
    })
```

Add `dispatchEdit` mirroring `dispatchMessage` but calling `this.editHandler` (if set) with `mapDiscordMessage(...)` plus `editedAt: Date.now()`. Implement `onMessageEdit(handler)` to store `this.editHandler = handler`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/discord/index.test.ts -t "messageUpdate"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/discord/index.ts tests/chat/discord/index.test.ts
git commit -m "feat(discord): subscribe messageUpdate → onMessageEdit"
```

---

## Task 14: Mattermost `post_updated` branch

**Files:**
- Modify: `src/chat/mattermost/index.ts:153-184` (add `post_updated` branch + `onMessageEdit`)
- Test: `tests/chat/mattermost/index.test.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/chat/mattermost/index.test.ts` (using its `Reflect.get(provider, 'handleWsMessage')` pattern):

```typescript
it('routes post_updated to onMessageEdit', async () => {
  const provider = new MattermostChatProvider(/* config per existing tests */)
  const edits: string[] = []
  provider.onMessageEdit(async (msg) => { edits.push(msg.text) })
  const handleWsMessage = Reflect.get(provider, 'handleWsMessage') as (e: MessageEvent) => Promise<void>
  await handleWsMessage({ data: JSON.stringify({ event: 'post_updated', data: { post: JSON.stringify({ id: 'p1', message: 'edited', user_id: 'u', channel_id: 'c' }) } } } as MessageEvent)
  expect(edits).toEqual(['edited'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/mattermost/index.test.ts -t "post_updated"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `handleWsMessage` (line 153-163), add the branch:

```typescript
    if (parsed.data.event === 'post_updated') {
      await this.handlePostUpdatedEvent(parsed.data.data)
      return
    }
```

Add `handlePostUpdatedEvent` mirroring `handlePostedEvent` but parsing `data.post` (a JSON string) via `MattermostPostSchema` and calling `this.editHandler` (set by `onMessageEdit`) with a built `IncomingMessage` + `editedAt: Date.now()`. Reuse `buildPostedMessage`'s mapping logic for the non-edit fields (extract the message-building portion into a shared helper if needed to avoid duplication).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/mattermost/index.test.ts -t "post_updated"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/mattermost/index.ts tests/chat/mattermost/index.test.ts
git commit -m "feat(mattermost): route post_updated → onMessageEdit"
```

---

## Task 15: Kontur Talk no-op + full-suite verification

**Files:**
- No source changes (Kontur Talk intentionally unsupported).
- Test: `tests/chat/kontur-talk/edit-noop.test.ts`

- [ ] **Step 1: Write the verification test**

`tests/chat/kontur-talk/edit-noop.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { KonturTalkChatProvider } from '../../src/chat/kontur-talk/index.js'

describe('kontur-talk edit support', () => {
  it('does not declare messages.edit.inbound', () => {
    const provider = new KonturTalkChatProvider(/* minimal config */ as any)
    expect(provider.capabilities.has('messages.edit.inbound')).toBe(false)
  })
  it('does not implement onMessageEdit', () => {
    const provider = new KonturTalkChatProvider(/* minimal config */ as any)
    expect(provider.onMessageEdit).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/chat/kontur-talk/edit-noop.test.ts`
Expected: PASS (no changes needed — capability absent, method absent).

- [ ] **Step 3: Run the full test suite + lint + typecheck**

Run: `bun run typecheck && bun run test`
Expected: PASS. Fix any fallout from the signature changes across the codebase (in particular, all existing `runRegistry.begin(...)` call sites must now pass `originatingMessageIds`, and `processMessage` call sites the new arg).

- [ ] **Step 4: Commit**

```bash
git add tests/chat/kontur-talk/edit-noop.test.ts
git commit -m "test(kontur-talk): verify no inbound edit support in v1"
```

---

## Definition of done

- All four window behaviors implemented (W1 steer, W2 regenerate/ask, W3 silent) + baseline history correction on every edit.
- Telegram, Discord, Mattermost deliver edits via `onMessageEdit`; Kontur Talk verified unsupported.
- `bun run typecheck && bun run test` green; mutation ratchet (`bun test:mutate:changed`) run on the new files before merge.
- Spec (`docs/superpowers/specs/2026-07-27-message-edit-handling-design.md`) reconciled with the W2 presentation refinement (post-new + supersede-old) recorded in Task 10.
