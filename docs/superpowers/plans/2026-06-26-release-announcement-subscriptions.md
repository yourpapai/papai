<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Release Announcement Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let DM users and group admins opt in to receive new-version release announcements; the raw changelog is humanized once by the central LLM and an admin reviews/broadcasts it to subscribers from a new settings-UI "Release notes" section.

**Architecture:** At startup `announceNewVersion` extracts the changelog section (as today), humanizes it once via the central/global LLM, persists `{raw, humanized}` on `version_announcements`, and DMs the admin a review notice (no auto fan-out). A bot admin reviews/edits/regenerates the draft in a new admin "Release notes" section and clicks Broadcast; `broadcastAnnouncement` fans out the single humanized text to opt-in subscribers (DMs + groups) with bounded concurrency and per-recipient idempotency. Subscription is a boolean column on `users` (DM, self opt-in) and `authorized_groups` (group, group-admin opt-in), mirroring `guest_mode`.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM + SQLite, Zod v4, Vercel AI SDK (`generateText`), Svelte 5 (runes) for the settings SPA, `p-limit` for bounded concurrency. Tests: `bun test --parallel` (server), happy-dom (client).

**Reference spec:** `docs/superpowers/specs/2026-06-26-announcement-subscriptions-design.md`

**Naming note:** This feature is "Release notes" / "Release announcements" — deliberately distinct from the pre-existing admin "Announce" section (manual free-text broadcast to all users). Do not merge them.

---

## File Structure

**Create:**

- `src/db/migrations/063_release_announcements.ts` — adds `announce_subscribed` columns + `announcement_deliveries` table.
- `src/announcements/store.ts` — subscription getters/setters, draft read/upsert, delivery records, subscriber enumeration/counts.
- `src/announcements/humanize.ts` — `humanizeChangelog(raw, deps?)` central-LLM one-shot.
- `src/announcements/broadcast.ts` — `broadcastAnnouncement(chat, version, body, deps?)` fan-out.
- `src/debug/settings/admin/release-notes-routes.ts` — `GET/POST /settings/api/admin/release-notes`.
- `src/debug/settings/release-subscription-routes.ts` — `GET/PATCH /settings/api/release-subscription` (personal).
- `client/settings/sections/admin/AdminReleaseNotesSection.svelte`
- `client/settings/sections/ReleaseSubscriptionSection.svelte`
- Tests: `tests/announcements/store.test.ts`, `tests/announcements/humanize.test.ts`, `tests/announcements/broadcast.test.ts`, `tests/announcements/announce-new-version.test.ts`, `tests/debug/settings/release-notes-routes.test.ts`, `tests/debug/settings/release-subscription-routes.test.ts`, `tests/client/settings/release-subscription-section.test.ts`.

**Modify:**

- `src/db/schema.ts` — extend `versionAnnouncements`; add `users.announceSubscribed`, `authorizedGroups.announceSubscribed`, `announcementDeliveries`.
- `src/db/index.ts` — import + register migration 063.
- `src/llm-config-resolver.ts` — export `resolveGlobalConfig`.
- `src/announcements.ts` — humanize + persist + admin review notice; no fan-out.
- `src/debug/settings/group-routes.ts` — add `/settings/api/group/release-subscription` GET/PATCH.
- `src/debug/settings-api-router.ts` — register the two new route modules.
- `client/settings/fetcher-schemas.ts` — response schemas.
- `client/settings/fetchers.ts` — release-subscription fetchers.
- `client/settings/admin-fetchers.ts` — release-notes admin fetchers.
- `client/settings/SettingsApp.svelte` — mount sections + sidebar items.

---

## Task 1: Migration + schema

**Files:**

- Create: `src/db/migrations/063_release_announcements.ts`
- Modify: `src/db/schema.ts:80-83` (versionAnnouncements), `src/db/schema.ts:11-34` (users), `src/db/schema.ts:100-111` (authorizedGroups)
- Modify: `src/db/index.ts:75` (import), `src/db/index.ts:110+` (MIGRATIONS array)
- Test: `tests/announcements/store.test.ts` (created in Task 2 exercises the schema; this task is verified by typecheck + the existing migration order test)

- [ ] **Step 1: Write the migration file**

Create `src/db/migrations/063_release_announcements.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:063' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'users', 'announce_subscribed')) {
    db.run(`ALTER TABLE users ADD COLUMN announce_subscribed INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists(db, 'authorized_groups', 'announce_subscribed')) {
    db.run(`ALTER TABLE authorized_groups ADD COLUMN announce_subscribed INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists(db, 'version_announcements', 'raw_body')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN raw_body TEXT`)
  }
  if (!columnExists(db, 'version_announcements', 'humanized_body')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN humanized_body TEXT`)
  }
  if (!columnExists(db, 'version_announcements', 'broadcast_at')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN broadcast_at TEXT`)
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS announcement_deliveries (
      version TEXT NOT NULL,
      context_id TEXT NOT NULL,
      context_type TEXT NOT NULL,
      status TEXT NOT NULL,
      delivered_at TEXT NOT NULL,
      PRIMARY KEY (version, context_id)
    )
  `)
  log.info('migration 063: release announcement subscription columns + deliveries table added')
}

export const migration063ReleaseAnnouncements: Migration = {
  id: '063_release_announcements',
  up,
}

export default migration063ReleaseAnnouncements
```

- [ ] **Step 2: Register the migration in `src/db/index.ts`**

Add the import after line 75 (`migration062NullableContextTaskInstance`):

```typescript
import { migration063ReleaseAnnouncements } from './migrations/063_release_announcements.js'
```

Add to the end of the `MIGRATIONS` array (after `migration062NullableContextTaskInstance,`):

```typescript
  migration063ReleaseAnnouncements,
```

- [ ] **Step 3: Extend the Drizzle schema in `src/db/schema.ts`**

Replace the `versionAnnouncements` definition (lines 80-83) with:

```typescript
export const versionAnnouncements = sqliteTable('version_announcements', {
  version: text('version').primaryKey(),
  announcedAt: text('announced_at').notNull(),
  rawBody: text('raw_body'),
  humanizedBody: text('humanized_body'),
  broadcastAt: text('broadcast_at'),
})
export const announcementDeliveries = sqliteTable(
  'announcement_deliveries',
  {
    version: text('version').notNull(),
    contextId: text('context_id').notNull(),
    contextType: text('context_type').notNull(),
    status: text('status').notNull(),
    deliveredAt: text('delivered_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.version, table.contextId] })],
)
```

Add `announceSubscribed` to the `users` table object (inside the columns object, after `kaneoWorkspaceId: text('kaneo_workspace_id'),` at line 24):

```typescript
    announceSubscribed: integer('announce_subscribed', { mode: 'boolean' }).notNull().default(false),
```

Add `announceSubscribed` to the `authorizedGroups` columns object (after `guestMode: integer('guest_mode', { mode: 'boolean' }).notNull().default(false),` at line 108):

```typescript
    announceSubscribed: integer('announce_subscribed', { mode: 'boolean' }).notNull().default(false),
```

- [ ] **Step 4: Typecheck**

Run: `bun typecheck`
Expected: PASS (no type errors).

- [ ] **Step 5: Verify the scoped-context consistency test still passes**

The new columns live on `users` / `authorized_groups`, which are not scoped-context-owned config tables (same as `guest_mode`), so no `ENTITY_SCOPES` / `CONTEXT_OWNED_COLUMNS` entry is expected.

