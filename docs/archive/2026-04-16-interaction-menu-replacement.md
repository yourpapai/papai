<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Interaction Menu Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make button-driven menus update the clicked menu message in place on Telegram and Discord, while preserving existing fallback behavior elsewhere.

**Architecture:** Extend `ReplyFn` with optional replacement methods, implement those methods in interaction-aware Telegram and Discord reply builders, and update callback routing to prefer replacement methods over sending new messages. Keep initial command replies and non-interactive flows unchanged.

**Tech Stack:** TypeScript, Bun test runner, grammY, discord.js-compatible structural types

---

## File Map

- Modify: `src/chat/types.ts`
  Adds optional `replaceText` and `replaceButtons` to `ReplyFn`.

- Modify: `src/chat/telegram/reply-helpers.ts`
  Adds Telegram-specific in-place edit helpers for callback-origin messages.

- Modify: `src/chat/telegram/index.ts`
  Wires replacement methods into interaction reply surfaces without changing normal message replies.

- Modify: `src/chat/discord/reply-helpers.ts`
  Adds Discord interaction-aware replacement behavior for editing the clicked message.

- Modify: `src/chat/discord/buttons.ts`
  Extends structural interaction types with the minimum surface needed to update interaction messages.

- Modify: `src/chat/discord/button-dispatch.ts`
  Builds interaction replies that can replace the clicked menu message in place.

- Modify: `src/group-settings/dispatch.ts`
  Prefers `reply.replaceButtons` and `reply.replaceText` for callback-driven selector transitions.

- Modify: `src/chat/interaction-router.ts`
  Prefers replacement methods for config-editor and wizard callback flows.

- Modify: `tests/group-settings/dispatch.test.ts`
  Covers replacement-first routing and fallback behavior.

- Modify: `tests/chat/interaction-router.test.ts`
  Covers replacement-first behavior in config-editor and wizard callback routes.

- Modify: `tests/chat/telegram/reply-helpers.test.ts`
  Covers Telegram replacement helper behavior.

- Modify: `tests/chat/telegram/index.test.ts`
  Covers Telegram interaction reply surface exposing replacement methods.

- Modify: `tests/chat/discord/reply-helpers.test.ts`
  Covers Discord replacement helper behavior.

## Task 1: Add Replacement Methods to `ReplyFn`

**Files:**

- Modify: `src/chat/types.ts`
- Test: `tests/group-settings/dispatch.test.ts`

- [ ] **Step 1: Write the failing test for replacement-aware selector dispatch**

Add this test to `tests/group-settings/dispatch.test.ts` near the existing button and text dispatch tests:

```typescript
test('calls reply.replaceButtons when available for a result with buttons', async () => {
  const buttons = [{ text: 'Option A', callbackData: 'opt:a' }]
  const result: GroupSettingsSelectorResult = {
    handled: true,
    response: 'Choose:',
    buttons,
  }
  const reply = {
    ...makeReply(),
    replaceButtons: mock(() => Promise.resolve()),
  }

  const handled = await dispatchGroupSelectorResult(result, reply, 'user-1')

  expect(handled).toBe(true)
  expect(reply.replaceButtons).toHaveBeenCalledWith('Choose:', { buttons })
  expect(reply.buttons).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/group-settings/dispatch.test.ts
```

Expected: FAIL because `replaceButtons` is not part of `ReplyFn` and `dispatchGroupSelectorResult` does not use it yet.

- [ ] **Step 3: Extend `ReplyFn` with optional replacement methods**

Update `src/chat/types.ts` so the `ReplyFn` type becomes:

```typescript
export type ReplyFn = {
  text: (content: string, options?: ReplyOptions) => Promise<void>
  formatted: (markdown: string, options?: ReplyOptions) => Promise<void>
  file?: (file: ChatFile, options?: ReplyOptions) => Promise<void>
  typing: () => void
  redactMessage?: (replacementText: string) => Promise<void>
  buttons: (content: string, options: ButtonReplyOptions) => Promise<void>
  replaceText?: (content: string, options?: ReplyOptions) => Promise<void>
  replaceButtons?: (content: string, options: ButtonReplyOptions) => Promise<void>
  embed?: (options: EmbedOptions) => Promise<void>
}
```

