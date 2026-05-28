<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Telegram Command Publication Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram command publication derive from a canonical command manifest, add drift-prevention tests, and let DM `/config` and `/setup` target newly authorized groups immediately after `/group add`.

**Architecture:** Introduce one provider-agnostic command metadata catalog near `src/commands/`, use it to render Telegram Bot API command scopes, and add focused tests that compare the catalog against the registered command surface. Extend manageable-group discovery so authorized-but-unobserved groups are visible in the DM selector with ID fallback labels.

**Tech Stack:** TypeScript, Bun test runner, grammY Telegram Bot API integration, Drizzle-backed SQLite state, existing test helpers in `tests/utils/test-helpers.ts`

---

### Task 1: Add a Canonical Command Catalog

**Files:**

- Create: `src/commands/catalog.ts`
- Modify: `src/commands/index.ts`
- Test: `tests/commands/catalog.test.ts`

- [ ] **Step 1: Write the failing catalog test**

```typescript
import { describe, expect, test } from 'bun:test'

import { getCommandCatalogEntry, listCommandCatalogEntries } from '../../src/commands/catalog.js'

describe('command catalog', () => {
  test('contains the current papai command surface with Telegram publication metadata', () => {
    const names = listCommandCatalogEntries().map((entry) => entry.name)

    expect(names).toEqual([
      'help',
      'start',
      'setup',
      'config',
      'context',
      'clear',
      'group',
      'groups',
      'user',
      'users',
      'announce',
      'plugin',
    ])

    expect(getCommandCatalogEntry('help')).toMatchObject({
      name: 'help',
      telegram: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: true,
        publishInGroupAdmin: true,
      },
    })

    expect(getCommandCatalogEntry('setup')).toMatchObject({
      name: 'setup',
      telegram: {
        publishInDmUser: true,
        publishInDmAdmin: true,
        publishInGroupUser: false,
        publishInGroupAdmin: false,
      },
    })
  })
})
```

- [ ] **Step 2: Run the new catalog test and confirm failure**

Run: `bun test tests/commands/catalog.test.ts`

Expected: FAIL because `src/commands/catalog.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal command catalog module**

```typescript
// src/commands/catalog.ts
export type TelegramCommandVisibility = {
  readonly publishInDmUser: boolean
  readonly publishInDmAdmin: boolean
  readonly publishInGroupUser: boolean
  readonly publishInGroupAdmin: boolean
}

export type CommandCatalogEntry = {
  readonly name: string
  readonly description: string
  readonly telegram: TelegramCommandVisibility
}

const COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  {
    name: 'help',
    description: 'Show available commands',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: true,
      publishInGroupAdmin: true,
    },
  },
  {
    name: 'start',
    description: 'Show welcome and getting-started guidance',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'setup',
    description: 'Interactive configuration wizard',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'config',
    description: 'View or edit current configuration',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'context',
    description: 'Show current LLM context usage',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: true,
      publishInGroupAdmin: true,
    },
  },
  {
    name: 'clear',
    description: 'Clear conversation history and memory',
    telegram: {
      publishInDmUser: true,
      publishInDmAdmin: true,
      publishInGroupUser: true,
      publishInGroupAdmin: true,
    },
  },
  {
    name: 'group',
    description: 'Manage group authorization or membership',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: true,
      publishInGroupAdmin: true,
    },
  },
  {
    name: 'groups',
    description: 'List authorized groups',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'user',
    description: 'Manage users',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'users',
    description: 'List authorized users',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'announce',
    description: 'Send announcement to all authorized users',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
  {
    name: 'plugin',
    description: 'Manage plugins',
    telegram: {
      publishInDmUser: false,
      publishInDmAdmin: true,
      publishInGroupUser: false,
      publishInGroupAdmin: false,
    },
  },
] as const

export function listCommandCatalogEntries(): readonly CommandCatalogEntry[] {
  return COMMAND_CATALOG
}

export function getCommandCatalogEntry(name: string): CommandCatalogEntry {
  const entry = COMMAND_CATALOG.find((candidate) => candidate.name === name)
  if (entry === undefined) {
    throw new Error(`Unknown command catalog entry: ${name}`)
  }
  return entry
}
```

- [ ] **Step 4: Export the catalog helpers from the commands barrel**

```typescript
// src/commands/index.ts
export { getCommandCatalogEntry, listCommandCatalogEntries } from './catalog.js'
```

- [ ] **Step 5: Run the catalog test and confirm it passes**

Run: `bun test tests/commands/catalog.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the catalog foundation**

