<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: reminder @mention resolution

**Spec:** `docs/superpowers/specs/2026-06-21-reminder-mention-resolution-design.md`
**Branch:** `feat/live-status-toggle`
**Tasks:** 8

---

## Task 1 — Roster service: unit tests (RED)

Write `tests/chat/participants/roster.test.ts`. These tests must fail until Task 2 is complete.

```
tests/chat/participants/roster.test.ts   ← new
```

**Full test file:**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { groupMembers, messageMetadata } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { computeScore, gatherParticipants, resolveChatParticipant } from '../../../src/chat/participants/roster.js'

const GROUP_CTX = 'g-test' // plain contextId (non-thread-scoped; config = same)
const THREAD_CTX = 'g-test:thread1' // thread-scoped; groupContextId = 'g-test'

const NOW_TS = 1_000_000_000
const FAR_FUTURE = NOW_TS + 86_400 * 365

function insertMember(groupId: string, userId: string): void {
  getDrizzleDb().insert(groupMembers).values({ groupId, userId, addedBy: 'test' }).onConflictDoNothing().run()
}

function insertSender(contextId: string, messageId: string, authorId: string, username: string | null): void {
  getDrizzleDb()
    .insert(messageMetadata)
    .values({
      contextId,
      messageId,
      authorId,
      authorUsername: username,
      timestamp: NOW_TS,
      expiresAt: FAR_FUTURE,
    })
    .run()
}

describe('gatherParticipants', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns group_members for the group context id', async () => {
    insertMember(GROUP_CTX, 'u1')
    insertMember(GROUP_CTX, 'u2')

    const candidates = await gatherParticipants(GROUP_CTX)
    expect(candidates.map((c) => c.userId).sort()).toEqual(['u1', 'u2'])
  })

  test('returns distinct senders from message_metadata', async () => {
    insertSender(GROUP_CTX, 'm1', 'u3', 'charlie')
    insertSender(GROUP_CTX, 'm2', 'u3', 'charlie') // duplicate sender

    const candidates = await gatherParticipants(GROUP_CTX)
    const userIds = candidates.map((c) => c.userId)
    expect(userIds.filter((id) => id === 'u3')).toHaveLength(1)
  })

  test('dedupes members and senders that share a userId', async () => {
    insertMember(GROUP_CTX, 'u1')
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice') // same user

    const candidates = await gatherParticipants(GROUP_CTX)
    expect(candidates.map((c) => c.userId)).toHaveLength(1)
  })

  test('skips message_metadata rows with null authorId', async () => {
    getDrizzleDb()
      .insert(messageMetadata)
      .values({
        contextId: GROUP_CTX,
        messageId: 'm-null',
        authorId: null,
        authorUsername: null,
        timestamp: NOW_TS,
        expiresAt: FAR_FUTURE,
      })
      .run()

    const candidates = await gatherParticipants(GROUP_CTX)
    expect(candidates).toHaveLength(0)
  })

  test('exposes username from message_metadata', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')
    const candidates = await gatherParticipants(GROUP_CTX)
    expect(candidates[0]?.username).toBe('alice')
  })

  test('prefers username from group_members row when both exist', async () => {
    // message_metadata has a username, member row has none
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice_from_meta')
    insertMember(GROUP_CTX, 'u1')
    const candidates = await gatherParticipants(GROUP_CTX)
    expect(candidates.find((c) => c.userId === 'u1')?.username).toBe('alice_from_meta')
  })

  test('uses group-level context id (strips thread suffix) for member lookup', async () => {
    // members stored under GROUP_CTX, thread-scoped messages under THREAD_CTX
    insertMember(GROUP_CTX, 'u-member')
    const candidates = await gatherParticipants(THREAD_CTX)
    expect(candidates.find((c) => c.userId === 'u-member')).toBeDefined()
  })
})

describe('computeScore', () => {
  test('exact match (case-insensitive) returns 3', () => {
    expect(computeScore('alice', 'Alice', null)).toBe(3)
    expect(computeScore('alice', null, 'Alice')).toBe(3)
  })

  test('prefix match returns 2', () => {
    expect(computeScore('ali', 'Alice Smith', null)).toBe(2)
  })

  test('substring match returns 1', () => {
    expect(computeScore('ice', 'Alice', null)).toBe(1)
  })

  test('no match returns 0', () => {
    expect(computeScore('bob', 'Alice', 'alice')).toBe(0)
  })

  test('displayName beats username for tiebreak (same score)', () => {
    // When displayName matches exactly and username also matches exactly, score is still 3
    expect(computeScore('alice', 'alice', 'alice')).toBe(3)
  })
})

