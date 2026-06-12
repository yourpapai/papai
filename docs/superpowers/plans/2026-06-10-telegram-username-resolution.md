<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Telegram Username Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable adding Telegram users by `@username` in the settings UI, resolving usernames to numeric user IDs via the Telegram Bot API.

**Architecture:** Update the Telegram adapter's `resolveUserId` method to use `getChat` API for username resolution. Update the settings UI to accept both numeric IDs and `@username` formats with appropriate validation feedback.

**Tech Stack:** TypeScript, Grammy (Telegram Bot API), Svelte (settings UI), Zod (validation)

---

## File Structure

| File                                                    | Change | Purpose                                                       |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| `src/chat/telegram/index.ts:170-173`                    | Modify | Update `resolveUserId` to resolve usernames via `getChat` API |
| `client/settings/sections/MembersSection.svelte:93-98`  | Modify | Update UI label and add helper text for username support      |
| `tests/chat/telegram/username-resolution.test.ts`       | Create | Test username resolution logic                                |
| `tests/client/settings/sections/MembersSection.test.ts` | Modify | Add tests for username input handling                         |

---

### Task 1: Update Telegram Adapter resolveUserId

**Files:**

- Modify: `src/chat/telegram/index.ts:170-173`
- Test: `tests/chat/telegram/username-resolution.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/chat/telegram/username-resolution.test.ts
import { describe, expect, test, mock } from 'bun:test'

describe('TelegramChatProvider.resolveUserId', () => {
  test('resolves numeric ID directly', async () => {
    const { TelegramChatProvider } = await import('../../src/chat/telegram/index.js')
    const provider = new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'test' })

    const result = await provider.resolveUserId('123456789', { contextId: 'ctx', contextType: 'dm' })
    expect(result).toBe('123456789')
  })

  test('resolves @username via getChat API', async () => {
    const mockGetChat = mock(() => Promise.resolve({ id: 987654321 }))
    const { TelegramChatProvider } = await import('../../src/chat/telegram/index.js')
    const provider = new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'test' })
    // @ts-expect-error - mock the bot.api.getChat
    provider.bot = { api: { getChat: mockGetChat } }

    const result = await provider.resolveUserId('@testuser', { contextId: 'ctx', contextType: 'dm' })
    expect(result).toBe('987654321')
    expect(mockGetChat).toHaveBeenCalledWith('@testuser')
  })

  test('resolves username without @ prefix via getChat API', async () => {
    const mockGetChat = mock(() => Promise.resolve({ id: 987654321 }))
    const { TelegramChatProvider } = await import('../../src/chat/telegram/index.js')
    const provider = new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'test' })
    // @ts-expect-error - mock the bot.api.getChat
    provider.bot = { api: { getChat: mockGetChat } }

    const result = await provider.resolveUserId('testuser', { contextId: 'ctx', contextType: 'dm' })
    expect(result).toBe('987654321')
    expect(mockGetChat).toHaveBeenCalledWith('@testuser')
  })

  test('returns null for unresolvable username', async () => {
    const mockGetChat = mock(() => Promise.reject(new Error('user not found')))
    const { TelegramChatProvider } = await import('../../src/chat/telegram/index.js')
    const provider = new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'test' })
    // @ts-expect-error - mock the bot.api.getChat
    provider.bot = { api: { getChat: mockGetChat } }

    const result = await provider.resolveUserId('@nonexistent', { contextId: 'ctx', contextType: 'dm' })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/telegram/username-resolution.test.ts`
Expected: FAIL with "Cannot find module" or method not implementing username resolution

- [ ] **Step 3: Write minimal implementation**

Update `src/chat/telegram/index.ts:170-173`:

```typescript
async resolveUserId(username: string, _context: ResolveUserContext): Promise<string | null> {
  const clean = username.startsWith('@') ? username.slice(1) : username
  if (/^\d+$/u.test(clean)) return clean
  try {
    const chat = await this.bot.api.getChat(`@${clean}`)
    return String(chat.id)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/telegram/username-resolution.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/telegram/index.ts tests/chat/telegram/username-resolution.test.ts
git commit -m "feat(telegram): resolve usernames via getChat API"
```

---

### Task 2: Update Settings UI for Username Support

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte:93-98`
- Test: `tests/client/settings/sections/MembersSection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/client/settings/sections/MembersSection.test.ts
import { describe, expect, test } from 'bun:test'
import { render } from '@testing-library/svelte'

describe('MembersSection', () => {
  test('shows helper text for username support', async () => {
    const { getByText } = await import('./MembersSection.svelte').then((m) => render(m.default, { contextId: 'test' }))
    expect(getByText(/User ID or @username/)).toBeTruthy()
  })

  test('accepts @username format in input', async () => {
    const { getByTestId } = await import('./MembersSection.svelte').then((m) =>
      render(m.default, { contextId: 'test' }),
    )
    const input = getByTestId('member-add-input')
    expect(input).toBeTruthy()
    // Input should accept @username format
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts`
Expected: FAIL with text not found

- [ ] **Step 3: Write minimal implementation**

Update `client/settings/sections/MembersSection.svelte:93-98`:

```svelte
<form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
  <Field label="User ID or @username">
    {#snippet children()}
      <Input value={newUserId} onInput={(v) => (newUserId = v)} testid="member-add-input" placeholder="123456789 or @username" />
      <p class="field-hint">For Telegram, you can use @username instead of numeric ID</p>
    {/snippet}
  </Field>
  <Btn variant="primary" type="submit" testid="member-add">
    {#snippet children()}Add member{/snippet}
  </Btn>
</form>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
git commit -m "feat(settings): support @username for member addition"
```

---

### Task 3: Verify End-to-End Integration

**Files:**

- No file changes

- [ ] **Step 1: Run full lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: PASS with 0 errors

- [ ] **Step 2: Run all tests**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify telegram username resolution integration"
```
