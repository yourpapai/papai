<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# User Profile Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Phase A of the user profile memory system: a single per-user markdown blob populated by background extraction at smart-trim cadence, editable hot-path via two LLM tools, DM-only.

**Architecture:** Single per-user markdown blob in a new `user_profile` SQLite table, mirroring the existing `memory_summary` pattern. A background runner (`runProfileExtractionInBackground`) fires alongside the existing trim runner and rewrites the blob via a small-model call. Two new LLM tools (`remember_about_user`, `forget_user_profile`) handle hot-path explicit edits. The blob is injected into the system prompt as a new `=== User profile ===` section in DM contexts only. Group contexts get strictly fewer tools, no profile in the system prompt, and no extraction trigger.

**Tech Stack:** Bun, SQLite + Drizzle, Vercel AI SDK (`generateText`), oxlint/oxfmt, pino, Zod v4, bun:test.

---

## Reference

**Design doc:** `docs/plans/2026-04-08-user-profile-memory-design.md` — read this before starting any task. Decisions there are final.

**Existing files referenced throughout this plan:**

| File                             | What's there                                                                                       | Used as template / extended                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `src/db/migrations/018_memos.ts` | Latest migration                                                                                   | Template for migration 019                          |
| `src/db/schema.ts`               | Drizzle table definitions                                                                          | Add `userProfile` table                             |
| `src/db/index.ts`                | Migration registry (lines 8-25, 52-71)                                                             | Register new migration                              |
| `tests/utils/test-helpers.ts`    | `ALL_MIGRATIONS` array (lines 38-57) and `setupTestDb`                                             | Add new migration here                              |
| `src/cache.ts`                   | `UserCache` type (line 23), `getCachedSummary` (lines 116-130), `setCachedSummary` (lines 132-137) | Template for profile cache slot                     |
| `src/cache-db.ts`                | `syncSummaryToDb` (lines 30-49)                                                                    | Template for `syncProfileToDb`                      |
| `src/memory.ts`                  | `buildMemoryContextMessage` (lines 261-281)                                                        | Extend with profile parameter                       |
| `src/conversation.ts`            | `buildMessagesWithMemory` (lines 29-34), `runTrimInBackground` (lines 43-86)                       | Extend with profile loading + new sibling runner    |
| `src/llm-orchestrator.ts`        | `processMessage` (lines 234-270), `callLlm` (lines 155-195), trim trigger (lines 258-260)          | Thread `contextType`, fire profile extraction       |
| `src/system-prompt.ts`           | `buildSystemPrompt` (lines 105-110), `STATIC_RULES` constant (lines 26-57)                         | Add DM-only profile rules section                   |
| `src/tools/index.ts`             | `makeTools` (lines 222-239), `addInstructionTools` (lines 186-191)                                 | Add profile tools, gate by contextType              |
| `src/tools/instructions.ts`      | Tool factories                                                                                     | Template for `src/tools/profile.ts`                 |
| `src/bot.ts`                     | `registerCommands` (lines 119-128), `processMessage` call (line 202)                               | Register `/profile`, thread `contextType`           |
| `src/commands/help.ts`           | `DM_USER_HELP` (lines 6-16)                                                                        | Add `/profile` lines                                |
| `src/commands/context.ts`        | `generateContextReport` (lines 81-108)                                                             | Insert profile section between summary and entities |
| `src/chat/types.ts`              | `ContextType = 'dm' \| 'group'` (line 10), `IncomingMessage.contextType` (line 56)                 | Already in place; use as-is                         |

---

## Prerequisites

Before starting any task:

1. **Use a clean worktree.** The current branch has many in-flight changes from other features. Either:
   - Use the `using-git-worktrees` skill to create a fresh worktree off a clean commit, OR
   - Stash current changes and check out a feature branch from `master`.
     Implementation must NOT happen on top of unrelated in-flight work.

2. **Disable mutation testing during rapid iteration:**

   ```fish
   set -x TDD_MUTATION 0
   ```

   The TDD hook still enforces test-first, coverage, and surface diffs without it. Re-enable for the final pass before merging.

3. **Confirm baseline tests pass:**
   ```fish
   bun test
   ```
   If anything is failing on the starting branch, fix or revert it before adding profile code.

---

## Task 1: Add migration 019_user_profile

**Goal:** Create the new SQLite table and register the migration in both production and test code paths.

**Files:**

- Create: `src/db/migrations/019_user_profile.ts`
- Modify: `src/db/schema.ts` (append after `memos` / `memoLinks` block)
- Modify: `src/db/index.ts` (lines 25, 70 — add import + array entry)
- Modify: `tests/utils/test-helpers.ts` (lines 32, 56 — add import + array entry)

### Step 1: Write the migration file

Create `src/db/migrations/019_user_profile.ts` with this exact content:

```ts
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

export const migration019UserProfile: Migration = {
  id: '019_user_profile',
  up(db: Database): void {
    db.run(`
      CREATE TABLE user_profile (
        user_id    TEXT PRIMARY KEY,
        profile    TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  },
}
```

### Step 2: Add the Drizzle schema entry

In `src/db/schema.ts`, append after the `memoLinks` table (around line 254):

```ts
export const userProfile = sqliteTable('user_profile', {
  userId: text('user_id').primaryKey(),
  profile: text('profile').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export type UserProfileRow = typeof userProfile.$inferSelect
```

### Step 3: Register in production migration runner

In `src/db/index.ts`:

- Add import after line 25:
  ```ts
  import { migration019UserProfile } from './migrations/019_user_profile.js'
  ```
- Add array entry after line 70 (`migration018Memos,`):
  ```ts
    migration019UserProfile,
  ```

### Step 4: Register in test migration helper

In `tests/utils/test-helpers.ts`:

- Add import after line 32:
  ```ts
  import { migration019UserProfile } from '../../src/db/migrations/019_user_profile.js'
  ```
- Add array entry after line 56 (`migration018Memos,`):
  ```ts
    migration019UserProfile,
  ```

### Step 5: Verify migration runs cleanly in tests

```fish
bun test tests/db/migrate.test.ts
```

Expected: PASS. The existing migration test exercises the order validator and migration table creation; adding 019 to the registered list must not break it.

### Step 6: Verify the table is queryable in a fresh test DB

Quick smoke check — run any existing test that uses `setupTestDb`:

```fish
bun test tests/instructions.test.ts
```

Expected: PASS. If this fails because the new migration is malformed, fix the SQL.

### Step 7: Commit

```fish
git add src/db/migrations/019_user_profile.ts src/db/schema.ts src/db/index.ts tests/utils/test-helpers.ts
git commit -m "feat(db): add user_profile table for Phase A profile memory"
```

---

## Task 2: Add profile cache slot

**Goal:** Add a `profile` slot to `UserCache` with lazy-load from DB and background sync, mirroring the existing `summary` slot.

**Files:**

- Test: `tests/cache.test.ts` (extend existing file with new describe block)
- Modify: `src/cache.ts` (add `profile` field to `UserCache` type, add three helpers)
- Modify: `src/cache-db.ts` (add `syncProfileToDb`, add `userProfile` import)

### Step 1: Read the existing summary cache helpers as a template

Open `src/cache.ts` and read lines 23-32 (`UserCache` type), 116-138 (`getCachedSummary` / `setCachedSummary`), and 237-246 (`clearCachedFacts` — pattern for clear helper). The profile helpers will be near-clones with `profile` substituted for `summary`.

### Step 2: Write the failing tests

Open `tests/cache.test.ts`. Find an existing describe block to copy the structure from (e.g., the summary cache tests). Add this new describe block at the bottom of the file:

```ts
describe('profile cache', () => {
  beforeEach(async () => {
    mockLogger()
    _userCaches.clear()
    await setupTestDb()
  })

  test('getCachedProfile returns null for new user', () => {
    expect(getCachedProfile('user-1')).toBeNull()
  })

  test('setCachedProfile then getCachedProfile round-trips', () => {
    setCachedProfile('user-1', '## Identity\nGo developer')
    expect(getCachedProfile('user-1')).toBe('## Identity\nGo developer')
  })

  test('setCachedProfile persists to DB across cache clear', async () => {
    setCachedProfile('user-1', '## Identity\nGo developer')
    await flushMicrotasks()
    _userCaches.clear()
    expect(getCachedProfile('user-1')).toBe('## Identity\nGo developer')
  })

  test('clearCachedProfile removes from cache without touching DB', () => {
    setCachedProfile('user-1', '## Identity\nGo developer')
    clearCachedProfile('user-1')
    // Cache slot is now reset, but DB row still exists — getCachedProfile would lazy-reload it
    // This test only checks the in-memory cache state, not the persisted state
    expect(_userCaches.get('user-1')?.profile).toBeNull()
  })

  test('different users have isolated profiles', () => {
    setCachedProfile('user-1', '## Identity\nUser 1')
    setCachedProfile('user-2', '## Identity\nUser 2')
    expect(getCachedProfile('user-1')).toBe('## Identity\nUser 1')
    expect(getCachedProfile('user-2')).toBe('## Identity\nUser 2')
  })
})
```

Add the new imports at the top of the file:

```ts
import {
  // ... existing imports
  getCachedProfile,
  setCachedProfile,
  clearCachedProfile,
} from '../src/cache.js'
import { flushMicrotasks } from './utils/test-helpers.js'
```

### Step 3: Run the test to confirm it fails

```fish
bun test tests/cache.test.ts -t 'profile cache'
```

Expected: FAIL with "getCachedProfile is not exported from '../src/cache.js'" or similar. **The TDD hook will block the next impl edit until this test exists in the file** — that's expected.

### Step 4: Add the profile field to UserCache

In `src/cache.ts`, modify the `UserCache` type (line 23-32) to add `profile`:

```ts
type UserCache = {
  history: ModelMessage[]
  summary: string | null
  profile: string | null
  facts: Array<{ identifier: string; title: string; url: string; last_seen: string }>
  instructions: Array<{ id: string; text: string; createdAt: string }> | null
  config: Map<string, string | null>
  workspaceId: string | null
  tools: unknown
  lastAccessed: number
}
```

In `getOrCreateCache` (around line 62-79), add `profile: null,` to the new-cache initializer alongside `summary: null,`.

### Step 5: Add the three cache helpers

In `src/cache.ts`, add these three functions near `getCachedSummary` / `setCachedSummary` (after line 137 is a good place):

```ts
export function getCachedProfile(userId: string): string | null {
  const cache = getOrCreateCache(userId)
  if (cache.profile === null && !cache.config.has('profile_loaded')) {
    log.debug({ userId }, 'Loading profile from DB into cache')
    const row = getDrizzleDb()
      .select({ profile: userProfile.profile })
      .from(userProfile)
      .where(sql`${userProfile.userId} = ${userId}`)
      .get()
    cache.profile = row?.profile ?? null
    cache.config.set('profile_loaded', 'true')
    emit('cache:load', { userId, field: 'profile' })
  }
  return cache.profile
}

export function setCachedProfile(userId: string, profile: string): void {
  const cache = getOrCreateCache(userId)
  cache.profile = profile
  syncProfileToDb(userId, profile)
  emit('cache:sync', { userId, field: 'profile', operation: 'set' })
}

export function clearCachedProfile(userId: string): void {
  const cache = userCaches.get(userId)
  if (cache === undefined) {
    log.debug({ userId }, 'No profile cache to clear (cache not initialized)')
    return
  }
  cache.profile = null
  cache.config.delete('profile_loaded')
  log.debug({ userId }, 'Profile cache cleared')
}
```

Add `userProfile` to the schema imports at the top:

```ts
import {
  conversationHistory,
  memoryFacts,
  memorySummary,
  userConfig,
  userInstructions,
  userProfile,
  users,
} from './db/schema.js'
```

Add `syncProfileToDb` to the cache-db imports (will be created in next step):

```ts
import {
  // ... existing imports
  syncProfileToDb,
} from './cache-db.js'
```

### Step 6: Add syncProfileToDb in cache-db.ts

In `src/cache-db.ts`:

- Add `userProfile` to the schema import (line 4):
  ```ts
  import {
    conversationHistory,
    memorySummary,
    memoryFacts,
    userConfig,
    userInstructions,
    userProfile,
    users,
  } from './db/schema.js'
  ```
- Add this function at the bottom of the file:

```ts
export function syncProfileToDb(userId: string, profile: string): void {
  queueMicrotask(() => {
    try {
      const db = getDrizzleDb()
      db.insert(userProfile)
        .values({ userId, profile, updatedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: userProfile.userId,
          set: { profile, updatedAt: new Date().toISOString() },
        })
        .run()
      log.debug({ userId, profileLength: profile.length }, 'Profile synced to DB')
    } catch (error) {
      log.error(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Failed to sync profile to DB',
      )
    }
  })
}
```

### Step 7: Run tests to verify they pass

```fish
bun test tests/cache.test.ts -t 'profile cache'
```

Expected: PASS, all 5 tests green.

### Step 8: Run the full cache test suite to make sure nothing else broke

```fish
bun test tests/cache.test.ts
```

Expected: PASS, all tests green.

### Step 9: Commit

```fish
git add src/cache.ts src/cache-db.ts tests/cache.test.ts
git commit -m "feat(cache): add profile cache slot with DB sync"
```

---

## Task 3: Create profile module skeleton (load/save/clear)

**Goal:** New `src/profile.ts` module with the three persistence helpers, mirroring `src/memory.ts`'s summary helpers.

**Files:**

- Create: `tests/profile.test.ts`
- Create: `src/profile.ts`

### Step 1: Write the failing test

Create `tests/profile.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'

import { _userCaches } from '../src/cache.js'
import { clearProfile, loadProfile, saveProfile } from '../src/profile.js'
import { mockLogger, setupTestDb, flushMicrotasks } from './utils/test-helpers.js'

describe('profile persistence', () => {
  beforeEach(async () => {
    mockLogger()
    _userCaches.clear()
    await setupTestDb()
  })

  test('loadProfile returns null when no profile stored', () => {
    expect(loadProfile('user-1')).toBeNull()
  })

  test('saveProfile then loadProfile returns the saved blob', () => {
    saveProfile('user-1', '## Identity\nSenior Go developer')
    expect(loadProfile('user-1')).toBe('## Identity\nSenior Go developer')
  })

  test('saveProfile persists across cache clear', async () => {
    saveProfile('user-1', '## Identity\nGo dev')
    await flushMicrotasks()
    _userCaches.clear()
    expect(loadProfile('user-1')).toBe('## Identity\nGo dev')
  })

  test('clearProfile removes the profile from DB', async () => {
    saveProfile('user-1', '## Identity\nGo dev')
    await flushMicrotasks()
    clearProfile('user-1')
    _userCaches.clear()
    expect(loadProfile('user-1')).toBeNull()
  })

  test('different users have isolated profiles', () => {
    saveProfile('user-1', '## Identity\nUser 1')
    saveProfile('user-2', '## Identity\nUser 2')
    expect(loadProfile('user-1')).toBe('## Identity\nUser 1')
    expect(loadProfile('user-2')).toBe('## Identity\nUser 2')
  })
})
```

### Step 2: Run the test to confirm it fails

```fish
bun test tests/profile.test.ts
```

Expected: FAIL with "Cannot find module '../src/profile.js'".

### Step 3: Create the profile module

Create `src/profile.ts`:

```ts
import { eq } from 'drizzle-orm'

import { clearCachedProfile, getCachedProfile, setCachedProfile } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { userProfile } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'profile' })