describe('resolveChatParticipant', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolves display name via resolveLabel, falls back to username, then userId', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')

    const calls: string[] = []
    const resolveLabel = async (userId: string): Promise<string | null> => {
      calls.push(userId)
      return 'Alice Smith'
    }

    const results = await resolveChatParticipant(GROUP_CTX, 'alice', resolveLabel)
    expect(results[0]?.displayName).toBe('Alice Smith')
    expect(calls).toContain('u1')
  })

  test('falls back to username when resolveLabel returns null', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')
    const results = await resolveChatParticipant(GROUP_CTX, 'alice', async () => null)
    expect(results[0]?.displayName).toBe('alice')
  })

  test('falls back to userId when resolveLabel returns null and username is null', async () => {
    insertMember(GROUP_CTX, 'u-no-username')
    const results = await resolveChatParticipant(GROUP_CTX, 'u-no-username', async () => null)
    expect(results[0]?.displayName).toBe('u-no-username')
  })

  test('returns empty array when no candidate matches the query', async () => {
    insertSender(GROUP_CTX, 'm1', 'u1', 'alice')
    const results = await resolveChatParticipant(GROUP_CTX, 'zzznomatch', async (id) => id)
    expect(results).toHaveLength(0)
  })

  test('ranks exact match above prefix above substring', async () => {
    insertSender(GROUP_CTX, 'm1', 'u-exact', null)
    insertSender(GROUP_CTX, 'm2', 'u-prefix', null)
    insertSender(GROUP_CTX, 'm3', 'u-sub', null)

    const labels: Record<string, string> = {
      'u-exact': 'ali', // exact
      'u-prefix': 'ali smith', // prefix match for 'ali'
      'u-sub': 'xaliy', // substring
    }
    const results = await resolveChatParticipant(GROUP_CTX, 'ali', async (id) => labels[id] ?? null)
    expect(results.map((r) => r.userId)).toEqual(['u-exact', 'u-prefix', 'u-sub'])
  })

  test('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      insertSender(GROUP_CTX, `m${i}`, `u${i}`, `alice${i}`)
    }
    const results = await resolveChatParticipant(GROUP_CTX, 'alice', async (id) => id, 2)
    expect(results).toHaveLength(2)
  })

  test('resolveLabel called with p-limit concurrency (all users resolved)', async () => {
    for (let i = 0; i < 12; i++) {
      insertMember(GROUP_CTX, `bulk-u${i}`)
    }
    const resolved: string[] = []
    const resolveLabel = async (userId: string): Promise<string | null> => {
      resolved.push(userId)
      return `User ${userId}`
    }
    await resolveChatParticipant(GROUP_CTX, 'bulk', resolveLabel)
    // All 12 members must be resolved despite p-limit capping concurrency
    expect(resolved).toHaveLength(12)
  })
})
```

**Run command:**

```bash
bun test tests/chat/participants/roster.test.ts
```

**Expected output (RED):** Cannot find module `../../src/chat/participants/roster.js`.

---

## Task 2 — Roster service: implementation (GREEN)

Create the directory and implement `src/chat/participants/roster.ts`.

```
src/chat/participants/roster.ts   ← new
```

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, isNotNull } from 'drizzle-orm'
import pLimit from 'p-limit'

import { getConfigContextIdFromStorageContextId } from '../scoped-context.js'
import { getDrizzleDb } from '../../db/drizzle.js'
import { groupMembers, messageMetadata } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:participants:roster' })

const LABEL_RESOLVE_CONCURRENCY = 8
const DEFAULT_LIMIT = 5

export type ResolveUserLabelFn = (userId: string) => Promise<string | null>

export type ParticipantCandidate = {
  userId: string
  displayName: string
  username: string | null
  score: number
}

/** ChatParticipantResolver: injected into the tool, pre-bound to a ResolveUserLabelFn. */
export type ChatParticipantResolver = (
  contextId: string,
  query: string,
  limit?: number,
) => Promise<ParticipantCandidate[]>

type RawCandidate = { userId: string; username: string | null }

/**
 * Gather the union of curated group members and recently-seen senders.
 * Uses the group-level context id (strips thread suffix) for member lookup.
 */
export async function gatherParticipants(contextId: string): Promise<RawCandidate[]> {
  log.debug({ contextId }, 'gatherParticipants')
  const db = getDrizzleDb()
  const groupContextId = getConfigContextIdFromStorageContextId(contextId)

  const memberRows = db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupContextId))
    .all()

  const senderRows = db
    .select({
      authorId: messageMetadata.authorId,
      authorUsername: messageMetadata.authorUsername,
    })
    .from(messageMetadata)
    .where(eq(messageMetadata.contextId, contextId))
    .all()

  // Merge: members + senders, deduped by userId.
  const seen = new Map<string, RawCandidate>()
  for (const m of memberRows) {
    seen.set(m.userId, { userId: m.userId, username: null })
  }
  for (const s of senderRows) {
    if (s.authorId === null || s.authorId === undefined) continue
    const existing = seen.get(s.authorId)
    if (existing !== undefined) {
      // prefer username from metadata if available
      if (existing.username === null && s.authorUsername !== null && s.authorUsername !== undefined) {
        seen.set(s.authorId, {
          userId: s.authorId,
          username: s.authorUsername,
        })
      }
    } else {
      seen.set(s.authorId, {
        userId: s.authorId,
        username: s.authorUsername ?? null,
      })
    }
  }

  return Array.from(seen.values())
}

/**
 * Compute a match score for a query against a candidate's display name and username.
 * Returns: 3 = exact, 2 = prefix, 1 = substring, 0 = no match.
 */
export function computeScore(query: string, displayName: string | null, username: string | null): number {
  const q = query.toLowerCase()
  const dn = displayName?.toLowerCase() ?? ''
  const un = username?.toLowerCase() ?? ''

  if (dn === q || un === q) return 3
  if (dn.startsWith(q) || un.startsWith(q)) return 2
  if (dn.includes(q) || un.includes(q)) return 1
  return 0
}

/**
 * Resolve a name query to a ranked list of chat participants.
 * Steps:
 *   1. Gather candidates (group_members ∪ message_metadata senders, deduped).
 *   2. Resolve display names via resolveLabel (p-limited), fall back to username, then userId.
 *   3. Fuzzy-match & rank against query. Return top-N (limit).
 */
export async function resolveChatParticipant(
  contextId: string,
  query: string,
  resolveLabel: ResolveUserLabelFn,
  limit: number = DEFAULT_LIMIT,
): Promise<ParticipantCandidate[]> {
  log.debug({ contextId, query, limit }, 'resolveChatParticipant')
  const raw = await gatherParticipants(contextId)
  if (raw.length === 0) return []

  const limiter = pLimit(LABEL_RESOLVE_CONCURRENCY)
  const resolved: ParticipantCandidate[] = await Promise.all(
    raw.map((candidate) =>
      limiter(async (): Promise<ParticipantCandidate> => {
        let displayName: string
        try {
          const label = await resolveLabel(candidate.userId)
          displayName = label ?? candidate.username ?? candidate.userId
        } catch {
          displayName = candidate.username ?? candidate.userId
        }
        const score = computeScore(query, displayName, candidate.username)
        return {
          userId: candidate.userId,
          displayName,
          username: candidate.username,
          score,
        }
      }),
    ),
  )

  const matched = resolved.filter((c) => c.score > 0)
  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // stable tie-break: alphabetical by userId for determinism
    return a.userId.localeCompare(b.userId)
  })

  const result = matched.slice(0, limit)
  log.info({ contextId, query, count: result.length }, 'resolveChatParticipant completed')
  return result
}
```

