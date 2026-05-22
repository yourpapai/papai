<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Sensitive Message Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-delete user messages containing sensitive data during `/setup` or `/config` on platforms that support it, and warn users on platforms that don't.

**Architecture:** Add a `messages.delete` capability and `deleteMessage` method to the chat layer. Extend config-editor and wizard result types with an `isSensitiveKey` flag. Integration layers attempt deletion or append warnings based on capability detection. Bot confirmation messages mask sensitive values instead of echoing plaintext.

**Tech Stack:** TypeScript, Bun, Grammy (Telegram), discord.js, Mattermost REST API, Zod v4

**Design Spec:** `docs/superpowers/specs/2026-04-18-sensitive-message-cleanup-design.md`

---

## File Structure

| File                                    | Responsibility                                   |
| --------------------------------------- | ------------------------------------------------ |
| `src/chat/types.ts`                     | `ChatCapability` union, `ReplyFn` partial type   |
| `src/chat/capabilities.ts`              | Capability query helpers                         |
| `src/config.ts`                         | `isSensitiveKey()` export                        |
| `src/config-editor/types.ts`            | `EditorProcessResult` type with `isSensitiveKey` |
| `src/config-editor/handlers.ts`         | Masked confirmation, `isSensitiveKey` flag       |
| `src/wizard/types.ts`                   | `WizardProcessResult` type with `isSensitiveKey` |
| `src/wizard/engine.ts`                  | `isSensitiveKey` flag on wizard results          |
| `src/chat/config-editor-integration.ts` | Delete-or-warn coordination for config editor    |
| `src/wizard-integration.ts`             | Delete-or-warn coordination for wizard           |
| `src/bot.ts`                            | Pass `messageId` to integration functions        |
| `src/commands/setup.ts`                 | Upfront warning when platform lacks delete       |
| `src/commands/config.ts`                | Upfront warning when platform lacks delete       |
| `src/chat/mattermost/reply-helpers.ts`  | `deleteMessage` on ReplyFn                       |
| `src/chat/mattermost/metadata.ts`       | Declare `messages.delete` capability             |

---

### Task 1: Export `isSensitiveKey` helper from config

**Files:**

- Modify: `src/config.ts:7-8`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `tests/config.test.ts` after the existing `maskValue` describe block (after line 134):

```typescript
describe('isSensitiveKey', () => {
  test('returns true for sensitive keys', () => {
    expect(isSensitiveKey('kaneo_apikey')).toBe(true)
    expect(isSensitiveKey('youtrack_token')).toBe(true)
    expect(isSensitiveKey('llm_apikey')).toBe(true)
  })

  test('returns false for non-sensitive keys', () => {
    expect(isSensitiveKey('llm_baseurl')).toBe(false)
    expect(isSensitiveKey('main_model')).toBe(false)
    expect(isSensitiveKey('small_model')).toBe(false)
    expect(isSensitiveKey('embedding_model')).toBe(false)
    expect(isSensitiveKey('timezone')).toBe(false)
  })
})
```