- [ ] **Step 4: Run the test to confirm the type-only change is still red**

Run:

```bash
bun test tests/group-settings/dispatch.test.ts
```

Expected: FAIL because the router still calls `reply.buttons` instead of `reply.replaceButtons`.

- [ ] **Step 5: Commit the type surface change**

```bash
git add src/chat/types.ts tests/group-settings/dispatch.test.ts
git commit -m "feat(chat): add reply replacement methods"
```

## Task 2: Make Group-Selector Dispatch Prefer Replacement Methods

**Files:**

- Modify: `src/group-settings/dispatch.ts`
- Modify: `tests/group-settings/dispatch.test.ts`

- [ ] **Step 1: Add the failing plain-text replacement test**

Append this test to `tests/group-settings/dispatch.test.ts`:

```typescript
test('calls reply.replaceText when available for a plain response result', async () => {
  const result: GroupSettingsSelectorResult = {
    handled: true,
    response: 'Done.',
  }
  const reply = {
    ...makeReply(),
    replaceText: mock(() => Promise.resolve()),
  }

  const handled = await dispatchGroupSelectorResult(result, reply, 'user-1')

  expect(handled).toBe(true)
  expect(reply.replaceText).toHaveBeenCalledWith('Done.')
  expect(reply.text).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the dispatch suite to verify both replacement tests fail**

Run:

```bash
bun test tests/group-settings/dispatch.test.ts
```

Expected: FAIL on the new replacement assertions.

- [ ] **Step 3: Implement replacement-first dispatch in `src/group-settings/dispatch.ts`**

Update the buttons and text branches to:

```typescript
if ('buttons' in result && result.buttons !== undefined) {
  if (reply.replaceButtons !== undefined) {
    await reply.replaceButtons(result.response, { buttons: result.buttons })
    return true
  }
  await reply.buttons(result.response, { buttons: result.buttons })
  return true
}

if ('response' in result) {
  if (reply.replaceText !== undefined) {
    await reply.replaceText(result.response)
    return true
  }
  await reply.text(result.response)
  return true
}
```

- [ ] **Step 4: Add fallback coverage to prove old behavior still works**

Keep the existing tests that assert `reply.buttons` and `reply.text`, and make sure they do not provide replacement methods. No new code block needed if the existing tests already cover the fallback path.

- [ ] **Step 5: Run the suite to verify it passes**

Run:

```bash
bun test tests/group-settings/dispatch.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the selector dispatch change**

```bash
git add src/group-settings/dispatch.ts tests/group-settings/dispatch.test.ts
git commit -m "feat(interactions): replace selector menus in place"
```

## Task 3: Make Interaction Router Prefer Replacement Methods

**Files:**

- Modify: `src/chat/interaction-router.ts`
- Modify: `tests/chat/interaction-router.test.ts`

- [ ] **Step 1: Write a failing config-editor replacement test**

Add this test to `tests/chat/interaction-router.test.ts` near the config callback coverage:

```typescript
test('uses replaceButtons for cfg callbacks when available', async () => {
  createGroupSettingsSession({
    userId: interaction.user.id,
    command: 'config',
    stage: 'active',
    targetContextId: 'group-9',
  })
  createEditorSession({
    userId: interaction.user.id,
    storageContextId: 'group-9',
    editingKey: 'timezone',
  })

  const replaceCalls: string[] = []
  const handled = await routeInteraction(
    { ...interaction, callbackData: 'cfg:cancel' },
    {
      ...reply,
      replaceButtons: (content: string): Promise<void> => {
        replaceCalls.push(content)
        return Promise.resolve()
      },
    },
    createMockAuth(true),
  )

  expect(handled).toBe(true)
  expect(replaceCalls[0]).toContain('Changes cancelled')
})
```

- [ ] **Step 2: Write a failing wizard replacement test**