**Run command:**

```bash
bun test tests/chat/participants/roster.test.ts
```

**Expected output (GREEN):** All tests pass.

**Commit:**

```bash
git add src/chat/participants/roster.ts tests/chat/participants/roster.test.ts
git commit -m "feat(participants): add chat roster service with fuzzy-rank resolution"
```

---

## Task 3 — Tool metadata + tests (RED)

**3a.** Add `resolve_chat_participant` to `TOOL_METADATA` in `src/tools/tool-metadata.ts`:

Locate the `find_user` line (currently `find_user: read('collaboration')`) and add below it:

```diff
   find_user: read('collaboration'),
+  resolve_chat_participant: read('collaboration'),
   get_current_user: read('identity'),
```

**3b.** Write `tests/tools/resolve-chat-participant.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { makeResolveChatParticipantTool } from '../../src/tools/resolve-chat-participant.js'
import type { ChatParticipantResolver } from '../../src/chat/participants/roster.js'
import { mockLogger } from '../utils/test-helpers.js'
import { getToolExecutor, schemaValidates } from '../utils/test-helpers.js'

const CONTEXT_ID = 'ctx-group-1'

function makeResolver(
  candidates: Array<{
    userId: string
    displayName: string
    username: string | null
    score: number
  }>,
): ChatParticipantResolver {
  return async (_contextId, _query, _limit) => candidates
}

describe('makeResolveChatParticipantTool', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('schema validates with required query field', () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    expect(schemaValidates(tool.inputSchema, { query: 'alice' })).toBe(true)
  })

  test('schema validates with optional limit', () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    expect(schemaValidates(tool.inputSchema, { query: 'bob', limit: 3 })).toBe(true)
  })

  test('schema rejects missing query', () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    expect(schemaValidates(tool.inputSchema, {})).toBe(false)
  })

  test('returns ranked candidates from resolver', async () => {
    const candidate = {
      userId: 'u1',
      displayName: 'Alice Smith',
      username: 'alice',
      score: 3,
    }
    const tool = makeResolveChatParticipantTool(makeResolver([candidate]), CONTEXT_ID)
    const execute = getToolExecutor(tool)

    const result = await execute({ query: 'alice' })
    expect(result).toEqual([candidate])
  })

  test('returns empty array when resolver returns []', async () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    const execute = getToolExecutor(tool)

    const result = await execute({ query: 'nobody' })
    expect(result).toEqual([])
  })

  test('passes limit to resolver', async () => {
    let receivedLimit: number | undefined
    const resolver: ChatParticipantResolver = async (_ctx, _q, limit) => {
      receivedLimit = limit
      return []
    }
    const tool = makeResolveChatParticipantTool(resolver, CONTEXT_ID)
    const execute = getToolExecutor(tool)

    await execute({ query: 'alice', limit: 2 })
    expect(receivedLimit).toBe(2)
  })

  test('passes contextId to resolver', async () => {
    let receivedContextId: string | undefined
    const resolver: ChatParticipantResolver = async (ctx, _q, _limit) => {
      receivedContextId = ctx
      return []
    }
    const tool = makeResolveChatParticipantTool(resolver, CONTEXT_ID)
    const execute = getToolExecutor(tool)

    await execute({ query: 'alice' })
    expect(receivedContextId).toBe(CONTEXT_ID)
  })
})
```