Run: `bun test tests/chat/context-scope.test.ts`
Expected: PASS. If it fails complaining about an unregistered column, that means these columns ARE treated as context-owned — STOP and re-read `src/chat/context-scope.ts` + `src/db/scoped-context-owned-columns.ts` before proceeding (the guest_mode precedent says they should not be).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/063_release_announcements.ts src/db/index.ts src/db/schema.ts
git commit -m "feat(db): migration 063 — release announcement subscription columns + deliveries"
```

---

## Task 2: Store layer

**Files:**

- Create: `src/announcements/store.ts`
- Test: `tests/announcements/store.test.ts`

This task uses the standard `setupTestDb()` helper (deserializes a once-migrated
in-memory snapshot) plus `seedCommonTestPlatformInstances()` to satisfy the
`users.platform_instance_id` → `platform_instances(id)` foreign key. Users are
created via the real `addUser()` helper and groups via `addAuthorizedGroup()`,
exactly as `tests/users.test.ts` and `tests/authorized-groups/guest-mode-store.test.ts` do.

- [ ] **Step 1: Write the failing test**

Create `tests/announcements/store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  countSubscribers,
  getAnnouncementDraft,
  getGroupAnnounceSubscribed,
  getUserAnnounceSubscribed,
  isDelivered,
  listSubscribedGroups,
  listSubscribedUsers,
  markBroadcast,
  recordDelivery,
  setGroupAnnounceSubscribed,
  setUserAnnounceSubscribed,
  updateHumanizedBody,
  upsertAnnouncementDraft,
} from '../../src/announcements/store.js'
import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { users } from '../../src/db/schema.js'
import { addUser } from '../../src/users.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const PID = 'telegram-default' // one of the ids seeded by seedCommonTestPlatformInstances()

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  seedCommonTestPlatformInstances()
  addUser({ userId: 'u1', platformInstanceId: PID, addedBy: 'test' })
  addUser({ userId: 'u2', platformInstanceId: PID, addedBy: 'test' })
  addAuthorizedGroup('g1', 'test')
})

