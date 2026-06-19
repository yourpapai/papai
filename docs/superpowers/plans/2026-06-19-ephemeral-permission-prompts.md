<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Ephemeral / Self-Removing `ask` Permission Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a user approves/denies an `ask`-gated tool prompt, delete the prompt message and confirm with an ephemeral toast on platforms that support it; on timeout, redact the prompt in place; fall back to today's edit-in-place behavior elsewhere.

**Architecture:** `reply.buttons` returns a detached `PromptHandle` (`redact`/`remove`) bound to the just-sent prompt message, stored on the pending request. The click path (interaction-router) deletes via the handle and confirms via a new `reply.ephemeralConfirm` surface; the timeout path (permission-prompt) redacts via the handle. An explicit `messages.ephemeral` capability string drives which platforms get the delete+toast path.

**Tech Stack:** Bun, strict TypeScript (`.js` import paths), Zod v4, Grammy (Telegram), discord.js (Discord), Mattermost REST, `bun test`.

**Spec:** `docs/superpowers/specs/2026-06-19-ephemeral-permission-prompts-design.md`

---

## File Structure

**Core (platform-agnostic):**

- `src/chat/types.ts` — add `'messages.ephemeral'` capability, `PromptHandle` type, change `ReplyFn.buttons` return type, add optional `ReplyFn.ephemeralConfirm`.
- `src/chat/permission-prompt.ts` — store the handle on the pending request; redact on timeout; `resolvePermissionRequest` returns the handle; replace `formatPermissionDecisionText` with `formatDecisionConfirmation`.
- `src/chat/interaction-router.ts` — capability-aware decision UI (delete + ephemeral toast, else edit-in-place), confirmation text includes the tool name.

**Adapters:**

- `src/chat/telegram/index.ts` + `src/chat/telegram/reply-helpers.ts` + `src/chat/telegram/metadata.ts`
- `src/chat/discord/reply-helpers.ts` + `src/chat/discord/buttons.ts` + `src/chat/discord/button-dispatch.ts` + `src/chat/discord/metadata.ts`
- `src/chat/mattermost/reply-helpers.ts` + `src/chat/mattermost/action-callbacks.ts` + `src/chat/mattermost/metadata.ts`
- `src/chat/kontur-talk/*` — **no change** (no buttons/callbacks; its `buttons` rejects, which is `Promise<never>` and stays type-compatible).

**Sequencing rationale:** Task 1 makes the wide type change and keeps every adapter compiling by having their `buttons` return `undefined` for now (behavior identical to today). Tasks 2–3 wire the core handle/UI logic against fakes. Tasks 4–6 give each adapter a real handle + `ephemeralConfirm`. Every task ends green.

---

## Task 1: Core types + keep adapters compiling (refactor, no behavior change)

**Files:**

- Modify: `src/chat/types.ts`
- Modify: `src/chat/telegram/index.ts:255-273` (the `buttons` property in `buildReplyFn`)
- Modify: `src/chat/discord/reply-helpers.ts:187-188` (the `buttons` property)
- Modify: `src/chat/mattermost/reply-helpers.ts:77-100` (`createButtonsReply`)

- [ ] **Step 1: Add the capability, the `PromptHandle` type, and `ephemeralConfirm`; change the `buttons` return type**

In `src/chat/types.ts`, add `'messages.ephemeral'` to the `ChatCapability` union (after `'messages.delete'`):

```ts
export type ChatCapability =
  | 'commands.menu'
  | 'interactions.callbacks'
  | 'messages.buttons'
  | 'messages.delete'
  | 'messages.ephemeral'
  | 'messages.files'
  | 'messages.redact'
  | 'messages.reply-context'
  | 'files.receive'
  | 'users.resolve'
```

Just above `export type ReplyFn`, add:

```ts
/** Detached control over an already-sent prompt message. Valid after the turn ends. */
export type PromptHandle = {
  /** Edit the prompt in place (used on timeout). */
  redact: (text: string) => Promise<void>
  /** Delete the prompt entirely (used after a decision). */
  remove: () => Promise<void>
}
```

Change `buttons` in `ReplyFn` from `Promise<void>` to `Promise<PromptHandle | undefined>`, and add `ephemeralConfirm` to the optional block:

```ts
export type ReplyFn = {
  text: { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> }
  formatted: { (markdown: string): Promise<void>; (markdown: string, options: ReplyOptions): Promise<void> }
  typing: () => void
  buttons: (content: string, options: ButtonReplyOptions) => Promise<PromptHandle | undefined>
} & Partial<{
  replaceText: { (content: string): Promise<void>; (content: string, options: ReplyOptions): Promise<void> }
  file: { (file: ChatFile): Promise<void>; (file: ChatFile, options: ReplyOptions): Promise<void> }
  redactMessage: (replacementText: string) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  replaceButtons: (content: string, options: ButtonReplyOptions) => Promise<void>
  /** Present only on interaction replies of `messages.ephemeral` platforms. Shows a non-persistent confirmation. */
  ephemeralConfirm: (text: string) => Promise<void>
  embed: (options: EmbedOptions) => Promise<void>
}>
```

- [ ] **Step 2: Make each adapter's `buttons` return `undefined` so the project still compiles**

Telegram — `src/chat/telegram/index.ts`, in `buildReplyFn` replace the `buttons` line inside the `replyFn` object literal:

```ts
      buttons: async (content: string, options): Promise<undefined> => {
        await sendButtonReply(ctx, content, buildReplyParams, options)
        return undefined
      },
```

Discord — `src/chat/discord/reply-helpers.ts`, replace the `buttons` property in `createDiscordReplyFn`:

```ts
    buttons: async (content: string, options: ButtonReplyOptions): Promise<undefined> => {
      await sendButtonsReply(channel, sentMessages, replyToMessageId, content, options)
      return undefined
    },
```

Mattermost — `src/chat/mattermost/reply-helpers.ts`, change `createButtonsReply`'s return type and value:

```ts
const createButtonsReply = (
  post: MattermostPostReply,
  platformInstanceId: string,
  channelId: string,
  callbackBaseUrl: string | null,
  createActionContext: (input: MattermostActionContextInput) => MattermostSignedActionContext,
  threadId: string | undefined,
): ((content: string, options: ButtonReplyOptions) => Promise<undefined>) => {
  return async (content, options) => {
    if (callbackBaseUrl === null) {
      throw new Error('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL')
    }
    const actions = buildActions(
      content,
      options,
      platformInstanceId,
      channelId,
      callbackBaseUrl,
      createActionContext,
      options.threadId ?? threadId,
    )
    await post(content, options, { props: { attachments: [{ actions }] } })
    return undefined
  }
}
```

- [ ] **Step 3: Run typecheck to verify the project compiles**

Run: `bun typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Run the chat test suites to verify no behavior changed**

Run: `bun test tests/chat/ --parallel`
Expected: PASS (Kontur Talk's `buttons` still rejects; all other behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/chat/types.ts src/chat/telegram/index.ts src/chat/discord/reply-helpers.ts src/chat/mattermost/reply-helpers.ts
git commit -m "refactor(chat): add PromptHandle + messages.ephemeral; widen buttons return type"
```

---

## Task 2: Store the handle; redact on timeout; return it on resolve

**Files:**

- Modify: `src/chat/permission-prompt.ts`
- Test: `tests/chat/permission-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/chat/permission-prompt.test.ts`, add an import for `PromptHandle` at the top (alongside the existing type imports from `../../src/chat/types.js`) and append this `describe` block. It uses a fake `ReplyFn` whose `buttons` returns a spy handle:

```ts
import type { PromptHandle, ReplyFn } from '../../src/chat/types.js'

describe('askPermissionViaChat handle lifecycle', () => {
  function makeReplyWithHandle(): {
    reply: ReplyFn
    handle: { redact: ReturnType<typeof mock>; remove: ReturnType<typeof mock> }
  } {
    const handle = { redact: mock(async () => undefined), remove: mock(async () => undefined) }
    const reply = {
      text: mock(async () => undefined),
      formatted: mock(async () => undefined),
      typing: mock(() => undefined),
      buttons: mock(async (): Promise<PromptHandle> => handle),
    } as unknown as ReplyFn
    return { reply, handle }
  }

  test('resolvePermissionRequest returns the stored handle', async () => {
    resetPermissionPromptForTesting()
    const { reply, handle } = makeReplyWithHandle()
    const decisionPromise = askPermissionViaChat(reply, 'ctx-1', { toolName: 'web_fetch', reason: 'r', args: {} })
    // The prompt has been sent; grab the generated id from the callbackData passed to buttons.
    const call = (reply.buttons as ReturnType<typeof mock>).mock.calls[0]
    const callbackData = (call[1] as { buttons: Array<{ callbackData: string }> }).buttons[0].callbackData
    const id = callbackData.replace('perm:a:', '')
    const result = resolvePermissionRequest(id, 'allow')
    expect(result.resolved).toBe(true)
    expect(result.handle).toBe(handle)
    await expect(decisionPromise).resolves.toBe('allow')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/chat/permission-prompt.test.ts`
Expected: FAIL — `resolvePermissionRequest(...).resolved` is undefined (current return is a boolean), and TypeScript/`result.handle` does not exist.

- [ ] **Step 3: Implement the handle storage, timeout redact, and new resolve shape**

In `src/chat/permission-prompt.ts`:

Import the `PromptHandle` type (extend the existing type import):

```ts
import type { PromptHandle, ReplyFn } from './types.js'
```

Add `handle` to `PendingRequest`:

```ts
interface PendingRequest {
  contextId: string
  toolName: string
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
  handle?: PromptHandle
}
```

Rewrite `askPermissionViaChat` to capture and store the handle and redact on timeout:

```ts
export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string; args: Record<string, unknown> },
): Promise<PermissionDecision> {
  const id = generateRequestId()
  const body = formatPrompt(req.toolName, req.reason, req.args)
  const handle = await reply.buttons(body, {
    buttons: [
      { text: '✅ Allow', callbackData: `perm:a:${id}`, style: 'primary' },
      { text: '🚫 Deny', callbackData: `perm:d:${id}`, style: 'secondary' },
    ],
  })
  return new Promise<PermissionDecision>((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id)
      if (entry === undefined) return
      pending.delete(id)
      log.warn({ contextId, toolName: req.toolName, id }, 'Permission prompt timed out; denying')
      void redactExpiredPrompt(entry, contextId, req.toolName, id)
      entry.resolve('deny')
    }, PERMISSION_TIMEOUT_MS)
    pending.set(id, { contextId, toolName: req.toolName, resolve, timer, handle })
  })
}

async function redactExpiredPrompt(
  entry: PendingRequest,
  contextId: string,
  toolName: string,
  id: string,
): Promise<void> {
  if (entry.handle === undefined) return
  try {
    await entry.handle.redact('⌛ Expired — denied.')
  } catch (error) {
    log.warn(
      { contextId, toolName, id, error: error instanceof Error ? error.message : String(error) },
      'Failed to redact expired permission prompt',
    )
  }
}
```