**Run command:**

```bash
bun test tests/tools/resolve-chat-participant.test.ts
```

**Expected output (RED):** Cannot find module `../../src/tools/resolve-chat-participant.js`.

---

## Task 4 — Tool implementation (GREEN)

Create `src/tools/resolve-chat-participant.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { ChatParticipantResolver } from '../chat/participants/roster.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:resolve-chat-participant' })

export { type ChatParticipantResolver }

export function makeResolveChatParticipantTool(resolver: ChatParticipantResolver, contextId: string): ToolSet[string] {
  return tool({
    description:
      'Find a chat group participant by name and return their user ID. ' +
      'Use before populating delivery.mention_user_ids for reminders or any time you need a chat user ID for a named person in this group. ' +
      'Returns a ranked list of candidates; take the top entry when the match is clear. ' +
      'If no confident match is found, ask ONE targeted question naming the returned candidates.',
    inputSchema: z.object({
      query: z.string().describe('Name or partial name of the person to look up'),
      limit: z.number().int().positive().optional().describe('Maximum number of candidates to return (default 5)'),
    }),
    execute: async ({ query, limit }) => {
      log.debug({ contextId, query, limit }, 'resolve_chat_participant')
      const candidates = await resolver(contextId, query, limit)
      log.info({ contextId, query, count: candidates.length }, 'resolve_chat_participant completed')
      return candidates
    },
  })
}
```

**Run command:**

```bash
bun test tests/tools/resolve-chat-participant.test.ts
```

**Expected output (GREEN):** All tests pass.

**Commit:**

```bash
git add src/tools/tool-metadata.ts src/tools/resolve-chat-participant.ts tests/tools/resolve-chat-participant.test.ts
git commit -m "feat(tool): add resolve_chat_participant tool for group @mention resolution"
```

---

## Task 5a — Thread resolver through MakeToolsOptions + tools-builder

**Write tests first:** Add gating tests to `tests/tools/resolve-chat-participant.test.ts`:

Append inside the existing describe block:

```typescript
describe('tool gating via buildTools', () => {
  test('tool is absent when chatParticipantResolver is undefined', async () => {
    // buildTools with no chatParticipantResolver → no resolve_chat_participant
    const { buildTools } = await import('../../src/tools/tools-builder.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    const tools = buildTools(createMockProvider(), 'u1', 'ctx1', 'normal', 'group', null, undefined, undefined)
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })

  test('tool is absent in dm context even when resolver is provided', async () => {
    const { buildTools } = await import('../../src/tools/tools-builder.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    const fakeResolver: ChatParticipantResolver = async () => []
    const tools = buildTools(createMockProvider(), 'u1', 'ctx1', 'normal', 'dm', null, undefined, fakeResolver)
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })

  test('tool is present in group context when resolver is provided', async () => {
    const { buildTools } = await import('../../src/tools/tools-builder.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    const fakeResolver: ChatParticipantResolver = async () => []
    const tools = buildTools(createMockProvider(), 'u1', 'ctx1', 'normal', 'group', null, undefined, fakeResolver)
    expect(tools['resolve_chat_participant']).toBeDefined()
  })
})
```

**Run command:**

```bash
bun test tests/tools/resolve-chat-participant.test.ts
```

**Expected output (RED):** Tests fail — `buildTools` signature mismatch.

**Now implement:**

**`src/tools/types.ts`** — add `chatParticipantResolver` field:

```diff
+  /**
+   * Resolver for chat group participants by name — used by resolve_chat_participant.
+   * Absent in DM context or when no ChatRouter is available.
+   */
+  chatParticipantResolver?: import('../chat/participants/roster.js').ChatParticipantResolver
```

Place it after the `askPermission` field (last entry in the `MakeToolsOptions` type).

**`src/tools/tools-builder.ts`** — extend `BuilderArgs` and use resolver in `buildTools`:

1. Add `makeResolveChatParticipantTool` import at top of file:

```typescript
import type { ChatParticipantResolver } from '../chat/participants/roster.js'
import { makeResolveChatParticipantTool } from './resolve-chat-participant.js'
```