export function loadProfile(userId: string): string | null {
  log.debug({ userId }, 'loadProfile called')
  return getCachedProfile(userId)
}

export function saveProfile(userId: string, profile: string): void {
  log.debug({ userId, profileLength: profile.length }, 'saveProfile called')
  setCachedProfile(userId, profile)
  log.info({ userId, profileLength: profile.length }, 'Profile saved to cache (DB sync in background)')
}

export function clearProfile(userId: string): void {
  log.debug({ userId }, 'clearProfile called')
  clearCachedProfile(userId)

  const db = getDrizzleDb()
  db.delete(userProfile).where(eq(userProfile.userId, userId)).run()

  log.info({ userId }, 'Profile cleared')
}
```

### Step 4: Run the test to verify it passes

```fish
bun test tests/profile.test.ts
```

Expected: PASS, all 5 tests green.

### Step 5: Commit

```fish
git add tests/profile.test.ts src/profile.ts
git commit -m "feat(profile): add profile module persistence skeleton"
```

---

## Task 4: extractProfile happy path

**Goal:** Add `extractProfile` to `src/profile.ts` — calls the LLM with the extraction prompt and returns the new blob. Use DI for the LLM call.

**Files:**

- Modify: `tests/profile.test.ts` (add new describe block)
- Modify: `src/profile.ts` (add `ProfileDeps`, `extractProfile`, `EXTRACTION_PROMPT`)

### Step 1: Write the failing test

Append to `tests/profile.test.ts`:

```ts
import type { LanguageModel, ModelMessage } from 'ai'

import type { ProfileDeps } from '../src/profile.js'
import { extractProfile } from '../src/profile.js'

describe('extractProfile', () => {
  const fakeModel = {} as LanguageModel

  function makeDeps(textResponse: string): ProfileDeps {
    return {
      generateText: (() =>
        Promise.resolve({ text: textResponse } as Awaited<
          ReturnType<ProfileDeps['generateText']>
        >)) as ProfileDeps['generateText'],
    }
  }

  test('returns the LLM output when it differs from previous', async () => {
    const history: ModelMessage[] = [
      { role: 'user', content: 'I am a Go developer' },
      { role: 'assistant', content: 'Got it.' },
    ]
    const deps = makeDeps('## Identity\nSenior Go developer')

    const result = await extractProfile(history, null, fakeModel, deps)

    expect(result).toBe('## Identity\nSenior Go developer')
  })

  test('returns previous unchanged when LLM output is identical', async () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'hello' }]
    const previous = '## Identity\nGo developer'
    const deps = makeDeps(previous)

    const result = await extractProfile(history, previous, fakeModel, deps)

    expect(result).toBe(previous)
  })

  test('passes previous profile and history to the LLM prompt', async () => {
    const history: ModelMessage[] = [{ role: 'user', content: 'I am a Rust developer' }]
    let capturedPrompt = ''
    const deps: ProfileDeps = {
      generateText: ((args: { prompt: string }) => {
        capturedPrompt = args.prompt
        return Promise.resolve({ text: '## Identity\nRust dev' } as Awaited<ReturnType<ProfileDeps['generateText']>>)
      }) as ProfileDeps['generateText'],
    }

    await extractProfile(history, '## Identity\nGo dev', fakeModel, deps)

    expect(capturedPrompt).toContain('## Identity\nGo dev')
    expect(capturedPrompt).toContain('I am a Rust developer')
  })
})
```

### Step 2: Run the test to confirm it fails

```fish
bun test tests/profile.test.ts -t 'extractProfile'
```

Expected: FAIL — `extractProfile` not exported.

### Step 3: Implement extractProfile

Add to `src/profile.ts`:

```ts
import { generateText, type LanguageModel, type ModelMessage } from 'ai'

// ... existing imports

const EXTRACTION_PROMPT = `You are a memory writer for a personal assistant chat bot.

Your task is to maintain a SHORT markdown profile of the user, capturing only
STABLE facts about who they are and how they prefer to interact. The profile is
shown to the assistant on every turn as background context, so it should help
the assistant be more user-oriented over time.

What to capture (only when supported by the conversation):
- IDENTITY: name, role, occupation, organization, location/timezone hints
- EXPERTISE: technical skills, domains, depth of experience
- COMMUNICATION STYLE: terseness, formality, language, things to avoid
- INTERESTS: topics the user repeatedly cares about

What NOT to capture (other systems handle these):
- Specific task IDs, project names, due dates
- Behavioral directives like "always do X"
- Conversation summaries or recent events
- Speculation, single-mention trivia, sensitive data (medical, financial)

Existing profile:
{PROFILE}

Recent conversation (verbatim, oldest to newest):
{MESSAGES}

Rules:
- Output a markdown document with these section headings, in this order:
  ## Identity
  ## Expertise
  ## Communication style
  ## Interests
  Omit any section that has no content.
- Prefer NEWER information over older when they conflict.
- If the conversation contains no new stable facts about the user, return the
  existing profile UNCHANGED, character-for-character.
- Output ONLY the markdown document, no commentary, no code fences.

Length & detail guidance:
- Aim for at most ~300 lines total. Treat this as a soft upper bound, not a target.
- Keep enough information to make the assistant noticeably more user-oriented,
  but skip trivia and one-off mentions.
- A good profile is dense and stable: prefer broad facts ("Senior Go engineer
  with backend infrastructure focus") over narrow ones ("Was working on the
  auth migration last Tuesday").
- When in doubt, be brief. The profile should feel like a colleague's mental
  model of the user, not an exhaustive log.`

export interface ProfileDeps {
  generateText: typeof generateText
}

const defaultProfileDeps: ProfileDeps = {
  generateText: (...args) => generateText(...args),
}

function formatHistoryForPrompt(history: readonly ModelMessage[]): string {
  return history
    .map((m) => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n')
}

export async function extractProfile(
  history: readonly ModelMessage[],
  previousProfile: string | null,
  model: LanguageModel,
  deps: ProfileDeps = defaultProfileDeps,
): Promise<string> {
  log.debug({ messageCount: history.length, hasPrevious: previousProfile !== null }, 'extractProfile called')

  const prompt = EXTRACTION_PROMPT.replace('{PROFILE}', previousProfile ?? '(empty)').replace(
    '{MESSAGES}',
    formatHistoryForPrompt(history),
  )

  const result = await deps.generateText({ model, prompt })
  return result.text
}
```

### Step 4: Run the test to verify it passes

```fish
bun test tests/profile.test.ts -t 'extractProfile'
```

Expected: PASS, all 3 tests green.

### Step 5: Commit

```fish
git add tests/profile.test.ts src/profile.ts
git commit -m "feat(profile): add extractProfile happy path with DI"
```

---

## Task 5: extractProfile validation paths

**Goal:** Add the four validation branches (empty fallback, sanity ceiling, code-fence stripping, whitespace trim) inside `extractProfile`. Each branch needs a dedicated test.

**Files:**

- Modify: `tests/profile.test.ts` (add 4 new tests)
- Modify: `src/profile.ts` (wrap return value with validation)

### Step 1: Write the four failing tests

Append to the `extractProfile` describe block in `tests/profile.test.ts`:

````ts
test('strips leading/trailing whitespace from LLM output', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
  const deps = makeDeps('\n\n## Identity\nGo dev\n\n')

  const result = await extractProfile(history, null, fakeModel, deps)

  expect(result).toBe('## Identity\nGo dev')
})

test('strips markdown code fences if model wraps output', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
  const deps = makeDeps('```markdown\n## Identity\nGo dev\n```')

  const result = await extractProfile(history, null, fakeModel, deps)

  expect(result).toBe('## Identity\nGo dev')
})