describe('announcement subscription store', () => {
  test('user subscription defaults off and toggles', () => {
    expect(getUserAnnounceSubscribed(PID, 'u1')).toBe(false)
    setUserAnnounceSubscribed(PID, 'u1', true)
    expect(getUserAnnounceSubscribed(PID, 'u1')).toBe(true)
    setUserAnnounceSubscribed(PID, 'u1', false)
    expect(getUserAnnounceSubscribed(PID, 'u1')).toBe(false)
  })

  test('group subscription defaults off and toggles', () => {
    expect(getGroupAnnounceSubscribed('g1')).toBe(false)
    setGroupAnnounceSubscribed('g1', true)
    expect(getGroupAnnounceSubscribed('g1')).toBe(true)
  })

  test('listSubscribedUsers excludes blocked + unsubscribed', () => {
    setUserAnnounceSubscribed(PID, 'u1', true)
    setUserAnnounceSubscribed(PID, 'u2', true)
    // u2 blocked
    getDrizzleDb().update(users).set({ blockedAt: '2026-01-01T00:00:00Z' }).where(eq(users.platformUserId, 'u2')).run()
    const subs = listSubscribedUsers().filter((u) => u.platformUserId === 'u1')
    expect(subs).toEqual([{ platformInstanceId: PID, platformUserId: 'u1' }])
    expect(listSubscribedUsers().some((u) => u.platformUserId === 'u2')).toBe(false)
  })

  test('counts reflect subscribed users + groups', () => {
    setUserAnnounceSubscribed(PID, 'u1', true)
    setGroupAnnounceSubscribed('g1', true)
    expect(countSubscribers()).toEqual({ dm: 1, group: 1 })
  })

  test('draft upsert + humanized update + broadcast mark', () => {
    upsertAnnouncementDraft({
      version: '9.9.9',
      rawBody: 'raw',
      humanizedBody: 'hi',
    })
    expect(getAnnouncementDraft('9.9.9')).toMatchObject({
      version: '9.9.9',
      rawBody: 'raw',
      humanizedBody: 'hi',
      broadcastAt: null,
    })
    updateHumanizedBody('9.9.9', 'edited')
    expect(getAnnouncementDraft('9.9.9')?.humanizedBody).toBe('edited')
    markBroadcast('9.9.9', '2026-06-26T00:00:00Z')
    expect(getAnnouncementDraft('9.9.9')?.broadcastAt).toBe('2026-06-26T00:00:00Z')
  })

  test('delivery idempotency: only sent counts as delivered', () => {
    recordDelivery('9.9.9', 'pi-1:u1', 'dm', 'failed')
    expect(isDelivered('9.9.9', 'pi-1:u1')).toBe(false)
    recordDelivery('9.9.9', 'pi-1:u1', 'dm', 'sent')
    expect(isDelivered('9.9.9', 'pi-1:u1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/announcements/store.test.ts`
Expected: FAIL — cannot find module `../../src/announcements/store.js`.

- [ ] **Step 3: Write the store implementation**

Create `src/announcements/store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { announcementDeliveries, authorizedGroups, users, versionAnnouncements } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'announcements:store' })

export type SubscribedUser = {
  platformInstanceId: string
  platformUserId: string
}
export type SubscribedGroup = { groupId: string }
export type SubscriberCounts = { dm: number; group: number }
export type AnnouncementDraft = {
  version: string
  rawBody: string | null
  humanizedBody: string | null
  broadcastAt: string | null
}

export function getUserAnnounceSubscribed(platformInstanceId: string, platformUserId: string): boolean {
  const row = getDrizzleDb()
    .select({ announceSubscribed: users.announceSubscribed })
    .from(users)
    .where(and(eq(users.platformInstanceId, platformInstanceId), eq(users.platformUserId, platformUserId)))
    .get()
  return row?.announceSubscribed === true
}

export function setUserAnnounceSubscribed(platformInstanceId: string, platformUserId: string, enabled: boolean): void {
  getDrizzleDb()
    .update(users)
    .set({ announceSubscribed: enabled })
    .where(and(eq(users.platformInstanceId, platformInstanceId), eq(users.platformUserId, platformUserId)))
    .run()
  log.info({ platformInstanceId, enabled }, 'user announce subscription updated')
}

export function getGroupAnnounceSubscribed(groupId: string): boolean {
  const row = getDrizzleDb()
    .select({ announceSubscribed: authorizedGroups.announceSubscribed })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.groupId, groupId))
    .get()
  return row?.announceSubscribed === true
}

export function setGroupAnnounceSubscribed(groupId: string, enabled: boolean): void {
  getDrizzleDb()
    .update(authorizedGroups)
    .set({ announceSubscribed: enabled })
    .where(eq(authorizedGroups.groupId, groupId))
    .run()
  log.info({ groupId, enabled }, 'group announce subscription updated')
}

export function listSubscribedUsers(): SubscribedUser[] {
  return getDrizzleDb()
    .select({
      platformInstanceId: users.platformInstanceId,
      platformUserId: users.platformUserId,
    })
    .from(users)
    .where(and(eq(users.announceSubscribed, true), isNull(users.blockedAt)))
    .all()
    .filter((u) => !u.platformUserId.startsWith('placeholder-'))
}

export function listSubscribedGroups(): SubscribedGroup[] {
  return getDrizzleDb()
    .select({ groupId: authorizedGroups.groupId })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.announceSubscribed, true))
    .all()
}

export function countSubscribers(): SubscriberCounts {
  return {
    dm: listSubscribedUsers().length,
    group: listSubscribedGroups().length,
  }
}

export function getAnnouncementDraft(version: string): AnnouncementDraft | null {
  const row = getDrizzleDb()
    .select({
      version: versionAnnouncements.version,
      rawBody: versionAnnouncements.rawBody,
      humanizedBody: versionAnnouncements.humanizedBody,
      broadcastAt: versionAnnouncements.broadcastAt,
    })
    .from(versionAnnouncements)
    .where(eq(versionAnnouncements.version, version))
    .get()
  return row ?? null
}

/** Insert the draft row once (dedup anchor). No-op if the version row already exists. */
export function upsertAnnouncementDraft(input: {
  version: string
  rawBody: string
  humanizedBody: string | null
}): void {
  getDrizzleDb()
    .insert(versionAnnouncements)
    .values({
      version: input.version,
      announcedAt: new Date().toISOString(),
      rawBody: input.rawBody,
      humanizedBody: input.humanizedBody,
    })
    .onConflictDoNothing()
    .run()
}

export function updateHumanizedBody(version: string, body: string): void {
  getDrizzleDb()
    .update(versionAnnouncements)
    .set({ humanizedBody: body })
    .where(eq(versionAnnouncements.version, version))
    .run()
}

export function markBroadcast(version: string, atIso: string): void {
  getDrizzleDb()
    .update(versionAnnouncements)
    .set({ broadcastAt: atIso })
    .where(eq(versionAnnouncements.version, version))
    .run()
}

export function recordDelivery(
  version: string,
  contextId: string,
  contextType: 'dm' | 'group',
  status: 'sent' | 'failed',
): void {
  getDrizzleDb()
    .insert(announcementDeliveries)
    .values({
      version,
      contextId,
      contextType,
      status,
      deliveredAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [announcementDeliveries.version, announcementDeliveries.contextId],
      set: { status, deliveredAt: new Date().toISOString() },
    })
    .run()
}

export function isDelivered(version: string, contextId: string): boolean {
  const row = getDrizzleDb()
    .select({ status: announcementDeliveries.status })
    .from(announcementDeliveries)
    .where(and(eq(announcementDeliveries.version, version), eq(announcementDeliveries.contextId, contextId)))
    .get()
  return row?.status === 'sent'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/announcements/store.test.ts`
Expected: PASS. (`seedCommonTestPlatformInstances()` provides the `telegram-default` platform instance the `users` FK requires, and `addUser`/`addAuthorizedGroup` are the real store writers.)

- [ ] **Step 5: Commit**

```bash
git add src/announcements/store.ts tests/announcements/store.test.ts
git commit -m "feat(announcements): subscription + draft + delivery store"
```

---

## Task 3: Changelog humanizer

**Files:**

- Modify: `src/llm-config-resolver.ts:40` (export `resolveGlobalConfig`)
- Create: `src/announcements/humanize.ts`
- Test: `tests/announcements/humanize.test.ts`

- [ ] **Step 1: Export `resolveGlobalConfig`**

In `src/llm-config-resolver.ts`, change the declaration at line 40 from:

```typescript
const resolveGlobalConfig = (): EffectiveLlmConfigResult => {
```

to:

```typescript
export const resolveGlobalConfig = (): EffectiveLlmConfigResult => {
```

- [ ] **Step 2: Write the failing test**

Create `tests/announcements/humanize.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { humanizeChangelog, type HumanizeChangelogDeps } from '../../src/announcements/humanize.js'

const okConfig = {
  ok: true as const,
  source: 'global' as const,
  llmApiKey: 'k',
  llmBaseUrl: 'https://llm.example',
  mainModel: 'main',
  smallModel: 'small',
  embeddingModel: 'embed',
}

function deps(over: Partial<HumanizeChangelogDeps>): HumanizeChangelogDeps {
  return {
    resolveConfig: () => okConfig,
    buildModel: () => ({}) as never,
    generate: async () => ({ text: 'Humanized!' }),
    ...over,
  }
}

describe('humanizeChangelog', () => {
  test('returns trimmed model text and passes raw as prompt', async () => {
    let seenPrompt = ''
    const result = await humanizeChangelog(
      '### Added\n- thing',
      deps({
        generate: async (opts) => {
          seenPrompt = String(opts.prompt)
          return { text: '  ✨ New\n- Thing  ' }
        },
      }),
    )
    expect(result).toBe('✨ New\n- Thing')
    expect(seenPrompt).toContain('### Added')
  })

  test('returns null when LLM config is missing', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        resolveConfig: () => ({
          ok: false,
          type: 'missing',
          source: 'global',
          missing: ['main_model'],
        }),
      }),
    )
    expect(result).toBeNull()
  })

  test('returns null when the model throws', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        generate: async () => {
          throw new Error('boom')
        },
      }),
    )
    expect(result).toBeNull()
  })

  test('returns null when the model returns only whitespace', async () => {
    const result = await humanizeChangelog('raw', deps({ generate: async () => ({ text: '   ' }) }))
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/announcements/humanize.test.ts`
Expected: FAIL — cannot find module `../../src/announcements/humanize.js`.

- [ ] **Step 4: Write the humanizer**

Create `src/announcements/humanize.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, type LanguageModel } from 'ai'

import { resolveGlobalConfig, type EffectiveLlmConfigResult } from '../llm-config-resolver.js'
import { buildChatModel } from '../llm-model-builder.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'announcements:humanize' })

const SYSTEM_PROMPT = [
  'You turn a raw software changelog into a short, friendly release announcement for end users of a chat bot.',
  'Rules:',
  '- Write for non-technical users. Plain, warm, concise.',
  '- Group into two sections with these exact headers when content exists: "✨ New" and "🛠 Fixes".',
  '- Keep only user-visible changes. Drop internal churn: build, ci, test, chore, refactor, deps, docs, formatting.',
  '- No commit hashes, no scopes in parentheses, no markdown headings larger than bold.',
  '- 1 short line per item. Omit a section entirely if it has no user-facing items.',
  '- Output only the announcement body. No preamble, no "here is", no version number.',
].join('\n')

export interface HumanizeChangelogDeps {
  resolveConfig: () => EffectiveLlmConfigResult
  buildModel: (apiKey: string, baseUrl: string, modelName: string) => LanguageModel
  generate: (opts: { model: LanguageModel; system: string; prompt: string }) => Promise<{ text: string }>
}

const defaultDeps: HumanizeChangelogDeps = {
  resolveConfig: resolveGlobalConfig,
  buildModel: buildChatModel,
  generate: async (opts) => {
    const result = await generateText(opts)
    return { text: result.text }
  },
}

/** Humanize the raw changelog via the CENTRAL/global LLM. Returns null on any failure. */
export async function humanizeChangelog(
  rawSection: string,
  deps: HumanizeChangelogDeps = defaultDeps,
): Promise<string | null> {
  const config = deps.resolveConfig()
  if (!config.ok) {
    log.warn(
      { type: config.type, source: config.source },
      'Central LLM not configured; skipping changelog humanization',
    )
    return null
  }
  try {
    const model = deps.buildModel(config.llmApiKey, config.llmBaseUrl, config.mainModel)
    const { text } = await deps.generate({
      model,
      system: SYSTEM_PROMPT,
      prompt: rawSection,
    })
    const trimmed = text.trim()
    return trimmed.length === 0 ? null : trimmed
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Changelog humanization failed')
    return null
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/announcements/humanize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/llm-config-resolver.ts src/announcements/humanize.ts tests/announcements/humanize.test.ts
git commit -m "feat(announcements): central-LLM changelog humanizer"
```

---

## Task 4: Broadcast fan-out

**Files:**

- Create: `src/announcements/broadcast.ts`
- Test: `tests/announcements/broadcast.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/announcements/broadcast.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { broadcastAnnouncement, type BroadcastDeps } from '../../src/announcements/broadcast.js'
import type { ChatProvider } from '../../src/chat/types.js'

const chat = {} as ChatProvider

function makeDeps(over: Partial<BroadcastDeps>): BroadcastDeps {
  const delivered = new Set<string>()
  return {
    listSubscribedUsers: () => [{ platformInstanceId: 'pi', platformUserId: 'u1' }],
    listSubscribedGroups: () => [{ groupId: 'g1' }],
    isDelivered: (_v, ctx) => delivered.has(ctx),
    recordDelivery: (_v, ctx, _t, status) => {
      if (status === 'sent') delivered.add(ctx)
    },
    markBroadcast: () => {},
    sendDm: async () => true,
    sendGroup: async () => true,
    now: () => '2026-06-26T00:00:00Z',
    ...over,
  }
}

describe('broadcastAnnouncement', () => {
  test('sends to all subscribers and returns counts', async () => {
    const result = await broadcastAnnouncement(chat, '9.9.9', 'body', makeDeps({}))
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 })
  })

  test('skips already-delivered recipients (idempotent re-broadcast)', async () => {
    const result = await broadcastAnnouncement(
      chat,
      '9.9.9',
      'body',
      makeDeps({
        isDelivered: (_v, ctx) => ctx === 'pi:u1',
      }),
    )
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 1 })
  })

  test('failure on one recipient does not abort the batch', async () => {
    const result = await broadcastAnnouncement(
      chat,
      '9.9.9',
      'body',
      makeDeps({
        sendGroup: async () => false,
      }),
    )
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 })
  })

  test('a thrown send is counted as failed, not fatal', async () => {
    const result = await broadcastAnnouncement(
      chat,
      '9.9.9',
      'body',
      makeDeps({
        sendDm: async () => {
          throw new Error('network')
        },
      }),
    )
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 })
  })

  test('marks the version broadcast when complete', async () => {
    let markedAt: string | null = null
    await broadcastAnnouncement(chat, '9.9.9', 'body', makeDeps({ markBroadcast: (_v, at) => (markedAt = at) }))
    expect(markedAt).toBe('2026-06-26T00:00:00Z')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/announcements/broadcast.test.ts`
Expected: FAIL — cannot find module `../../src/announcements/broadcast.js`.

- [ ] **Step 3: Write the broadcast implementation**

Create `src/announcements/broadcast.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { dmTarget, type ChatProvider, type DeferredDeliveryTarget } from '../chat/types.js'
import { sendProactiveMessage } from '../deferred-prompts/proactive-delivery.js'
import { logger } from '../logger.js'
import {
  isDelivered as defaultIsDelivered,
  listSubscribedGroups as defaultListGroups,
  listSubscribedUsers as defaultListUsers,
  markBroadcast as defaultMarkBroadcast,
  recordDelivery as defaultRecordDelivery,
  type SubscribedGroup,
  type SubscribedUser,
} from './store.js'

const log = logger.child({ scope: 'announcements:broadcast' })

const MAX_CONCURRENT_SENDS = 5

export type BroadcastSummary = {
  sent: number
  failed: number
  skipped: number
}

export interface BroadcastDeps {
  listSubscribedUsers: () => SubscribedUser[]
  listSubscribedGroups: () => SubscribedGroup[]
  isDelivered: (version: string, contextId: string) => boolean
  recordDelivery: (version: string, contextId: string, contextType: 'dm' | 'group', status: 'sent' | 'failed') => void
  markBroadcast: (version: string, atIso: string) => void
  sendDm: (chat: ChatProvider, platformInstanceId: string, platformUserId: string, body: string) => Promise<boolean>
  sendGroup: (chat: ChatProvider, groupId: string, body: string) => Promise<boolean>
  now: () => string
}

function groupTarget(groupId: string): DeferredDeliveryTarget {
  return {
    contextId: groupId,
    contextType: 'group',
    threadId: null,
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: '',
    createdByUsername: null,
    storageContextId: groupId,
  }
}

const defaultDeps: BroadcastDeps = {
  listSubscribedUsers: defaultListUsers,
  listSubscribedGroups: defaultListGroups,
  isDelivered: defaultIsDelivered,
  recordDelivery: defaultRecordDelivery,
  markBroadcast: defaultMarkBroadcast,
  sendDm: async (chat, platformInstanceId, platformUserId, body) => {
    const result = await chat.sendMessage(platformInstanceId, dmTarget(platformUserId), body)
    return result !== false
  },
  sendGroup: (chat, groupId, body) => sendProactiveMessage(chat, groupTarget(groupId), body),
  now: () => new Date().toISOString(),
}

const dmContextKey = (u: SubscribedUser): string => `${u.platformInstanceId}:${u.platformUserId}`

/** Fan out `body` to all opt-in subscribers. Idempotent per recipient; failure-isolated. */
export async function broadcastAnnouncement(
  chat: ChatProvider,
  version: string,
  body: string,
  deps: BroadcastDeps = defaultDeps,
): Promise<BroadcastSummary> {
  const limit = pLimit(MAX_CONCURRENT_SENDS)
  const summary: BroadcastSummary = { sent: 0, failed: 0, skipped: 0 }

  const send = async (
    contextId: string,
    contextType: 'dm' | 'group',
    doSend: () => Promise<boolean>,
  ): Promise<void> => {
    if (deps.isDelivered(version, contextId)) {
      summary.skipped += 1
      return
    }
    let ok = false
    try {
      ok = await doSend()
    } catch (error) {
      log.warn(
        {
          contextId,
          error: error instanceof Error ? error.message : String(error),
        },
        'announcement send threw',
      )
      ok = false
    }
    deps.recordDelivery(version, contextId, contextType, ok ? 'sent' : 'failed')
    if (ok) summary.sent += 1
    else summary.failed += 1
  }

  const userTasks = deps
    .listSubscribedUsers()
    .map((u) =>
      limit(() => send(dmContextKey(u), 'dm', () => deps.sendDm(chat, u.platformInstanceId, u.platformUserId, body))),
    )
  const groupTasks = deps
    .listSubscribedGroups()
    .map((g) => limit(() => send(g.groupId, 'group', () => deps.sendGroup(chat, g.groupId, body))))

  await Promise.allSettled([...userTasks, ...groupTasks])
  deps.markBroadcast(version, deps.now())
  log.info({ version, ...summary }, 'announcement broadcast complete')
  return summary
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/announcements/broadcast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/announcements/broadcast.ts tests/announcements/broadcast.test.ts
git commit -m "feat(announcements): subscriber broadcast fan-out"
```

---

## Task 5: Startup change — humanize + persist + admin review notice

**Files:**

- Modify: `src/announcements.ts`
- Test: `tests/announcements/announce-new-version.test.ts`

> There is likely an existing announcement test (search `tests/` for `announceNewVersion` / `announcements`). If one exists, update its expectations rather than duplicating. The DI surface changes: `AnnouncementsDeps` gains `humanizeChangelog` and `persistDraft`.

- [ ] **Step 1: Write the failing test**

Create `tests/announcements/announce-new-version.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { announceNewVersion, type AnnouncementsDeps } from '../../src/announcements.js'
import type { ChatProvider } from '../../src/chat/types.js'
import packageJson from '../../package.json' with { type: 'json' }

const VERSION = packageJson.version

function makeChat(sent: string[]): ChatProvider {
  return {
    sendMessage: async (_pid, _target, md: string) => {
      sent.push(md)
      return true
    },
  } as unknown as ChatProvider
}

function makeDeps(over: Partial<AnnouncementsDeps>): AnnouncementsDeps {
  return {
    readChangelogFile: async () => `## [${VERSION}]\n\n### Added\n- thing\n\n## [0.0.1]\n- old`,
    humanizeChangelog: async () => '✨ New\n- A friendly thing',
    persistDraft: () => {},
    isVersionAnnounced: () => false,
    ...over,
  }
}

describe('announceNewVersion', () => {
  test('humanizes, persists, and DMs the admin a review notice (no fan-out)', async () => {
    const sent: string[] = []
    let persisted: { humanizedBody: string | null } | null = null
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        persistDraft: (d) => {
          persisted = { humanizedBody: d.humanizedBody }
        },
      }),
    )
    expect(persisted).toEqual({ humanizedBody: '✨ New\n- A friendly thing' })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('✨ New')
    expect(sent[0]).toContain('Release notes')
  })

  test('falls back to raw body in the admin notice when humanization returns null', async () => {
    const sent: string[] = []
    let persisted: { humanizedBody: string | null } | null = null
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        humanizeChangelog: async () => null,
        persistDraft: (d) => {
          persisted = { humanizedBody: d.humanizedBody }
        },
      }),
    )
    expect(persisted).toEqual({ humanizedBody: null })
    expect(sent[0]).toContain('- thing')
  })

  test('skips entirely when the version is already announced', async () => {
    const sent: string[] = []
    let persistCalls = 0
    await announceNewVersion(
      makeChat(sent),
      'pi-1',
      'admin-1',
      makeDeps({
        isVersionAnnounced: () => true,
        persistDraft: () => {
          persistCalls += 1
        },
      }),
    )
    expect(persistCalls).toBe(0)
    expect(sent).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/announcements/announce-new-version.test.ts`
Expected: FAIL — `humanizeChangelog`/`persistDraft`/`isVersionAnnounced` not in `AnnouncementsDeps`.

- [ ] **Step 3: Rewrite `src/announcements.ts`**

Replace the entire file with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import packageJson from '../package.json' with { type: 'json' }
import { humanizeChangelog as defaultHumanizeChangelog } from './announcements/humanize.js'
import { upsertAnnouncementDraft as defaultUpsertDraft } from './announcements/store.js'
import { readChangelogFile as defaultReadChangelogFile } from './changelog-reader.js'
import type { ChatProvider } from './chat/types.js'
import { dmTarget } from './chat/types.js'
import { getDrizzleDb } from './db/drizzle.js'
import { versionAnnouncements } from './db/schema.js'
import { logger } from './logger.js'
import { extractChangelogSection } from './utils/changelog.js'

export interface AnnouncementsDeps {
  readChangelogFile: () => Promise<string>
  humanizeChangelog: (rawSection: string) => Promise<string | null>
  persistDraft: (input: { version: string; rawBody: string; humanizedBody: string | null }) => void
  isVersionAnnounced: (version: string) => boolean
}

function defaultIsVersionAnnounced(version: string): boolean {
  const row = getDrizzleDb().select().from(versionAnnouncements).where(eq(versionAnnouncements.version, version)).get()
  return row !== undefined
}

const defaultAnnouncementsDeps: AnnouncementsDeps = {
  readChangelogFile: defaultReadChangelogFile,
  humanizeChangelog: (raw) => defaultHumanizeChangelog(raw),
  persistDraft: defaultUpsertDraft,
  isVersionAnnounced: defaultIsVersionAnnounced,
}

const log = logger.child({ scope: 'announcements' })

const VERSION: string = packageJson.version
type RouterInstanceLookup = { getInstance: (id: string) => unknown }

const hasRouterInstanceLookup = (chat: ChatProvider): chat is ChatProvider & RouterInstanceLookup =>
  typeof Reflect.get(chat, 'getInstance') === 'function'

async function sendAnnouncementToAdmin(
  platformInstanceId: string,
  adminUserId: string,
  markdown: string,
  chat: ChatProvider,
): Promise<boolean> {
  try {
    if (hasRouterInstanceLookup(chat)) {
      const instance = chat.getInstance(platformInstanceId)
      if (instance === undefined || instance === null) return false
    }
    const result = await chat.sendMessage(platformInstanceId, dmTarget(adminUserId), markdown)
    if (result === false) return false
    log.debug({ version: VERSION }, 'Announcement review notice sent to admin')
    return true
  } catch (error) {
    log.warn(
      {
        version: VERSION,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to send announcement review notice to admin',
    )
    return false
  }
}

export async function announceNewVersion(
  chat: ChatProvider,
  platformInstanceId: string,
  adminUserId: string,
  ...args: [] | [deps: AnnouncementsDeps]
): Promise<void> {
  log.debug({ version: VERSION }, 'Checking if version announcement is needed')

  const deps = args.length === 0 ? defaultAnnouncementsDeps : args[0]
  const rawSection = await loadChangelogSection(deps)
  if (rawSection === null) return

  if (deps.isVersionAnnounced(VERSION)) {
    log.debug({ version: VERSION }, 'Version already announced, skipping')
    return
  }

  log.info({ version: VERSION }, 'Humanizing changelog and notifying admin')

  const humanized = await deps.humanizeChangelog(rawSection)
  deps.persistDraft({
    version: VERSION,
    rawBody: rawSection,
    humanizedBody: humanized,
  })

  const draftBody = humanized ?? rawSection
  const message =
    `🆕 papai v${VERSION} is ready to announce!\n\n${draftBody}\n\n` +
    `_Review and broadcast to subscribers in Settings → Release notes._`
  const success = await sendAnnouncementToAdmin(platformInstanceId, adminUserId, message, chat)

  log.info({ version: VERSION, success, humanized: humanized !== null }, 'Version announcement notice complete')
}

async function loadChangelogSection(deps: AnnouncementsDeps): Promise<string | null> {
  let changelogContent: string
  try {
    changelogContent = await deps.readChangelogFile()
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Could not read CHANGELOG.md')
    return null
  }

  const section = extractChangelogSection(VERSION, changelogContent)
  if (section === null) {
    log.warn({ version: VERSION }, 'No changelog section found for version, skipping announcement')
    return null
  }
  return section
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/announcements/announce-new-version.test.ts`
Expected: PASS.

- [ ] **Step 5: Run any pre-existing announcements test + typecheck**

Run: `bun test tests/announcements/ && bun typecheck`
Expected: PASS. The `src/index.ts` call site `announceNewVersion(chatProvider, announcementPlatformInstanceId, adminUserId)` is unchanged (still 3 args; deps default). No change needed there.

- [ ] **Step 6: Commit**

```bash
git add src/announcements.ts tests/announcements/announce-new-version.test.ts
git commit -m "feat(announcements): humanize + persist draft + admin review notice on new version"
```

---

## Task 6: Admin "Release notes" route

**Files:**

- Create: `src/debug/settings/admin/release-notes-routes.ts`
- Modify: `src/debug/settings-api-router.ts` (import + dispatch in `routeAdminApi`)
- Test: `tests/debug/settings/admin/release-notes-routes.test.ts`

> The real settings-route test harness is `tests/debug/settings/helpers.ts`
> (`establishSession({ platformInstanceId, platformUserId })` → `{ cookie, csrf }`,
> and `authHeaders(session, withCsrf)`). Admin status comes from
> `addAdmin(userId, platformInstanceId)` (`src/instances/admin-store.js`). Mirror
> `tests/debug/settings/admin/tool-defaults-routes.test.ts` exactly. Note this test
> lives in the `admin/` subfolder, so import depth is `../../../../src/...` and
> `../helpers.js`.

- [ ] **Step 1: Write the route handler**

Create `src/debug/settings/admin/release-notes-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import packageJson from '../../../../package.json' with { type: 'json' }
import { broadcastAnnouncement } from '../../../announcements/broadcast.js'
import { humanizeChangelog } from '../../../announcements/humanize.js'
import { countSubscribers, getAnnouncementDraft, updateHumanizedBody } from '../../../announcements/store.js'
import { readChangelogFile } from '../../../changelog-reader.js'
import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { extractChangelogSection } from '../../../utils/changelog.js'
import { getRuntimeChatRouter } from '../../chat-router-runtime.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-release-notes' })

const VERSION: string = packageJson.version

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('regenerate') }),
  z.object({ action: z.literal('save'), body: z.string().min(1) }),
  z.object({ action: z.literal('broadcast') }),
])

function view(): Response {
  const draft = getAnnouncementDraft(VERSION)
  return settingsJson(200, {
    version: VERSION,
    body: draft?.humanizedBody ?? draft?.rawBody ?? null,
    broadcastAt: draft?.broadcastAt ?? null,
    counts: countSubscribers(),
  })
}

async function resolveRawSection(): Promise<string | null> {
  const draft = getAnnouncementDraft(VERSION)
  if (draft?.rawBody != null && draft.rawBody.length > 0) return draft.rawBody
  try {
    return extractChangelogSection(VERSION, await readChangelogFile())
  } catch {
    return null
  }
}

function handleGet(authed: AuthenticatedSettingsRequest): Response {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  return view()
}

async function handlePost(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ActionSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  if (body.data.action === 'save') {
    updateHumanizedBody(VERSION, body.data.body)
    log.info({ version: VERSION }, 'release notes draft saved')
    return view()
  }

  if (body.data.action === 'regenerate') {
    const raw = await resolveRawSection()
    if (raw === null)
      return settingsJson(422, {
        error: 'no changelog content for this version',
      })
    const humanized = await humanizeChangelog(raw)
    if (humanized === null)
      return settingsJson(422, {
        error: 'LLM unavailable or returned empty output',
      })
    updateHumanizedBody(VERSION, humanized)
    log.info({ version: VERSION }, 'release notes draft regenerated')
    return view()
  }

  // broadcast
  const draft = getAnnouncementDraft(VERSION)
  const sendBody = draft?.humanizedBody ?? draft?.rawBody
  if (sendBody == null || sendBody.length === 0) return settingsJson(422, { error: 'nothing to broadcast' })
  const chat = getRuntimeChatRouter()
  if (chat === null) return settingsJson(422, { error: 'chat router not running' })
  const result = await broadcastAnnouncement(chat, VERSION, sendBody)
  log.info({ version: VERSION, ...result }, 'release notes broadcast')
  return settingsJson(200, {
    version: VERSION,
    broadcast: result,
    counts: countSubscribers(),
  })
}

export function handleAdminReleaseNotesRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/release-notes') {
    if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed))
    if (req.method === 'POST') return handlePost(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
```

- [ ] **Step 2: Register the route in `src/debug/settings-api-router.ts`**

Add the import near the other admin route imports at the top of the file:

```typescript
import { handleAdminReleaseNotesRoutes } from './settings/admin/release-notes-routes.js'
```

Inside `routeAdminApi`, add before the final `return null`:

```typescript
if (p === '/settings/api/admin/release-notes') return handleAdminReleaseNotesRoutes(req, url, p)
```

- [ ] **Step 3: Write the failing test**

Create `tests/debug/settings/admin/release-notes-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import packageJson from '../../../../package.json' with { type: 'json' }
import { upsertAnnouncementDraft } from '../../../../src/announcements/store.js'
import { handleAdminReleaseNotesRoutes } from '../../../../src/debug/settings/admin/release-notes-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const PATH = '/settings/api/admin/release-notes'
const VERSION = packageJson.version

describe('admin release-notes route', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({
      platformInstanceId: 'pi-1',
      platformUserId: 'admin-1',
    })
    userSession = await establishSession({
      platformInstanceId: 'pi-1',
      platformUserId: 'user-1',
    })
  })

  test('GET returns version + body + counts for an admin', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(new Request(url, { headers: authHeaders(adminSession) }), url, PATH)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.version).toBe(VERSION)
    expect(json.counts).toEqual({ dm: 0, group: 0 })
  })

  test('non-admin is forbidden', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(new Request(url, { headers: authHeaders(userSession) }), url, PATH)
    expect(res.status).toBe(403)
  })

  test('PUT is 405', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(
      new Request(url, {
        method: 'PUT',
        headers: authHeaders(adminSession, true),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(405)
  })

  test('POST with unknown action is 422', async () => {
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(
      new Request(url, {
        method: 'POST',
        headers: {
          ...authHeaders(adminSession, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'nope' }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(422)
  })

  test('POST save updates the humanized body', async () => {
    upsertAnnouncementDraft({
      version: VERSION,
      rawBody: 'raw',
      humanizedBody: 'orig',
    })
    const url = new URL(`https://x${PATH}`)
    const res = await handleAdminReleaseNotesRoutes(
      new Request(url, {
        method: 'POST',
        headers: {
          ...authHeaders(adminSession, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'save', body: 'edited body' }),
      }),
      url,
      PATH,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).body).toBe('edited body')
  })
})
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `bun test tests/debug/settings/admin/release-notes-routes.test.ts`
First run expected: FAIL (route not registered / module missing). After Steps 1–2 it passes.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/release-notes-routes.ts src/debug/settings-api-router.ts tests/debug/settings/release-notes-routes.test.ts
git commit -m "feat(settings): admin release-notes route (view/regenerate/save/broadcast)"
```

---

## Task 7: Subscription routes (personal + group)

**Files:**

- Create: `src/debug/settings/release-subscription-routes.ts` (personal)
- Modify: `src/debug/settings/group-routes.ts` (group handlers + dispatch)
- Modify: `src/debug/settings-api-router.ts` (register personal route)
- Test: `tests/debug/settings/release-subscription-routes.test.ts`

- [ ] **Step 1: Write the personal route handler**

Create `src/debug/settings/release-subscription-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getUserAnnounceSubscribed, setUserAnnounceSubscribed } from '../../announcements/store.js'
import { logger } from '../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from './respond.js'