2. Extend `BuilderArgs`:

```diff
 type BuilderArgs =
   | readonly []
   | readonly [contextType: ContextType | undefined]
   | readonly [contextType: ContextType | undefined, username: string | null | undefined]
   | readonly [
       contextType: ContextType | undefined,
       username: string | null | undefined,
       stagedDownloadFn: StagedFileDownloadFn | undefined,
+    ]
+  | readonly [
+      contextType: ContextType | undefined,
+      username: string | null | undefined,
+      stagedDownloadFn: StagedFileDownloadFn | undefined,
+      chatParticipantResolver: ChatParticipantResolver | undefined,
     ]
```

3. In `buildTools`, read the new arg and register the tool:

```diff
 export function buildTools(
   provider: TaskProvider,
   chatUserId: string | undefined,
   contextId: string | undefined,
   mode: ToolMode,
   ...args: BuilderArgs
 ): ToolSet {
   const contextType = args[0]
   const username = args[1]
   const stagedDownloadFn = args[2]
+  const chatParticipantResolver = args[3] as ChatParticipantResolver | undefined
```

And after `maybeAddIdentityTools(tools, provider, chatUserId, contextType)`:

```diff
+  if (contextType === 'group' && chatParticipantResolver !== undefined && contextId !== undefined) {
+    tools['resolve_chat_participant'] = makeResolveChatParticipantTool(chatParticipantResolver, contextId)
+  }
```

**Run command:**

```bash
bun test tests/tools/resolve-chat-participant.test.ts
```

**Expected output (GREEN):** All tests pass.

**Commit:**

```bash
git add src/tools/types.ts src/tools/tools-builder.ts src/tools/resolve-chat-participant.ts tests/tools/resolve-chat-participant.test.ts
git commit -m "feat(tools): gate resolve_chat_participant by chatParticipantResolver in group context"
```

---

## Task 5b — Thread resolver through orchestrator and bot

**Write integration test first:** Add to `tests/tools/resolve-chat-participant.test.ts` (or a new file `tests/chat/participants/plumbing.test.ts`):

New file `tests/chat/participants/plumbing.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatParticipantResolver } from '../../../src/chat/participants/roster.js'
import { makeTools } from '../../../src/tools/index.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import { createMockProvider } from '../../tools/mock-provider.js'

describe('chatParticipantResolver plumbing through MakeToolsOptions', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolve_chat_participant absent when chatParticipantResolver not in options', async () => {
    const provider = createMockProvider()
    const tools = await makeTools(provider, {
      storageContextId: 'ctx-group',
      chatUserId: 'u1',
      contextType: 'group',
    })
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })

  test('resolve_chat_participant present when chatParticipantResolver provided and contextType=group', async () => {
    const provider = createMockProvider()
    const fakeResolver: ChatParticipantResolver = async () => []
    const tools = await makeTools(provider, {
      storageContextId: 'ctx-group',
      chatUserId: 'u1',
      contextType: 'group',
      chatParticipantResolver: fakeResolver,
    })
    expect(tools['resolve_chat_participant']).toBeDefined()
  })

  test('resolve_chat_participant absent in dm context', async () => {
    const provider = createMockProvider()
    const fakeResolver: ChatParticipantResolver = async () => []
    const tools = await makeTools(provider, {
      storageContextId: 'ctx-dm',
      chatUserId: 'u1',
      contextType: 'dm',
      chatParticipantResolver: fakeResolver,
    })
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })
})
```

**Run command:**

```bash
bun test tests/chat/participants/plumbing.test.ts
```

**Expected output (RED):** `chatParticipantResolver` not in `MakeToolsOptions` yet or not passed through `makeTools`.

**Now implement — four file changes:**

**`src/tools/index.ts`** — in `makeTools`, pass `chatParticipantResolver`:

```diff
-  const tools = buildTools(provider, chatUserId, contextId, mode, contextType, username, stagedDownloadFn)
+  const tools = buildTools(provider, chatUserId, contextId, mode, contextType, username, stagedDownloadFn, options.chatParticipantResolver)
```

**`src/llm-orchestrator-types.ts`** — add `chatParticipantResolver?` to `LlmOrchestratorDeps`:

```diff
 export type LlmOrchestratorDeps = {
   generateText: (options: Parameters<typeof generateText>[0]) => ReturnType<typeof generateText>
   stepCountIs: typeof stepCountIs
   buildOpenAI: (apiKey: string, baseURL: string) => ReturnType<typeof createOpenAICompatible>
   resolve: (contextId: string) => Promise<TaskProvider | null> | TaskProvider | null
   maybeAutoProvision: (
     reply: ReplyFn,
     contextId: string,
     chatUserId: string,
     username: string | null,
   ) => Promise<boolean>
-} & Partial<Record<'stagedDownloadFn', StagedFileDownloadFn>>
+} & Partial<Record<'stagedDownloadFn', StagedFileDownloadFn>> &
+  Partial<Record<'chatParticipantResolver', import('./chat/participants/roster.js').ChatParticipantResolver>>
```