Add `isSensitiveKey` to the import from `'../src/config.js'` on line 6.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config.test.ts`
Expected: FAIL — `isSensitiveKey` is not exported from `src/config.ts`

- [ ] **Step 3: Write minimal implementation**

Add after line 7 in `src/config.ts` (after the `SENSITIVE_KEYS` declaration):

```typescript
export function isSensitiveKey(key: ConfigKey): boolean {
  return SENSITIVE_KEYS.has(key)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: export isSensitiveKey helper from config module"
```

---

### Task 2: Add `messages.delete` capability and `deleteMessage` to types

**Files:**

- Modify: `src/chat/types.ts:31-39` (ChatCapability union)
- Modify: `src/chat/types.ts:236-245` (ReplyFn partial)
- Modify: `src/chat/capabilities.ts`
- Modify: `tests/chat/capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/chat/capabilities.test.ts`. Add `supportsMessageDeletion` to the import from `'../../src/chat/capabilities.js'`. Add a new test inside the existing `describe` block:

```typescript
test('supportsMessageDeletion returns true when messages.delete is present', () => {
  expect(supportsMessageDeletion(withCapabilities(['messages.delete']))).toBe(true)
})

test('supportsMessageDeletion returns false when messages.delete is absent', () => {
  expect(supportsMessageDeletion(withCapabilities(['messages.buttons']))).toBe(false)
  expect(supportsMessageDeletion(withCapabilities([]))).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/capabilities.test.ts`
Expected: FAIL — `supportsMessageDeletion` is not exported

- [ ] **Step 3: Add capability to union type**

In `src/chat/types.ts`, add `'messages.delete'` to the `ChatCapability` union (after line 38, before the closing backtick of `users.resolve`):

```typescript
export type ChatCapability =
  | 'commands.menu'
  | 'interactions.callbacks'
  | 'messages.buttons'
  | 'messages.files'
  | 'messages.redact'
  | 'messages.reply-context'
  | 'files.receive'
  | 'users.resolve'
  | 'messages.delete'
```

In the same file, add `deleteMessage` to the `ReplyFn` partial type (after line 244, before the closing `}`):

```typescript
deleteMessage: (messageId: string) => Promise<void>
```

The `ReplyFn` partial should now read:

```typescript
} & Partial<{
  replaceText: ReplyTextFn
  file: ReplyFileFn
  redactMessage: RedactMessageFn
  replaceButtons: ReplyButtonsFn
  embed: ReplyEmbedFn
  deleteMessage: (messageId: string) => Promise<void>
}>
```

- [ ] **Step 4: Add capability helper**

In `src/chat/capabilities.ts`, add after the existing `supportsCommandMenu` function:

```typescript
export function supportsMessageDeletion(chat: WithCapabilities): boolean {
  return chat.capabilities.has('messages.delete')
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/chat/capabilities.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `bun typecheck`
Expected: PASS (no existing code calls `deleteMessage` yet, so adding it as optional partial is safe)

- [ ] **Step 7: Commit**

```bash
git add src/chat/types.ts src/chat/capabilities.ts tests/chat/capabilities.test.ts
git commit -m "feat: add messages.delete capability and deleteMessage to ReplyFn"
```

---

### Task 3: Implement `deleteMessage` in Mattermost adapter

**Files:**

- Modify: `src/chat/mattermost/metadata.ts`
- Modify: `src/chat/mattermost/reply-helpers.ts`

- [ ] **Step 1: Declare capability**

In `src/chat/mattermost/metadata.ts`, add `'messages.delete'` to the capability set:

```typescript
export const mattermostCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'messages.files',
  'messages.reply-context',
  'files.receive',
  'users.resolve',
  'messages.delete',
])
```

- [ ] **Step 2: Implement deleteMessage on ReplyFn**

In `src/chat/mattermost/reply-helpers.ts`, add `deleteMessage` to the returned `ReplyFn` object (after the `redactMessage` method, before `buttons`):

```typescript
    deleteMessage: async (messageId: string) => {
      await apiFetch('DELETE', `/api/v4/posts/${messageId}`, undefined).catch(() => undefined)
    },
```

Note: We pass `undefined` as body since DELETE requests have no body. The `.catch(() => undefined)` makes deletion best-effort (failures are silently swallowed at the adapter level — the integration layer will also log at warn level).

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/chat/mattermost/metadata.ts src/chat/mattermost/reply-helpers.ts
git commit -m "feat: implement deleteMessage in Mattermost adapter"
```

---

### Task 4: Add `isSensitiveKey` to config-editor result type and mask confirmation

**Files:**

- Modify: `src/config-editor/types.ts:43-48`
- Modify: `src/config-editor/handlers.ts:219-256`
- Modify: `tests/chat/config-editor-integration.test.ts`

- [ ] **Step 1: Extend the result type**

In `src/config-editor/types.ts`, add `isSensitiveKey` to `EditorProcessResult`:

```typescript
export interface EditorProcessResult {
  handled: boolean
  response?: string
  buttons?: EditorButton[]
  editOriginal?: boolean
  isSensitiveKey?: boolean
}
```

- [ ] **Step 2: Write the failing test**

Add to `tests/chat/config-editor-integration.test.ts` after the existing tests. Import `isSensitiveKey` is not needed at the test level — we test through the integration:

Add after the `'handles message when editor is active'` test:

```typescript
test('sets isSensitiveKey flag for sensitive key', async () => {
  startEditor(userId, storageContextId, 'llm_apikey')
  const { reply, buttonCalls } = createMockReply()

  const result = await handleConfigEditorMessage(userId, storageContextId, 'sk-test-api-key-12345', reply)
  expect(result).toBe(true)
  expect(buttonCalls.length).toBeGreaterThan(0)
  expect(buttonCalls[0]).not.toContain('sk-test-api-key-12345')
})
```

Update the imports at the top: add `createMockReply` to the import from `'../utils/test-helpers.js'`.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/chat/config-editor-integration.test.ts`
Expected: FAIL — the confirmation still echoes the raw value

- [ ] **Step 4: Mask value and set flag in handler**

In `src/config-editor/handlers.ts`, modify the `handleEditorMessage` function:

Add `isSensitiveKey` import at the top of the file (add to the import from `'../config.js'`):

```typescript
import { getConfig, maskValue, isSensitiveKey } from '../config.js'
```

Change the confirmation response at line 247-255 to mask sensitive values:

```typescript
const maskedOrRaw = isSensitiveKey(session.editingKey) ? maskValue(session.editingKey, text.trim()) : text.trim()

return {
  handled: true,
  response: `✏️ **${displayName}**\n\nNew value: \`${maskedOrRaw}\`\n\nSave this value?`,
  buttons: [
    { text: '❌ Cancel', action: 'cancel', style: 'danger' },
    { text: '⬅️ Back', action: 'back', style: 'secondary' },
    { text: `✅ Save ${emoji}`, action: 'save', key: session.editingKey, style: 'primary' },
  ],
  isSensitiveKey: isSensitiveKey(session.editingKey),
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/chat/config-editor-integration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/config-editor/types.ts src/config-editor/handlers.ts tests/chat/config-editor-integration.test.ts
git commit -m "feat: mask sensitive values in config editor confirmation, add isSensitiveKey flag"
```

---

### Task 5: Add `isSensitiveKey` to wizard result type and set flag

**Files:**

- Modify: `src/wizard/types.ts:49-54`
- Modify: `src/wizard/engine.ts`
- Modify: `tests/wizard-integration.test.ts`

- [ ] **Step 1: Extend the result type**

In `src/wizard/types.ts`, add `isSensitiveKey` to `WizardProcessResult`:

```typescript
export interface WizardProcessResult {
  handled: boolean
  response?: string
  requiresInput?: boolean
  buttons?: WizardButton[]
  isSensitiveKey?: boolean
}
```

- [ ] **Step 2: Write the failing test**

Add to `tests/wizard-integration.test.ts` after the existing tests:

```typescript
test('returns isSensitiveKey flag for sensitive wizard step', async () => {
  await createWizard(userId, storageContextId, 'kaneo')
  const { reply, textCalls } = createMockReply()

  const handled = await handleWizardMessage(userId, storageContextId, 'sk-test-api-key-12345', reply, false)
  expect(handled).toBe(true)
  expect(textCalls.length).toBeGreaterThan(0)
})
```

This test verifies the wizard handles a sensitive key input (the first step is `llm_apikey`) without error. The real assertion for the flag will be tested implicitly through the integration layer in Task 6.

- [ ] **Step 3: Set flag in wizard engine**

In `src/wizard/engine.ts`, the `processWizardMessage` function returns results from `advanceStep`. We need to propagate the sensitivity of the step that was just completed.

Modify the `processWizardMessage` function. After the `const result = await advanceStep(...)` call (around line 264), we need to check the _previous_ step (the one just completed). The session has already advanced, so we check `currentSession.currentStep - 1`:

First, add the import at the top:

```typescript
import { getAllConfig, isSensitiveKey, maskValue } from '../config.js'
```

Then in `processWizardMessage`, change the final return block. Replace the return statement at the end of the function (lines 264-278) with:

```typescript
const result = await advanceStep(userId, storageContextId, text)

const currentSession = getWizardSession(userId, storageContextId)
const completedStepIndex = currentSession !== null ? currentSession.currentStep - 1 : -1
const completedStep =
  currentSession !== null ? getStepByIndex(currentSession.taskProvider, completedStepIndex) : undefined
const stepIsSensitive = completedStep !== undefined && isSensitiveKey(completedStep.key)

if (currentSession !== null) {
  const currentStep = getStepByIndex(currentSession.taskProvider, currentSession.currentStep)
  if (currentStep !== null && currentStep !== undefined) {
    const skipButtons = buildSkipButtons(currentStep.key)
    if (skipButtons !== undefined) {
      return {
        handled: true,
        response: result.prompt,
        requiresInput: true,
        buttons: skipButtons,
        isSensitiveKey: stepIsSensitive,
      }
    }
  }
}

return { handled: true, response: result.prompt, requiresInput: true, isSensitiveKey: stepIsSensitive }
```

Remove the old `const currentSession = ...` block that was inside this function (lines 267-276) since we moved it up.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/wizard-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing wizard tests**

Run: `bun test tests/wizard/`
Expected: PASS — existing tests should not be affected since `isSensitiveKey` is an additive optional field

- [ ] **Step 6: Commit**

```bash
git add src/wizard/types.ts src/wizard/engine.ts tests/wizard-integration.test.ts
git commit -m "feat: add isSensitiveKey flag to wizard process results"
```

---

### Task 6: Implement delete-or-warn in config-editor integration

**Files:**

- Modify: `src/chat/config-editor-integration.ts`
- Modify: `tests/chat/config-editor-integration.test.ts`

- [ ] **Step 1: Write the failing test**

Add these tests to `tests/chat/config-editor-integration.test.ts`:

```typescript
test('calls deleteMessage when available and key is sensitive', async () => {
  startEditor(userId, storageContextId, 'llm_apikey')
  const deletedIds: string[] = []
  const reply: ReplyFn = {
    text: async (): Promise<void> => {},
    formatted: async (): Promise<void> => {},
    file: async (): Promise<void> => {},
    typing: (): void => {},
    buttons: async (): Promise<void> => {},
    deleteMessage: async (messageId: string): Promise<void> => {
      deletedIds.push(messageId)
    },
  }

  const result = await handleConfigEditorMessage(userId, storageContextId, 'sk-key', reply, 'msg-123')
  expect(result).toBe(true)
  expect(deletedIds).toEqual(['msg-123'])
})

test('appends warning when deleteMessage unavailable and key is sensitive', async () => {
  startEditor(userId, storageContextId, 'llm_apikey')
  const { reply, buttonCalls } = createMockReply()

  const result = await handleConfigEditorMessage(userId, storageContextId, 'sk-key', reply, 'msg-123')
  expect(result).toBe(true)
  expect(buttonCalls.length).toBeGreaterThan(0)
  expect(buttonCalls[0]).toContain('manually delete')
})

test('does not delete or warn for non-sensitive key', async () => {
  startEditor(userId, storageContextId, 'main_model')
  const deletedIds: string[] = []
  const reply: ReplyFn = {
    text: async (): Promise<void> => {},
    formatted: async (): Promise<void> => {},
    file: async (): Promise<void> => {},
    typing: (): void => {},
    buttons: async (): Promise<void> => {},
    deleteMessage: async (messageId: string): Promise<void> => {
      deletedIds.push(messageId)
    },
  }

  const result = await handleConfigEditorMessage(userId, storageContextId, 'gpt-4', reply, 'msg-456')
  expect(result).toBe(true)
  expect(deletedIds).toEqual([])
})
```

Add `ReplyFn` to the import from `'../../src/chat/types.js'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/config-editor-integration.test.ts`
Expected: FAIL — `handleConfigEditorMessage` doesn't accept `messageId` param

- [ ] **Step 3: Implement the integration**

Replace the contents of `src/chat/config-editor-integration.ts`:

```typescript
import { handleEditorMessage, hasActiveEditor, serializeCallbackData } from '../config-editor/index.js'
import { isSensitiveKey } from '../config.js'
import { logger } from '../logger.js'
import type { ChatButton, ReplyFn } from './types.js'

const log = logger.child({ scope: 'config-editor-integration' })

const SENSITIVE_DELETE_WARNING =
  '\n\n⚠️ This platform does not support automatic deletion of messages. Please manually delete your previous message containing the secret value.'

export async function handleConfigEditorMessage(
  userId: string,
  storageContextId: string,
  text: string,
  reply: ReplyFn,
  messageId?: string,
): Promise<boolean> {
  if (!hasActiveEditor(userId, storageContextId)) {
    return false
  }

  const result = handleEditorMessage(userId, storageContextId, text)

  if (result.handled) {
    let response = result.response ?? ''
    const isSensitive = result.isSensitiveKey === true

    if (isSensitive) {
      if (reply.deleteMessage !== undefined && messageId !== undefined) {
        try {
          await reply.deleteMessage(messageId)
          log.info({ userId, messageId }, 'Deleted user message containing sensitive config value')
        } catch (error) {
          log.warn(
            { userId, messageId, error: error instanceof Error ? error.message : String(error) },
            'Failed to delete user message with sensitive config value',
          )
        }
      } else {
        response += SENSITIVE_DELETE_WARNING
      }
    }

    const buttons = result.buttons
    if (buttons !== undefined && buttons.length > 0) {
      const chatButtons: ChatButton[] = buttons.map((btn) => ({
        text: btn.text,
        callbackData: serializeCallbackData(btn, storageContextId),
        style: btn.style ?? 'primary',
      }))
      await reply.buttons(response, { buttons: chatButtons })
    } else if (response !== '') {
      await reply.text(response)
    }
    return true
  }

  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/config-editor-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/config-editor-integration.ts tests/chat/config-editor-integration.test.ts
git commit -m "feat: delete or warn after sensitive config editor input"
```

---

### Task 7: Implement delete-or-warn in wizard integration

**Files:**

- Modify: `src/wizard-integration.ts`
- Modify: `tests/wizard-integration.test.ts`

- [ ] **Step 1: Write the failing test**

Add these tests to `tests/wizard-integration.test.ts`:

```typescript
test('calls deleteMessage when available and step is sensitive', async () => {
  await createWizard(userId, storageContextId, 'kaneo')
  const deletedIds: string[] = []
  const reply: ReplyFn = {
    ...createMockReply().reply,
    deleteMessage: async (messageId: string): Promise<void> => {
      deletedIds.push(messageId)
    },
  }

  const handled = await handleWizardMessage(
    userId,
    storageContextId,
    'sk-test-api-key',
    reply,
    false,
    undefined,
    'msg-789',
  )
  expect(handled).toBe(true)
  expect(deletedIds).toEqual(['msg-789'])
})

test('appends warning when deleteMessage unavailable and step is sensitive', async () => {
  await createWizard(userId, storageContextId, 'kaneo')
  const { reply, textCalls } = createMockReply()

  const handled = await handleWizardMessage(
    userId,
    storageContextId,
    'sk-test-api-key',
    reply,
    false,
    undefined,
    'msg-789',
  )
  expect(handled).toBe(true)
  expect(textCalls.length).toBeGreaterThan(0)
  expect(textCalls[0]).toContain('manually delete')
})
```

Add `ReplyFn` to the import from `'../src/chat/types.js'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/wizard-integration.test.ts`
Expected: FAIL — `handleWizardMessage` doesn't accept `messageId` param

- [ ] **Step 3: Implement the integration**

Replace the contents of `src/wizard-integration.ts`:

```typescript
import type { ReplyFn } from './chat/types.js'
import { isSensitiveKey } from './config.js'
import { logger } from './logger.js'
import { hasActiveWizard, processWizardMessage } from './wizard/index.js'

const log = logger.child({ scope: 'wizard-integration' })

const SENSITIVE_DELETE_WARNING =
  '\n\n⚠️ This platform does not support automatic deletion of messages. Please manually delete your previous message containing the secret value.'

export async function handleWizardMessage(
  userId: string,
  storageContextId: string,
  text: string,
  reply: ReplyFn,
  supportsInteractiveButtons: boolean,
  targetContextId?: string,
  messageId?: string,
): Promise<boolean> {
  if (!hasActiveWizard(userId, storageContextId)) {
    return false
  }

  const wizardResult = await processWizardMessage(userId, storageContextId, text)

  if (wizardResult.handled) {
    let response = wizardResult.response ?? ''
    const isSensitive = wizardResult.isSensitiveKey === true

    if (isSensitive) {
      if (reply.deleteMessage !== undefined && messageId !== undefined) {
        try {
          await reply.deleteMessage(messageId)
          log.info({ userId, messageId }, 'Deleted user message containing sensitive wizard value')
        } catch (error) {
          log.warn(
            { userId, messageId, error: error instanceof Error ? error.message : String(error) },
            'Failed to delete user message with sensitive wizard value',
          )
        }
      } else {
        response += SENSITIVE_DELETE_WARNING
      }
    }

    const buttons = wizardResult.buttons
    const shouldShowButtons = supportsInteractiveButtons && buttons !== undefined && buttons.length > 0
    if (shouldShowButtons && buttons !== undefined) {
      const chatButtons: import('./chat/types.js').ChatButton[] = buttons.map((btn) => {
        let style: 'primary' | 'secondary' | 'danger' = 'primary'
        if (btn.action === 'cancel') {
          style = 'danger'
        } else if (btn.action === 'skip_small_model' || btn.action === 'skip_embedding') {
          style = 'secondary'
        }
        const contextSuffix =
          targetContextId === undefined ? '' : `@${Buffer.from(targetContextId).toString('base64url')}`
        return {
          text: btn.text,
          callbackData: `wizard_${btn.action}${contextSuffix}`,
          style,
        }
      })
      await reply.buttons(response, { buttons: chatButtons })
    } else if (response !== '') {
      await reply.text(response)
    }
    return true
  }

  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/wizard-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wizard-integration.ts tests/wizard-integration.test.ts
git commit -m "feat: delete or warn after sensitive wizard input"
```

---

### Task 8: Pass `messageId` from bot.ts to integration functions

**Files:**

- Modify: `src/bot.ts:251-257`

- [ ] **Step 1: Update bot.ts call sites**

In `src/bot.ts`, update `maybeHandleSetupFlows` to pass `msg.messageId` to both integration functions.

Change line 253 from:

```typescript
if (await handleConfigEditorMessage(msg.user.id, settingsTargetContextId, msg.text, reply)) return true
```

to:

```typescript
if (await handleConfigEditorMessage(msg.user.id, settingsTargetContextId, msg.text, reply, msg.messageId)) return true
```

Change line 254 from:

```typescript
if (
  await handleWizardMessage(
    msg.user.id,
    settingsTargetContextId,
    msg.text,
    reply,
    interactiveButtons,
    settingsTargetContextId,
  )
)
  return true
```

to:

```typescript
if (
  await handleWizardMessage(
    msg.user.id,
    settingsTargetContextId,
    msg.text,
    reply,
    interactiveButtons,
    settingsTargetContextId,
    msg.messageId,
  )
)
  return true
```

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/bot.ts
git commit -m "feat: pass messageId to setup flow integration functions"
```

---

### Task 9: Add upfront warning in `/setup` and `/config` commands

**Files:**

- Modify: `src/commands/setup.ts`
- Modify: `src/commands/config.ts`

- [ ] **Step 1: Add warning to setup command**

In `src/commands/setup.ts`:

Add `supportsMessageDeletion` to the import from `'../chat/capabilities.js'`.

Add a constant after the existing `GROUP_SETUP_ADMIN_ONLY` constant:

```typescript
const NO_DELETE_WARNING =
  '⚠️ This platform does not support automatic deletion of messages containing secrets. Please manually delete your messages after entering API keys and tokens.\n\n'
```

In `startSetupForTarget`, before the `deps.createWizard(...)` call (line 90), add the warning check:

```typescript
if (!supportsMessageDeletion({ capabilities: chatCapabilities })) {
  await reply.text(NO_DELETE_WARNING)
}
```

Wait — `startSetupForTarget` doesn't have access to the chat provider. The warning needs to be sent from the command handler where `chat` is available.

In `registerSetupCommand`, inside the handler, before the `await replyWithSetupSelection(...)` call (line 129), add the chat as a module-level reference. Instead, the better approach: pass the capability check result to `replyWithSetupSelection` and `startSetupForTarget`.

Actually the simplest approach: the handler has `chat` in scope. Send the warning right before `replyWithSetupSelection`:

Change the handler to:

```typescript
const handler: CommandHandler = async (msg, reply, auth) => {
  if (!auth.allowed) {
    await reply.text('You are not authorized to use this bot.')
    return
  }

  if (msg.contextType === 'group') {
    await reply.text(auth.isGroupAdmin ? GROUP_SETUP_REDIRECT : GROUP_SETUP_ADMIN_ONLY)
    return
  }

  log.info({ userId: msg.user.id, contextId: auth.storageContextId }, '/setup command executed')
  if (!supportsMessageDeletion(chat)) {
    await reply.text(NO_DELETE_WARNING)
  }
  await replyWithSetupSelection(reply, msg.user.id, supportsInteractiveButtons(chat))
}
```

- [ ] **Step 2: Add warning to config command**

In `src/commands/config.ts`:

Add `supportsMessageDeletion` to the import from `'../chat/capabilities.js'`.

Add a constant after the existing `GROUP_CONFIG_ADMIN_ONLY` constant:

```typescript
const NO_DELETE_WARNING =
  '⚠️ This platform does not support automatic deletion of messages containing secrets. Please manually delete your messages after entering API keys and tokens.\n\n'
```

In `registerConfigCommand`, inside the handler, before `replyWithConfigSelection` (line 116), add the check:

```typescript
if (!supportsMessageDeletion(chat)) {
  await reply.text(NO_DELETE_WARNING)
}
```

- [ ] **Step 3: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/setup.ts src/commands/config.ts
git commit -m "feat: add upfront warning on platforms without message deletion"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `bun lint`
Expected: PASS

- [ ] **Step 4: Run format check**

Run: `bun format:check`
Expected: PASS