```bash
git add src/commands/catalog.ts src/commands/index.ts tests/commands/catalog.test.ts
git commit -m "feat(commands): add telegram publication catalog"
```

### Task 2: Add a Drift Test Against Bot Command Registration

**Files:**

- Modify: `tests/bot.test.ts`
- Test: `tests/bot.test.ts`

- [ ] **Step 1: Add a failing bot-level drift test**

```typescript
test('registered command handlers stay aligned with the command catalog', () => {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()

  setupBot(provider, 'admin-1', { processMessage: async () => {} })

  expect([...commandHandlers.keys()].toSorted()).toEqual([
    'announce',
    'clear',
    'config',
    'context',
    'group',
    'groups',
    'help',
    'plugin',
    'setup',
    'start',
    'user',
    'users',
  ])
})
```

- [ ] **Step 2: Run the focused bot test and confirm the initial failure mode**

Run: `bun test tests/bot.test.ts --test-name-pattern "registered command handlers stay aligned with the command catalog"`

Expected: FAIL first if the expected list or helper wiring is incomplete.

- [ ] **Step 3: Tighten the test to compare against the catalog instead of a duplicated list**

```typescript
import { listCommandCatalogEntries } from '../src/commands/catalog.js'

test('registered command handlers stay aligned with the command catalog', () => {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()

  setupBot(provider, 'admin-1', { processMessage: async () => {} })

  expect([...commandHandlers.keys()].toSorted()).toEqual(
    listCommandCatalogEntries()
      .map((entry) => entry.name)
      .toSorted(),
  )
})
```

- [ ] **Step 4: Run the focused bot test and confirm it passes**

Run: `bun test tests/bot.test.ts --test-name-pattern "registered command handlers stay aligned with the command catalog"`

Expected: PASS

- [ ] **Step 5: Commit the drift test**

```bash
git add tests/bot.test.ts
git commit -m "test(bot): lock command registration to catalog"
```

### Task 3: Make Telegram Command Publication Manifest-Driven

**Files:**

- Modify: `src/chat/telegram/commands.ts`
- Create: `tests/chat/telegram/commands.test.ts`
- Test: `tests/chat/telegram/commands.test.ts`

- [ ] **Step 1: Write the failing Telegram scope-generation test**

```typescript
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { registerTelegramCommands } from '../../../src/chat/telegram/commands.js'

describe('registerTelegramCommands', () => {
  const setMyCommands = mock(() => Promise.resolve(true))

  beforeEach(() => {
    setMyCommands.mockClear()
  })

  test('publishes DM, admin-DM, group, and group-admin scopes from the catalog', async () => {
    const bot = {
      api: {
        setMyCommands,
      },
    }

    await registerTelegramCommands(bot as never, '12345')

    expect(setMyCommands.mock.calls).toEqual([
      [
        expect.arrayContaining([
          expect.objectContaining({ command: 'help' }),
          expect.objectContaining({ command: 'setup' }),
          expect.objectContaining({ command: 'config' }),
        ]),
        { scope: { type: 'all_private_chats' } },
      ],
      [
        expect.arrayContaining([
          expect.objectContaining({ command: 'user' }),
          expect.objectContaining({ command: 'plugin' }),
        ]),
        { scope: { type: 'chat', chat_id: 12345 } },
      ],
      [
        expect.arrayContaining([
          expect.objectContaining({ command: 'help' }),
          expect.objectContaining({ command: 'context' }),
          expect.objectContaining({ command: 'clear' }),
          expect.objectContaining({ command: 'group' }),
        ]),
        { scope: { type: 'all_group_chats' } },
      ],
    ])
  })
})
```

- [ ] **Step 2: Run the new Telegram command publication test and confirm failure**

Run: `bun test tests/chat/telegram/commands.test.ts`

Expected: FAIL because the implementation still only publishes the two old arrays.

- [ ] **Step 3: Replace the hard-coded arrays with catalog-driven helpers**