const log = logger.child({
  scope: 'debug-server:settings-release-subscription',
})

const BodySchema = z.object({ enabled: z.boolean() })

function handleGet(authed: AuthenticatedSettingsRequest): Response {
  if (!authed.principal.authorized) return settingsJson(403, { error: 'forbidden' })
  const enabled = getUserAnnounceSubscribed(authed.principal.platformInstanceId, authed.principal.platformUserId)
  return settingsJson(200, { enabled })
}

async function handlePatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  if (!authed.principal.authorized) return settingsJson(403, { error: 'forbidden' })
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = BodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  setUserAnnounceSubscribed(authed.principal.platformInstanceId, authed.principal.platformUserId, body.data.enabled)
  log.info(
    {
      platformInstanceId: authed.principal.platformInstanceId,
      enabled: body.data.enabled,
    },
    'release subscription updated',
  )
  return settingsJson(200, { ok: true, enabled: body.data.enabled })
}

export function handleReleaseSubscriptionRoutes(req: Request, _url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (req.method === 'GET') return Promise.resolve(handleGet(auth.authed))
  if (req.method === 'PATCH') return handlePatch(req, auth.authed)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
```

- [ ] **Step 2: Add the group handlers + dispatch in `src/debug/settings/group-routes.ts`**

Add the import for the store getters/setters near the top (with the other `../../` imports):

```typescript
import { getGroupAnnounceSubscribed, setGroupAnnounceSubscribed } from '../../announcements/store.js'
```

Add these handlers near `handleGuestModeGet`/`handleGuestModePatch`:

```typescript
const ReleaseSubBodySchema = z.object({
  enabled: z.boolean(),
  contextId: z.string().min(1),
})

function handleReleaseSubGet(authed: AuthenticatedSettingsRequest, url: URL): Response {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  return settingsJson(200, {
    contextId: outcome.group.contextId,
    enabled: getGroupAnnounceSubscribed(outcome.group.contextId),
  })
}

async function handleReleaseSubPatch(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ReleaseSubBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const outcome = requireGroup(authed, 'write', body.data.contextId)
  if (!outcome.ok) return outcome.response
  setGroupAnnounceSubscribed(outcome.group.contextId, body.data.enabled)
  log.info({ contextId: outcome.group.contextId, enabled: body.data.enabled }, 'group release subscription updated')
  return settingsJson(200, {
    ok: true,
    contextId: outcome.group.contextId,
    enabled: body.data.enabled,
  })
}
```

In `handleGroupRoutes`, add this branch alongside the existing `/settings/api/group/guest-mode` branch:

```typescript
if (pathname === '/settings/api/group/release-subscription') {
  if (req.method === 'GET') return Promise.resolve(handleReleaseSubGet(auth.authed, url))
  if (req.method === 'PATCH') return handleReleaseSubPatch(req, auth.authed)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
```

- [ ] **Step 3: Register the personal route in `src/debug/settings-api-router.ts`**

Add the import:

```typescript
import { handleReleaseSubscriptionRoutes } from './settings/release-subscription-routes.js'
```

In `routeSettingsApi`, add before the `/settings/api/group/` branch:

```typescript
if (url.pathname === '/settings/api/release-subscription') return handleReleaseSubscriptionRoutes(req, url)
```

- [ ] **Step 4: Write the failing test**

Create `tests/debug/settings/release-subscription-routes.test.ts` (mirrors `guest-mode-routes.test.ts` for the group case):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleGroupRoutes } from '../../../src/debug/settings/group-routes.js'
import { handleReleaseSubscriptionRoutes } from '../../../src/debug/settings/release-subscription-routes.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../../src/group-settings/registry.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PERSONAL = '/settings/api/release-subscription'
const GROUP = '/settings/api/group/release-subscription'

function seedManageableGroup(): string {
  const scopedGroupId = toScopedContextId({
    platformInstanceId: 'pi-1',
    nativeContextId: 'grp-1',
  })
  upsertKnownGroupContext({
    contextId: scopedGroupId,
    provider: 'telegram',
    displayName: 'Test Group',
    parentName: null,
  })
  upsertGroupAdminObservation({
    contextId: scopedGroupId,
    provider: 'telegram',
    userId: 'u-1',
    username: 'u-1',
    isAdmin: true,
  })
  addAuthorizedGroup(scopedGroupId, 'u-1')
  return scopedGroupId
}

describe('release-subscription routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({
      userId: 'u-1',
      platformInstanceId: 'pi-1',
      addedBy: 'admin',
      username: undefined,
    })
    session = await establishSession({
      platformInstanceId: 'pi-1',
      platformUserId: 'u-1',
    })
  })

  test('personal GET defaults to enabled=false; PATCH round-trips', async () => {
    const url = new URL(`https://x${PERSONAL}`)
    const get0 = await handleReleaseSubscriptionRoutes(new Request(url, { headers: authHeaders(session) }), url)
    expect(get0.status).toBe(200)
    expect((await get0.json()).enabled).toBe(false)

    const patch = await handleReleaseSubscriptionRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true }),
      }),
      url,
    )
    expect(patch.status).toBe(200)

    const get1 = await handleReleaseSubscriptionRoutes(new Request(url, { headers: authHeaders(session) }), url)
    expect((await get1.json()).enabled).toBe(true)
  })

  test('personal PATCH without CSRF → 403', async () => {
    const url = new URL(`https://x${PERSONAL}`)
    const res = await handleReleaseSubscriptionRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true }),
      }),
      url,
    )
    expect(res.status).toBe(403)
  })

  test('personal POST → 405', async () => {
    const url = new URL(`https://x${PERSONAL}`)
    const res = await handleReleaseSubscriptionRoutes(
      new Request(url, { method: 'POST', headers: authHeaders(session, true) }),
      url,
    )
    expect(res.status).toBe(405)
  })

  test('group admin can toggle their group subscription', async () => {
    const contextId = seedManageableGroup()
    const url = new URL(`https://x${GROUP}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true, contextId }),
      }),
      url,
      GROUP,
    )
    expect(res.status).toBe(200)
    expect((await res.json()).enabled).toBe(true)
  })

  test('group PATCH for an unmanaged context → 403', async () => {
    const url = new URL(`https://x${GROUP}`)
    const res = await handleGroupRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: {
          ...authHeaders(session, true),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true, contextId: 'unmanaged-context' }),
      }),
      url,
      GROUP,
    )
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `bun test tests/debug/settings/release-subscription-routes.test.ts`
First run expected: FAIL (routes not yet wired). After Steps 1–3 it passes.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/release-subscription-routes.ts src/debug/settings/group-routes.ts src/debug/settings-api-router.ts tests/debug/settings/release-subscription-routes.test.ts
git commit -m "feat(settings): personal + group release-subscription routes"
```

---

## Task 8: Client fetchers + schemas

**Files:**

- Modify: `client/settings/fetcher-schemas.ts`
- Modify: `client/settings/fetchers.ts`
- Modify: `client/settings/admin-fetchers.ts`

No standalone test here; these are exercised by the section tests in Tasks 9-10. Verified by `bun typecheck` + `bun build:client`.

- [ ] **Step 1: Add response schemas to `client/settings/fetcher-schemas.ts`**

Append:

```typescript
export const ReleaseSubscriptionResponseSchema = z.object({
  enabled: z.boolean(),
})
export type ReleaseSubscriptionResponse = z.infer<typeof ReleaseSubscriptionResponseSchema>