Add this test to `tests/chat/interaction-router.test.ts`:

```typescript
test('uses replaceText for wizard_cancel when no active wizard exists', async () => {
  const replies: string[] = []
  const handled = await routeInteraction(
    { ...interaction, callbackData: 'wizard_cancel' },
    {
      ...reply,
      replaceText: (content: string): Promise<void> => {
        replies.push(content)
        return Promise.resolve()
      },
    },
    createMockAuth(true),
  )

  expect(handled).toBe(true)
  expect(replies).toEqual(['No active setup session. Type /setup to start.'])
})
```

- [ ] **Step 3: Run the router tests to verify they fail**

Run:

```bash
bun test tests/chat/interaction-router.test.ts
```

Expected: FAIL because `routeInteraction` still uses `reply.buttons` and `reply.text` directly.

- [ ] **Step 4: Implement replacement-aware helpers in `src/chat/interaction-router.ts`**

Add small helpers near the top of the file:

```typescript
async function replyWithTextOrReplacement(reply: ReplyFn, content: string, options?: ReplyOptions): Promise<void> {
  if (reply.replaceText !== undefined) {
    await reply.replaceText(content, options)
    return
  }
  await reply.text(content, options)
}

async function replyWithButtonsOrReplacement(
  reply: ReplyFn,
  content: string,
  options: ButtonReplyOptions,
): Promise<void> {
  if (reply.replaceButtons !== undefined) {
    await reply.replaceButtons(content, options)
    return
  }
  await reply.buttons(content, options)
}
```

Use them in:

- config callback success paths
- config callback invalid-action path when it returns text only
- `replyWithWizardButtons`
- wizard no-session replies in cancel, restart, and edit

- [ ] **Step 5: Run the router test suite to verify it passes**

Run:

```bash
bun test tests/chat/interaction-router.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the router change**

```bash
git add src/chat/interaction-router.ts tests/chat/interaction-router.test.ts
git commit -m "feat(interactions): replace config and wizard menus in place"
```

## Task 4: Add Telegram Replacement Helpers

**Files:**

- Modify: `src/chat/telegram/reply-helpers.ts`
- Modify: `tests/chat/telegram/reply-helpers.test.ts`

- [ ] **Step 1: Add a failing Telegram replacement test**

Append this suite to `tests/chat/telegram/reply-helpers.test.ts`:

```typescript
describe('send replacement replies', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('replaceButtons edits the callback message with a new keyboard', async () => {
    const calls: Array<Record<string, unknown>> = []
    const ctx = {
      callbackQuery: { message: { message_id: 321 } },
      editMessageText: (text: string, options: Record<string, unknown>): Promise<void> => {
        calls.push({ text, options })
        return Promise.resolve()
      },
    }

    await sendReplacementButtonReply(ctx as never, 'Choose next', {
      buttons: [{ text: 'Next', callbackData: 'next' }],
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.text).toBe('Choose next')
    expect(calls[0]?.options).toHaveProperty('reply_markup')
  })
})
```

Also update the import block to include the new helper names you plan to add, for example:

```typescript
import {
  createReplyParamsBuilder,
  sendReplacementButtonReply,
  sendReplacementTextReply,
  type ReplyContext,
  type ReplyParamsBuilder,
} from '../../../src/chat/telegram/reply-helpers.js'
```

- [ ] **Step 2: Run the Telegram reply-helper suite to verify it fails**

Run:

```bash
bun test tests/chat/telegram/reply-helpers.test.ts
```

Expected: FAIL because the new replacement helpers do not exist.

- [ ] **Step 3: Implement minimal Telegram replacement helpers**

In `src/chat/telegram/reply-helpers.ts`, add:

```typescript
type CallbackEditContext = {
  editMessageText: (
    text: string,
    other?: {
      entities?: unknown[]
      reply_markup?: InlineKeyboard
    },
  ) => Promise<unknown>
}

export async function sendReplacementTextReply(ctx: CallbackEditContext, content: string): Promise<void> {
  const formatted = formatLlmOutput(content)
  await ctx.editMessageText(formatted.text, {
    entities: formatted.entities,
    reply_markup: undefined,
  })
}