```typescript
// src/chat/telegram/commands.ts
import type { Bot } from 'grammy'

import { listCommandCatalogEntries } from '../../commands/catalog.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:telegram:commands' })

type TelegramPublishedCommand = {
  readonly command: string
  readonly description: string
}

function commandsForScope(
  scope: 'dm-user' | 'dm-admin' | 'group-user' | 'group-admin',
): readonly TelegramPublishedCommand[] {
  return listCommandCatalogEntries()
    .filter((entry) => {
      switch (scope) {
        case 'dm-user':
          return entry.telegram.publishInDmUser
        case 'dm-admin':
          return entry.telegram.publishInDmAdmin
        case 'group-user':
          return entry.telegram.publishInGroupUser
        case 'group-admin':
          return entry.telegram.publishInGroupAdmin
      }
    })
    .map((entry) => ({ command: entry.name, description: entry.description }))
}

function parseAdminChatId(adminUserId: string): number {
  const parsed = Number.parseInt(adminUserId, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Telegram admin command scope requires a numeric ADMIN_USER_ID, got: ${adminUserId}`)
  }
  return parsed
}

export async function registerTelegramCommands(bot: Bot, adminUserId: string): Promise<void> {
  const adminChatId = parseAdminChatId(adminUserId)

  await bot.api.setMyCommands(commandsForScope('dm-user'), { scope: { type: 'all_private_chats' } })
  await bot.api.setMyCommands(commandsForScope('dm-admin'), { scope: { type: 'chat', chat_id: adminChatId } })
  await bot.api.setMyCommands(commandsForScope('group-user'), { scope: { type: 'all_group_chats' } })

  const groupAdminCommands = commandsForScope('group-admin')
  if (groupAdminCommands.length > 0) {
    await bot.api.setMyCommands(groupAdminCommands, { scope: { type: 'all_chat_administrators' } })
  }

  log.info({ adminUserId }, 'Telegram command menu registered')
}
```

- [ ] **Step 4: Add an explicit invalid-admin-ID failure test**

```typescript
test('throws when admin user id is not numeric for Telegram chat scope', async () => {
  const bot = {
    api: {
      setMyCommands: mock(() => Promise.resolve(true)),
    },
  }

  await expect(registerTelegramCommands(bot as never, 'admin-user')).rejects.toThrow(
    'Telegram admin command scope requires a numeric ADMIN_USER_ID',
  )
})
```

- [ ] **Step 5: Run the Telegram command publication tests and confirm they pass**

Run: `bun test tests/chat/telegram/commands.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the manifest-driven Telegram publication**

```bash
git add src/chat/telegram/commands.ts tests/chat/telegram/commands.test.ts
git commit -m "feat(telegram): derive command scopes from catalog"
```

### Task 4: Surface Newly Authorized Groups In DM Selection Without Prior Observation

**Files:**

- Modify: `src/group-settings/types.ts`
- Modify: `src/group-settings/access.ts`
- Modify: `tests/group-settings/access.test.ts`
- Modify: `tests/group-settings/selector.test.ts`

- [ ] **Step 1: Add a failing access-layer test for authorized-but-unobserved groups**

```typescript
import { addAdmin } from '../../src/instances/admin-store.js'

test('lists authorized scoped groups for an admin even before group metadata is observed', () => {
  const scopedGroupId = toScopedContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: '-10012345',
  })

  addAdmin('admin-1', 'telegram-default')
  addAuthorizedGroup(scopedGroupId, 'admin-1')

  const groups = listManageableGroups('admin-1', 'telegram-default')

  expect(groups).toEqual([
    expect.objectContaining({
      contextId: scopedGroupId,
      displayName: '-10012345',
      parentName: null,
    }),
  ])
})
```

- [ ] **Step 2: Run the focused access tests and confirm failure**

Run: `bun test tests/group-settings/access.test.ts`

Expected: FAIL because unobserved authorized groups are not currently returned.

- [ ] **Step 3: Extend manageable-group discovery to merge observed groups with authorized fallback entries**

```typescript
// src/group-settings/types.ts
export type KnownGroupContext = {
  readonly contextId: string
  readonly provider: string
  readonly displayName: string
  readonly parentName: string | null
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly source?: 'observed' | 'authorized-fallback'
}
```