Change `resolvePermissionRequest` to return the handle:

```ts
export function resolvePermissionRequest(
  id: string,
  decision: PermissionDecision,
): { resolved: boolean; handle?: PromptHandle } {
  const entry = pending.get(id)
  if (entry === undefined) return { resolved: false }
  pending.delete(id)
  clearTimeout(entry.timer)
  entry.resolve(decision)
  return entry.handle === undefined ? { resolved: true } : { resolved: true, handle: entry.handle }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/chat/permission-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/permission-prompt.ts tests/chat/permission-prompt.test.ts
git commit -m "feat(chat): capture prompt handle, redact on timeout, return handle on resolve"
```

---

## Task 3: Replace decision text with tool-named confirmation; capability-aware UI

**Files:**

- Modify: `src/chat/permission-prompt.ts` (swap `formatPermissionDecisionText` → `formatDecisionConfirmation`)
- Modify: `src/chat/interaction-router.ts`
- Test: `tests/chat/permission-prompt.test.ts`, `tests/chat/interaction-router.test.ts`

- [ ] **Step 1: Replace the decision-text test with a confirmation-text test**

In `tests/chat/permission-prompt.test.ts`, replace the existing `describe('formatPermissionDecisionText', ...)` block (around lines 140–150) and its import with:

```ts
// import: replace `formatPermissionDecisionText` with `formatDecisionConfirmation`

describe('formatDecisionConfirmation', () => {
  test('includes the tool name for allow', () => {
    expect(formatDecisionConfirmation('delete_task', 'allow')).toBe('Allowed delete_task ✅')
  })
  test('includes the tool name for deny', () => {
    expect(formatDecisionConfirmation('delete_task', 'deny')).toBe('Denied delete_task 🚫')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/chat/permission-prompt.test.ts`
Expected: FAIL — `formatDecisionConfirmation` is not exported.

- [ ] **Step 3: Implement `formatDecisionConfirmation` and remove `formatPermissionDecisionText`**

In `src/chat/permission-prompt.ts`, delete `formatPermissionDecisionText` and add:

```ts
export function formatDecisionConfirmation(toolName: string, decision: PermissionDecision): string {
  return decision === 'allow' ? `Allowed ${toolName} ✅` : `Denied ${toolName} 🚫`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/chat/permission-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing interaction-router tests**

In `tests/chat/interaction-router.test.ts`, add these two tests (adapt the local `makeReply`/auth helpers to the file's existing style — the file already builds `IncomingInteraction` and `AuthorizationResult` fixtures). The key assertions:

```ts
test('ephemeral platform: deletes the prompt and confirms with tool name', async () => {
  resetPermissionPromptForTesting()
  const handle = { redact: mock(async () => undefined), remove: mock(async () => undefined) }
  const buttons = mock(async () => handle)
  const ephemeralConfirm = mock(async () => undefined)
  const reply = {
    text: mock(async () => undefined),
    formatted: mock(async () => undefined),
    typing: mock(() => undefined),
    buttons,
    ephemeralConfirm,
  } as unknown as ReplyFn

  // Arrange a pending request whose contextId matches the auth context.
  await askPermissionViaChat(reply, 'ctx-1', { toolName: 'web_fetch', reason: 'r', args: {} })
  const id = (buttons.mock.calls[0][1] as { buttons: Array<{ callbackData: string }> }).buttons[0].callbackData.replace(
    'perm:a:',
    '',
  )

  const interaction = makeInteraction({ callbackData: `perm:a:${id}`, storageContextId: 'ctx-1' })
  const handled = await routeInteraction(interaction, reply, makeAuth({ storageContextId: 'ctx-1' }))

  expect(handled).toBe(true)
  expect(handle.remove).toHaveBeenCalledTimes(1)
  expect(ephemeralConfirm).toHaveBeenCalledWith('Allowed web_fetch ✅')
})