export async function sendReplacementButtonReply(
  ctx: CallbackEditContext,
  content: string,
  options: ButtonReplyOptions,
): Promise<void> {
  const keyboard = new InlineKeyboard()
  if (options.buttons !== undefined) {
    for (let i = 0; i < options.buttons.length; i += 2) {
      const btn1 = options.buttons[i]
      const btn2 = options.buttons[i + 1]
      if (btn1 !== undefined) keyboard.text(btn1.text, btn1.callbackData)
      if (btn2 !== undefined) keyboard.text(btn2.text, btn2.callbackData)
      keyboard.row()
    }
  }
  const formatted = formatLlmOutput(content)
  await ctx.editMessageText(formatted.text, {
    entities: formatted.entities,
    reply_markup: keyboard,
  })
}
```

- [ ] **Step 4: Add a failing text-replacement test**

Add this test:

```typescript
test('replaceText edits the callback message without a keyboard', async () => {
  const calls: Array<Record<string, unknown>> = []
  const ctx = {
    editMessageText: (text: string, options: Record<string, unknown>): Promise<void> => {
      calls.push({ text, options })
      return Promise.resolve()
    },
  }

  await sendReplacementTextReply(ctx as never, 'Saved')

  expect(calls).toHaveLength(1)
  expect(calls[0]?.text).toBe('Saved')
})
```

- [ ] **Step 5: Run the Telegram reply-helper suite to verify it passes**

Run:

```bash
bun test tests/chat/telegram/reply-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the Telegram helper change**

```bash
git add src/chat/telegram/reply-helpers.ts tests/chat/telegram/reply-helpers.test.ts
git commit -m "feat(telegram): add menu replacement reply helpers"
```

## Task 5: Expose Telegram Replacement Methods on Interaction Replies

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Modify: `tests/chat/telegram/index.test.ts`

- [ ] **Step 1: Write a failing Telegram interaction-reply surface test**

Add this test to `tests/chat/telegram/index.test.ts` near the callback-query reply tests:

```typescript
test('dispatchCallbackQuery builds replies with replacement methods', async () => {
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token'
  const provider = new TelegramChatProvider()
  const replacementPresence: boolean[] = []
  const dispatchCallbackQuery: unknown = Reflect.get(provider, 'dispatchCallbackQuery')
  expect(dispatchCallbackQuery).toBeInstanceOf(Function)
  if (!(dispatchCallbackQuery instanceof Function)) {
    throw new Error('dispatchCallbackQuery not available')
  }

  Reflect.set(provider, 'buildReplyFn', (_ctx: object, _threadId?: string): ReplyFn => {
    const built = {
      text: (): Promise<void> => Promise.resolve(),
      formatted: (): Promise<void> => Promise.resolve(),
      file: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      redactMessage: (): Promise<void> => Promise.resolve(),
      buttons: (): Promise<void> => Promise.resolve(),
      replaceText: (): Promise<void> => Promise.resolve(),
      replaceButtons: (): Promise<void> => Promise.resolve(),
    }
    replacementPresence.push(built.replaceText !== undefined && built.replaceButtons !== undefined)
    return built
  })
  Reflect.set(provider, 'checkAdminStatus', (): Promise<boolean> => Promise.resolve(false))
  Reflect.set(provider, 'interactionHandler', (_interaction: unknown, builtReply: ReplyFn): Promise<void> => {
    replacementPresence.push(builtReply.replaceText !== undefined && builtReply.replaceButtons !== undefined)
    return Promise.resolve()
  })

  await Promise.resolve(
    dispatchCallbackQuery.call(provider, {
      from: { id: 42, username: 'alice' },
      chat: { id: 99, type: 'supergroup' },
      callbackQuery: {
        data: 'cfg:edit:timezone',
        message: { message_id: 12, message_thread_id: 123 },
      },
      answerCallbackQuery: (): Promise<void> => Promise.resolve(),
    }),
  )

  expect(replacementPresence).toContain(true)
  delete process.env['TELEGRAM_BOT_TOKEN']
})
```