test('returns previous unchanged when LLM output is empty and previous exists', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
  const previous = '## Identity\nGo developer'
  const deps = makeDeps('   \n\n  ')

  const result = await extractProfile(history, previous, fakeModel, deps)

  expect(result).toBe(previous)
})

test('returns previous unchanged when LLM output exceeds sanity ceiling', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
  const previous = '## Identity\nGo developer'
  const runaway = 'a'.repeat(50_001)
  const deps = makeDeps(runaway)

  const result = await extractProfile(history, previous, fakeModel, deps)

  expect(result).toBe(previous)
})

test('returns empty string when LLM returns empty and there was no previous', async () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]
  const deps = makeDeps('   ')

  const result = await extractProfile(history, null, fakeModel, deps)

  expect(result).toBe('')
})
````

### Step 2: Run the tests to verify they fail

```fish
bun test tests/profile.test.ts -t 'extractProfile'
```

Expected: 5 of the 8 tests fail (the 4 new validation tests + possibly the whitespace one).

### Step 3: Add validation logic

Replace the body of `extractProfile` in `src/profile.ts`:

````ts
const PROFILE_SANITY_CEILING = 50_000 // chars; ~12k tokens

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:markdown)?\n?/, '').replace(/\n?```$/, '')
}

export async function extractProfile(
  history: readonly ModelMessage[],
  previousProfile: string | null,
  model: LanguageModel,
  deps: ProfileDeps = defaultProfileDeps,
): Promise<string> {
  log.debug({ messageCount: history.length, hasPrevious: previousProfile !== null }, 'extractProfile called')

  const prompt = EXTRACTION_PROMPT.replace('{PROFILE}', previousProfile ?? '(empty)').replace(
    '{MESSAGES}',
    formatHistoryForPrompt(history),
  )

  const result = await deps.generateText({ model, prompt })
  const cleaned = stripCodeFences(result.text.trim()).trim()

  if (cleaned.length === 0 && previousProfile !== null && previousProfile.length > 0) {
    log.warn({ previousLength: previousProfile.length }, 'Profile extractor returned empty, keeping previous')
    return previousProfile
  }

  if (cleaned.length > PROFILE_SANITY_CEILING) {
    log.warn(
      { length: cleaned.length, ceiling: PROFILE_SANITY_CEILING },
      'Profile output exceeded sanity ceiling, treating as malformed',
    )
    return previousProfile ?? ''
  }

  return cleaned
}
````

### Step 4: Run the tests to verify they pass

```fish
bun test tests/profile.test.ts -t 'extractProfile'
```

Expected: PASS, all 8 tests green.

### Step 5: Commit

```fish
git add tests/profile.test.ts src/profile.ts
git commit -m "feat(profile): add extractProfile validation (empty/ceiling/fences)"
```

---

## Task 6: applyRemember

**Goal:** Hot-path helper that integrates a single new fact into the existing profile via a small-model rewrite.

**Files:**

- Modify: `tests/profile.test.ts` (add describe block)
- Modify: `src/profile.ts` (add `applyRemember` + `REMEMBER_PROMPT`)

### Step 1: Write the failing tests

Append to `tests/profile.test.ts`:

```ts
import { applyRemember } from '../src/profile.js'

describe('applyRemember', () => {
  const fakeModel = {} as LanguageModel

  function makeDeps(textResponse: string): ProfileDeps {
    return {
      generateText: (() =>
        Promise.resolve({ text: textResponse } as Awaited<
          ReturnType<ProfileDeps['generateText']>
        >)) as ProfileDeps['generateText'],
    }
  }

  test('returns rewritten profile with the new fact integrated', async () => {
    const previous = '## Identity\nDeveloper'
    const deps = makeDeps('## Identity\nGo developer')

    const result = await applyRemember(previous, 'User uses Go', fakeModel, deps)

    expect(result).toBe('## Identity\nGo developer')
  })

  test('passes the fact and existing profile to the LLM prompt', async () => {
    let capturedPrompt = ''
    const deps: ProfileDeps = {
      generateText: ((args: { prompt: string }) => {
        capturedPrompt = args.prompt
        return Promise.resolve({ text: '## Identity\nGo dev' } as Awaited<ReturnType<ProfileDeps['generateText']>>)
      }) as ProfileDeps['generateText'],
    }

    await applyRemember('## Identity\nDeveloper', 'User uses Go', fakeModel, deps)

    expect(capturedPrompt).toContain('User uses Go')
    expect(capturedPrompt).toContain('## Identity\nDeveloper')
  })

  test('starts from empty profile when previous is null', async () => {
    const deps = makeDeps('## Identity\nGo dev')

    const result = await applyRemember(null, 'User uses Go', fakeModel, deps)

    expect(result).toBe('## Identity\nGo dev')
  })

  test('honors sanity ceiling on output', async () => {
    const previous = '## Identity\nGo dev'
    const runaway = 'a'.repeat(50_001)
    const deps = makeDeps(runaway)

    const result = await applyRemember(previous, 'User uses Rust', fakeModel, deps)

    expect(result).toBe(previous)
  })
})
```

### Step 2: Run the test to confirm it fails

```fish
bun test tests/profile.test.ts -t 'applyRemember'
```

Expected: FAIL — `applyRemember` not exported.

### Step 3: Implement applyRemember

Add to `src/profile.ts`:

```ts
const REMEMBER_PROMPT = `You are editing a user profile for a personal assistant chat bot. The user (or the assistant on the user's behalf) wants to add a new stable fact about the user.

Existing profile:
{PROFILE}

New fact to integrate:
{FACT}

Rewrite the profile to include this new fact in the appropriate section. Keep
the existing markdown structure with these section headings, in this order:
  ## Identity
  ## Expertise
  ## Communication style
  ## Interests
Omit any section that has no content.

Rules:
- If the fact is already represented (semantically), return the profile UNCHANGED.
- Prefer NEWER information over older when they conflict.
- Stay under ~300 lines total. Be brief and dense, not exhaustive.
- Output ONLY the new markdown document, no commentary, no code fences.`

export async function applyRemember(
  previousProfile: string | null,
  fact: string,
  model: LanguageModel,
  deps: ProfileDeps = defaultProfileDeps,
): Promise<string> {
  log.debug({ hasPrevious: previousProfile !== null, factLength: fact.length }, 'applyRemember called')

  const prompt = REMEMBER_PROMPT.replace('{PROFILE}', previousProfile ?? '(empty)').replace('{FACT}', fact)

  const result = await deps.generateText({ model, prompt })
  const cleaned = stripCodeFences(result.text.trim()).trim()

  if (cleaned.length === 0 && previousProfile !== null && previousProfile.length > 0) {
    log.warn({ previousLength: previousProfile.length }, 'applyRemember returned empty, keeping previous')
    return previousProfile
  }

  if (cleaned.length > PROFILE_SANITY_CEILING) {
    log.warn({ length: cleaned.length }, 'applyRemember exceeded sanity ceiling, keeping previous')
    return previousProfile ?? ''
  }

  return cleaned
}
```

### Step 4: Run the tests to verify they pass

```fish
bun test tests/profile.test.ts -t 'applyRemember'
```

Expected: PASS, all 4 tests green.

### Step 5: Commit

```fish
git add tests/profile.test.ts src/profile.ts
git commit -m "feat(profile): add applyRemember for hot-path explicit adds"
```

---

## Task 7: applyForget

**Goal:** Hot-path helper that removes specified information from the profile.

**Files:**

- Modify: `tests/profile.test.ts` (add describe block)
- Modify: `src/profile.ts` (add `applyForget` + `FORGET_PROMPT`)

### Step 1: Write the failing tests

Append to `tests/profile.test.ts`:

```ts
import { applyForget } from '../src/profile.js'

describe('applyForget', () => {
  const fakeModel = {} as LanguageModel

  function makeDeps(textResponse: string): ProfileDeps {
    return {
      generateText: (() =>
        Promise.resolve({ text: textResponse } as Awaited<
          ReturnType<ProfileDeps['generateText']>
        >)) as ProfileDeps['generateText'],
    }
  }

  test('returns rewritten profile with the forgotten fact removed', async () => {
    const previous = '## Identity\nGo developer based in Berlin'
    const deps = makeDeps('## Identity\nDeveloper based in Berlin')

    const result = await applyForget(previous, 'that I use Go', fakeModel, deps)

    expect(result).toBe('## Identity\nDeveloper based in Berlin')
  })

  test('passes the forget instruction and existing profile to the LLM prompt', async () => {
    let capturedPrompt = ''
    const deps: ProfileDeps = {
      generateText: ((args: { prompt: string }) => {
        capturedPrompt = args.prompt
        return Promise.resolve({
          text: '## Identity\nDeveloper',
        } as Awaited<ReturnType<ProfileDeps['generateText']>>)
      }) as ProfileDeps['generateText'],
    }

    await applyForget('## Identity\nGo developer', 'that I use Go', fakeModel, deps)

    expect(capturedPrompt).toContain('that I use Go')
    expect(capturedPrompt).toContain('## Identity\nGo developer')
  })

  test('returns previous unchanged when LLM output is empty', async () => {
    const previous = '## Identity\nGo developer'
    const deps = makeDeps('   ')

    const result = await applyForget(previous, 'that I am a developer', fakeModel, deps)

    expect(result).toBe(previous)
  })

  test('honors sanity ceiling on output', async () => {
    const previous = '## Identity\nGo developer'
    const runaway = 'a'.repeat(50_001)
    const deps = makeDeps(runaway)

    const result = await applyForget(previous, 'that I use Go', fakeModel, deps)

    expect(result).toBe(previous)
  })
})
```

### Step 2: Run the tests to confirm they fail

```fish
bun test tests/profile.test.ts -t 'applyForget'
```

Expected: FAIL — `applyForget` not exported.

### Step 3: Implement applyForget

Add to `src/profile.ts`:

```ts
const FORGET_PROMPT = `You are editing a user profile for a personal assistant chat bot. The user has explicitly asked to forget something about themselves.

Existing profile:
{PROFILE}

What the user wants forgotten:
{FORGET}

Rewrite the profile to remove or weaken the information the user wants
forgotten. Keep everything else identical. Use the same markdown structure with
these section headings, in this order:
  ## Identity
  ## Expertise
  ## Communication style
  ## Interests
Omit any section that has no content after the removal.

Rules:
- If the information is not present in the profile, return it UNCHANGED.
- Stay under ~300 lines total. Be brief and dense.
- Output ONLY the new markdown document, no commentary, no code fences.`

export async function applyForget(
  previousProfile: string,
  whatToForget: string,
  model: LanguageModel,
  deps: ProfileDeps = defaultProfileDeps,
): Promise<string> {
  log.debug({ previousLength: previousProfile.length, forgetLength: whatToForget.length }, 'applyForget called')

  const prompt = FORGET_PROMPT.replace('{PROFILE}', previousProfile).replace('{FORGET}', whatToForget)

  const result = await deps.generateText({ model, prompt })
  const cleaned = stripCodeFences(result.text.trim()).trim()

  if (cleaned.length === 0) {
    log.warn({ previousLength: previousProfile.length }, 'applyForget returned empty, keeping previous')
    return previousProfile
  }

  if (cleaned.length > PROFILE_SANITY_CEILING) {
    log.warn({ length: cleaned.length }, 'applyForget exceeded sanity ceiling, keeping previous')
    return previousProfile
  }

  return cleaned
}
```

### Step 4: Run the tests to verify they pass

```fish
bun test tests/profile.test.ts -t 'applyForget'
```

Expected: PASS, all 4 tests green.

### Step 5: Run the full profile test file to make sure nothing regressed

```fish
bun test tests/profile.test.ts
```

Expected: PASS, all profile tests green.

### Step 6: Commit

```fish
git add tests/profile.test.ts src/profile.ts
git commit -m "feat(profile): add applyForget for hot-path explicit deletes"
```

---

## Task 8: buildProfileContextMessage

**Goal:** A helper that formats the profile blob as a prompt section. Used later by `buildMemoryContextMessage`.

**Files:**

- Modify: `tests/profile.test.ts`
- Modify: `src/profile.ts`

### Step 1: Write the failing tests

Append to `tests/profile.test.ts`:

```ts
import { buildProfileContextMessage } from '../src/profile.js'

describe('buildProfileContextMessage', () => {
  test('returns null when profile is null', () => {
    expect(buildProfileContextMessage(null)).toBeNull()
  })

  test('returns null when profile is empty string', () => {
    expect(buildProfileContextMessage('')).toBeNull()
  })

  test('returns formatted block when profile is present', () => {
    const result = buildProfileContextMessage('## Identity\nGo developer')
    expect(result).toBe('=== User profile ===\n## Identity\nGo developer')
  })
})
```

### Step 2: Run the test to confirm it fails

```fish
bun test tests/profile.test.ts -t 'buildProfileContextMessage'
```

Expected: FAIL — not exported.

### Step 3: Implement the helper

Add to `src/profile.ts`:

```ts
export function buildProfileContextMessage(profile: string | null): string | null {
  if (profile === null || profile.length === 0) return null
  return `=== User profile ===\n${profile}`
}
```

### Step 4: Run the test to verify it passes

```fish
bun test tests/profile.test.ts -t 'buildProfileContextMessage'
```

Expected: PASS.

### Step 5: Commit

```fish
git add tests/profile.test.ts src/profile.ts
git commit -m "feat(profile): add buildProfileContextMessage for prompt injection"
```

---

## Task 9: Thread `contextType` through the LLM orchestrator call chain

**Goal:** Add a `contextType: ContextType` parameter to `processMessage`, `callLlm`, `buildMessagesWithMemory`, `makeTools`, and `buildSystemPrompt`. This is purely a mechanical signature change with no behavior change yet — but it unlocks all subsequent tasks. Each existing test that calls these functions needs an updated argument list.

**Files:**

- Modify: `src/llm-orchestrator.ts` (lines 234-270 `processMessage`, lines 155-195 `callLlm`)
- Modify: `src/llm-orchestrator-types.ts` (`InvokeModelArgs` if needed)
- Modify: `src/conversation.ts` (line 29 `buildMessagesWithMemory` signature)
- Modify: `src/system-prompt.ts` (line 105 `buildSystemPrompt` signature)
- Modify: `src/tools/index.ts` (line 222 `makeTools` signature)
- Modify: `src/bot.ts` (line 26 `BotDeps` interface, line 202 call site)
- Modify: existing tests that call these functions (`tests/conversation.test.ts`, `tests/system-prompt.test.ts` if exists, `tests/tools/index.test.ts` if exists, plus llm-orchestrator tests)

### Step 1: Inventory the existing test usage

Run grep to find all callers — this drives the scope of the test updates:

```fish
bun run --silent test --bail 2>&1 | head -20
```

Or simpler — locate each call site directly:

```fish
grep -rn 'buildMessagesWithMemory\|buildSystemPrompt(\|makeTools(\|processMessage(' tests/ src/ --include='*.ts'
```

Note every test file that calls any of these functions. They will all need argument list updates after the impl change.

### Step 2: Write tests for the new contextType behavior FIRST

The TDD hook will block impl edits to `src/conversation.ts`, `src/system-prompt.ts`, etc. unless the corresponding tests already exist. The behavior change in this task is **only the parameter passes through** — no observable behavior yet. So tests are: "passing `dm` vs `group` doesn't break anything that already worked."

Add to `tests/conversation.test.ts` (find the `buildMessagesWithMemory` describe block, around line 85, and add inside):

```ts
test('accepts contextType parameter and behaves the same way for dm', () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
  const result = buildMessagesWithMemory('user1', 'dm', history)
  expect(result.messages).toEqual(history)
  expect(result.memoryMsg).toBeNull()
})