test('non-ephemeral platform: falls back to edit-in-place with tool name', async () => {
  resetPermissionPromptForTesting()
  const handle = { redact: mock(async () => undefined), remove: mock(async () => undefined) }
  const buttons = mock(async () => handle)
  const replaceText = mock(async () => undefined)
  const reply = {
    text: mock(async () => undefined),
    formatted: mock(async () => undefined),
    typing: mock(() => undefined),
    buttons,
    replaceText,
  } as unknown as ReplyFn

  await askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'r', args: {} })
  const id = (buttons.mock.calls[0][1] as { buttons: Array<{ callbackData: string }> }).buttons[0].callbackData.replace(
    'perm:a:',
    '',
  )

  const interaction = makeInteraction({
    callbackData: `perm:d:${id}`,
    storageContextId: 'ctx-1',
    sourceMessageText: 'Run `delete_task`?',
  })
  await routeInteraction(interaction, reply, makeAuth({ storageContextId: 'ctx-1' }))

  expect(handle.remove).not.toHaveBeenCalled()
  expect(replaceText).toHaveBeenCalledWith('Run `delete_task`?\n\nDenied delete_task 🚫')
})
```

If the test file lacks `makeInteraction`/`makeAuth` helpers, add minimal local builders: `makeInteraction(overrides)` returns `{ kind: 'button', user: { id: 'u', username: null, isAdmin: false }, contextId: 'ctx-1', contextType: 'dm', platformInstanceId: 'pi', storageContextId: 'ctx-1', callbackData: '', ...overrides }`; `makeAuth(overrides)` returns `{ allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'ctx-1', ...overrides }`.

- [ ] **Step 6: Run to verify the interaction-router tests fail**

Run: `bun test tests/chat/interaction-router.test.ts`
Expected: FAIL — `ephemeralConfirm` path not implemented; confirmation text lacks tool name.

- [ ] **Step 7: Implement the capability-aware decision UI**

Replace the body of `src/chat/interaction-router.ts` with:

```ts
import { logger } from '../logger.js'
import {
  formatDecisionConfirmation,
  peekPermissionRequest,
  resolvePermissionRequest,
  type PermissionDecision,
} from './permission-prompt.js'
import type { AuthorizationResult, IncomingInteraction, PromptHandle, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })
const PERMISSION_CALLBACK_PATTERN = /^perm:(a|d):([A-Za-z0-9_-]+)$/u

const permissionDecisionFromCode = (code: string): PermissionDecision => (code === 'a' ? 'allow' : 'deny')

async function finalizePermissionDecision(
  reply: ReplyFn,
  toolName: string,
  sourceMessageText: string | undefined,
  decision: PermissionDecision,
  handle: PromptHandle | undefined,
): Promise<void> {
  const confirmation = formatDecisionConfirmation(toolName, decision)

  // Ephemeral path: delete the prompt, confirm with a non-persistent toast.
  if (reply.ephemeralConfirm !== undefined && handle !== undefined) {
    try {
      await handle.remove()
    } catch (error) {
      log.warn({ toolName, error: error instanceof Error ? error.message : String(error) }, 'Failed to remove prompt')
    }
    await reply.ephemeralConfirm(confirmation)
    return
  }

  // Fallback: edit the prompt in place (current behavior), now with the tool name.
  const content = sourceMessageText === undefined ? confirmation : `${sourceMessageText.trimEnd()}\n\n${confirmation}`
  if (reply.replaceText !== undefined) {
    try {
      await reply.replaceText(content)
      return
    } catch {
      await reply.text(content)
      return
    }
  }
  await reply.text(content)
}

export async function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean> {
  if (!auth.allowed) {
    await reply.text('You are not authorized to use this bot.')
    return true
  }

  const permissionMatch = PERMISSION_CALLBACK_PATTERN.exec(interaction.callbackData)
  if (permissionMatch !== null) {
    const decision = permissionDecisionFromCode(permissionMatch[1]!)
    const id = permissionMatch[2]!
    const pending = peekPermissionRequest(id)
    if (pending === null || pending.contextId !== auth.storageContextId) {
      await reply.text('Action is no longer available.')
      return true
    }
    const result = resolvePermissionRequest(id, decision)
    if (!result.resolved) {
      await reply.text('Action is no longer available.')
      return true
    }
    await finalizePermissionDecision(reply, pending.toolName, interaction.sourceMessageText, decision, result.handle)
    return true
  }

  log.debug({ callbackData: interaction.callbackData }, 'No route matched for interaction callback')
  return false
}
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `bun test tests/chat/permission-prompt.test.ts tests/chat/interaction-router.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck (catches any leftover `formatPermissionDecisionText` references)**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/chat/permission-prompt.ts src/chat/interaction-router.ts tests/chat/permission-prompt.test.ts tests/chat/interaction-router.test.ts
git commit -m "feat(chat): tool-named ephemeral confirmation with edit-in-place fallback"
```

---

## Task 4: Telegram — real handle, ephemeral toast, single callback answer

**Files:**

- Modify: `src/chat/telegram/metadata.ts:8-16`
- Modify: `src/chat/telegram/reply-helpers.ts:244-257` (`sendButtonReply`)
- Modify: `src/chat/telegram/index.ts` (`buildReplyFn` `buttons`, add `ephemeralConfirm`, `dispatchCallbackQuery`)
- Test: `tests/chat/telegram/metadata.test.ts`, `tests/chat/telegram/reply-helpers.test.ts`, `tests/chat/telegram/index.test.ts`

- [ ] **Step 1: Write the failing capability test**

In `tests/chat/telegram/metadata.test.ts`, add:

```ts
test('declares messages.ephemeral capability', () => {
  expect(telegramCapabilities.has('messages.ephemeral')).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/chat/telegram/metadata.test.ts`
Expected: FAIL — capability not present.

- [ ] **Step 3: Add the capability**

In `src/chat/telegram/metadata.ts`, add `'messages.ephemeral'` to `telegramCapabilities` (after `'messages.delete'` is not present here, so add it after `'messages.buttons'`):

```ts
export const telegramCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.ephemeral',
  'messages.files',
  'messages.redact',
  'messages.reply-context',
  'files.receive',
])
```

- [ ] **Step 4: Make `sendButtonReply` return the sent message**

In `src/chat/telegram/reply-helpers.ts`, import the `Message` type and change `sendButtonReply` to return the sent message:

```ts
import type { Message } from '@grammyjs/types/message.js'
```