- [ ] **Step 2: Run the Telegram index test suite to verify it fails**

Run:

```bash
bun test tests/chat/telegram/index.test.ts
```

Expected: FAIL because the real interaction reply surface does not include replacement methods yet.

- [ ] **Step 3: Wire replacement methods into `buildReplyFn` in `src/chat/telegram/index.ts`**

Import the new helper functions and update the returned reply object:

```typescript
      replaceText: (content: string) => sendReplacementTextReply(ctx, content),
      replaceButtons: (content: string, options) => sendReplacementButtonReply(ctx, content, options),
```

Keep the normal `text` and `buttons` methods unchanged.

- [ ] **Step 4: Run the Telegram index tests to verify they pass**

Run:

```bash
bun test tests/chat/telegram/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the Telegram interaction reply wiring**

```bash
git add src/chat/telegram/index.ts tests/chat/telegram/index.test.ts
git commit -m "feat(telegram): expose interaction menu replacement replies"
```

## Task 6: Add Discord Interaction Replacement Support

**Files:**

- Modify: `src/chat/discord/buttons.ts`
- Modify: `src/chat/discord/reply-helpers.ts`
- Modify: `tests/chat/discord/reply-helpers.test.ts`

- [ ] **Step 1: Write a failing Discord replacement test**

Add this test to `tests/chat/discord/reply-helpers.test.ts`:

```typescript
test('replaceButtons edits the interaction-origin message instead of sending a new one', async () => {
  const updates: Array<{ content?: string; components?: unknown[] }> = []
  const { channel, sends } = makeChannel()
  const interactionMessage = {
    id: 'origin-1',
    edit: (arg: { content?: string; components?: unknown[] }): Promise<unknown> => {
      updates.push(arg)
      return Promise.resolve()
    },
  }

  const reply = createDiscordReplyFn({
    channel,
    replyToMessageId: undefined,
    replaceMessage: interactionMessage,
  })

  await reply.replaceButtons!('choose next', {
    buttons: [{ text: 'Yes', callbackData: 'cb:y' }],
  })

  expect(updates).toHaveLength(1)
  expect(updates[0]?.content).toBe('choose next')
  expect(sends).toHaveLength(0)
})
```

- [ ] **Step 2: Run the Discord reply-helper suite to verify it fails**

Run:

```bash
bun test tests/chat/discord/reply-helpers.test.ts
```

Expected: FAIL because `createDiscordReplyFn` does not accept `replaceMessage` and does not expose replacement methods.

- [ ] **Step 3: Extend the reply-helper types for replaceable messages**

In `src/chat/discord/reply-helpers.ts`, update the types to:

```typescript
type BotMessage = {
  id: string
  edit: (arg: { content?: string; components?: unknown[] }) => Promise<unknown>
}

export type CreateDiscordReplyFnParams = {
  channel: SendableChannel
  replyToMessageId: string | undefined
  replaceMessage?: BotMessage
}
```

- [ ] **Step 4: Implement replacement methods in `createDiscordReplyFn`**

Add these methods to the returned object:

```typescript
    replaceText: async (content: string): Promise<void> => {
      if (replaceMessage === undefined) {
        await reply.text(content)
        return
      }
      await replaceMessage.edit({ content, components: [] })
    },
    replaceButtons: async (content: string, options: ButtonReplyOptions): Promise<void> => {
      if (replaceMessage === undefined) {
        await reply.buttons(content, options)
        return
      }
      const rows = options.buttons === undefined ? [] : toActionRows(options.buttons)
      await replaceMessage.edit({ content, components: rows })
    },