export const GroupReleaseSubscriptionResponseSchema = z.object({
  contextId: z.string(),
  enabled: z.boolean(),
})
export type GroupReleaseSubscriptionResponse = z.infer<typeof GroupReleaseSubscriptionResponseSchema>

export const ReleaseNotesResponseSchema = z.object({
  version: z.string(),
  body: z.string().nullable(),
  broadcastAt: z.string().nullable(),
  counts: z.object({ dm: z.number(), group: z.number() }),
})
export type ReleaseNotesResponse = z.infer<typeof ReleaseNotesResponseSchema>

export const ReleaseBroadcastResultSchema = z.object({
  version: z.string(),
  broadcast: z.object({
    sent: z.number(),
    failed: z.number(),
    skipped: z.number(),
  }),
  counts: z.object({ dm: z.number(), group: z.number() }),
})
export type ReleaseBroadcastResult = z.infer<typeof ReleaseBroadcastResultSchema>
```

- [ ] **Step 2: Add subscription fetchers to `client/settings/fetchers.ts`**

Add imports for the new schemas at the top (with the other schema imports), then append:

```typescript
export const fetchReleaseSubscription = (): Promise<ReleaseSubscriptionResponse> =>
  getJson('/settings/api/release-subscription', (b) => ReleaseSubscriptionResponseSchema.parse(b))