```typescript
// src/group-settings/access.ts
import { listAuthorizedGroups } from '../authorized-groups.js'
import { isAdmin } from '../instances/admin-store.js'
import { getNativeContextId, isScopedContextId, parseScopedContextId } from '../chat/scoped-context.js'

const FALLBACK_PROVIDER = 'unknown'

function fallbackKnownGroupContext(contextId: string): KnownGroupContext {
  const now = new Date().toISOString()
  return {
    contextId,
    provider: FALLBACK_PROVIDER,
    displayName: getNativeContextId(contextId),
    parentName: null,
    firstSeenAt: now,
    lastSeenAt: now,
    source: 'authorized-fallback',
  }
}

function appendAuthorizedFallbackGroups(
  groups: readonly KnownGroupContext[],
  userId: string,
  platformInstanceId: string | undefined,
): KnownGroupContext[] {
  const existing = new Set(groups.map((group) => group.contextId))

  if (platformInstanceId === undefined || !isAdmin(userId, platformInstanceId)) {
    return [...groups]
  }

  const authorizedFallbacks = listAuthorizedGroups()
    .map((row) => row.group_id)
    .filter((groupId) => {
      if (existing.has(groupId)) return false
      if (!isScopedContextId(groupId)) return false
      const parsed = parseScopedContextId(groupId)
      return parsed !== null && parsed.platformInstanceId === platformInstanceId
    })
    .map((groupId) => fallbackKnownGroupContext(groupId))

  return [...groups, ...authorizedFallbacks].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName),
  )
}

export function listManageableGroups(userId: string, ...args: [] | [platformInstanceId: string]): KnownGroupContext[] {
  const platformInstanceId = args[0]
  const groups = listAdminGroupContextsForUser(userId, ...args).filter((group) =>
    isAuthorizedGroupContext(group, platformInstanceId),
  )

  return appendAuthorizedFallbackGroups(groups, userId, platformInstanceId)
}
```

- [ ] **Step 4: Run the access tests and confirm they pass**

Run: `bun test tests/group-settings/access.test.ts`

Expected: PASS

- [ ] **Step 5: Add a selector-level regression test for immediate DM targeting after authorization**

```typescript
import { addAdmin } from '../../src/instances/admin-store.js'

test('shows a newly authorized scoped group in DM selection before any observation exists', () => {
  const scopedGroupId = toScopedContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: '-10012345',
  })

  addAdmin('admin-id', 'telegram-default')
  addAuthorizedGroup(scopedGroupId, 'admin-id')

  startGroupSettingsSelection('admin-id', 'config', false, 'telegram-default')
  const result = handleGroupSettingsSelectorMessage('admin-id', 'group', false, 'telegram-default')
  const response = getResponse(result)

  expect(response.response).toContain('-10012345')
})
```

- [ ] **Step 6: Run the selector tests and confirm they pass**

Run: `bun test tests/group-settings/selector.test.ts`

Expected: PASS

- [ ] **Step 7: Commit the immediate group-target discovery change**

```bash
git add src/group-settings/types.ts src/group-settings/access.ts tests/group-settings/access.test.ts tests/group-settings/selector.test.ts
git commit -m "feat(group-settings): surface newly authorized telegram groups"
```

### Task 5: Verify The Combined Telegram Behavior

**Files:**

- Modify: `tests/bot.test.ts` (only if coverage gaps appear)
- Test: `tests/commands/catalog.test.ts`
- Test: `tests/chat/telegram/commands.test.ts`
- Test: `tests/group-settings/access.test.ts`
- Test: `tests/group-settings/selector.test.ts`
- Test: `tests/bot.test.ts`

- [ ] **Step 1: Run the focused Telegram verification suite**

Run: `bun test tests/commands/catalog.test.ts tests/chat/telegram/commands.test.ts tests/group-settings/access.test.ts tests/group-settings/selector.test.ts tests/bot.test.ts`

Expected: PASS

- [ ] **Step 2: Run strict lint on the touched sources and tests**

Run: `bun run lint:agent-strict -- src/commands/catalog.ts src/commands/index.ts src/chat/telegram/commands.ts src/group-settings/types.ts src/group-settings/access.ts tests/commands/catalog.test.ts tests/chat/telegram/commands.test.ts tests/group-settings/access.test.ts tests/group-settings/selector.test.ts tests/bot.test.ts`

Expected: PASS

- [ ] **Step 3: Run formatting check for the touched files**

Run: `bun format:check src/commands/catalog.ts src/commands/index.ts src/chat/telegram/commands.ts src/group-settings/types.ts src/group-settings/access.ts tests/commands/catalog.test.ts tests/chat/telegram/commands.test.ts tests/group-settings/access.test.ts tests/group-settings/selector.test.ts tests/bot.test.ts`

Expected: PASS

- [ ] **Step 4: Commit the final Telegram verification pass**

```bash
git add src/commands/catalog.ts src/commands/index.ts src/chat/telegram/commands.ts src/group-settings/types.ts src/group-settings/access.ts tests/commands/catalog.test.ts tests/chat/telegram/commands.test.ts tests/group-settings/access.test.ts tests/group-settings/selector.test.ts tests/bot.test.ts
git commit -m "test(telegram): verify command publication alignment"
```