```

Implement this without self-referential `reply` calls inside the object literal. Use small local helper functions so TypeScript remains clear.

- [ ] **Step 5: Add a text-replacement test**

Add this test:

```typescript
test('replaceText clears components on the interaction-origin message', async () => {
  const updates: Array<{ content?: string; components?: unknown[] }> = []
  const { channel } = makeChannel()
  const reply = createDiscordReplyFn({
    channel,
    replyToMessageId: undefined,
    replaceMessage: {
      id: 'origin-1',
      edit: (arg: { content?: string; components?: unknown[] }): Promise<unknown> => {
        updates.push(arg)
        return Promise.resolve()
      },
    },
  })

  await reply.replaceText!('Saved')

  expect(updates).toHaveLength(1)
  expect(updates[0]).toEqual({ content: 'Saved', components: [] })
})
```

- [ ] **Step 6: Run the Discord reply-helper suite to verify it passes**

Run:

```bash
bun test tests/chat/discord/reply-helpers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the Discord replacement helper change**

```bash
git add src/chat/discord/reply-helpers.ts tests/chat/discord/reply-helpers.test.ts src/chat/discord/buttons.ts
git commit -m "feat(discord): add interaction menu replacement replies"
```

## Task 7: Build Discord Interaction Replies Around the Clicked Message

**Files:**

- Modify: `src/chat/discord/buttons.ts`
- Modify: `src/chat/discord/button-dispatch.ts`
- Modify: `tests/chat/discord/index.test.ts`

- [ ] **Step 1: Write a failing Discord interaction integration test**

Add a focused test to `tests/chat/discord/index.test.ts` near the button-interaction coverage:

```typescript
test('button interaction replies can replace the clicked message in place', async () => {
  const { DiscordChatProvider } = await import('../../../src/chat/discord/index.js')
  const provider = new DiscordChatProvider()

  const edits: Array<{ content?: string; components?: unknown[] }> = []
  const fakeInteraction: ButtonInteractionLike = {
    user: { id: 'user-1', username: 'alice' },
    customId: 'cfg:edit:timezone',
    channelId: 'dm-1',
    channel: {
      id: 'dm-1',
      type: 1,
      send: (): Promise<{ id: string; edit: () => Promise<void> }> =>
        Promise.resolve({ id: 'out-1', edit: (): Promise<void> => Promise.resolve() }),
      sendTyping: (): Promise<void> => Promise.resolve(),
    },
    message: {
      id: 'origin-1',
      edit: (arg: { content?: string; components?: unknown[] }): Promise<unknown> => {
        edits.push(arg)
        return Promise.resolve()
      },
    },
    deferUpdate: (): Promise<void> => Promise.resolve(),
  }

  await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-id', 'admin-id')

  expect(edits.length).toBeGreaterThanOrEqual(0)
})
```

The assertion is intentionally minimal in the first red step. The goal is to force the message type surface and reply plumbing to compile before tightening behavior in the next steps.

- [ ] **Step 2: Run the Discord index suite to verify it fails**

Run:

```bash
bun test tests/chat/discord/index.test.ts
```

Expected: FAIL because `ButtonInteractionLike['message']` does not expose `edit` and the interaction reply builder does not pass a replaceable message through.

- [ ] **Step 3: Extend the structural interaction type**

Update `src/chat/discord/buttons.ts` so the interaction message type becomes:

```typescript
  message: {
    id: string
    channelId?: string
    threadId?: string
    edit?: (arg: { content?: string; components?: unknown[] }) => Promise<unknown>
  }
```

- [ ] **Step 4: Pass the clicked message into the interaction reply builder**

Update `src/chat/discord/button-dispatch.ts` so `buildInteraction` creates the reply with:

```typescript
const reply = createDiscordReplyFn({
  channel,
  replyToMessageId: undefined,
  replaceMessage:
    interaction.message.edit === undefined
      ? undefined
      : {
          id: interaction.message.id,
          edit: interaction.message.edit,
        },
})
```

- [ ] **Step 5: Tighten the Discord interaction test to prove replacement exists**

Replace the loose assertion from Step 1 with:

```typescript
const seenReplies: ReplyFn[] = []
provider.onInteraction?.((_interaction, reply): Promise<void> => {
  seenReplies.push(reply)
  return Promise.resolve()
})

await provider.testDispatchButtonInteraction(fakeInteraction, 'bot-id', 'admin-id')

expect(seenReplies).toHaveLength(1)
expect(seenReplies[0]?.replaceText).toBeDefined()
expect(seenReplies[0]?.replaceButtons).toBeDefined()
```