```ts
export async function sendButtonReply(
  ctx: Context,
  content: string,
  buildReplyParams: ReplyParamsBuilder,
  options: ButtonReplyOptions,
): Promise<Message.TextMessage> {
  const keyboard = buildInlineKeyboard(options)
  const formatted = formatLlmOutput(content)
  return ctx.reply(formatted.text, {
    entities: formatted.entities,
    reply_markup: keyboard,
    reply_parameters: buildReplyParams(options),
  })
}
```

- [ ] **Step 5: Build a real `PromptHandle` from `buttons` and add `ephemeralConfirm`**

In `src/chat/telegram/index.ts`, in `buildReplyFn`, replace the `buttons` property (the `undefined`-returning version from Task 1) with a handle-returning one:

```ts
      buttons: async (content: string, options): Promise<PromptHandle | undefined> => {
        const sent = await sendButtonReply(ctx, content, buildReplyParams, options)
        const sentChatId = sent.chat.id
        const sentMessageId = sent.message_id
        return {
          redact: async (text: string): Promise<void> => {
            await this.bot.api
              .editMessageText(sentChatId, sentMessageId, text, { reply_markup: { inline_keyboard: [] } })
              .catch((err: unknown) =>
                log.warn(
                  { sentChatId, sentMessageId, error: err instanceof Error ? err.message : String(err) },
                  'Failed to redact prompt',
                ),
              )
          },
          remove: async (): Promise<void> => {
            await this.bot.api.deleteMessage(sentChatId, sentMessageId).catch((err: unknown) =>
              log.warn(
                { sentChatId, sentMessageId, error: err instanceof Error ? err.message : String(err) },
                'Failed to remove prompt',
              ),
            )
          },
        }
      },
```

Add the `PromptHandle` type to the type import at the top of the file (extend the existing `import type { ... } from '../types.js'` line to include `PromptHandle`).

In the `if (allowReplacement) { ... }` block (callback context only), add `ephemeralConfirm`:

```ts
if (allowReplacement) {
  replyFn.replaceText = (content: string, ..._rest: [] | [ReplyOptions]): Promise<void> =>
    sendReplacementTextReply(ctx, content)
  replyFn.replaceButtons = (content: string, options): Promise<void> =>
    sendReplacementButtonReply(ctx, content, options)
  replyFn.ephemeralConfirm = async (text: string): Promise<void> => {
    await ctx
      .answerCallbackQuery({ text })
      .catch((err: unknown) =>
        log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to answer callback query'),
      )
  }
}
```

- [ ] **Step 6: Ensure the callback is answered exactly once**

In `dispatchCallbackQuery`, remove the leading `await ctx.answerCallbackQuery()` and add a trailing safety-net answer (a second answer after `ephemeralConfirm` already answered fails harmlessly and is swallowed):

```ts
  private async dispatchCallbackQuery(ctx: Context): Promise<void> {
    const interaction = buildTelegramInteraction(ctx, await this.checkAdminStatus(ctx), this.platformInstanceId)
    if (interaction === null) {
      await ctx.answerCallbackQuery().catch(() => undefined)
      return
    }
    const reply = this.buildReplyFn(ctx, interaction.threadId, true)
    if (this.interactionHandler === undefined) {
      const callbackQuery = ctx.callbackQuery
      log.warn(
        { callbackData: callbackQuery === undefined ? undefined : callbackQuery.data },
        'No interaction handler registered',
      )
      await ctx.answerCallbackQuery().catch(() => undefined)
      return
    }
    await this.interactionHandler(interaction, reply)
    await ctx.answerCallbackQuery().catch(() => undefined)
  }
```

- [ ] **Step 7: Write a failing reply-helpers test for the returned message**