export const patchReleaseSubscription = (input: { enabled: boolean }): Promise<unknown> =>
  writeJson('/settings/api/release-subscription', 'PATCH', input, (b) => b)

export const fetchGroupReleaseSubscription = (contextId: string): Promise<GroupReleaseSubscriptionResponse> =>
  getJson(`/settings/api/group/release-subscription?${ctxQuery(contextId)}`, (b) =>
    GroupReleaseSubscriptionResponseSchema.parse(b),
  )

export const patchGroupReleaseSubscription = (input: { enabled: boolean; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/release-subscription', 'PATCH', input, (b) => b)
```

- [ ] **Step 3: Add admin fetchers to `client/settings/admin-fetchers.ts`**

Add imports for `ReleaseNotesResponseSchema`/`ReleaseNotesResponse`/`ReleaseBroadcastResultSchema`/`ReleaseBroadcastResult` (mirror how `AnnounceResultSchema`/`AnnounceResult` are imported there), then append. Use the same `getJson`/`writeJson` helpers the existing admin fetchers use (they share the `settingsFetch`-based helpers; copy the exact call style from `sendAnnounce` and `fetchAdminByok`):

```typescript
export const fetchReleaseNotes = (): Promise<ReleaseNotesResponse> =>
  getJson('/settings/api/admin/release-notes', (b) => ReleaseNotesResponseSchema.parse(b))

export const regenerateReleaseNotes = (): Promise<ReleaseNotesResponse> =>
  writeJson('/settings/api/admin/release-notes', 'POST', { action: 'regenerate' }, (b) =>
    ReleaseNotesResponseSchema.parse(b),
  )

export const saveReleaseNotes = (body: string): Promise<ReleaseNotesResponse> =>
  writeJson('/settings/api/admin/release-notes', 'POST', { action: 'save', body }, (b) =>
    ReleaseNotesResponseSchema.parse(b),
  )

export const broadcastReleaseNotes = (): Promise<ReleaseBroadcastResult> =>
  writeJson('/settings/api/admin/release-notes', 'POST', { action: 'broadcast' }, (b) =>
    ReleaseBroadcastResultSchema.parse(b),
  )
```

> If `admin-fetchers.ts` uses local re-exports of `getJson`/`writeJson` under different names (e.g. `adminGetJson`), use those instead — match the file's existing style. Verify by reading the top of `client/settings/admin-fetchers.ts` first.

- [ ] **Step 4: Typecheck + build client**

Run: `bun typecheck && bun build:client`
Expected: PASS (bundles built).

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/fetchers.ts client/settings/admin-fetchers.ts
git commit -m "feat(settings-ui): release notes + subscription fetchers and schemas"
```

---

## Task 9: Admin "Release notes" section component

**Files:**

- Create: `client/settings/sections/admin/AdminReleaseNotesSection.svelte`
- Modify: `client/settings/SettingsApp.svelte` (import, mount, sidebar)

- [ ] **Step 1: Write the component**

Create `client/settings/sections/admin/AdminReleaseNotesSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../../shared/ui/Btn.svelte'
  import Field from '../../../shared/ui/Field.svelte'
  import Input from '../../../shared/ui/Input.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import Confirm from '../../../shared/Confirm.svelte'
  import {
    broadcastReleaseNotes,
    fetchReleaseNotes,
    regenerateReleaseNotes,
    saveReleaseNotes,
  } from '../../admin-fetchers.js'
  import type { ReleaseBroadcastResult, ReleaseNotesResponse } from '../../fetcher-schemas.js'

  let data = $state<ReleaseNotesResponse | null>(null)
  let body = $state('')
  let error: string | null = $state(null)
  let busy = $state(false)
  let confirming = $state(false)
  let lastBroadcast = $state<ReleaseBroadcastResult | null>(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function load(): Promise<void> {
    error = null
    busy = true
    try {
      data = await fetchReleaseNotes()
      body = data.body ?? ''
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function regenerate(): Promise<void> {
    error = null
    busy = true
    try {
      data = await regenerateReleaseNotes()
      body = data.body ?? ''
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function save(): Promise<void> {
    if (body.trim() === '') return
    error = null
    busy = true
    try {
      data = await saveReleaseNotes(body)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  async function confirmedBroadcast(): Promise<void> {
    confirming = false
    error = null
    busy = true
    try {
      lastBroadcast = await broadcastReleaseNotes()
      await load()
    } catch (err) {
      error = messageFrom(err)
    } finally {
      busy = false
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="release-notes" class="settings-section">
  <PageHeader eyebrow="Admin" title="Release notes" />

  {#if error !== null}<p class="status-error" data-testid="release-notes-error">{error}</p>{/if}

  {#if data !== null}
    <p class="settings-section__caption">
      Version {data.version} · {data.counts.dm} DM + {data.counts.group} group subscriber(s)
      {#if data.broadcastAt !== null} · already broadcast{/if}
    </p>

    <Field label="Announcement">
      <Input value={body} onInput={(v) => (body = v)} testid="release-notes-body" multiline rows={8} />
    </Field>

    <div class="settings-actions">
      <Btn variant="outline" size="sm" disabled={busy} testid="release-notes-regenerate" onClick={() => void regenerate()}>
        {#snippet children()}Regenerate{/snippet}
      </Btn>
      <Btn variant="outline" size="sm" disabled={busy || body.trim() === ''} testid="release-notes-save" onClick={() => void save()}>
        {#snippet children()}Save{/snippet}
      </Btn>
      <Btn
        variant="primary"
        size="sm"
        disabled={busy || body.trim() === ''}
        testid="release-notes-broadcast"
        onClick={() => (confirming = true)}>
        {#snippet children()}Broadcast{/snippet}
      </Btn>
    </div>

    {#if lastBroadcast !== null}
      <p class="status-success" data-testid="release-notes-result">
        Sent {lastBroadcast.broadcast.sent}, failed {lastBroadcast.broadcast.failed}, skipped {lastBroadcast.broadcast.skipped}.
      </p>
    {/if}
  {/if}
</section>

<Confirm
  open={confirming}
  title="Broadcast release notes"
  danger
  confirmLabel="Send to subscribers"
  onCancel={() => (confirming = false)}
  onConfirm={() => void confirmedBroadcast()}>
  {#snippet body()}<p>This sends the announcement to all opt-in subscribers. Continue?</p>{/snippet}
</Confirm>
```

> Confirm the `Btn`/`Input`/`Field`/`Confirm`/`PageHeader` prop names against `AdminAnnounceSection.svelte` (Task reference) — match its exact usage (e.g. `Input ... multiline rows={n}`, `Btn` `testid`, `{#snippet children()}`). Adjust if the shared UI components differ.

- [ ] **Step 2: Mount in `client/settings/SettingsApp.svelte`**

Add the import alongside the other admin section imports:

```typescript
import AdminReleaseNotesSection from './sections/admin/AdminReleaseNotesSection.svelte'
```

In the `isBotAdmin` admin zone (next to `<AdminAnnounceSection />`), add:

```svelte
                <AdminReleaseNotesSection />
```

In `buildAdminSidebarItems`, add to the `isBotAdmin` items list (after the `announce` item):

```typescript
        { id: 'release-notes', label: 'Release notes' },
```

- [ ] **Step 3: Typecheck + build client**

Run: `bun typecheck && bun build:client`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/settings/sections/admin/AdminReleaseNotesSection.svelte client/settings/SettingsApp.svelte
git commit -m "feat(settings-ui): admin Release notes section"
```

---

## Task 10: Subscription toggle component (personal + group)

**Files:**

- Create: `client/settings/sections/ReleaseSubscriptionSection.svelte`
- Modify: `client/settings/SettingsApp.svelte` (import + mount in personal and group areas)
- Test: `tests/client/settings/release-subscription-section.test.ts`

- [ ] **Step 1: Write the failing client test**

Create `tests/client/settings/release-subscription-section.test.ts` (mirrors `tests/client/settings/admin-byok-section.test.ts`):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import ReleaseSubscriptionSection from '../../../client/settings/sections/ReleaseSubscriptionSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

afterEach(() => {
  restoreFetch()
})

describe('ReleaseSubscriptionSection', () => {
  test('personal scope reads /settings/api/release-subscription and shows the toggle', async () => {
    const urls: string[] = []
    setMockFetch((url) => {
      urls.push(url)
      return Promise.resolve(json({ enabled: false }))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReleaseSubscriptionSection, {
      target,
      props: { scope: 'personal', contextId: 'u1' },
    })

    await drain()

    expect(urls.some((u) => u.includes('/settings/api/release-subscription'))).toBe(true)
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).not.toBeNull()
    void unmount(component)
  })

  test('group scope reads /settings/api/group/release-subscription with contextId', async () => {
    const urls: string[] = []
    setMockFetch((url) => {
      urls.push(url)
      return Promise.resolve(json({ contextId: 'g1', enabled: true }))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReleaseSubscriptionSection, {
      target,
      props: { scope: 'group', contextId: 'g1' },
    })

    await drain()

    expect(urls.some((u) => u.includes('/settings/api/group/release-subscription') && u.includes('contextId=g1'))).toBe(
      true,
    )
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/settings/release-subscription-section.test.ts`
Expected: FAIL — `ReleaseSubscriptionSection.svelte` does not exist yet.

- [ ] **Step 3: Write the component**

Create `client/settings/sections/ReleaseSubscriptionSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import {
    fetchGroupReleaseSubscription,
    fetchReleaseSubscription,
    patchGroupReleaseSubscription,
    patchReleaseSubscription,
  } from '../fetchers.js'

  interface Props {
    scope: 'personal' | 'group'
    contextId: string
  }

  let { scope, contextId }: Props = $props()

  let enabled = $state<boolean | null>(null)
  let loading = $state(false)
  let mutating = $state(false)
  let error: string | null = $state(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const result = scope === 'group' ? await fetchGroupReleaseSubscription(id) : await fetchReleaseSubscription()
      if (scope === 'group' && id !== contextId) return
      enabled = result.enabled
    } catch (err) {
      error = messageFrom(err)
    } finally {
      loading = false
    }
  }

  async function toggle(): Promise<void> {
    if (enabled === null) return
    error = null
    mutating = true
    try {
      if (scope === 'group') await patchGroupReleaseSubscription({ contextId, enabled: !enabled })
      else await patchReleaseSubscription({ enabled: !enabled })
      await load(contextId)
    } catch (err) {
      error = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="release-announcements" class="settings-section">
  <PageHeader eyebrow={scope === 'group' ? 'Group' : 'Personal'} title="Release announcements">
    {#snippet action()}
      <Btn
        variant={enabled ? 'outline' : 'primary'}
        size="sm"
        disabled={enabled === null || loading || mutating}
        testid="release-subscription-toggle"
        onClick={() => void toggle()}>
        {#snippet children()}{enabled ? 'Unsubscribe' : 'Subscribe'}{/snippet}
      </Btn>
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error" data-testid="release-subscription-error">{error}</p>{/if}

  <p class="settings-section__caption">
    {#if scope === 'group'}
      When on, this group receives a message whenever a new bot version ships. Only future releases — past ones are not re-sent.
    {:else}
      When on, you receive a DM whenever a new bot version ships. Only future releases — past ones are not re-sent.
    {/if}
  </p>
</section>
```

> Match `PageHeader` snippet/action usage and `Btn` props to `GuestModeSection.svelte` exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client tests/client/settings/release-subscription-section.test.ts`
Expected: PASS.

- [ ] **Step 5: Mount in `client/settings/SettingsApp.svelte`**

Add the import with the other section imports:

```typescript
import ReleaseSubscriptionSection from './sections/ReleaseSubscriptionSection.svelte'
```

In the group block (the `{#if isGroup}` region, after `<GuestModeSection contextId={ctx} />`):

```svelte
              <ReleaseSubscriptionSection scope="group" contextId={ctx} />
```

In the personal sections area (near the other personal sections like `<ProfileSection />`/`<MemorySection />` that receive `contextId={ctx}`):

```svelte
            <ReleaseSubscriptionSection scope="personal" contextId={ctx} />
```

- [ ] **Step 6: Typecheck + build client**

Run: `bun typecheck && bun build:client`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/settings/sections/ReleaseSubscriptionSection.svelte client/settings/SettingsApp.svelte tests/client/settings/release-subscription-section.test.ts
git commit -m "feat(settings-ui): release announcement subscription toggle (personal + group)"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full server suite**

Run: `bun run test`
Expected: PASS. Investigate and fix any failure before continuing.

- [ ] **Step 2: Run the client suite**

Run: `bun test:client`
Expected: PASS.

- [ ] **Step 3: Run the full check**

Run: `bun check:full`
Expected: PASS (lint, typecheck, format, license-headers, etc.).

- [ ] **Step 4: Manual smoke (optional, requires a running bot + settings UI)**

- Set a fake newer `version` in `package.json` (or add a matching `## [x.y.z]` section to `CHANGELOG.md`), start the bot, confirm the admin receives a humanized review DM and NO subscribers receive anything.
- In settings → Release notes (admin), edit + Save, Regenerate, then Broadcast; confirm only subscribed contexts received it.
- Toggle a personal subscription off and a group subscription on; re-broadcast a new test version; confirm targeting.

- [ ] **Step 5: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "test: verification fixes for release announcement subscriptions"
```