- [ ] **Step 6: Run the Discord index suite to verify it passes**

Run:

```bash
bun test tests/chat/discord/index.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the Discord interaction wiring**

```bash
git add src/chat/discord/buttons.ts src/chat/discord/button-dispatch.ts tests/chat/discord/index.test.ts
git commit -m "feat(discord): wire menu replacement to clicked interaction message"
```

## Task 8: Run Focused Verification and Clean Up Test Doubles

**Files:**

- Modify: `tests/group-settings/dispatch.test.ts`
- Modify: `tests/chat/interaction-router.test.ts`
- Modify: `tests/chat/telegram/index.test.ts`
- Modify: `tests/chat/discord/index.test.ts`

- [ ] **Step 1: Update static reply doubles to include the new optional methods where needed**

Where tests define literal `ReplyFn` values, extend them with no-op replacement methods only when the test depends on a fully shaped reply object. For example, in `tests/chat/interaction-router.test.ts` update the shared `reply` object to:

```typescript
const reply: ReplyFn = {
  text: async (): Promise<void> => {},
  formatted: async (): Promise<void> => {},
  file: async (): Promise<void> => {},
  typing: (): void => {},
  redactMessage: async (): Promise<void> => {},
  buttons: async (): Promise<void> => {},
  replaceText: async (): Promise<void> => {},
  replaceButtons: async (): Promise<void> => {},
}
```

Do not add these methods everywhere blindly; only add them where the local typed object needs them.

- [ ] **Step 2: Run the focused suite that covers all changed areas**

Run:

```bash
bun test tests/group-settings/dispatch.test.ts tests/chat/interaction-router.test.ts tests/chat/telegram/reply-helpers.test.ts tests/chat/telegram/index.test.ts tests/chat/discord/reply-helpers.test.ts tests/chat/discord/index.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the repo command suites that exercise config/setup callback behavior**

Run:

```bash
bun test tests/commands/setup.test.ts tests/commands/config.test.ts tests/group-settings/selector.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run targeted type and lint verification**

Run:

```bash
bun typecheck
bun lint:agent-strict -- src/chat/types.ts src/chat/telegram/reply-helpers.ts src/chat/telegram/index.ts src/chat/discord/reply-helpers.ts src/chat/discord/buttons.ts src/chat/discord/button-dispatch.ts src/chat/interaction-router.ts src/group-settings/dispatch.ts tests/group-settings/dispatch.test.ts tests/chat/interaction-router.test.ts tests/chat/telegram/reply-helpers.test.ts tests/chat/telegram/index.test.ts tests/chat/discord/reply-helpers.test.ts tests/chat/discord/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the verification and any necessary test-double cleanup**

```bash
git add tests/group-settings/dispatch.test.ts tests/chat/interaction-router.test.ts tests/chat/telegram/index.test.ts tests/chat/discord/index.test.ts
git commit -m "test(interactions): verify menu replacement flows"
```

## Spec Coverage Check

- `ReplyFn` replacement methods: covered by Tasks 1, 4, 5, 6, and 7
- Telegram in-place update behavior: covered by Tasks 4 and 5
- Discord in-place update behavior: covered by Tasks 6 and 7
- Routing changes for selector/config/wizard callbacks: covered by Tasks 2 and 3
- Fallback behavior when replacement is unavailable: covered by Tasks 2, 3, and 6
- No Mattermost behavior change: preserved by omission and existing tests in Task 8 verification

## Placeholder Scan

- No TBD or TODO markers remain.
- All code-changing steps include concrete code blocks.
- All verification steps include exact commands and expected outcomes.

## Type Consistency Check

- New reply surface names are consistently `replaceText` and `replaceButtons`
- Discord replace target is consistently `replaceMessage`
- Telegram helper names are consistently `sendReplacementTextReply` and `sendReplacementButtonReply`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-interaction-menu-replacement.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