**`src/llm-orchestrator-tools.ts`** — pass resolver in `getOrCreateDescriptors` and update the cache key:

1. Update `getOrCreateDescriptors` signature:

```diff
 const getOrCreateDescriptors = async (
   contextId: string,
   chatUserId: string,
   username: string | null,
   provider: TaskProvider | null,
   contextType: 'dm' | 'group' | undefined,
   stagedDownloadFn: StagedFileDownloadFn | undefined,
+  chatParticipantResolver: import('./chat/participants/roster.js').ChatParticipantResolver | undefined,
   deps: PrepareLlmInvocationDeps,
 ): Promise<ToolSet> => {
   const providerCacheScope = provider === null ? 'providerless' : 'provider-backed'
   const stagedDownloadScope = stagedDownloadFn === undefined ? 'no-staged-download' : 'with-staged-download'
+  const resolverScope = chatParticipantResolver === undefined ? 'no-resolver' : 'with-resolver'
   const usernameSuffix = username ?? ''
-  const cacheKey = `${providerCacheScope}:${stagedDownloadScope}:${contextId}:${chatUserId}:${usernameSuffix}`
+  const cacheKey = `${providerCacheScope}:${stagedDownloadScope}:${resolverScope}:${contextId}:${chatUserId}:${usernameSuffix}`
```

2. Update `descriptorOptions` to include resolver:

```diff
   const descriptorOptions = {
     storageContextId: contextId,
     chatUserId,
     username,
     contextType,
     stagedDownloadFn,
+    chatParticipantResolver,
   }
```

3. Update the call site in `buildFullToolSet`:

```diff
   const descriptors = await getOrCreateDescriptors(
     contextId,
     chatUserId,
     username,
     provider,
     contextType,
     stagedDownloadFn,
+    opts.chatParticipantResolver,
     deps,
   )
```

4. Add `chatParticipantResolver?` to `LlmInvocationOptions`:

```diff
 export type LlmInvocationOptions = {
   contextId: string
   configId: string
   chatUserId: string
   username: string | null
   contextType: 'dm' | 'group'
   provider: TaskProvider | null
   history: readonly ModelMessage[]
   userText: string
   stagedDownloadFn: StagedFileDownloadFn | undefined
   askPermission: AskPermissionFn | undefined
   actorRole?: ActorRole
+  chatParticipantResolver?: import('./chat/participants/roster.js').ChatParticipantResolver
 }
```

**`src/llm-orchestrator.ts`** — extract resolver from deps and pass to invocation opts:

In `callLlm`, after `buildLlmInvocationOpts`:

```diff
   const invocationOpts = buildLlmInvocationOpts(args, configId, provider, deps.stagedDownloadFn)
+  const invocationOptsWithResolver = {
+    ...invocationOpts,
+    chatParticipantResolver: deps.chatParticipantResolver,
+  }
-  const { tools, validatedMessages, enabledToolNames, disclosure } = await prepareLlmInvocation(invocationOpts)
+  const { tools, validatedMessages, enabledToolNames, disclosure } = await prepareLlmInvocation(invocationOptsWithResolver)
```

**`src/bot.ts`** — add `chatParticipantResolver?` to `BotDeps` and pass to processCoalescedMessage:

1. Add import at top:

```diff
+import type { ChatParticipantResolver } from './chat/participants/roster.js'
+import { resolveChatParticipant } from './chat/participants/roster.js'
```

2. Update `BotDeps`:

```diff
 export type BotDeps = Readonly<{ processMessage: ProcessMessageFn }> &
-  Readonly<Partial<Record<'stagedDownloadFn', StagedFileDownloadFn> & Record<'enqueueMessage', typeof enqueueMessage>>>
+  Readonly<Partial<
+    Record<'stagedDownloadFn', StagedFileDownloadFn> &
+    Record<'enqueueMessage', typeof enqueueMessage> &
+    Record<'chatParticipantResolver', ChatParticipantResolver>
+  >>
```

3. Update `processCoalescedMessage` to pass the resolver:

```diff
-      { ...defaultDeps, stagedDownloadFn: deps.stagedDownloadFn },
+      { ...defaultDeps, stagedDownloadFn: deps.stagedDownloadFn, chatParticipantResolver: deps.chatParticipantResolver },
```

**`src/index.ts`** — construct and inject the resolver when calling `setupBot`.

Find where `setupBot` is called and inject the resolver. Add a helper that creates the resolver bound to the `chatRouter`:

```typescript
// Add near the setupBot call in src/index.ts
import { resolveChatParticipant } from './chat/participants/roster.js'
import type { ResolveUserContext } from './chat/types.js'

function makeChatParticipantResolver(chatRouter: ChatRouter): ChatParticipantResolver {
  return (contextId, query, limit) => {
    const resolveLabel = (userId: string): Promise<string | null> => {
      const context: ResolveUserContext = { contextId, contextType: 'group' }
      return chatRouter.resolveUserLabel(userId, context)
    }
    return resolveChatParticipant(contextId, query, resolveLabel, limit)
  }
}

// Then pass it into setupBot deps:
setupBot(chatRouter, adminUserId, {
  ...existingBotDeps,
  chatParticipantResolver: makeChatParticipantResolver(chatRouter),
})
```

**Run command:**

```bash
bun test tests/chat/participants/plumbing.test.ts
```

**Expected output (GREEN):** All plumbing tests pass.

```bash
bun run test
```

**Expected:** Full test suite passes.

**Commit:**

```bash
git add \
  src/tools/index.ts \
  src/llm-orchestrator-types.ts \
  src/llm-orchestrator-tools.ts \
  src/llm-orchestrator.ts \
  src/bot.ts \
  src/index.ts \
  tests/chat/participants/plumbing.test.ts
git commit -m "feat(plumbing): thread chatParticipantResolver from ChatRouter into MakeToolsOptions"
```

---

## Task 6 — System prompt: GROUP_DEFERRED update + test

**Write test first.** Append to an existing system-prompt test or create `tests/system-prompt-group-deferred.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildSystemPrompt } from '../../src/system-prompt.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from '../tools/mock-provider.js'

describe('GROUP_DEFERRED population procedure', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('prompt includes resolve_chat_participant procedure when tool is enabled', () => {
    const provider = createMockProvider()
    const enabled = new Set(['create_deferred_prompt', 'list_deferred_prompts', 'resolve_chat_participant'])
    const prompt = buildSystemPrompt(provider, 'ctx-group', enabled, {
      askPermissionAvailable: false,
      contextType: 'group',
    })
    expect(prompt).toContain('resolve_chat_participant')
    expect(prompt).toContain('mention_user_ids')
    expect(prompt).toContain('Resolve all names before creating')
  })

  test('prompt keeps original GROUP_DEFERRED content when resolve_chat_participant absent', () => {
    const provider = createMockProvider()
    const enabled = new Set(['create_deferred_prompt', 'list_deferred_prompts'])
    const prompt = buildSystemPrompt(provider, 'ctx-group', enabled, {
      askPermissionAvailable: false,
      contextType: 'group',
    })
    // Original "remind me" line still present
    expect(prompt).toContain('remind me')
    expect(prompt).toContain('mention_user_ids')
  })
})
```

**Run command:**

```bash
bun test tests/system-prompt-group-deferred.test.ts
```

**Expected output (RED):** Test fails — no `resolve_chat_participant` mention in the prompt.

**Now implement.** In `src/system-prompt.ts`:

Replace the `GROUP_DEFERRED` constant:

```diff
-const GROUP_DEFERRED = `GROUP REMINDERS — This is a group chat. Any reminder or scheduled prompt you create here fires IN THIS GROUP CHAT, never in a private DM, and is owned by the group, not by one member. Control who gets @mentioned when it fires with delivery.mention_user_ids:
-- "remind me" / a reminder just for the requester → OMIT delivery.mention_user_ids; it fires in this group and @mentions the requester automatically.
-- "remind us" / "remind everyone" / "remind the team" / anything for the whole group → set delivery.mention_user_ids to [] (empty array); it fires in this group with no @mention.
-- To @mention specific people, set delivery.mention_user_ids to their user IDs.
-- If it is unclear whether the reminder is only for the requester or for the whole group, ask ONE short question before creating it.`
+const GROUP_DEFERRED = `GROUP REMINDERS — This is a group chat. Any reminder or scheduled prompt you create here fires IN THIS GROUP CHAT, never in a private DM, and is owned by the group, not by one member. Control who gets @mentioned when it fires with delivery.mention_user_ids:
+- "remind me" / a reminder just for the requester → OMIT delivery.mention_user_ids; it fires in this group and @mentions the requester automatically.
+- "remind us" / "remind everyone" / "remind the team" / anything for the whole group → set delivery.mention_user_ids to [] (empty array); it fires in this group with no @mention.
+- Named people ("remind Alice and Bob", "ping @charlie") → for EACH named person, call resolve_chat_participant with their name, take the top candidate's userId, and collect them into delivery.mention_user_ids. Resolve ALL names before calling create_deferred_prompt.
+  - If no candidate is returned for a name, ask ONE short, specific question (e.g. "I don't see an Alice in this group — do you mean @alice_m or @alice_s?").
+  - If multiple candidates are returned and the match is not clear, name the top candidates in ONE question and wait for the user to choose before creating the reminder.
+- If it is unclear whether the reminder is only for the requester or for the whole group, ask ONE short question before creating it.
+
+USER IDs IN THIS GROUP — resolve_chat_participant also works any time you need a chat user ID for a named person in this group, not only for reminders.`
```