In `tests/chat/telegram/reply-helpers.test.ts`, add a test that `sendButtonReply` returns what `ctx.reply` resolves to (follow the file's existing fake-`ctx` style; `ctx.reply` should be a mock resolving to `{ message_id: 42, chat: { id: 7 } }`):

```ts
test('sendButtonReply returns the sent message', async () => {
  const ctx = makeButtonCtx() // existing helper or inline fake with reply: mock(async () => ({ message_id: 42, chat: { id: 7 } }))
  const sent = await sendButtonReply(ctx as never, 'hi', () => undefined, { buttons: [] })
  expect(sent.message_id).toBe(42)
})
```

- [ ] **Step 8: Run the Telegram suites**

Run: `bun test tests/chat/telegram/ --parallel`
Expected: PASS. If `index.test.ts` asserts the old upfront `answerCallbackQuery()` ordering, update those expectations to match the single-answer-at-end behavior.

- [ ] **Step 9: Typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/chat/telegram/ tests/chat/telegram/
git commit -m "feat(telegram): self-removing prompt + ephemeral callback toast"
```

---

## Task 5: Discord — real handle, ephemeral follow-up

**Files:**

- Modify: `src/chat/discord/metadata.ts:8-14`
- Modify: `src/chat/discord/reply-helpers.ts` (`SendableChannel`/`BotMessage` types, `sendButtonsReply`, `createDiscordReplyFn`)
- Modify: `src/chat/discord/buttons.ts:31-45` (`ButtonInteractionLike`)
- Modify: `src/chat/discord/button-dispatch.ts:45-78` (`buildInteraction`)
- Test: `tests/chat/discord/metadata.test.ts`, `tests/chat/discord/reply-helpers.test.ts`, `tests/chat/discord/button-dispatch.test.ts`

- [ ] **Step 1: Write the failing capability test**

In `tests/chat/discord/metadata.test.ts`, add:

```ts
test('declares messages.ephemeral capability', () => {
  expect(discordCapabilities.has('messages.ephemeral')).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/chat/discord/metadata.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the capability**

In `src/chat/discord/metadata.ts`:

```ts
export const discordCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'interactions.callbacks',
  'messages.buttons',
  'messages.ephemeral',
  'messages.redact',
  'messages.reply-context',
  'users.resolve',
])
```

- [ ] **Step 4: Extend the message/channel types and return the sent message from `sendButtonsReply`**

In `src/chat/discord/reply-helpers.ts`, extend the send-return and `BotMessage` types to include `delete`, and add an optional ephemeral-reply param:

```ts
export type SendableChannel = {
  id: string
  send: (
    arg: SendPayload,
  ) => Promise<{ id: string; edit: (arg: EditPayload) => Promise<unknown>; delete: () => Promise<unknown> }>
  sendTyping: () => Promise<void>
}

export type CreateDiscordReplyFnParams = {
  channel: SendableChannel
  replyToMessageId: string | undefined
} & Partial<{ replaceMessage: BotMessage; ephemeralReply: (text: string) => Promise<void> }>

type BotMessage = {
  id: string
  edit: (arg: EditPayload) => Promise<unknown>
} & Partial<{ delete: () => Promise<unknown> }>
```

Change `sendButtonsReply` to return the sent message:

```ts
async function sendButtonsReply(
  channel: SendableChannel,
  sentMessages: BotMessage[],
  replyToMessageId: string | undefined,
  content: string,
  options: ButtonReplyOptions,
): Promise<BotMessage> {
  const rows = options.buttons === undefined ? [] : toActionRows(options.buttons)
  const sent = await channel.send({
    content,
    components: rows,
    reply: buildReply(replyToMessageId, options),
  })
  sentMessages.push(sent)
  return sent
}
```

- [ ] **Step 5: Return a real handle from `buttons`; add `ephemeralConfirm`**

In `createDiscordReplyFn`, destructure `ephemeralReply`, import `PromptHandle`, replace the `buttons` property, and conditionally add `ephemeralConfirm`:

```ts
import type { ButtonReplyOptions, EmbedOptions, PromptHandle, ReplyFn, ReplyOptions } from '../types.js'
```

```ts
export function createDiscordReplyFn(params: CreateDiscordReplyFnParams): ReplyFn {
  const { channel, replyToMessageId, replaceMessage, ephemeralReply } = params
  const sentMessages: BotMessage[] = []
  // ...existing text / replaceText / formatted unchanged...

  const reply: ReplyFn = {
    text,
    replaceText,
    formatted,
    typing: (): void => {
      void channel.sendTyping().catch(() => null)
    },
    redactMessage: (replacementText: string): Promise<void> =>
      redactMessages(channel.id, sentMessages, replacementText),
    buttons: async (content: string, options: ButtonReplyOptions): Promise<PromptHandle | undefined> => {
      const sent = await sendButtonsReply(channel, sentMessages, replyToMessageId, content, options)
      return {
        redact: async (text: string): Promise<void> => {
          await sent
            .edit({ content: text, components: [] })
            .catch((err: unknown) =>
              log.warn(
                { id: sent.id, error: err instanceof Error ? err.message : String(err) },
                'Failed to redact prompt',
              ),
            )
        },
        remove: async (): Promise<void> => {
          if (sent.delete === undefined) return
          await sent
            .delete()
            .catch((err: unknown) =>
              log.warn(
                { id: sent.id, error: err instanceof Error ? err.message : String(err) },
                'Failed to remove prompt',
              ),
            )
        },
      }
    },
    replaceButtons: (content: string, options: ButtonReplyOptions): Promise<void> =>
      replaceOrSend(
        replaceMessage,
        { content, components: options.buttons === undefined ? [] : toActionRows(options.buttons) },
        () => sendButtonsReply(channel, sentMessages, replyToMessageId, content, options).then(() => undefined),
      ),
    embed: async (options: EmbedOptions): Promise<void> => {
      const embed = createEmbedPayload(options)
      const sent = await channel.send({ embeds: [embed] })
      sentMessages.push(sent)
    },
  }
  if (ephemeralReply !== undefined) {
    reply.ephemeralConfirm = ephemeralReply
  }
  return reply
}
```

- [ ] **Step 6: Add `followUp` to `ButtonInteractionLike` and wire `ephemeralReply` in `buildInteraction`**

In `src/chat/discord/buttons.ts`, extend `ButtonInteractionLike`:

```ts
export type ButtonInteractionLike = {
  user: { id: string; username: string } & Partial<{ bot: boolean; isAdmin: boolean }>
  customId: string
  channelId: string
  channel: ButtonChannelLike | null
  message: {
    id: string
  } & Partial<{
    channelId: string
    threadId: string
    editable: boolean
    edit: (arg: DiscordEditPayload) => Promise<unknown>
  }>
  deferUpdate(): Promise<void>
  followUp: (arg: { content: string; flags?: number; ephemeral?: boolean }) => Promise<unknown>
}
```

In `src/chat/discord/button-dispatch.ts`, import `MessageFlags` from discord.js and pass `ephemeralReply` into `createDiscordReplyFn` in `buildInteraction`:

```ts
import { MessageFlags } from 'discord.js'
```

```ts
const reply = createDiscordReplyFn({
  channel,
  replyToMessageId: undefined,
  replaceMessage: supportsEditableMessage(interaction.message) ? interaction.message : undefined,
  ephemeralReply: async (text: string): Promise<void> => {
    await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral })
  },
})
```

(Leave `routeButtonFallback`'s `createDiscordReplyFn` call unchanged — fallback commands do not need ephemeral confirmation.)

- [ ] **Step 7: Write a failing button-dispatch test for the ephemeral confirm**

In `tests/chat/discord/button-dispatch.test.ts`, add a test that a `perm:a:<id>` interaction calls `interaction.followUp` with an ephemeral flag. Use the existing fake interaction builder in that file and a pending request created via `askPermissionViaChat` against a reply built from the same channel; assert `followUp` was called once with `flags: MessageFlags.Ephemeral` (64). Mirror the structure of the Task 3 interaction-router test for arranging the pending id.

- [ ] **Step 8: Run the Discord suites**

Run: `bun test tests/chat/discord/ --parallel`
Expected: PASS. Update any existing reply-helpers test fakes whose `channel.send` mock returns an object without `delete` — add `delete: mock(async () => undefined)`.

- [ ] **Step 9: Typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/chat/discord/ tests/chat/discord/
git commit -m "feat(discord): self-removing prompt + ephemeral follow-up confirmation"
```

---

## Task 6: Mattermost — real handle, ephemeral action confirmation

**Files:**

- Modify: `src/chat/mattermost/metadata.ts:8-17`
- Modify: `src/chat/mattermost/reply-helpers.ts` (`post` returns id; `createButtonsReply` returns handle; `text`/`formatted`/`file` return void)
- Modify: `src/chat/mattermost/action-callbacks.ts:121-142` (`buildActionReply` adds `ephemeralConfirm`)
- Test: `tests/chat/mattermost/metadata.test.ts`, `tests/chat/mattermost/reply-helpers.test.ts`, `tests/chat/mattermost/action-callbacks.test.ts`

- [ ] **Step 1: Write the failing capability test**

In `tests/chat/mattermost/metadata.test.ts`, add:

```ts
test('declares messages.ephemeral capability', () => {
  expect(mattermostCapabilities.has('messages.ephemeral')).toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/chat/mattermost/metadata.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the capability**

In `src/chat/mattermost/metadata.ts`:

```ts
export const mattermostCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'interactions.callbacks',
  'messages.buttons',
  'messages.delete',
  'messages.ephemeral',
  'messages.files',
  'messages.reply-context',
  'files.receive',
  'users.resolve',
])
```

- [ ] **Step 4: Make `post` return the created post id; build a real handle from `buttons`**

In `src/chat/mattermost/reply-helpers.ts`, import `PromptHandle`, change `post` to return the created id, and have `text`/`formatted`/`file` await it (returning void). Update `createButtonsReply` to return a `PromptHandle`:

```ts
import type { ButtonReplyOptions, DeferredDeliveryTarget, PromptHandle, ReplyFn, ReplyOptions } from '../types.js'
```

Add a small local guard near the top of the file:

```ts
const extractPostId = (created: unknown): string | undefined =>
  typeof created === 'object' &&
  created !== null &&
  'id' in created &&
  typeof (created as { id: unknown }).id === 'string'
    ? (created as { id: string }).id
    : undefined
```

Change `createButtonsReply`'s signature and body to return a handle:

```ts
const createButtonsReply = (
  post: MattermostPostReply,
  platformInstanceId: string,
  channelId: string,
  callbackBaseUrl: string | null,
  createActionContext: (input: MattermostActionContextInput) => MattermostSignedActionContext,
  threadId: string | undefined,
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>,
): ((content: string, options: ButtonReplyOptions) => Promise<PromptHandle | undefined>) => {
  return async (content, options) => {
    if (callbackBaseUrl === null) {
      throw new Error('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL')
    }
    const actions = buildActions(
      content,
      options,
      platformInstanceId,
      channelId,
      callbackBaseUrl,
      createActionContext,
      options.threadId ?? threadId,
    )
    const createdId = await post(content, options, { props: { attachments: [{ actions }] } })
    if (createdId === undefined) return undefined
    return {
      redact: async (text: string): Promise<void> => {
        await apiFetch('PUT', `/api/v4/posts/${createdId}/patch`, { message: text, props: {} }).catch(() => undefined)
      },
      remove: async (): Promise<void> => {
        await apiFetch('DELETE', `/api/v4/posts/${createdId}`, undefined).catch(() => undefined)
      },
    }
  }
}
```

Change `MattermostPostReply` and `post` to return the id, and update `createMattermostReplyFn`'s `text`/`formatted`/`file` to await without leaking the return type, and pass `apiFetch` into `createButtonsReply`:

```ts
type MattermostPostReply = (
  message: string,
  options?: ReplyOptions,
  extra?: Record<string, unknown>,
) => Promise<string | undefined>
```

```ts
const post = async (
  message: string,
  options?: ReplyOptions,
  extra?: Record<string, unknown>,
): Promise<string | undefined> => {
  const created = await apiFetch('POST', '/api/v4/posts', {
    channel_id: channelId,
    message,
    root_id: options?.threadId ?? threadId ?? '',
    ...extra,
  })
  return extractPostId(created)
}

return {
  text: async (content: string, options?: ReplyOptions): Promise<void> => {
    await post(content, options)
  },
  formatted: async (markdown: string, options?: ReplyOptions): Promise<void> => {
    await post(markdown, options)
  },
  file: async (file, options?: ReplyOptions): Promise<void> => {
    const fileId = await uploadFile(channelId, file.content, file.filename)
    await post('', options, { file_ids: [fileId] })
  },
  typing: () => {
    wsSend({ seq: getWsSeq(), action: 'user_typing', data: { channel_id: channelId } })
  },
  redactMessage: async (replacementText: string) => {
    if (postId !== undefined) {
      await apiFetch('PUT', `/api/v4/posts/${postId}/patch`, { message: replacementText }).catch(() => undefined)
    }
  },
  deleteMessage: async (messageId: string) => {
    await apiFetch('DELETE', `/api/v4/posts/${messageId}`, undefined)
  },
  buttons: createButtonsReply(
    post,
    platformInstanceId,
    channelId,
    callbackBaseUrl,
    createActionContext,
    threadId,
    apiFetch,
  ),
}
```

- [ ] **Step 5: Add `ephemeralConfirm` to the action reply**

In `src/chat/mattermost/action-callbacks.ts`, add `ephemeralConfirm` to the reply built by `buildActionReply` (it maps to the existing `setEphemeral`, which produces an `ephemeral_text` response):

```ts
return {
  reply: {
    text: setEphemeral,
    formatted: setEphemeral,
    typing: noop,
    buttons: setUpdate as unknown as ReplyFn['buttons'],
    replaceText: setUpdate,
    replaceButtons: setUpdate,
    ephemeralConfirm: setEphemeral,
  },
  getResponse: () => response,
}
```

(`buttons` here is never used by the action path; the `as unknown as` cast satisfies the widened `buttons` return type without changing behavior.)

- [ ] **Step 6: Write failing tests**

In `tests/chat/mattermost/reply-helpers.test.ts`, add a test that `buttons` returns a handle whose `remove` issues a `DELETE /api/v4/posts/<id>` (use the file's existing fake `apiFetch` that resolves POST to `{ id: 'post-1' }`):

```ts
test('buttons returns a handle that deletes the created post', async () => {
  const calls: Array<{ method: string; path: string }> = []
  const apiFetch = mock(async (method: string, path: string) => {
    calls.push({ method, path })
    return method === 'POST' ? { id: 'post-1' } : undefined
  })
  const reply = createMattermostReplyFn(makeParams({ apiFetch, callbackBaseUrl: 'https://x' }))
  const handle = await reply.buttons('Run?', { buttons: [{ text: 'A', callbackData: 'perm:a:1' }] })
  await handle!.remove()
  expect(calls).toContainEqual({ method: 'DELETE', path: '/api/v4/posts/post-1' })
})
```

In `tests/chat/mattermost/action-callbacks.test.ts`, add a test that `buildActionReply().reply.ephemeralConfirm('x')` yields `{ ephemeral_text: 'x' }` from `getResponse()`.

- [ ] **Step 7: Run the Mattermost suites**

Run: `bun test tests/chat/mattermost/ --parallel`
Expected: PASS. If existing `reply-helpers.test.ts` assertions checked `text`/`formatted` return values, they still resolve to `undefined` (void) — adjust only if a test asserted a specific resolved value.

- [ ] **Step 8: Typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/chat/mattermost/ tests/chat/mattermost/
git commit -m "feat(mattermost): self-removing prompt post + ephemeral confirmation"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full chat suite**

Run: `bun test tests/chat/ --parallel`
Expected: PASS.

- [ ] **Step 2: Run lint, typecheck, format, knip (catches the removed `formatPermissionDecisionText` export and any unused symbols)**

Run: `bun lint && bun typecheck && bun knip`
Expected: PASS. `knip` must not report `formatPermissionDecisionText` or any newly-orphaned export.

- [ ] **Step 3: Run the full server suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 4: Commit any incidental fixes**

```bash
git add -A
git commit -m "test(chat): full-suite verification for ephemeral permission prompts"
```

---

## Self-Review notes

- **Spec coverage:** `messages.ephemeral` capability (Task 1, 4–6); `PromptHandle` + `buttons` return + `ephemeralConfirm` (Task 1); store handle / timeout redact / resolve returns handle (Task 2); capability-aware delete + tool-named ephemeral confirm with edit-in-place fallback (Task 3); per-adapter Telegram/Discord/Mattermost mappings (Tasks 4–6); Kontur Talk unchanged fallback (noted in File Structure + Task 1 reasoning). Consistency between capability and `ephemeralConfirm` is asserted per-adapter (metadata tests in 4–6 + the wiring tests).
- **Type consistency:** `PromptHandle` (`redact`/`remove`) is used identically across core and all adapters; `resolvePermissionRequest` returns `{ resolved, handle? }` consumed by `finalizePermissionDecision`; `ephemeralConfirm(text)` signature is identical everywhere; `formatDecisionConfirmation(toolName, decision)` is the single confirmation-text source.
- **Kontur Talk:** its `buttons` rejects (`Promise<never>`), which remains assignable to `Promise<PromptHandle | undefined>` — no change needed and `ask`-gated prompts there behave exactly as today (time out → auto-deny; no `ephemeralConfirm`, so the fallback path applies).