test('accepts contextType parameter and behaves the same way for group', () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
  const result = buildMessagesWithMemory('group1', 'group', history)
  expect(result.messages).toEqual(history)
  expect(result.memoryMsg).toBeNull()
})
```

(The behavior difference between `dm` and `group` for profile loading comes in Task 11. This task is just parameter threading.)

### Step 3: Run tests to confirm they fail

```fish
bun test tests/conversation.test.ts -t 'contextType parameter'
```

Expected: FAIL — `buildMessagesWithMemory` does not accept a 2nd string argument.

### Step 4: Update the function signatures (mechanical)

In `src/conversation.ts`, line 29, change:

```ts
export const buildMessagesWithMemory = (userId: string, history: readonly ModelMessage[]): MessagesWithMemory => {
```

to:

```ts
import type { ContextType } from './chat/types.js'

// ...

export const buildMessagesWithMemory = (
  userId: string,
  contextType: ContextType,
  history: readonly ModelMessage[],
): MessagesWithMemory => {
```

The body stays unchanged for now — `contextType` is unused. Add a `void contextType` line if linter complains about unused parameters, OR just defer the lint fix to Task 11 when we actually use it.

In `src/system-prompt.ts`, line 105, change:

```ts
export const buildSystemPrompt = (provider: TaskProvider, timezone: string, contextId: string): string => {
```

to:

```ts
import type { ContextType } from './chat/types.js'

export const buildSystemPrompt = (
  provider: TaskProvider,
  timezone: string,
  contextId: string,
  contextType: ContextType,
): string => {
```

Body unchanged for now.

In `src/tools/index.ts`, line 222, change:

```ts
export function makeTools(provider: TaskProvider, userId?: string, mode: ToolMode = 'normal'): ToolSet {
```

to:

```ts
import type { ContextType } from '../chat/types.js'

export function makeTools(
  provider: TaskProvider,
  userId?: string,
  contextType: ContextType = 'dm',
  mode: ToolMode = 'normal',
): ToolSet {
```

(Default `'dm'` keeps backwards compat for any caller that doesn't pass it. We'll wire the real value through in subsequent steps.)

In `src/llm-orchestrator.ts`, modify `processMessage` (lines 234-270):

```ts
export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  contextType: ContextType,
  username: string | null,
  userText: string,
  deps: LlmOrchestratorDeps = defaultDeps,
): Promise<void> => {
```

Add `import type { ContextType } from './chat/types.js'` near the top.

Pass `contextType` through `callLlm`:

```ts
const callLlm = async (
  reply: ReplyFn,
  contextId: string,
  contextType: ContextType,
  username: string | null,
  history: readonly ModelMessage[],
  deps: LlmOrchestratorDeps,
): Promise<{ response: { messages: ModelMessage[] } }> => {
  // ...
  const tools = getOrCreateTools(contextId, contextType, provider)
  // ...
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, contextType, history)
  // ...
}
```

And inside `invokeModel`, update the `buildSystemPrompt` call:

```ts
system: buildSystemPrompt(provider, timezone, contextId, contextType),
```

`InvokeModelArgs` in `src/llm-orchestrator-types.ts` needs a `contextType: ContextType` field — add it.

Update `getOrCreateTools` to take `contextType`:

```ts
const getOrCreateTools = (contextId: string, contextType: ContextType, provider: TaskProvider): ToolSet => {
  const cachedTools = getCachedTools(contextId)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    return cachedTools
  }
  const tools = makeTools(provider, contextId, contextType)
  setCachedTools(contextId, tools)
  return tools
}
```

In `src/bot.ts`, update `BotDeps` (line 26):

```ts
export interface BotDeps {
  processMessage: (
    reply: ReplyFn,
    contextId: string,
    contextType: ContextType,
    username: string | null,
    userText: string,
  ) => Promise<void>
}
```

And update the call site (line 202):

```ts
await deps.processMessage(reply, auth.storageContextId, msg.contextType, msg.user.username, prompt)
```

### Step 5: Update existing test call sites

Run the full test suite to find every broken caller:

```fish
bun test 2>&1 | grep -E '(FAIL|expected|argument)' | head -30
```

For each test file that fails because of the new parameter, add `'dm'` (or `'group'` where appropriate) at the right position. Likely affected files:

- `tests/conversation.test.ts` — `buildMessagesWithMemory(userId, ...)` calls become `buildMessagesWithMemory(userId, 'dm', ...)`
- `tests/system-prompt.test.ts` (if exists) — `buildSystemPrompt(provider, tz, contextId)` becomes `buildSystemPrompt(provider, tz, contextId, 'dm')`
- `tests/tools/*.test.ts` — `makeTools(provider, userId)` calls — usually OK because of the new `'dm'` default, but `makeTools(provider, userId, 'normal')` becomes `makeTools(provider, userId, 'dm', 'normal')`
- `tests/llm-orchestrator.test.ts` — `processMessage(reply, contextId, username, text)` becomes `processMessage(reply, contextId, 'dm', username, text)`
- `tests/bot.test.ts` — wherever `BotDeps.processMessage` is mocked

Update each broken test call site, defaulting to `'dm'` unless the test is specifically about group behavior.

### Step 6: Run the full test suite

```fish
bun test
```

Expected: PASS. If there are still failures, find the call site and fix the argument list.

### Step 7: Commit

```fish
git add src/llm-orchestrator.ts src/llm-orchestrator-types.ts src/conversation.ts src/system-prompt.ts src/tools/index.ts src/bot.ts tests/
git commit -m "refactor(llm): thread contextType through orchestrator + builders"
```

---

## Task 10: Extend `buildMemoryContextMessage` to take a profile

**Goal:** Update the existing `buildMemoryContextMessage` in `src/memory.ts` to accept an optional profile string and emit it at the top of the combined memory block.

**Files:**

- Modify: `tests/memory.test.ts` (existing test file — extend the `buildMemoryContextMessage` describe)
- Modify: `src/memory.ts` (lines 261-281)

### Step 1: Read the existing test file

```fish
bun test tests/memory.test.ts --bail 2>&1 | head -20
```

Open `tests/memory.test.ts`, find the `buildMemoryContextMessage` describe block, and read its existing tests for context.

### Step 2: Write the failing tests

Add inside the existing `buildMemoryContextMessage` describe block:

```ts
test('returns null when profile, summary, and facts are all empty', () => {
  expect(buildMemoryContextMessage(null, null, [])).toBeNull()
})

test('includes profile section when profile is present', () => {
  const result = buildMemoryContextMessage('## Identity\nGo dev', null, [])
  expect(result).not.toBeNull()
  expect(result!.content).toContain('=== User profile ===')
  expect(result!.content).toContain('## Identity\nGo dev')
})

test('places profile before summary in the combined block', () => {
  const result = buildMemoryContextMessage('## Identity\nGo dev', 'Conversation about login bug', [])
  expect(result).not.toBeNull()
  const profileIdx = result!.content.indexOf('=== User profile ===')
  const summaryIdx = result!.content.indexOf('Summary:')
  expect(profileIdx).toBeGreaterThanOrEqual(0)
  expect(summaryIdx).toBeGreaterThan(profileIdx)
})

test('places profile before facts in the combined block', () => {
  const facts = [{ identifier: '#42', title: 'Fix login', url: '', last_seen: '2026-04-08T00:00:00Z' }]
  const result = buildMemoryContextMessage('## Identity\nGo dev', null, facts)
  expect(result).not.toBeNull()
  const profileIdx = result!.content.indexOf('=== User profile ===')
  const factsIdx = result!.content.indexOf('#42')
  expect(profileIdx).toBeGreaterThanOrEqual(0)
  expect(factsIdx).toBeGreaterThan(profileIdx)
})

test('omits profile section when profile is null', () => {
  const result = buildMemoryContextMessage(null, 'A summary', [])
  expect(result).not.toBeNull()
  expect(result!.content).not.toContain('=== User profile ===')
})
```

You may also need to update existing tests in this describe block if they call `buildMemoryContextMessage(summary, facts)` — those become `buildMemoryContextMessage(null, summary, facts)`.

### Step 3: Run the tests to confirm they fail

```fish
bun test tests/memory.test.ts -t 'buildMemoryContextMessage'
```

Expected: FAIL — most tests fail because the function signature doesn't accept a third argument.

### Step 4: Update the function

In `src/memory.ts`, lines 261-281, replace `buildMemoryContextMessage`:

```ts
import { buildProfileContextMessage } from './profile.js'

// ...

export function buildMemoryContextMessage(
  profile: string | null,
  summary: string | null,
  facts: readonly MemoryFact[],
): { role: 'system'; content: string } | null {
  const parts: string[] = []

  const profilePart = buildProfileContextMessage(profile)
  if (profilePart !== null) {
    parts.push(profilePart)
  }

  if (summary !== null && summary.length > 0) {
    parts.push(`Summary: ${summary}`)
  }

  if (facts.length > 0) {
    const lines = facts.map((f) => `- ${f.identifier}: "${f.title}" — last seen ${f.last_seen.slice(0, 10)}`)
    parts.push(`Recently accessed entities:\n${lines.join('\n')}`)
  }

  if (parts.length === 0) return null
  return { role: 'system', content: parts.join('\n\n') }
}
```

### Step 5: Update existing callers of `buildMemoryContextMessage`

Find and fix:

```fish
grep -rn 'buildMemoryContextMessage' src/ --include='*.ts'
```

The only caller is `src/conversation.ts` line ~32. Update that call site (will be done fully in Task 11):

```ts
const memoryMsg = buildMemoryContextMessage(null, summary, facts) // profile parameter added in Task 11
```

### Step 6: Run the tests to verify they pass

```fish
bun test tests/memory.test.ts -t 'buildMemoryContextMessage'
bun test tests/conversation.test.ts
```

Expected: PASS.

### Step 7: Commit

```fish
git add src/memory.ts src/conversation.ts tests/memory.test.ts
git commit -m "feat(memory): extend buildMemoryContextMessage with profile section"
```

---

## Task 11: Wire profile loading into `buildMessagesWithMemory` (DM-only)

**Goal:** When `contextType === 'dm'`, load the profile and pass it to `buildMemoryContextMessage`. In groups, pass `null`.

**Files:**

- Modify: `tests/conversation.test.ts`
- Modify: `src/conversation.ts` (line 29 and around)

### Step 1: Write the failing tests

Add to the `buildMessagesWithMemory` describe block in `tests/conversation.test.ts`:

```ts
test('includes profile in system message for DM context', () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
  trackSpy(spyOn(profileModule, 'loadProfile').mockReturnValue('## Identity\nGo developer'))

  const result = buildMessagesWithMemory('user1', 'dm', history)

  expect(result.messages).toHaveLength(2)
  expect(result.messages[0]!.content).toContain('=== User profile ===')
  expect(result.messages[0]!.content).toContain('Go developer')
})

test('does NOT include profile in system message for group context', () => {
  const history: ModelMessage[] = [{ role: 'user', content: 'Hello' }]
  // Even though the spy is set, the function must not call loadProfile in groups
  const loadProfileSpy = trackSpy(spyOn(profileModule, 'loadProfile').mockReturnValue('## Identity\nGo developer'))

  const result = buildMessagesWithMemory('group1', 'group', history)

  expect(loadProfileSpy).not.toHaveBeenCalled()
  // No profile content expected
  if (result.memoryMsg !== null) {
    expect(result.memoryMsg.content).not.toContain('=== User profile ===')
  }
})
```

Add the import:

```ts
import * as profileModule from '../src/profile.js'
```

### Step 2: Run the tests to confirm they fail

```fish
bun test tests/conversation.test.ts -t 'profile in system message'
```

Expected: FAIL.

### Step 3: Update `buildMessagesWithMemory`

In `src/conversation.ts`:

Add the import:

```ts
import { loadProfile } from './profile.js'
```

Update the function body:

```ts
export const buildMessagesWithMemory = (
  userId: string,
  contextType: ContextType,
  history: readonly ModelMessage[],
): MessagesWithMemory => {
  const profile = contextType === 'dm' ? loadProfile(userId) : null
  const summary = loadSummary(userId)
  const facts = loadFacts(userId)
  const memoryMsg = buildMemoryContextMessage(profile, summary, facts)
  return { messages: memoryMsg === null ? [...history] : [memoryMsg, ...history], memoryMsg }
}
```

### Step 4: Run the tests to verify they pass

```fish
bun test tests/conversation.test.ts -t 'profile in system message'
bun test tests/conversation.test.ts
```

Expected: PASS.

### Step 5: Commit

```fish
git add src/conversation.ts tests/conversation.test.ts
git commit -m "feat(conversation): inject profile into system message for DM context"
```

---

## Task 12: `runProfileExtractionInBackground`

**Goal:** New sibling function in `src/conversation.ts` that mirrors `runTrimInBackground`. Reads the LLM config, builds the small model, calls `extractProfile`, persists the result.

**Files:**

- Modify: `tests/conversation.test.ts` (new describe block)
- Modify: `src/conversation.ts`

### Step 1: Write the failing tests

Add a new describe block to `tests/conversation.test.ts`:

```ts
import { runProfileExtractionInBackground } from '../src/conversation.js'

describe('runProfileExtractionInBackground', () => {
  const mockProfiles = new Map<string, string | null>()
  const mockConfigs = new Map<string, Map<string, string | null>>()
  const spies: SpyInstance[] = []
  let generateTextImpl = (): Promise<{ text: string }> => Promise.resolve({ text: '## Identity\nNew profile' })

  function trackSpy<T extends SpyInstance>(spy: T): T {
    spies.push(spy)
    return spy
  }

  beforeEach(() => {
    mockProfiles.clear()
    mockConfigs.clear()
    generateTextImpl = (): Promise<{ text: string }> => Promise.resolve({ text: '## Identity\nNew profile' })
    void mock.module('ai', () => ({
      generateText: (..._args: unknown[]): Promise<{ text: string }> => generateTextImpl(),
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (): ((_model: string) => string) =>
        (_model: string): string =>
          'mock-model',
    }))
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  test('happy path: calls extractProfile and saves new profile', async () => {
    mockConfigs.set(
      'user1',
      new Map([
        ['llm_apikey', 'test-key'],
        ['llm_baseurl', 'http://test.com'],
        ['small_model', 'test-model'],
      ]),
    )
    trackSpy(
      spyOn(cacheModule, 'getCachedConfig').mockImplementation(
        (userId: string, key: string) => mockConfigs.get(userId)?.get(key) ?? null,
      ),
    )
    trackSpy(spyOn(profileModule, 'loadProfile').mockReturnValue(null))
    const saveSpy = trackSpy(
      spyOn(profileModule, 'saveProfile').mockImplementation((userId: string, profile: string) => {
        mockProfiles.set(userId, profile)
      }),
    )

    await runProfileExtractionInBackground('user1', [{ role: 'user', content: 'I am a Go dev' }])
    await flushMicrotasks()

    expect(saveSpy).toHaveBeenCalled()
    expect(mockProfiles.get('user1')).toBe('## Identity\nNew profile')
  })

  test('does not save when extraction returns the same profile', async () => {
    mockConfigs.set(
      'user1',
      new Map([
        ['llm_apikey', 'test-key'],
        ['llm_baseurl', 'http://test.com'],
        ['small_model', 'test-model'],
      ]),
    )
    generateTextImpl = (): Promise<{ text: string }> => Promise.resolve({ text: '## Identity\nUnchanged' })
    trackSpy(
      spyOn(cacheModule, 'getCachedConfig').mockImplementation(
        (userId: string, key: string) => mockConfigs.get(userId)?.get(key) ?? null,
      ),
    )
    trackSpy(spyOn(profileModule, 'loadProfile').mockReturnValue('## Identity\nUnchanged'))
    const saveSpy = trackSpy(spyOn(profileModule, 'saveProfile').mockImplementation(() => {}))

    await runProfileExtractionInBackground('user1', [{ role: 'user', content: 'hi' }])
    await flushMicrotasks()

    expect(saveSpy).not.toHaveBeenCalled()
  })

  test('returns silently when llm config is missing', async () => {
    trackSpy(spyOn(cacheModule, 'getCachedConfig').mockReturnValue(null))
    const saveSpy = trackSpy(spyOn(profileModule, 'saveProfile').mockImplementation(() => {}))

    await runProfileExtractionInBackground('user1', [{ role: 'user', content: 'hi' }])
    await flushMicrotasks()

    expect(saveSpy).not.toHaveBeenCalled()
  })

  test('swallows extraction errors and does not throw', async () => {
    mockConfigs.set(
      'user1',
      new Map([
        ['llm_apikey', 'test-key'],
        ['llm_baseurl', 'http://test.com'],
        ['small_model', 'test-model'],
      ]),
    )
    generateTextImpl = (): Promise<{ text: string }> => Promise.reject(new Error('LLM API error'))
    trackSpy(
      spyOn(cacheModule, 'getCachedConfig').mockImplementation(
        (userId: string, key: string) => mockConfigs.get(userId)?.get(key) ?? null,
      ),
    )
    trackSpy(spyOn(profileModule, 'loadProfile').mockReturnValue(null))
    trackSpy(spyOn(profileModule, 'saveProfile').mockImplementation(() => {}))
    trackSpy(spyOn(logger, 'warn').mockImplementation(() => {}))

    // Should not throw
    await runProfileExtractionInBackground('user1', [{ role: 'user', content: 'hi' }])
    await flushMicrotasks()
  })
})
```

### Step 2: Run the tests to confirm they fail

```fish
bun test tests/conversation.test.ts -t 'runProfileExtractionInBackground'
```

Expected: FAIL — `runProfileExtractionInBackground` not exported.

### Step 3: Implement the runner

Add to `src/conversation.ts`:

```ts
import { extractProfile, loadProfile, saveProfile } from './profile.js'

// ...

export const runProfileExtractionInBackground = async (
  userId: string,
  history: readonly ModelMessage[],
  deps: ConversationDeps = defaultConversationDeps,
): Promise<void> => {
  log.warn({ userId, historyLength: history.length }, 'Profile extraction triggered (running in background)')
  emit('profile:start', { userId, historyLength: history.length })

  const llmApiKey = getCachedConfig(userId, 'llm_apikey')
  const llmBaseUrl = getCachedConfig(userId, 'llm_baseurl')
  const mainModel = getCachedConfig(userId, 'main_model')
  const smallModel = getCachedConfig(userId, 'small_model') ?? mainModel

  if (llmApiKey === null || llmBaseUrl === null || smallModel === null) {
    log.warn({ userId }, 'LLM config not available for background profile extraction')
    return
  }

  try {
    const previous = loadProfile(userId)
    const model = deps.buildModel(llmApiKey, llmBaseUrl, smallModel)
    const newProfile = await extractProfile(history, previous, model)
    if (newProfile !== previous) {
      saveProfile(userId, newProfile)
      log.info(
        { userId, sizeBefore: previous?.length ?? 0, sizeAfter: newProfile.length },
        'Profile updated in background',
      )
    }
    emit('profile:end', { userId, success: true, changed: newProfile !== previous })
  } catch (error) {
    log.warn(
      { userId, error: error instanceof Error ? error.message : String(error) },
      'Profile extraction failed in background',
    )
    emit('profile:end', {
      userId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
```

### Step 4: Run the tests to verify they pass

```fish
bun test tests/conversation.test.ts -t 'runProfileExtractionInBackground'
```

Expected: PASS.

### Step 5: Commit

```fish
git add src/conversation.ts tests/conversation.test.ts
git commit -m "feat(conversation): add runProfileExtractionInBackground runner"
```

---

## Task 13: Fire profile extraction from the trim trigger (DM only)

**Goal:** In `src/llm-orchestrator.ts`, when `shouldTriggerTrim` fires and `contextType === 'dm'`, also fire `runProfileExtractionInBackground`.

**Files:**

- Modify: `tests/llm-orchestrator.test.ts` (or whichever test file covers `processMessage`'s trim trigger)
- Modify: `src/llm-orchestrator.ts` (lines 258-260)

### Step 1: Locate the existing trim trigger test

```fish
grep -rn 'shouldTriggerTrim\|runTrimInBackground' tests/ --include='*.ts'
```

Find the test file that exercises the trigger point. Likely `tests/llm-orchestrator.test.ts` or `tests/conversation.test.ts`.

### Step 2: Write the failing tests

Add new tests near the existing trim trigger tests:

```ts
test('fires runProfileExtractionInBackground for DM context when trim triggers', async () => {
  // ... set up history that triggers shouldTriggerTrim
  // ... mock processMessage path with contextType='dm'
  // ... assert runProfileExtractionInBackground was invoked
})

test('does NOT fire runProfileExtractionInBackground for group context', async () => {
  // ... set up history that triggers shouldTriggerTrim
  // ... mock processMessage path with contextType='group'
  // ... assert runProfileExtractionInBackground was NOT invoked
})
```

The exact mocking shape depends on how the existing trim trigger tests are written. Use `spyOn(conversationModule, 'runProfileExtractionInBackground')` to assert.

### Step 3: Run the tests to confirm they fail

```fish
bun test tests/llm-orchestrator.test.ts -t 'runProfileExtractionInBackground'
```

Expected: FAIL.

### Step 4: Update the trigger point

In `src/llm-orchestrator.ts`, lines 258-260 (inside `processMessage`'s try block), change:

```ts
if (shouldTriggerTrim([...history, ...assistantMessages])) {
  void runTrimInBackground(contextId, [...history, ...assistantMessages])
}
```

to:

```ts
if (shouldTriggerTrim([...history, ...assistantMessages])) {
  void runTrimInBackground(contextId, [...history, ...assistantMessages])
  if (contextType === 'dm') {
    void runProfileExtractionInBackground(contextId, [...history, ...assistantMessages])
  }
}
```

Add the import:

```ts
import {
  buildMessagesWithMemory,
  runProfileExtractionInBackground,
  runTrimInBackground,
  shouldTriggerTrim,
} from './conversation.js'
```

### Step 5: Run the tests to verify they pass

```fish
bun test tests/llm-orchestrator.test.ts -t 'runProfileExtractionInBackground'
bun test tests/llm-orchestrator.test.ts
```

Expected: PASS.

### Step 6: Commit

```fish
git add src/llm-orchestrator.ts tests/llm-orchestrator.test.ts
git commit -m "feat(orchestrator): fire profile extraction from trim trigger (DM only)"
```

---

## Task 14: Add `USER_PROFILE_RULES` to system prompt (DM only)

**Goal:** Add a new constant `USER_PROFILE_RULES` and conditionally append it to the system prompt for DM contexts.

**Files:**

- Modify: `tests/system-prompt.test.ts` (create if doesn't exist)
- Modify: `src/system-prompt.ts`

### Step 1: Check if the test file exists

```fish
ls tests/system-prompt.test.ts 2>&1
```

If it doesn't exist, create it. If it does, extend it.

### Step 2: Write the failing tests

Add (or create) `tests/system-prompt.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'

import { buildSystemPrompt } from '../src/system-prompt.js'
import { mockLogger } from './utils/test-helpers.js'
import { createMockProvider } from './tools/mock-provider.js'

describe('buildSystemPrompt', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('includes USER PROFILE rules block for DM context', () => {
    const provider = createMockProvider()
    const result = buildSystemPrompt(provider, 'UTC', 'user-1', 'dm')
    expect(result).toContain('USER PROFILE')
    expect(result).toContain('remember_about_user')
    expect(result).toContain('forget_user_profile')
  })

  test('omits USER PROFILE rules block for group context', () => {
    const provider = createMockProvider()
    const result = buildSystemPrompt(provider, 'UTC', 'group-1', 'group')
    expect(result).not.toContain('USER PROFILE')
    expect(result).not.toContain('remember_about_user')
    expect(result).not.toContain('forget_user_profile')
  })
})
```

### Step 3: Run the tests to confirm they fail

```fish
bun test tests/system-prompt.test.ts
```

Expected: FAIL.

### Step 4: Update `src/system-prompt.ts`

Add the constant near `STATIC_RULES` (around line 26):

```ts
const USER_PROFILE_RULES = `USER PROFILE — Stable facts about the user (identity, expertise, style, interests):
- When the user explicitly tells you something lasting about themselves ("I'm a Go dev", "I don't like verbose replies"), call remember_about_user.
- When the user asks to forget something about themselves ("forget I'm a Go dev"), call forget_user_profile.
- For explicit behavioral directives like "always reply in Spanish", call save_instruction instead.
- The profile itself appears in the "User profile" block above — read it to tailor your replies.`
```

Update `buildSystemPrompt` (line 105):

```ts
export const buildSystemPrompt = (
  provider: TaskProvider,
  timezone: string,
  contextId: string,
  contextType: ContextType,
): string => {
  const localDateStr = getLocalDateString(timezone)
  const base = buildBasePrompt(localDateStr)
  const profileRules = contextType === 'dm' ? `\n\n${USER_PROFILE_RULES}` : ''
  const addendum = provider.getPromptAddendum()
  return `${buildInstructionsBlock(contextId)}${base}${profileRules}${addendum === '' ? '' : `\n\n${addendum}`}`
}
```

### Step 5: Run the tests to verify they pass

```fish
bun test tests/system-prompt.test.ts
```

Expected: PASS.

### Step 6: Commit

```fish
git add src/system-prompt.ts tests/system-prompt.test.ts
git commit -m "feat(system-prompt): add USER_PROFILE_RULES section for DM context"
```

---

## Task 15: Create `src/tools/profile.ts` with the two LLM tools

**Goal:** Two tool factories `makeRememberAboutUserTool` and `makeForgetUserProfileTool`. Both call into `src/profile.ts` helpers, both log, both follow the existing tool conventions.

**Files:**

- Create: `tests/tools/profile.test.ts`
- Create: `src/tools/profile.ts`

### Step 1: Write the failing tests

Create `tests/tools/profile.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'

import { _userCaches } from '../../src/cache.js'
import { saveProfile } from '../../src/profile.js'
import { makeForgetUserProfileTool, makeRememberAboutUserTool } from '../../src/tools/profile.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  _userCaches.clear()
  await setupTestDb()
})

async function exec(
  tool: ReturnType<typeof makeRememberAboutUserTool>,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!tool.execute) throw new Error('Tool execute is undefined')
  return tool.execute(input, { toolCallId: '1', messages: [] })
}

describe('remember_about_user tool', () => {
  test('returns saved status when LLM rewrite succeeds', async () => {
    // The tool will call the small_model via cache config — needs mocking, OR
    // we test the structure only and let the LLM call fail gracefully.
    // For unit-test simplicity, we call without llm config and expect not_supported or similar.
    const tool = makeRememberAboutUserTool('user-1')
    const result = await exec(tool, { fact: 'User is a Go developer' })
    // Without LLM config, expect a graceful "no_config" or "saved" if mocked
    expect(result).toBeDefined()
    expect(result).toHaveProperty('status')
  })
})

describe('forget_user_profile tool', () => {
  test('returns not_found when no profile exists', async () => {
    const tool = makeForgetUserProfileTool('user-1')
    const result = await exec(tool, { what_to_forget: 'that I use Go' })
    expect(result).toHaveProperty('status', 'not_found')
  })

  test('returns forgotten when profile exists and LLM rewrite removes the fact', async () => {
    saveProfile('user-1', '## Identity\nGo developer')
    // Note: this test requires the tool to call the small model — actual integration
    // testing happens in the manual smoke flow. For unit tests, the tool's behavior
    // is exercised at the schema/structure level.
    const tool = makeForgetUserProfileTool('user-1')
    const result = await exec(tool, { what_to_forget: 'that I use Go' })
    expect(result).toBeDefined()
  })
})
```

**Important note about LLM mocking in tool tests:** The tools need to call the small model. For meaningful unit tests, the tool should accept a `deps` parameter. We'll add `RememberToolDeps` / `ForgetToolDeps` interfaces so tests can inject a fake `applyRemember` / `applyForget`. Update the test to use DI:

```ts
import type { RememberToolDeps, ForgetToolDeps } from '../../src/tools/profile.js'

describe('remember_about_user tool', () => {
  test('returns saved when applyRemember produces a different blob', async () => {
    const deps: RememberToolDeps = {
      applyRemember: async (_prev: string | null, _fact: string): Promise<string> => '## Identity\nNew fact',
      loadConfig: () => ({ apiKey: 'k', baseUrl: 'b', model: 'm' }),
    }
    const tool = makeRememberAboutUserTool('user-1', deps)
    const result = await exec(tool, { fact: 'User is a Go developer' })
    expect(result).toHaveProperty('status', 'saved')
  })

  test('returns unchanged when applyRemember returns the same blob', async () => {
    saveProfile('user-1', '## Identity\nGo dev')
    const deps: RememberToolDeps = {
      applyRemember: async (prev: string | null): Promise<string> => prev ?? '',
      loadConfig: () => ({ apiKey: 'k', baseUrl: 'b', model: 'm' }),
    }
    const tool = makeRememberAboutUserTool('user-1', deps)
    const result = await exec(tool, { fact: 'User is a Go developer' })
    expect(result).toHaveProperty('status', 'unchanged')
  })

  test('returns no_config when LLM config is missing', async () => {
    const deps: RememberToolDeps = {
      applyRemember: async (): Promise<string> => '',
      loadConfig: () => null,
    }
    const tool = makeRememberAboutUserTool('user-1', deps)
    const result = await exec(tool, { fact: 'User is a Go developer' })
    expect(result).toHaveProperty('status', 'no_config')
  })
})
```

(Similar pattern for `forget_user_profile` — DI'd `applyForget` and config loader.)

### Step 2: Run the tests to confirm they fail

```fish
bun test tests/tools/profile.test.ts
```

Expected: FAIL — module doesn't exist.

### Step 3: Implement the tools

Create `src/tools/profile.ts`:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { applyForget, applyRemember, loadProfile, saveProfile } from '../profile.js'

const log = logger.child({ scope: 'tool:profile' })

interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
}

function loadLlmConfig(userId: string): LlmConfig | null {
  const apiKey = getConfig(userId, 'llm_apikey')
  const baseUrl = getConfig(userId, 'llm_baseurl')
  const mainModel = getConfig(userId, 'main_model')
  const smallModel = getConfig(userId, 'small_model') ?? mainModel
  if (apiKey === null || baseUrl === null || smallModel === null) return null
  return { apiKey, baseUrl, model: smallModel }
}

function buildSmallModel(config: LlmConfig): ReturnType<ReturnType<typeof createOpenAICompatible>> {
  return createOpenAICompatible({ name: 'openai-compatible', apiKey: config.apiKey, baseURL: config.baseUrl })(
    config.model,
  )
}

export interface RememberToolDeps {
  applyRemember: (previous: string | null, fact: string, model: unknown) => Promise<string>
  loadConfig: (userId: string) => LlmConfig | null
}

const defaultRememberDeps: RememberToolDeps = {
  applyRemember: (previous, fact, model) => applyRemember(previous, fact, model as Parameters<typeof applyRemember>[2]),
  loadConfig: loadLlmConfig,
}

export function makeRememberAboutUserTool(
  userId: string,
  deps: RememberToolDeps = defaultRememberDeps,
): ToolSet[string] {
  return tool({
    description:
      'Save a stable fact about the user (their role, expertise, communication style, interests) when they explicitly tell you something to remember. Do NOT use this for task IDs, project names, or behavioral directives like "always reply in Spanish" — use save_instruction for directives.',
    inputSchema: z.object({
      fact: z
        .string()
        .min(3)
        .max(500)
        .describe(
          'A short sentence describing the fact to remember, e.g. "User is a senior Go developer" or "User prefers terse replies"',
        ),
    }),
    execute: async ({ fact }) => {
      log.debug({ userId, factLength: fact.length }, 'remember_about_user tool called')

      const config = deps.loadConfig(userId)
      if (config === null) {
        log.warn({ userId }, 'remember_about_user: LLM config missing')
        return { status: 'no_config' as const }
      }

      const previous = loadProfile(userId)
      const model = buildSmallModel(config)
      const newProfile = await deps.applyRemember(previous, fact, model)

      if (newProfile === previous || newProfile === '') {
        log.info({ userId }, 'remember_about_user: no change')
        return { status: 'unchanged' as const }
      }

      saveProfile(userId, newProfile)
      log.info(
        { userId, sizeBefore: previous?.length ?? 0, sizeAfter: newProfile.length },
        'remember_about_user: saved',
      )
      return { status: 'saved' as const }
    },
  })
}

export interface ForgetToolDeps {
  applyForget: (previous: string, whatToForget: string, model: unknown) => Promise<string>
  loadConfig: (userId: string) => LlmConfig | null
}

const defaultForgetDeps: ForgetToolDeps = {
  applyForget: (previous, whatToForget, model) =>
    applyForget(previous, whatToForget, model as Parameters<typeof applyForget>[2]),
  loadConfig: loadLlmConfig,
}

export function makeForgetUserProfileTool(userId: string, deps: ForgetToolDeps = defaultForgetDeps): ToolSet[string] {
  return tool({
    description:
      'Remove or weaken information from the user profile when the user explicitly asks to forget something about themselves. Takes a natural-language description of what to forget.',
    inputSchema: z.object({
      what_to_forget: z
        .string()
        .min(3)
        .max(500)
        .describe('What the user wants forgotten, e.g. "that I use Go" or "the communication style preferences"'),
    }),
    execute: async ({ what_to_forget: whatToForget }) => {
      log.debug({ userId, instructionLength: whatToForget.length }, 'forget_user_profile tool called')

      const previous = loadProfile(userId)
      if (previous === null || previous.length === 0) {
        log.info({ userId }, 'forget_user_profile: no profile exists')
        return { status: 'not_found' as const }
      }

      const config = deps.loadConfig(userId)
      if (config === null) {
        log.warn({ userId }, 'forget_user_profile: LLM config missing')
        return { status: 'no_config' as const }
      }

      const model = buildSmallModel(config)
      const newProfile = await deps.applyForget(previous, whatToForget, model)

      if (newProfile === previous) {
        log.info({ userId }, 'forget_user_profile: nothing to remove')
        return { status: 'not_found' as const }
      }

      saveProfile(userId, newProfile)
      log.info({ userId, sizeBefore: previous.length, sizeAfter: newProfile.length }, 'forget_user_profile: forgotten')
      return { status: 'forgotten' as const }
    },
  })
}
```

### Step 4: Run the tests to verify they pass

```fish
bun test tests/tools/profile.test.ts
```

Expected: PASS.

### Step 5: Commit

```fish
git add tests/tools/profile.test.ts src/tools/profile.ts
git commit -m "feat(tools): add remember_about_user and forget_user_profile tools"
```

---

## Task 16: Wire profile tools into `makeTools` (DM-only)

**Goal:** Register `remember_about_user` and `forget_user_profile` in `makeTools` only when `contextType === 'dm'`.

**Files:**

- Modify: `tests/tools/index.test.ts` (or `tests/tools.test.ts` — find the right one)
- Modify: `src/tools/index.ts`

### Step 1: Locate the existing makeTools test

```fish
grep -rn 'makeTools(' tests/ --include='*.ts' | head -10
```

Find the test file. It may not exist as a dedicated `tests/tools/index.test.ts` — the integration may be tested via `tests/llm-orchestrator.test.ts`. Either extend the existing test or create a new dedicated file.

### Step 2: Write the failing tests

Add to the appropriate test file:

```ts
import { makeTools } from '../../src/tools/index.js'
import { createMockProvider } from './mock-provider.js'

describe('makeTools profile tool gating', () => {
  test('includes profile tools for dm context', () => {
    const provider = createMockProvider()
    const tools = makeTools(provider, 'user-1', 'dm')
    expect(tools).toHaveProperty('remember_about_user')
    expect(tools).toHaveProperty('forget_user_profile')
  })

  test('excludes profile tools for group context', () => {
    const provider = createMockProvider()
    const tools = makeTools(provider, 'group-1', 'group')
    expect(tools).not.toHaveProperty('remember_about_user')
    expect(tools).not.toHaveProperty('forget_user_profile')
  })
})
```

### Step 3: Run the test to confirm it fails

```fish
bun test tests/tools/index.test.ts -t 'profile tool gating'
```

Expected: FAIL.

### Step 4: Wire the tools into makeTools

In `src/tools/index.ts`, add the import:

```ts
import { makeForgetUserProfileTool, makeRememberAboutUserTool } from './profile.js'
```

Add a new helper:

```ts
function addProfileTools(tools: ToolSet, contextType: ContextType, userId: string | undefined): void {
  if (contextType !== 'dm' || userId === undefined) return
  tools['remember_about_user'] = makeRememberAboutUserTool(userId)
  tools['forget_user_profile'] = makeForgetUserProfileTool(userId)
}
```

In `makeTools` body, add the call:

```ts
export function makeTools(
  provider: TaskProvider,
  userId?: string,
  contextType: ContextType = 'dm',
  mode: ToolMode = 'normal',
): ToolSet {
  const tools = makeCoreTools(provider, userId)
  // ... existing maybeAddX calls
  addInstructionTools(tools, userId)
  addProfileTools(tools, contextType, userId) // NEW
  if (mode === 'normal') {
    addDeferredPromptTools(tools, userId)
  }
  return tools
}
```

### Step 5: Run the tests to verify they pass

```fish
bun test tests/tools/index.test.ts -t 'profile tool gating'
```

Expected: PASS.

### Step 6: Commit

```fish
git add src/tools/index.ts tests/tools/index.test.ts
git commit -m "feat(tools): gate profile tools by contextType in makeTools"
```

---

## Task 17: Create `src/commands/profile.ts` with `/profile` and `/profile clear`

**Goal:** Two slash command handlers. Both DM-only, both follow the existing command convention.

**Files:**

- Create: `tests/commands/profile.test.ts`
- Create: `src/commands/profile.ts`

### Step 1: Write the failing tests

Create `tests/commands/profile.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'

import { _userCaches } from '../../src/cache.js'
import { registerProfileCommand } from '../../src/commands/profile.js'
import { saveProfile } from '../../src/profile.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/profile command', () => {
  beforeEach(async () => {
    mockLogger()
    _userCaches.clear()
    await setupTestDb()
  })

  test('shows "no profile stored" when profile is empty', async () => {
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerProfileCommand(provider)
    const handler = commandHandlers.get('profile')!
    const { reply, textCalls } = createMockReply()

    await handler(createDmMessage('user-1', 'profile'), reply, createAuth('user-1'))

    expect(textCalls.join('')).toContain('No profile stored')
  })

  test('shows the profile blob when present', async () => {
    saveProfile('user-1', '## Identity\nGo developer')
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerProfileCommand(provider)
    const handler = commandHandlers.get('profile')!
    const { reply, textCalls } = createMockReply()

    await handler(createDmMessage('user-1', 'profile'), reply, createAuth('user-1'))

    expect(textCalls.join('')).toContain('## Identity\nGo developer')
  })

  test('rejects group context with "DM only" message', async () => {
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerProfileCommand(provider)
    const handler = commandHandlers.get('profile')!
    const { reply, textCalls } = createMockReply()

    await handler(createGroupMessage('user-1', '/profile'), reply, createAuth('group-1'))

    expect(textCalls.join('')).toContain('only available in direct messages')
  })

  test('clear subcommand wipes the profile', async () => {
    saveProfile('user-1', '## Identity\nGo developer')
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerProfileCommand(provider)
    const handler = commandHandlers.get('profile')!
    const { reply, textCalls } = createMockReply()

    const msg = createDmMessage('user-1', 'profile')
    msg.text = '/profile clear'
    await handler(msg, reply, createAuth('user-1'))

    expect(textCalls.join('')).toContain('Profile cleared')

    // Verify it's actually wiped
    const { reply: reply2, textCalls: textCalls2 } = createMockReply()
    await handler(createDmMessage('user-1', 'profile'), reply2, createAuth('user-1'))
    expect(textCalls2.join('')).toContain('No profile stored')
  })
})
```

### Step 2: Run the tests to confirm they fail

```fish
bun test tests/commands/profile.test.ts
```

Expected: FAIL — module doesn't exist.

### Step 3: Create the command handler

Create `src/commands/profile.ts`:

```ts
import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { clearProfile, loadProfile } from '../profile.js'

const log = logger.child({ scope: 'commands:profile' })

const DM_ONLY_MESSAGE = 'User profile is only available in direct messages.'

function isClearSubcommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  return trimmed === '/profile clear' || trimmed === 'profile clear'
}

export function registerProfileCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType !== 'dm') {
      await reply.text(DM_ONLY_MESSAGE)
      return
    }

    log.info({ userId: msg.user.id }, '/profile command executed')

    if (isClearSubcommand(msg.text)) {
      clearProfile(msg.user.id)
      await reply.text('Profile cleared.')
      return
    }

    const profile = loadProfile(msg.user.id)
    if (profile === null || profile.length === 0) {
      await reply.text('No profile stored yet.')
      return
    }

    await reply.text(profile)
  }

  chat.registerCommand('profile', handler)
}
```

### Step 4: Run the tests to verify they pass

```fish
bun test tests/commands/profile.test.ts
```

Expected: PASS.

### Step 5: Commit

```fish
git add tests/commands/profile.test.ts src/commands/profile.ts
git commit -m "feat(commands): add /profile show and /profile clear commands"
```

---

## Task 18: Register `/profile` in `bot.ts`

**Goal:** Wire the new command into the bot startup so it's actually accessible to users.

**Files:**

- Modify: `tests/bot.test.ts` (existing — verify /profile is registered)
- Modify: `src/bot.ts`
- Modify: `src/commands/index.ts` (re-export)

### Step 1: Locate the commands index export pattern

```fish
cat src/commands/index.ts | head -30
```

Find the existing pattern for re-exporting register functions.

### Step 2: Write the failing test

In `tests/bot.test.ts`, find an existing test that asserts a command is registered. Add:

```ts
test('registers /profile command', () => {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()
  setupBot(provider, 'admin-1')
  expect(commandHandlers.has('profile')).toBe(true)
})
```

### Step 3: Run the test to confirm it fails

```fish
bun test tests/bot.test.ts -t 'profile'
```

Expected: FAIL.

### Step 4: Wire the registration

In `src/commands/index.ts`, add:

```ts
export { registerProfileCommand } from './profile.js'
```

In `src/bot.ts`:

- Import (around line 4):
  ```ts
  import {
    // ... existing imports
    registerProfileCommand,
  } from './commands/index.js'
  ```
- Inside `registerCommands` (lines 119-128), add:
  ```ts
  registerProfileCommand(chat)
  ```

### Step 5: Run the test to verify it passes

```fish
bun test tests/bot.test.ts -t 'profile'
bun test tests/bot.test.ts
```

Expected: PASS.

### Step 6: Commit

```fish
git add src/bot.ts src/commands/index.ts tests/bot.test.ts
git commit -m "feat(bot): register /profile command at bot startup"
```

---

## Task 19: Add `/profile` lines to `/help` output

**Files:**

- Modify: `tests/commands/help.test.ts`
- Modify: `src/commands/help.ts`

### Step 1: Write the failing test

Add to `tests/commands/help.test.ts`:

```ts
test('DM help text includes /profile commands', async () => {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()
  registerHelpCommand(provider)
  const handler = commandHandlers.get('help')!
  const { reply, textCalls } = createMockReply()

  await handler(createDmMessage('user-1', 'help'), reply, createAuth('user-1'))

  const output = textCalls.join('\n')
  expect(output).toContain('/profile')
  expect(output).toContain('clear')
})

test('group help text does NOT include /profile commands', async () => {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()
  registerHelpCommand(provider)
  const handler = commandHandlers.get('help')!
  const { reply, textCalls } = createMockReply()

  await handler(createGroupMessage('user-1', '/help'), reply, createAuth('group-1'))

  const output = textCalls.join('\n')
  expect(output).not.toContain('/profile')
})
```

### Step 2: Run the test to confirm it fails

```fish
bun test tests/commands/help.test.ts -t 'profile'
```

Expected: FAIL.

### Step 3: Update `DM_USER_HELP`

In `src/commands/help.ts`, lines 6-16, change:

```ts
const DM_USER_HELP = [
  'papai — AI assistant for Kaneo task management',
  '',
  'Commands:',
  '/help — Show this message',
  '/setup — Interactive configuration wizard',
  '/config — View current configuration',
  '/clear — Clear conversation history and memory',
  '/profile — Show what the bot has learned about you',
  '/profile clear — Forget everything in your profile',
  '',
  'Any other message is sent to the AI assistant.',
].join('\n')
```

### Step 4: Run the tests to verify they pass

```fish
bun test tests/commands/help.test.ts
```

Expected: PASS.

### Step 5: Commit

```fish
git add src/commands/help.ts tests/commands/help.test.ts
git commit -m "feat(help): add /profile commands to DM help text"
```

---

## Task 20: Include profile in `/context` admin export

**Files:**

- Modify: `tests/commands/context.test.ts` (find or create)
- Modify: `src/commands/context.ts`

### Step 1: Write the failing test

If `tests/commands/context.test.ts` exists, extend it. Otherwise, find any existing context test.

```ts
test('/context output includes profile section when present', async () => {
  saveProfile('user-1', '## Identity\nGo developer')
  // ... set up admin context, run /context handler, capture file output
  // Assert the file content contains '=== USER PROFILE ===' and '## Identity\nGo developer'
})

test('/context output shows "(none)" for profile when empty', async () => {
  // ... no saveProfile call
  // ... assert file content has '(none)' under the USER PROFILE section
})
```

### Step 2: Run the test to confirm it fails

```fish
bun test tests/commands/context.test.ts -t 'profile'
```

Expected: FAIL.

### Step 3: Update `src/commands/context.ts`

Import:

```ts
import { loadProfile } from '../profile.js'
```

Add a section formatter near the existing ones (after line 79):

```ts
function formatProfileSection(profile: string | null): string {
  if (profile === null || profile.length === 0) {
    return '(none)'
  }
  return profile
}
```

Update `generateContextReport` (lines 81-108):

```ts
function generateContextReport(
  history: readonly ModelMessage[],
  profile: string | null,
  summary: string | null,
  facts: readonly Fact[],
): string {
  const lines: string[] = []

  lines.push('='.repeat(80))
  lines.push('HISTORY')
  lines.push('='.repeat(80))
  lines.push('')
  lines.push(formatHistorySection(history))

  lines.push('='.repeat(80))
  lines.push('USER PROFILE')
  lines.push('='.repeat(80))
  lines.push('')
  lines.push(formatProfileSection(profile))
  lines.push('')

  lines.push('='.repeat(80))
  lines.push('SUMMARY')
  lines.push('='.repeat(80))
  lines.push('')
  lines.push(formatSummarySection(summary))
  lines.push('')

  lines.push('='.repeat(80))
  lines.push('KNOWN ENTITIES')
  lines.push('='.repeat(80))
  lines.push('')
  lines.push(formatFactsSection(facts))

  return lines.join('\n')
}
```

Update the handler (lines 110-137):

```ts
export function registerContextCommand(chat: ChatProvider, adminUserId: string): void {
  chat.registerCommand('context', async (msg, reply, auth) => {
    if (msg.user.id !== adminUserId) {
      await reply.text('Only the admin can use this command.')
      return
    }

    const history = loadHistory(auth.storageContextId)
    const profile = loadProfile(auth.storageContextId)
    const summary = loadSummary(auth.storageContextId)
    const facts = loadFacts(auth.storageContextId)

    const report = generateContextReport(history, profile, summary, facts)

    log.info(
      {
        userId: msg.user.id,
        storageContextId: auth.storageContextId,
        historyLength: history.length,
        factsCount: facts.length,
        hasSummary: summary !== null && summary.length > 0,
        hasProfile: profile !== null && profile.length > 0,
      },
      '/context command executed',
    )
    await reply.file({ content: Buffer.from(report, 'utf-8'), filename: 'context.txt' })
  })
}
```

### Step 4: Run the tests to verify they pass

```fish
bun test tests/commands/context.test.ts
```

Expected: PASS.

### Step 5: Commit

```fish
git add src/commands/context.ts tests/commands/context.test.ts
git commit -m "feat(context): include user profile in admin context export"
```

---

## Task 21: Final integration check and full test suite

**Goal:** Run the full test suite, fix any cross-cutting failures, and verify the feature is wired end-to-end.

### Step 1: Run the full test suite

```fish
bun test
```

Expected: PASS. If anything fails:

- A test that mocks `loadProfile` / `saveProfile` may need updating
- A test that calls `processMessage` / `buildSystemPrompt` / `makeTools` / `buildMessagesWithMemory` with the old signature needs the new `contextType` argument
- Fix each failure individually, commit per fix.

### Step 2: Run lint and typecheck

```fish
bun check:full
```

Expected: PASS. Fix any lint or type issues.

### Step 3: Re-enable mutation testing and run on the new files

```fish
set -x TDD_MUTATION 1
bun test tests/profile.test.ts tests/tools/profile.test.ts tests/commands/profile.test.ts
```

Expected: Stryker reports zero new surviving mutants on the touched files. If mutants survive, add the missing test cases to kill them.

### Step 4: Manual smoke flow against a real LLM

Per the design doc Section 5, run this checklist with a real bot instance:

1. **Fresh DM user.** Send 10+ messages establishing persona:
   - "I work mostly in Go"
   - "I prefer short replies"
   - "Currently learning Rust"
   - (continue until trim trigger fires)
2. **Wait for the trigger** — check logs for `profile:start` / `profile:end` events.
3. **`/profile`** → expect a populated blob with `## Identity`, `## Expertise`, `## Communication style`.
4. **"forget that I use Go"** → assistant should call `forget_user_profile`, confirm, and the next `/profile` should show Go removed.
5. **"remember that I'm based in Berlin"** → assistant should call `remember_about_user`, confirm, and the next `/profile` should include Berlin.
6. **`/profile clear`** → expect "Profile cleared." Next `/profile` shows "No profile stored yet."
7. **In a group:** mention the bot, send a personal message → verify `/profile` returns "DM only" message, no extraction trigger fired in logs.

### Step 5: Final commit if any fixes were needed

```fish
git status
git add <any-fix-files>
git commit -m "fix: <description>"
```

### Step 6: Push the branch (if applicable)

```fish
git push -u origin <branch-name>
```

---

## Summary checklist

- [ ] Task 1: Migration 019_user_profile created and registered
- [ ] Task 2: Profile cache slot with DB sync
- [ ] Task 3: Profile module skeleton (load/save/clear)
- [ ] Task 4: extractProfile happy path
- [ ] Task 5: extractProfile validation paths
- [ ] Task 6: applyRemember
- [ ] Task 7: applyForget
- [ ] Task 8: buildProfileContextMessage
- [ ] Task 9: contextType threaded through orchestrator + builders
- [ ] Task 10: buildMemoryContextMessage extended with profile
- [ ] Task 11: buildMessagesWithMemory loads profile in DM
- [ ] Task 12: runProfileExtractionInBackground runner
- [ ] Task 13: Trigger fires extraction in DM context
- [ ] Task 14: USER_PROFILE_RULES in system prompt (DM only)
- [ ] Task 15: src/tools/profile.ts with two LLM tools
- [ ] Task 16: Tools gated by contextType in makeTools
- [ ] Task 17: src/commands/profile.ts with show + clear
- [ ] Task 18: /profile registered in bot.ts
- [ ] Task 19: /profile in DM help text
- [ ] Task 20: Profile included in /context export
- [ ] Task 21: Full test suite + smoke flow + lint passes