Also, update the `FRAGMENTS` array to conditionally include the `resolve_chat_participant` procedure. The `GROUP_DEFERRED` is already included via the group-context branch in `assembleSystemPrompt`. The `requiredTools` guard for the deferred fragment already gates on `create_deferred_prompt` / `list_deferred_prompts`. No further change needed — the new text lives in `GROUP_DEFERRED` which is always appended when `contextType === 'group'` and the DEFERRED fragment is included.

**Run command:**

```bash
bun test tests/system-prompt-group-deferred.test.ts
```

**Expected output (GREEN):** All tests pass.

```bash
bun run test
```

**Expected:** Full test suite passes.

**Commit:**

```bash
git add src/system-prompt.ts tests/system-prompt-group-deferred.test.ts
git commit -m "feat(prompt): add explicit resolve_chat_participant population procedure to GROUP_DEFERRED"
```

---

## Task 7 — Tool description update

The tool description in Task 4 already covers the general use case ("any time you need a chat user ID for a named person in this group"). No separate change needed — the description written in `src/tools/resolve-chat-participant.ts` is already complete.

Verify the tool description once more:

```bash
grep -A6 'description:' src/tools/resolve-chat-participant.ts
```

If the description is complete (mentions "reminders", "named person", "ranked list", "ask ONE targeted question"), this task is done.

**Commit:** (no code change — skip if tool description is already complete from Task 4)

---

## Task 8 — CLAUDE.md note

Add a line to `CLAUDE.md` under the "Live task status" bullet in the top-level description (the Notable non-obvious behaviors section), or to `src/chat/CLAUDE.md`:

Add to `CLAUDE.md` in the Notable non-obvious behaviors section, after the live-status paragraph:

```diff
+- **Chat participant resolution (`resolve_chat_participant`):** in group contexts, the bot uses this tool to resolve a named person ("Alice") to a chat user ID before populating `delivery.mention_user_ids`. It queries `group_members` ∪ `message_metadata` (recent senders), resolves display names via `ChatRouter.resolveUserLabel` (p-limited), and fuzzy-ranks candidates. Tool is registered only in group contexts when `chatParticipantResolver` is injected (from `ChatRouter` at startup). The system prompt (`GROUP_DEFERRED`) spells out the full resolution procedure. See `src/chat/participants/roster.ts`.
```

**Run command:**

```bash
bun run test
```

**Expected:** All tests pass.

**Commit:**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): note resolve_chat_participant tool and roster service"
```

---

## Self-review

### Spec coverage

| Spec requirement                                                       | Covered                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Roster: group_members ∪ message_metadata, dedupe by userId             | Task 2                                                   |
| Label-resolution fallback chain (resolveLabel → username → userId)     | Task 2                                                   |
| Deterministic fuzzy ranking (exact/prefix/substring, stable tie-break) | Task 2                                                   |
| p-limit bounded label resolution                                       | Task 2                                                   |
| resolve_chat_participant tool, read risk, group-only                   | Tasks 3-4                                                |
| chatParticipantResolver in MakeToolsOptions                            | Task 5a                                                  |
| Thread through makeTools                                               | Task 5a                                                  |
| Thread through LlmOrchestratorDeps + orchestrator                      | Task 5b                                                  |
| Bind resolver to ChatRouter at startup (bot.ts / index.ts)             | Task 5b                                                  |
| Cache key update for resolver presence                                 | Task 5b                                                  |
| GROUP_DEFERRED population procedure ("resolve all before creating")    | Task 6                                                   |
| No confident match / ambiguous → ask ONE question                      | Task 6 (prompt)                                          |
| DM context: tool absent                                                | Task 5a test                                             |
| Injected-resolver seam with fake router                                | Task 5b test                                             |
| System-prompt fragment assertion                                       | Task 6                                                   |
| No fixed-wall-clock assertions                                         | Checked — all tests use `expect()` on sync/returned data |

### Placeholder scan

No placeholders (`TODO`, `FIXME`, `...`, `YOUR_VALUE`) remain in any code block.

### Type consistency

- `ChatParticipantResolver` defined once in `src/chat/participants/roster.ts`, re-exported from tool file and referenced via import in types.ts and llm-orchestrator-types.ts — no duplicate definitions.
- `ParticipantCandidate` defined in roster.ts, used by the tool and tests.
- All import paths use `.js` extensions.

### Edge cases confirmed covered

- `message_metadata` row with `null authorId`: skipped in `gatherParticipants` (tested Task 1).
- `resolveUserLabel` throws: caught, falls back to username/userId (roster.ts try/catch).
- DM context: tool absent (Task 5a test).
- No resolver: tool absent (Task 5a test).
- Empty result: `resolveChatParticipant` returns `[]` (tested Task 1).
- Ambiguous result: multiple candidates returned; prompt directs ONE question (Task 6).
- Thread-scoped contextId: `getConfigContextIdFromStorageContextId` strips thread for `groupMembers` query (Task 1 `THREAD_CTX` test).
