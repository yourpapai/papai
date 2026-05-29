<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Access Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side access model for the settings web UI — one-time code issuance from `/config`, the exchange/logout/bootstrap endpoints, SQLite-backed sessions with synchronizer-token CSRF, per-request principal resolution, and the scope guard — all on the existing `Bun.serve()` listener with strict isolation from `DEBUG_TOKEN`.

**Architecture:** A new `src/settings/` module holds the auth/session/scope logic over three new SQLite tables (migration `047`). The existing debug server (`src/debug/server.ts`) branches on the `/settings/*` path prefix **before** its `DEBUG_TOKEN` check and dispatches to a new `src/debug/settings-router.ts`. Chat `/config` issues a single-use, short-TTL code; the browser exchanges it for an httpOnly session cookie; every `/settings/api/*` write reuses existing authorization stores via a `requireScope` guard. This plan delivers the access model only — the individual capability write-routes and the Svelte SPA belong to the Surface spec.

**Tech Stack:** Bun, TypeScript (strict), Drizzle ORM (`bun:sqlite`), Zod v4, `node:crypto`, `bun:test`.

**Source spec:** [`docs/superpowers/specs/2026-05-28-settings-web-ui-access-model-design.md`](../specs/2026-05-28-settings-web-ui-access-model-design.md)

**Scope notes / resolved open questions carried into this plan:**

- OQ-A5 (auto-redact chat message after exchange): **out of scope.** The `/config` reply warns the link is single-use; redaction is deferred.
- OQ-P1 (bot admin editing another user's personal context): follows the spec default — **not allowed**; `requireScope` resolves `personal` only to the principal's own context.
- OQ-P2 (group-admin determination): resolved purely from stored state via `listManageableGroups` (platform-admin + authorized-group), no live chat signal needed.

**Conventions every task must follow** (from `CLAUDE.md`):

- Every created `.ts` file starts with the 4-line BUSL SPDX header (copy from any existing `src/` file).
- All import paths use the `.js` extension.
- Strict TypeScript. Error extraction: `error instanceof Error ? error.message : String(error)`.
- Never add `eslint-disable` / `@ts-ignore` / `@ts-nocheck` — the write hook blocks them.
- `process.env` reads use bracket-string notation, e.g. `process.env['SETTINGS_PUBLIC_BASE_URL']`.
- New tests follow `tests/CLAUDE.md`: `import { mockLogger, setupTestDb } from '../utils/test-helpers.js'`, then `mockLogger(); await setupTestDb()` in `beforeEach`. `setupTestDb()` runs **all** migrations (including the new `047`) into an in-memory DB.
- The TDD write hook runs the targeted test for each edited `src/` file; keep tests green before moving on.

---

## Task 1: Settings public base-URL config & link builder

**Files:**

- Create: `src/settings/config.ts`
- Test: `tests/settings/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings/config.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { buildSettingsUrl, getSettingsPublicBaseUrl } from '../../src/settings/config.js'

describe('settings config', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(() => {
    delete process.env['SETTINGS_PUBLIC_BASE_URL']
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  test('getSettingsPublicBaseUrl returns null when unset', () => {
    expect(getSettingsPublicBaseUrl()).toBeNull()
  })

  test('getSettingsPublicBaseUrl strips trailing slashes', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com///'
    expect(getSettingsPublicBaseUrl()).toBe('https://bot.example.com')
  })

  test('buildSettingsUrl returns null when base url unset', () => {
    expect(buildSettingsUrl('abc')).toBeNull()
  })

  test('buildSettingsUrl builds an encoded /settings link', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    expect(buildSettingsUrl('a b+c')).toBe('https://bot.example.com/settings?code=a%20b%2Bc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/config.test.ts`
Expected: FAIL — `Cannot find module '../../src/settings/config.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/config.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function getSettingsPublicBaseUrl(): string | null {
  const raw = process.env['SETTINGS_PUBLIC_BASE_URL']
  if (raw === undefined || raw.trim() === '') return null
  return raw.trim().replace(/\/+$/, '')
}

export function buildSettingsUrl(code: string): string | null {
  const base = getSettingsPublicBaseUrl()
  if (base === null) return null
  return `${base}/settings?code=${encodeURIComponent(code)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/config.ts tests/settings/config.test.ts
git commit -m "feat(settings): add public base-url config and link builder"
```

---

## Task 2: Crypto helpers (code generation, hashing, constant-time compare)

**Files:**

- Create: `src/settings/crypto.ts`
- Test: `tests/settings/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings/crypto.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { generateToken, hashToken, timingSafeEqualHex } from '../../src/settings/crypto.js'

describe('settings crypto', () => {
  test('generateToken returns a high-entropy url-safe string', () => {
    const token = generateToken()
    // 32 random bytes base64url-encoded => 43 chars, no padding, url-safe alphabet
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateToken()).not.toBe(token)
  })

  test('hashToken is deterministic 64-char hex', () => {
    const hash = hashToken('hello')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('hello')).toBe(hash)
    expect(hashToken('world')).not.toBe(hash)
  })

  test('timingSafeEqualHex compares equal and unequal hex strings', () => {
    const a = hashToken('same')
    expect(timingSafeEqualHex(a, hashToken('same'))).toBe(true)
    expect(timingSafeEqualHex(a, hashToken('different'))).toBe(false)
    expect(timingSafeEqualHex(a, 'deadbeef')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/crypto.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 32 random bytes (256 bits) encoded url-safe, no padding. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** SHA-256 of a token, lowercase hex. Only hashes are persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/crypto.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/crypto.ts tests/settings/crypto.test.ts
git commit -m "feat(settings): add crypto helpers for codes and sessions"
```

---

## Task 3: DB schema & migration `047_settings_auth`

**Files:**

- Create: `src/db/settings-auth-schema.ts`
- Create: `src/db/migrations/047_settings_auth.ts`
- Modify: `src/db/schema.ts` (add barrel re-export)
- Modify: `src/db/index.ts` (import + append to `MIGRATIONS`)
- Test: `tests/db/settings-auth-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/settings-auth-schema.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { settingsAuthCodes, settingsRateLimit, settingsSessions } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('settings auth schema (migration 047)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('settings_auth_codes round-trips a row', () => {
    const db = getDrizzleDb()
    db.insert(settingsAuthCodes)
      .values({
        codeHash: 'hash-1',
        platformInstanceId: 'pi-1',
        platformUserId: 'u-1',
        createdAt: 1,
        expiresAt: 2,
        usedAt: null,
      })
      .run()
    const row = db.select().from(settingsAuthCodes).get()
    expect(row?.platformUserId).toBe('u-1')
    expect(row?.usedAt).toBeNull()
  })

  test('settings_sessions round-trips a row', () => {
    const db = getDrizzleDb()
    db.insert(settingsSessions)
      .values({
        sessionIdHash: 'sid-1',
        platformInstanceId: 'pi-1',
        platformUserId: 'u-1',
        createdAt: 1,
        expiresAt: 2,
        csrfTokenHash: 'csrf-1',
      })
      .run()
    const row = db.select().from(settingsSessions).get()
    expect(row?.csrfTokenHash).toBe('csrf-1')
  })

  test('settings_rate_limit round-trips a row', () => {
    const db = getDrizzleDb()
    db.insert(settingsRateLimit).values({ bucket: 'issue', actorId: 'a-1', windowStart: 0, count: 1 }).run()
    const row = db.select().from(settingsRateLimit).get()
    expect(row?.count).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/settings-auth-schema.test.ts`
Expected: FAIL — `settingsAuthCodes` is not exported from `../../src/db/schema.js`.

- [ ] **Step 3: Create the schema file**

Create `src/db/settings-auth-schema.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const settingsAuthCodes = sqliteTable(
  'settings_auth_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    platformInstanceId: text('platform_instance_id').notNull(),
    platformUserId: text('platform_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [index('idx_settings_auth_codes_principal').on(table.platformInstanceId, table.platformUserId)],
)

export const settingsSessions = sqliteTable(
  'settings_sessions',
  {
    sessionIdHash: text('session_id_hash').primaryKey(),
    platformInstanceId: text('platform_instance_id').notNull(),
    platformUserId: text('platform_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
  },
  (table) => [index('idx_settings_sessions_principal').on(table.platformInstanceId, table.platformUserId)],
)

export const settingsRateLimit = sqliteTable(
  'settings_rate_limit',
  {
    bucket: text('bucket').notNull(),
    actorId: text('actor_id').notNull(),
    windowStart: integer('window_start').notNull(),
    count: integer('count').notNull(),
  },
  (table) => [primaryKey({ columns: [table.bucket, table.actorId, table.windowStart] })],
)

export type SettingsAuthCodeRow = typeof settingsAuthCodes.$inferSelect
export type SettingsSessionRow = typeof settingsSessions.$inferSelect
```

- [ ] **Step 4: Add the barrel re-export**

In `src/db/schema.ts`, add this line alongside the other sub-schema re-exports (near the `plugin-schema.js` / `instance-schema.js` exports):

```typescript
export { settingsAuthCodes, settingsRateLimit, settingsSessions } from './settings-auth-schema.js'
```

- [ ] **Step 5: Create the migration file**

Create `src/db/migrations/047_settings_auth.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:047' })

function createSettingsAuthCodesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings_auth_codes (
      code_hash TEXT PRIMARY KEY,
      platform_instance_id TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    )
  `)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_settings_auth_codes_principal ON settings_auth_codes (platform_instance_id, platform_user_id)`,
  )
}

function createSettingsSessionsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings_sessions (
      session_id_hash TEXT PRIMARY KEY,
      platform_instance_id TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      csrf_token_hash TEXT NOT NULL
    )
  `)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_settings_sessions_principal ON settings_sessions (platform_instance_id, platform_user_id)`,
  )
}

function createSettingsRateLimitTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS settings_rate_limit (
      bucket TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (bucket, actor_id, window_start)
    )
  `)
}

const up = (db: Database): void => {
  createSettingsAuthCodesTable(db)
  createSettingsSessionsTable(db)
  createSettingsRateLimitTable(db)
  log.info('migration 047: settings auth tables created')
}

export const migration047SettingsAuth: Migration = {
  id: '047_settings_auth',
  up,
}

export default migration047SettingsAuth
```

- [ ] **Step 6: Register the migration**

In `src/db/index.ts`, add the import alongside the other migration imports:

```typescript
import { migration047SettingsAuth } from './migrations/047_settings_auth.js'
```

Then append it to the `MIGRATIONS` array, immediately after `migration046ParentSharedContextEntities`:

```typescript
  migration046ParentSharedContextEntities,
  migration047SettingsAuth,
]
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test tests/db/settings-auth-schema.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add src/db/settings-auth-schema.ts src/db/migrations/047_settings_auth.ts src/db/schema.ts src/db/index.ts tests/db/settings-auth-schema.test.ts
git commit -m "feat(settings): add 047 migration and schema for auth codes, sessions, rate limit"
```

---

## Task 4: One-time auth-code store

**Files:**

- Create: `src/settings/auth-code-store.ts`
- Test: `tests/settings/auth-code-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings/auth-code-store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { CODE_TTL_MS, consumeAuthCode, issueAuthCode } from '../../src/settings/auth-code-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

describe('settings auth-code store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('issue then consume returns the bound principal', () => {
    const code = issueAuthCode(principal, 1000)
    expect(consumeAuthCode(code, 2000)).toEqual(principal)
  })

  test('a code is single-use', () => {
    const code = issueAuthCode(principal, 1000)
    expect(consumeAuthCode(code, 2000)).toEqual(principal)
    expect(consumeAuthCode(code, 3000)).toBeNull()
  })

  test('an expired code is rejected', () => {
    const code = issueAuthCode(principal, 1000)
    expect(consumeAuthCode(code, 1000 + CODE_TTL_MS + 1)).toBeNull()
  })

  test('an unknown code is rejected', () => {
    expect(consumeAuthCode('not-a-real-code', 2000)).toBeNull()
  })

  test('re-issuing supersedes the prior unused code', () => {
    const first = issueAuthCode(principal, 1000)
    issueAuthCode(principal, 1500)
    expect(consumeAuthCode(first, 2000)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/auth-code-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/auth-code-store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, gt, isNull } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { settingsAuthCodes } from '../db/schema.js'
import { logger } from '../logger.js'
import { generateToken, hashToken } from './crypto.js'

const log = logger.child({ scope: 'settings:auth-code-store' })

/** One-time code TTL: 10 minutes (spec OQ-A4). */
export const CODE_TTL_MS = 10 * 60 * 1000

export type AuthCodePrincipal = {
  readonly platformInstanceId: string
  readonly platformUserId: string
}

/**
 * Issue a single-use settings code bound to the principal. Supersedes any prior
 * unused codes for the same principal. Returns the plaintext code (only its hash
 * is persisted).
 */
export function issueAuthCode(principal: AuthCodePrincipal, nowMs: number = Date.now()): string {
  const db = getDrizzleDb()
  const code = generateToken()
  const codeHash = hashToken(code)

  db.transaction((tx) => {
    tx.update(settingsAuthCodes)
      .set({ usedAt: nowMs })
      .where(
        and(
          eq(settingsAuthCodes.platformInstanceId, principal.platformInstanceId),
          eq(settingsAuthCodes.platformUserId, principal.platformUserId),
          isNull(settingsAuthCodes.usedAt),
        ),
      )
      .run()

    tx.insert(settingsAuthCodes)
      .values({
        codeHash,
        platformInstanceId: principal.platformInstanceId,
        platformUserId: principal.platformUserId,
        createdAt: nowMs,
        expiresAt: nowMs + CODE_TTL_MS,
        usedAt: null,
      })
      .run()
  })

  log.info({ platformInstanceId: principal.platformInstanceId }, 'Issued settings auth code')
  return code
}

/**
 * Atomically consume a code: marks it used only if it is unused and unexpired.
 * Returns the bound principal, or null on any failure (unknown/expired/used).
 */
export function consumeAuthCode(code: string, nowMs: number = Date.now()): AuthCodePrincipal | null {
  const db = getDrizzleDb()
  const codeHash = hashToken(code)

  const updated = db
    .update(settingsAuthCodes)
    .set({ usedAt: nowMs })
    .where(
      and(
        eq(settingsAuthCodes.codeHash, codeHash),
        isNull(settingsAuthCodes.usedAt),
        gt(settingsAuthCodes.expiresAt, nowMs),
      ),
    )
    .returning({
      platformInstanceId: settingsAuthCodes.platformInstanceId,
      platformUserId: settingsAuthCodes.platformUserId,
    })
    .get()

  if (updated === undefined) {
    log.warn({}, 'Settings auth code rejected')
    return null
  }

  return { platformInstanceId: updated.platformInstanceId, platformUserId: updated.platformUserId }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/auth-code-store.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/auth-code-store.ts tests/settings/auth-code-store.test.ts
git commit -m "feat(settings): add single-use auth-code store"
```

---

## Task 5: Session store (create, sliding get, CSRF rotation, delete)

**Files:**

- Create: `src/settings/session-store.ts`
- Test: `tests/settings/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings/session-store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { hashToken } from '../../src/settings/crypto.js'
import {
  SESSION_TTL_MS,
  createSession,
  deleteSession,
  deleteSessionsForPrincipal,
  getSession,
  rotateSessionCsrf,
} from '../../src/settings/session-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

describe('settings session store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('createSession then getSession returns the principal and stored csrf hash', () => {
    const created = createSession(principal, 1000)
    const session = getSession(created.sessionId, 2000)
    expect(session?.platformInstanceId).toBe('pi-1')
    expect(session?.platformUserId).toBe('u-1')
    expect(session?.csrfTokenHash).toBe(hashToken(created.csrfToken))
  })

  test('getSession slides the expiry on activity', () => {
    const created = createSession(principal, 1000)
    const session = getSession(created.sessionId, 5000)
    expect(session?.expiresAt).toBe(5000 + SESSION_TTL_MS)
  })

  test('an expired session is rejected and removed', () => {
    const created = createSession(principal, 1000)
    expect(getSession(created.sessionId, 1000 + SESSION_TTL_MS + 1)).toBeNull()
    // even with a fresh clock, the row is gone
    expect(getSession(created.sessionId, 2000)).toBeNull()
  })

  test('rotateSessionCsrf issues a new token and updates the stored hash', () => {
    const created = createSession(principal, 1000)
    const rotated = rotateSessionCsrf(created.sessionId, 2000)
    expect(rotated).not.toBeNull()
    expect(rotated).not.toBe(created.csrfToken)
    const session = getSession(created.sessionId, 3000)
    expect(session?.csrfTokenHash).toBe(hashToken(rotated as string))
  })

  test('deleteSession removes the session', () => {
    const created = createSession(principal, 1000)
    deleteSession(created.sessionId)
    expect(getSession(created.sessionId, 2000)).toBeNull()
  })

  test('deleteSessionsForPrincipal removes all and reports the count', () => {
    createSession(principal, 1000)
    createSession(principal, 1100)
    expect(deleteSessionsForPrincipal('pi-1', 'u-1')).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/session-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/session-store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { settingsSessions } from '../db/schema.js'
import { logger } from '../logger.js'
import { generateToken, hashToken } from './crypto.js'

const log = logger.child({ scope: 'settings:session-store' })

/** Session TTL: 60 minutes sliding (spec OQ-A4). */
export const SESSION_TTL_MS = 60 * 60 * 1000

export type SessionPrincipal = {
  readonly platformInstanceId: string
  readonly platformUserId: string
}

export type CreatedSession = {
  readonly sessionId: string
  readonly csrfToken: string
  readonly expiresAt: number
}

export type SessionRecord = {
  readonly platformInstanceId: string
  readonly platformUserId: string
  readonly csrfTokenHash: string
  readonly expiresAt: number
}

export function createSession(principal: SessionPrincipal, nowMs: number = Date.now()): CreatedSession {
  const db = getDrizzleDb()
  const sessionId = generateToken()
  const csrfToken = generateToken()
  const expiresAt = nowMs + SESSION_TTL_MS

  db.insert(settingsSessions)
    .values({
      sessionIdHash: hashToken(sessionId),
      platformInstanceId: principal.platformInstanceId,
      platformUserId: principal.platformUserId,
      createdAt: nowMs,
      expiresAt,
      csrfTokenHash: hashToken(csrfToken),
    })
    .run()

  log.info({ platformInstanceId: principal.platformInstanceId }, 'Created settings session')
  return { sessionId, csrfToken, expiresAt }
}

/** Look up a session by plaintext id, sliding its expiry. Deletes & rejects if expired. */
export function getSession(sessionId: string, nowMs: number = Date.now()): SessionRecord | null {
  const db = getDrizzleDb()
  const sessionIdHash = hashToken(sessionId)

  return db.transaction((tx) => {
    const row = tx.select().from(settingsSessions).where(eq(settingsSessions.sessionIdHash, sessionIdHash)).get()
    if (row === undefined) return null

    if (row.expiresAt <= nowMs) {
      tx.delete(settingsSessions).where(eq(settingsSessions.sessionIdHash, sessionIdHash)).run()
      return null
    }

    const expiresAt = nowMs + SESSION_TTL_MS
    tx.update(settingsSessions).set({ expiresAt }).where(eq(settingsSessions.sessionIdHash, sessionIdHash)).run()

    return {
      platformInstanceId: row.platformInstanceId,
      platformUserId: row.platformUserId,
      csrfTokenHash: row.csrfTokenHash,
      expiresAt,
    }
  })
}

/** Issue a fresh CSRF token for an existing session, returning the plaintext. */
export function rotateSessionCsrf(sessionId: string, nowMs: number = Date.now()): string | null {
  const db = getDrizzleDb()
  const sessionIdHash = hashToken(sessionId)
  const csrfToken = generateToken()

  const updated = db
    .update(settingsSessions)
    .set({ csrfTokenHash: hashToken(csrfToken), expiresAt: nowMs + SESSION_TTL_MS })
    .where(eq(settingsSessions.sessionIdHash, sessionIdHash))
    .returning({ sessionIdHash: settingsSessions.sessionIdHash })
    .get()

  if (updated === undefined) return null
  return csrfToken
}

export function deleteSession(sessionId: string): void {
  const db = getDrizzleDb()
  db.delete(settingsSessions)
    .where(eq(settingsSessions.sessionIdHash, hashToken(sessionId)))
    .run()
}

export function deleteSessionsForPrincipal(platformInstanceId: string, platformUserId: string): number {
  const db = getDrizzleDb()
  const rows = db
    .delete(settingsSessions)
    .where(
      and(
        eq(settingsSessions.platformInstanceId, platformInstanceId),
        eq(settingsSessions.platformUserId, platformUserId),
      ),
    )
    .returning({ sessionIdHash: settingsSessions.sessionIdHash })
    .all()
  return rows.length
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/session-store.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/session-store.ts tests/settings/session-store.test.ts
git commit -m "feat(settings): add SQLite-backed session store with CSRF rotation"
```

---

## Task 6: Parameterized rate limiter

**Files:**

- Create: `src/settings/rate-limit.ts`
- Test: `tests/settings/rate-limit.test.ts`

This mirrors `src/web/rate-limit.ts` but is parameterized by `bucket`, `limit`, and `windowMs` so both code issuance (per user) and exchange (per IP) can reuse one table.

- [ ] **Step 1: Write the failing test**

Create `tests/settings/rate-limit.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { consumeSettingsQuota } from '../../src/settings/rate-limit.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('consumeSettingsQuota', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('allows up to the limit in a window', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)).toEqual({ allowed: true, remaining: 2 - i })
    }
  })

  test('blocks once the limit is reached and reports retry-after', () => {
    for (let i = 0; i < 3; i += 1) consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)
    expect(consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSec: 60,
    })
  })

  test('buckets are independent', () => {
    for (let i = 0; i < 3; i += 1) consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)
    expect(consumeSettingsQuota('exchange', 'a-1', 3, 60_000, 0)).toEqual({ allowed: true, remaining: 2 })
  })

  test('quota resets after the window rolls over', () => {
    for (let i = 0; i < 3; i += 1) consumeSettingsQuota('issue', 'a-1', 3, 60_000, 0)
    expect(consumeSettingsQuota('issue', 'a-1', 3, 60_000, 60_000)).toEqual({ allowed: true, remaining: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/rate-limit.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, lt, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { settingsRateLimit } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'settings:rate-limit' })

export type SettingsRateLimitResult =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly remaining: 0; readonly retryAfterSec: number }

export function consumeSettingsQuota(
  bucket: string,
  actorId: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): SettingsRateLimitResult {
  const db = getDrizzleDb()
  const windowStart = Math.floor(nowMs / windowMs) * windowMs

  return db.transaction((tx) => {
    tx.insert(settingsRateLimit).values({ bucket, actorId, windowStart, count: 0 }).onConflictDoNothing().run()

    const updated = tx
      .update(settingsRateLimit)
      .set({ count: sql`${settingsRateLimit.count} + 1` })
      .where(
        and(
          eq(settingsRateLimit.bucket, bucket),
          eq(settingsRateLimit.actorId, actorId),
          eq(settingsRateLimit.windowStart, windowStart),
          lt(settingsRateLimit.count, limit),
        ),
      )
      .returning({ count: settingsRateLimit.count })
      .get()

    if (updated !== undefined) {
      return { allowed: true, remaining: limit - updated.count }
    }

    const retryAfterSec = Math.ceil((windowStart + windowMs - nowMs) / 1000)
    log.warn({ bucket, actorId, windowStart, retryAfterSec }, 'Settings quota exceeded')
    return { allowed: false, remaining: 0, retryAfterSec }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/rate-limit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/rate-limit.ts tests/settings/rate-limit.test.ts
git commit -m "feat(settings): add parameterized rate limiter"
```

---

## Task 7: Link-issuance service (chat-callable)

**Files:**

- Create: `src/settings/issue-link.ts`
- Test: `tests/settings/issue-link.test.ts`

Combines config + rate-limit + auth-code-store into one function the `/config` command calls.

- [ ] **Step 1: Write the failing test**

Create `tests/settings/issue-link.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ISSUE_LIMIT, issueSettingsLink } from '../../src/settings/issue-link.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

describe('issueSettingsLink', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['SETTINGS_PUBLIC_BASE_URL']
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  test('returns not_configured when base url is unset', () => {
    expect(issueSettingsLink(principal, 0)).toEqual({ kind: 'not_configured' })
  })

  test('returns a single-use link when configured', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    const result = issueSettingsLink(principal, 0)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.url).toMatch(/^https:\/\/bot\.example\.com\/settings\?code=[A-Za-z0-9_%-]+$/)
    }
  })

  test('rate-limits after the issue limit', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    for (let i = 0; i < ISSUE_LIMIT; i += 1) issueSettingsLink(principal, 0)
    const result = issueSettingsLink(principal, 0)
    expect(result.kind).toBe('rate_limited')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/issue-link.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/issue-link.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { type AuthCodePrincipal, issueAuthCode } from './auth-code-store.js'
import { buildSettingsUrl, getSettingsPublicBaseUrl } from './config.js'
import { consumeSettingsQuota } from './rate-limit.js'

const log = logger.child({ scope: 'settings:issue-link' })

/** Max settings links a single principal may request per window. */
export const ISSUE_LIMIT = 5
export const ISSUE_WINDOW_MS = 10 * 60 * 1000

export type IssueSettingsLinkResult =
  | { readonly kind: 'ok'; readonly url: string }
  | { readonly kind: 'not_configured' }
  | { readonly kind: 'rate_limited'; readonly retryAfterSec: number }

export function issueSettingsLink(principal: AuthCodePrincipal, nowMs: number = Date.now()): IssueSettingsLinkResult {
  if (getSettingsPublicBaseUrl() === null) return { kind: 'not_configured' }

  const actorId = `${principal.platformInstanceId}:${principal.platformUserId}`
  const quota = consumeSettingsQuota('issue', actorId, ISSUE_LIMIT, ISSUE_WINDOW_MS, nowMs)
  if (!quota.allowed) return { kind: 'rate_limited', retryAfterSec: quota.retryAfterSec }

  const code = issueAuthCode(principal, nowMs)
  const url = buildSettingsUrl(code)
  if (url === null) return { kind: 'not_configured' }

  log.info({ platformInstanceId: principal.platformInstanceId }, 'Issued settings link')
  return { kind: 'ok', url }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/issue-link.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/issue-link.ts tests/settings/issue-link.test.ts
git commit -m "feat(settings): add link-issuance service"
```

---

## Task 8: Principal resolution (live scope per request)

**Files:**

- Create: `src/settings/principal.ts`
- Test: `tests/settings/principal.test.ts`

Recomputes the live scope from the existing authorization stores. No parallel permission table — this is a new caller of existing authority.

- [ ] **Step 1: Write the failing test**

Create `tests/settings/principal.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { addAdmin } from '../../src/instances/admin-store.js'
import { resolveSettingsPrincipal } from '../../src/settings/principal.js'
import { addUser } from '../../src/users.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('resolveSettingsPrincipal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an unknown user is unauthorized with no manageable groups', () => {
    const principal = resolveSettingsPrincipal('pi-1', 'nobody')
    expect(principal.authorized).toBe(false)
    expect(principal.isBotAdmin).toBe(false)
    expect(principal.manageableGroups).toEqual([])
    expect(principal.personalConfigContextId).toBe(
      toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'nobody' }),
    )
  })

  test('an authorized user resolves authorized=true', () => {
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    const principal = resolveSettingsPrincipal('pi-1', 'u-1')
    expect(principal.authorized).toBe(true)
    expect(principal.isBotAdmin).toBe(false)
  })

  test('a super admin resolves isBotAdmin and isSuperAdmin', () => {
    addAdmin('boss', '__super__')
    const principal = resolveSettingsPrincipal('pi-1', 'boss')
    expect(principal.isBotAdmin).toBe(true)
    expect(principal.isSuperAdmin).toBe(true)
    expect(principal.authorized).toBe(true)
  })
})
```

> Note: `'__super__'` is `SUPER_ADMIN_PLATFORM_ID` (see `src/instances/admin-store.ts`); passing it to `addAdmin` inserts a super-admin row.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/principal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/principal.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toScopedContextId } from '../chat/scoped-context.js'
import { listManageableGroups } from '../group-settings/access.js'
import type { KnownGroupContext } from '../group-settings/types.js'
import { isAdmin, isSuperAdmin } from '../instances/admin-store.js'
import { logger } from '../logger.js'
import { isAuthorized } from '../users.js'

const log = logger.child({ scope: 'settings:principal' })

export type SettingsPrincipal = {
  readonly platformInstanceId: string
  readonly platformUserId: string
  readonly isBotAdmin: boolean
  readonly isSuperAdmin: boolean
  readonly authorized: boolean
  readonly personalConfigContextId: string
  readonly manageableGroups: readonly KnownGroupContext[]
}

/**
 * Resolve the live scope for a principal from the existing authorization stores.
 * Called per request so revocations take effect without waiting for session expiry.
 */
export function resolveSettingsPrincipal(platformInstanceId: string, platformUserId: string): SettingsPrincipal {
  const botAdmin = isAdmin(platformUserId, platformInstanceId)
  const superAdmin = isSuperAdmin(platformUserId)
  const authorized = isAuthorized(platformUserId, platformInstanceId)
  const personalConfigContextId = toScopedContextId({ platformInstanceId, nativeContextId: platformUserId })
  const manageableGroups = listManageableGroups(platformUserId, platformInstanceId)

  log.debug({ platformInstanceId, isBotAdmin: botAdmin, authorized }, 'Resolved settings principal')
  return {
    platformInstanceId,
    platformUserId,
    isBotAdmin: botAdmin,
    isSuperAdmin: superAdmin,
    authorized,
    personalConfigContextId,
    manageableGroups,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/principal.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/principal.ts tests/settings/principal.test.ts
git commit -m "feat(settings): add per-request principal resolution"
```

---

## Task 9: The scope guard

**Files:**

- Create: `src/settings/scope-guard.ts`
- Test: `tests/settings/scope-guard.test.ts`

This is the single authority every `/settings/api/*` write route (Surface spec) must call before touching a store. It implements the spec's "The scope guard" rules and capability matrix.

- [ ] **Step 1: Write the failing test**

Create `tests/settings/scope-guard.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { KnownGroupContext } from '../../src/group-settings/types.js'
import type { SettingsPrincipal } from '../../src/settings/principal.js'
import { requireScope } from '../../src/settings/scope-guard.js'

const group: KnownGroupContext = {
  contextId: 'group-ctx-1',
  provider: 'telegram',
  displayName: 'Team',
  parentName: null,
  firstSeenAt: 't',
  lastSeenAt: 't',
}

function principal(overrides: Partial<SettingsPrincipal>): SettingsPrincipal {
  return {
    platformInstanceId: 'pi-1',
    platformUserId: 'u-1',
    isBotAdmin: false,
    isSuperAdmin: false,
    authorized: true,
    personalConfigContextId: 'personal-ctx-1',
    manageableGroups: [],
    ...overrides,
  }
}

describe('requireScope', () => {
  test('personal: authorized user resolves to own config context', () => {
    const result = requireScope(principal({}), { action: 'write', target: { kind: 'personal' } })
    expect(result).toEqual({ ok: true, contextId: 'personal-ctx-1' })
  })

  test('personal: unauthorized user is denied', () => {
    const result = requireScope(principal({ authorized: false }), { action: 'read', target: { kind: 'personal' } })
    expect(result).toEqual({ ok: false, status: 403 })
  })

  test('group: denied for a non-managing regular user', () => {
    const result = requireScope(principal({}), { action: 'write', target: { kind: 'group', contextId: 'group-ctx-1' } })
    expect(result).toEqual({ ok: false, status: 403 })
  })

  test('group: allowed for a managing group admin', () => {
    const result = requireScope(principal({ manageableGroups: [group] }), {
      action: 'write',
      target: { kind: 'group', contextId: 'group-ctx-1' },
    })
    expect(result).toEqual({ ok: true, contextId: 'group-ctx-1' })
  })

  test('group: allowed for a bot admin even without managing it', () => {
    const result = requireScope(principal({ isBotAdmin: true }), {
      action: 'write',
      target: { kind: 'group', contextId: 'group-ctx-1' },
    })
    expect(result).toEqual({ ok: true, contextId: 'group-ctx-1' })
  })

  test('admin: denied for a non-admin', () => {
    expect(requireScope(principal({}), { action: 'write', target: { kind: 'admin' } })).toEqual({
      ok: false,
      status: 403,
    })
  })

  test('admin: allowed for a bot admin', () => {
    expect(requireScope(principal({ isBotAdmin: true }), { action: 'write', target: { kind: 'admin' } })).toEqual({
      ok: true,
      contextId: '__system__',
    })
  })

  test('admin: super-admin-only sub-action denies a non-super bot admin', () => {
    expect(
      requireScope(principal({ isBotAdmin: true }), {
        action: 'write',
        target: { kind: 'admin', requireSuperAdmin: true },
      }),
    ).toEqual({ ok: false, status: 403 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/scope-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/scope-guard.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { SettingsPrincipal } from './principal.js'

/** Sentinel config context for system/admin-tier actions. */
export const ADMIN_SYSTEM_CONTEXT_ID = '__system__'

export type ScopeTarget =
  | { readonly kind: 'personal' }
  | { readonly kind: 'group'; readonly contextId: string }
  | { readonly kind: 'admin'; readonly requireSuperAdmin?: boolean }

export type ScopeRequest = {
  readonly action: 'read' | 'write'
  readonly target: ScopeTarget
}

export type ScopeResult =
  | { readonly ok: true; readonly contextId: string }
  | { readonly ok: false; readonly status: 403 }

const DENY: ScopeResult = { ok: false, status: 403 }

/**
 * Resolve and authorize the concrete config context a handler may act on.
 * Returns the validated contextId, or a 403 result. Handlers must use the
 * returned contextId, never a client-supplied one.
 */
export function requireScope(principal: SettingsPrincipal, request: ScopeRequest): ScopeResult {
  const { target } = request

  if (target.kind === 'personal') {
    if (!principal.authorized) return DENY
    return { ok: true, contextId: principal.personalConfigContextId }
  }

  if (target.kind === 'group') {
    const manageable = principal.manageableGroups.some((g) => g.contextId === target.contextId)
    if (manageable || principal.isBotAdmin) {
      return { ok: true, contextId: getConfigContextIdFromStorageContextId(target.contextId) }
    }
    return DENY
  }

  // admin tier
  if (!principal.isBotAdmin) return DENY
  if (target.requireSuperAdmin === true && !principal.isSuperAdmin) return DENY
  return { ok: true, contextId: ADMIN_SYSTEM_CONTEXT_ID }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/scope-guard.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/scope-guard.ts tests/settings/scope-guard.test.ts
git commit -m "feat(settings): add server-side scope guard"
```

---

## Task 10: Available-context listing (context switcher)

**Files:**

- Create: `src/settings/contexts.ts`
- Test: `tests/settings/contexts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/settings/contexts.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { KnownGroupContext } from '../../src/group-settings/types.js'
import { listAvailableContexts } from '../../src/settings/contexts.js'
import type { SettingsPrincipal } from '../../src/settings/principal.js'

const group: KnownGroupContext = {
  contextId: 'group-ctx-1',
  provider: 'telegram',
  displayName: 'Team',
  parentName: null,
  firstSeenAt: 't',
  lastSeenAt: 't',
}

function principal(overrides: Partial<SettingsPrincipal>): SettingsPrincipal {
  return {
    platformInstanceId: 'pi-1',
    platformUserId: 'u-1',
    isBotAdmin: false,
    isSuperAdmin: false,
    authorized: true,
    personalConfigContextId: 'personal-ctx-1',
    manageableGroups: [],
    ...overrides,
  }
}

describe('listAvailableContexts', () => {
  test('authorized user gets a personal context first, then groups', () => {
    expect(listAvailableContexts(principal({ manageableGroups: [group] }))).toEqual([
      { kind: 'personal', contextId: 'personal-ctx-1', label: 'Personal' },
      { kind: 'group', contextId: 'group-ctx-1', label: 'Team' },
    ])
  })

  test('unauthorized user gets only managed groups', () => {
    expect(listAvailableContexts(principal({ authorized: false, manageableGroups: [group] }))).toEqual([
      { kind: 'group', contextId: 'group-ctx-1', label: 'Team' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/settings/contexts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/settings/contexts.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SettingsPrincipal } from './principal.js'

export type AvailableContext = {
  readonly kind: 'personal' | 'group'
  readonly contextId: string
  readonly label: string
}

export function listAvailableContexts(principal: SettingsPrincipal): readonly AvailableContext[] {
  const groups: AvailableContext[] = principal.manageableGroups.map((g) => ({
    kind: 'group',
    contextId: g.contextId,
    label: g.displayName,
  }))

  if (!principal.authorized) return groups

  const personal: AvailableContext = {
    kind: 'personal',
    contextId: principal.personalConfigContextId,
    label: 'Personal',
  }
  return [personal, ...groups]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/settings/contexts.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/settings/contexts.ts tests/settings/contexts.test.ts
git commit -m "feat(settings): add available-context listing"
```

---

## Task 11: Cookie helpers & request authentication (session + CSRF)

**Files:**

- Create: `src/settings/cookies.ts`
- Create: `src/settings/request-auth.ts`
- Test: `tests/settings/cookies.test.ts`
- Test: `tests/settings/request-auth.test.ts`

- [ ] **Step 1: Write the failing cookie test**

Create `tests/settings/cookies.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  SESSION_COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
  parseSessionCookie,
} from '../../src/settings/cookies.js'

describe('settings cookies', () => {
  test('buildSessionCookie sets hardened attributes scoped to /settings', () => {
    const cookie = buildSessionCookie('sid-value', 3600)
    expect(cookie).toBe(
      `${SESSION_COOKIE_NAME}=sid-value; HttpOnly; Secure; SameSite=Lax; Path=/settings; Max-Age=3600`,
    )
  })

  test('clearSessionCookie expires the cookie', () => {
    expect(clearSessionCookie()).toContain('Max-Age=0')
  })

  test('parseSessionCookie extracts the session id', () => {
    const req = new Request('https://x/settings/api/session', {
      headers: { Cookie: `other=1; ${SESSION_COOKIE_NAME}=sid-value; more=2` },
    })
    expect(parseSessionCookie(req)).toBe('sid-value')
  })

  test('parseSessionCookie returns null when absent', () => {
    expect(parseSessionCookie(new Request('https://x/settings/api/session'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run cookie test to verify it fails**

Run: `bun test tests/settings/cookies.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the cookie implementation**

Create `src/settings/cookies.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const SESSION_COOKIE_NAME = 'papai_settings_session'

const ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/settings'

export function buildSessionCookie(sessionId: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; ${ATTRIBUTES}; Max-Age=${maxAgeSec}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; ${ATTRIBUTES}; Max-Age=0`
}

export function parseSessionCookie(req: Request): string | null {
  const header = req.headers.get('Cookie')
  if (header === null) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    if (trimmed.slice(0, eq) === SESSION_COOKIE_NAME) {
      const value = trimmed.slice(eq + 1)
      return value === '' ? null : value
    }
  }
  return null
}
```

- [ ] **Step 4: Run cookie test to verify it passes**

Run: `bun test tests/settings/cookies.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing request-auth test**

Create `tests/settings/request-auth.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { SESSION_COOKIE_NAME } from '../../src/settings/cookies.js'
import { CSRF_HEADER, authenticateSettingsRequest, verifyCsrf } from '../../src/settings/request-auth.js'
import { createSession } from '../../src/settings/session-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

function requestWithCookie(sessionId: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request('https://x/settings/api/session', {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}`, ...extraHeaders },
  })
}

describe('settings request auth', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('authenticates a valid session and resolves the principal', () => {
    const created = createSession(principal, 1000)
    const authed = authenticateSettingsRequest(requestWithCookie(created.sessionId), 2000)
    expect(authed?.principal.platformUserId).toBe('u-1')
  })

  test('returns null without a cookie', () => {
    expect(authenticateSettingsRequest(new Request('https://x/settings/api/session'), 2000)).toBeNull()
  })

  test('returns null for an unknown session id', () => {
    expect(authenticateSettingsRequest(requestWithCookie('bogus'), 2000)).toBeNull()
  })

  test('verifyCsrf accepts the matching token and rejects others', () => {
    const created = createSession(principal, 1000)
    const authed = authenticateSettingsRequest(
      requestWithCookie(created.sessionId, { [CSRF_HEADER]: created.csrfToken }),
      2000,
    )
    expect(authed).not.toBeNull()
    if (authed === null) return
    expect(verifyCsrf(requestWithCookie(created.sessionId, { [CSRF_HEADER]: created.csrfToken }), authed.session)).toBe(
      true,
    )
    expect(verifyCsrf(requestWithCookie(created.sessionId, { [CSRF_HEADER]: 'wrong' }), authed.session)).toBe(false)
    expect(verifyCsrf(requestWithCookie(created.sessionId), authed.session)).toBe(false)
  })
})
```

- [ ] **Step 6: Run request-auth test to verify it fails**

Run: `bun test tests/settings/request-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the request-auth implementation**

Create `src/settings/request-auth.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseSessionCookie } from './cookies.js'
import { hashToken, timingSafeEqualHex } from './crypto.js'
import { type SettingsPrincipal, resolveSettingsPrincipal } from './principal.js'
import { type SessionRecord, getSession } from './session-store.js'

export const CSRF_HEADER = 'X-Settings-CSRF'

export type AuthenticatedSettingsRequest = {
  readonly sessionId: string
  readonly session: SessionRecord
  readonly principal: SettingsPrincipal
}

/**
 * Resolve the settings session from the request cookie (sliding its expiry) and
 * recompute the live principal scope. Returns null if unauthenticated.
 */
export function authenticateSettingsRequest(
  req: Request,
  nowMs: number = Date.now(),
): AuthenticatedSettingsRequest | null {
  const sessionId = parseSessionCookie(req)
  if (sessionId === null) return null
  const session = getSession(sessionId, nowMs)
  if (session === null) return null
  const principal = resolveSettingsPrincipal(session.platformInstanceId, session.platformUserId)
  return { sessionId, session, principal }
}

/** Verify the synchronizer CSRF token against the session's stored hash. */
export function verifyCsrf(req: Request, session: SessionRecord): boolean {
  const provided = req.headers.get(CSRF_HEADER)
  if (provided === null || provided === '') return false
  return timingSafeEqualHex(hashToken(provided), session.csrfTokenHash)
}
```

- [ ] **Step 8: Run request-auth test to verify it passes**

Run: `bun test tests/settings/request-auth.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add src/settings/cookies.ts src/settings/request-auth.ts tests/settings/cookies.test.ts tests/settings/request-auth.test.ts
git commit -m "feat(settings): add cookie helpers and request authentication"
```

---

## Task 12: HTTP route handlers (exchange, logout, bootstrap)

**Files:**

- Create: `src/debug/settings-routes.ts`
- Test: `tests/debug/settings-routes.test.ts`

These are pure request→response handlers (no `Bun.serve` wiring yet). The exchange route deliberately ignores `DEBUG_TOKEN`; the bootstrap route rotates the CSRF token so a page reload (session cookie survives) gets a fresh token without re-exchange.

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { SESSION_COOKIE_NAME } from '../../src/settings/cookies.js'
import { CSRF_HEADER } from '../../src/settings/request-auth.js'
import { issueAuthCode } from '../../src/settings/auth-code-store.js'
import {
  handleSettingsBootstrap,
  handleSettingsExchange,
  handleSettingsLogout,
} from '../../src/debug/settings-routes.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const principal = { platformInstanceId: 'pi-1', platformUserId: 'u-1' }

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie')
  if (setCookie === null) throw new Error('no Set-Cookie')
  const value = setCookie.split(';')[0]?.split('=')[1]
  if (value === undefined) throw new Error('no cookie value')
  return value
}

describe('settings routes', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  function exchangeRequest(code: string): Request {
    return new Request('https://x/settings/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  }

  test('exchange rejects an invalid code with 401 and ignores DEBUG_TOKEN', async () => {
    process.env['DEBUG_TOKEN'] = 'operator-secret'
    const res = await handleSettingsExchange(exchangeRequest('bogus'), 1000)
    expect(res.status).toBe(401)
    delete process.env['DEBUG_TOKEN']
  })

  test('exchange consumes a valid code, sets a session cookie, returns csrf + contexts', async () => {
    const code = issueAuthCode(principal, 1000)
    const res = await handleSettingsExchange(exchangeRequest(code), 2000)
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly')
    const body = (await res.json()) as { csrfToken: string; contexts: unknown[] }
    expect(typeof body.csrfToken).toBe('string')
    expect(Array.isArray(body.contexts)).toBe(true)
  })

  test('bootstrap rejects an unauthenticated request with 401', () => {
    const res = handleSettingsBootstrap(new Request('https://x/settings/api/session'), 2000)
    expect(res.status).toBe(401)
  })

  test('bootstrap returns a fresh csrf token for a valid session', async () => {
    const code = issueAuthCode(principal, 1000)
    const exchanged = await handleSettingsExchange(exchangeRequest(code), 2000)
    const sid = cookieFrom(exchanged)
    const res = handleSettingsBootstrap(
      new Request('https://x/settings/api/session', { headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}` } }),
      3000,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { csrfToken: string }
    expect(typeof body.csrfToken).toBe('string')
  })

  test('logout requires a valid CSRF token then clears the cookie', async () => {
    const code = issueAuthCode(principal, 1000)
    const exchanged = await handleSettingsExchange(exchangeRequest(code), 2000)
    const sid = cookieFrom(exchanged)
    const csrf = ((await exchanged.json()) as { csrfToken: string }).csrfToken

    const noCsrf = await handleSettingsLogout(
      new Request('https://x/settings/auth/logout', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}` },
      }),
      3000,
    )
    expect(noCsrf.status).toBe(403)

    const ok = await handleSettingsLogout(
      new Request('https://x/settings/auth/logout', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sid}`, [CSRF_HEADER]: csrf },
      }),
      3000,
    )
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings-routes.test.ts`
Expected: FAIL — `../../src/debug/settings-routes.js` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/debug/settings-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../logger.js'
import { consumeAuthCode } from '../settings/auth-code-store.js'
import { listAvailableContexts } from '../settings/contexts.js'
import { buildSessionCookie, clearSessionCookie } from '../settings/cookies.js'
import { resolveSettingsPrincipal } from '../settings/principal.js'
import { authenticateSettingsRequest, verifyCsrf } from '../settings/request-auth.js'
import { createSession, deleteSession, rotateSessionCsrf } from '../settings/session-store.js'
import { consumeSettingsQuota } from '../settings/rate-limit.js'

const log = logger.child({ scope: 'debug-server:settings-routes' })

const EXCHANGE_LIMIT = 10
const EXCHANGE_WINDOW_MS = 10 * 60 * 1000

const ExchangeBodySchema = z.object({ code: z.string().min(1) })

const jsonResponse = (status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })

/** Best-effort client IP for rate-limiting; trusts the reverse proxy's first XFF hop. */
function clientIp(req: Request): string {
  const xff = req.headers.get('X-Forwarded-For')
  if (xff !== null && xff.length > 0) {
    const first = xff.split(',')[0]
    if (first !== undefined && first.trim() !== '') return first.trim()
  }
  return 'unknown'
}

export async function handleSettingsExchange(req: Request, nowMs: number = Date.now()): Promise<Response> {
  const quota = consumeSettingsQuota('exchange', clientIp(req), EXCHANGE_LIMIT, EXCHANGE_WINDOW_MS, nowMs)
  if (!quota.allowed) {
    return jsonResponse(429, { error: 'rate limited' }, { 'Retry-After': String(quota.retryAfterSec) })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' })
  }

  const parsed = ExchangeBodySchema.safeParse(body)
  if (!parsed.success) return jsonResponse(400, { error: 'invalid request' })

  const principal = consumeAuthCode(parsed.data.code, nowMs)
  if (principal === null) return jsonResponse(401, { error: 'invalid or expired code' })

  const created = createSession(principal, nowMs)
  const resolved = resolveSettingsPrincipal(principal.platformInstanceId, principal.platformUserId)
  const maxAgeSec = Math.max(0, Math.floor((created.expiresAt - nowMs) / 1000))

  log.info({ platformInstanceId: principal.platformInstanceId }, 'Settings session established')
  return jsonResponse(
    200,
    {
      csrfToken: created.csrfToken,
      principal: { isBotAdmin: resolved.isBotAdmin, isSuperAdmin: resolved.isSuperAdmin },
      contexts: listAvailableContexts(resolved),
    },
    { 'Set-Cookie': buildSessionCookie(created.sessionId, maxAgeSec) },
  )
}

export function handleSettingsBootstrap(req: Request, nowMs: number = Date.now()): Response {
  const authed = authenticateSettingsRequest(req, nowMs)
  if (authed === null) return jsonResponse(401, { error: 'unauthenticated' })

  const csrfToken = rotateSessionCsrf(authed.sessionId, nowMs)
  if (csrfToken === null) return jsonResponse(401, { error: 'unauthenticated' })

  return jsonResponse(200, {
    csrfToken,
    principal: { isBotAdmin: authed.principal.isBotAdmin, isSuperAdmin: authed.principal.isSuperAdmin },
    contexts: listAvailableContexts(authed.principal),
  })
}

export async function handleSettingsLogout(req: Request, nowMs: number = Date.now()): Promise<Response> {
  const authed = authenticateSettingsRequest(req, nowMs)
  if (authed === null) {
    return jsonResponse(401, { error: 'unauthenticated' }, { 'Set-Cookie': clearSessionCookie() })
  }
  if (!verifyCsrf(req, authed.session)) {
    return jsonResponse(403, { error: 'invalid csrf token' })
  }
  deleteSession(authed.sessionId)
  return jsonResponse(200, { ok: true }, { 'Set-Cookie': clearSessionCookie() })
}
```

> The `handleSettingsLogout` request body is consumed only after auth+CSRF; `await` on `handleSettingsExchange`'s `req.json()` is the single body read. If a `.ts` import-ordering lint complains, keep imports alphabetized within groups (node, third-party, local) per existing files.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings-routes.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings-routes.ts tests/debug/settings-routes.test.ts
git commit -m "feat(settings): add exchange, logout, and bootstrap route handlers"
```

---

## Task 13: Settings sub-router + trust-isolated server wiring

**Files:**

- Create: `src/debug/settings-router.ts`
- Test: `tests/debug/settings-router.test.ts`
- Modify: `src/debug/server.ts` (branch on `/settings/*` before the `DEBUG_TOKEN` check)
- Test: `tests/debug/server.test.ts` (extend with isolation assertions)

The critical property (spec §"Trust isolation"): `/settings/*` must be reachable **only** via the session cookie and must never consult `DEBUG_TOKEN`; conversely a settings cookie must never satisfy operator routes.

- [ ] **Step 1: Write the failing sub-router test**

Create `tests/debug/settings-router.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { routeSettingsPaths } from '../../src/debug/settings-router.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('routeSettingsPaths', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  test('returns null for non-settings paths', async () => {
    const req = new Request('https://x/debug')
    expect(await routeSettingsPaths(req, new URL(req.url))).toBeNull()
  })

  test('GET /settings/api/session is 401 without a session, even with a DEBUG_TOKEN bearer', async () => {
    process.env['DEBUG_TOKEN'] = 'operator-secret'
    const req = new Request('https://x/settings/api/session', {
      headers: { Authorization: 'Bearer operator-secret' },
    })
    const res = await routeSettingsPaths(req, new URL(req.url))
    expect(res?.status).toBe(401)
    delete process.env['DEBUG_TOKEN']
  })

  test('wrong method on a settings route returns 405', async () => {
    const req = new Request('https://x/settings/auth/exchange', { method: 'GET' })
    const res = await routeSettingsPaths(req, new URL(req.url))
    expect(res?.status).toBe(405)
  })

  test('unknown /settings subpath returns 404', async () => {
    const req = new Request('https://x/settings/nope')
    const res = await routeSettingsPaths(req, new URL(req.url))
    expect(res?.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the sub-router test to verify it fails**

Run: `bun test tests/debug/settings-router.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the sub-router implementation**

Create `src/debug/settings-router.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleSettingsBootstrap, handleSettingsExchange, handleSettingsLogout } from './settings-routes.js'

/** True for any path the settings trust domain owns. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/')
}

const methodNotAllowed = (): Response => new Response('Method not allowed', { status: 405 })

/**
 * Dispatch `/settings/*` requests. Returns a Response for any settings path
 * (including 404/405), and never consults DEBUG_TOKEN. Returns null only for
 * paths it does not own (so a caller can fall through).
 */
export async function routeSettingsPaths(req: Request, url: URL): Promise<Response | null> {
  if (!isSettingsPath(url.pathname)) return null

  if (url.pathname === '/settings/auth/exchange') {
    return req.method === 'POST' ? handleSettingsExchange(req) : methodNotAllowed()
  }
  if (url.pathname === '/settings/auth/logout') {
    return req.method === 'POST' ? handleSettingsLogout(req) : methodNotAllowed()
  }
  if (url.pathname === '/settings/api/session') {
    return req.method === 'GET' ? handleSettingsBootstrap(req) : methodNotAllowed()
  }

  // Static SPA serving (client/settings) and the per-capability /settings/api/*
  // write routes are delivered by the Surface spec. Anything else is 404.
  return new Response('Not found', { status: 404 })
}
```

- [ ] **Step 4: Run the sub-router test to verify it passes**

Run: `bun test tests/debug/settings-router.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the sub-router into `server.ts`**

In `src/debug/server.ts`, add the import alongside the other route imports:

```typescript
import { isSettingsPath, routeSettingsPaths } from './settings-router.js'
```

Then change the top of `routeRequest` so the `/settings/*` branch runs **before** `isAuthorizedRequest`. Replace:

```typescript
async function routeRequest(req: Request): Promise<Response> {
  if (!isAuthorizedRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(req.url)
```

with:

```typescript
async function routeRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)

  // Settings trust domain: session-cookie auth only, never DEBUG_TOKEN.
  if (isSettingsPath(url.pathname)) {
    const settingsResponse = await routeSettingsPaths(req, url)
    return settingsResponse ?? new Response('Not found', { status: 404 })
  }

  if (!isAuthorizedRequest(req)) {
    return new Response('Unauthorized', { status: 401 })
  }
```

(The later `const url = new URL(req.url)` line that already existed is now removed by this replacement — make sure there is exactly one `url` declaration.)

- [ ] **Step 6: Extend the server integration test with isolation assertions**

In `tests/debug/server.test.ts`, the suite already starts a real server via `startDebugServer` on `TEST_PORT` and issues `fetch` calls. Add a new test inside the existing top-level `describe` (use the same server lifecycle the file already sets up). Add this test:

```typescript
test('settings domain is isolated from DEBUG_TOKEN', async () => {
  // A DEBUG_TOKEN bearer must NOT authenticate a settings route.
  const settingsRes = await fetch(`http://127.0.0.1:${TEST_PORT}/settings/api/session`, {
    headers: { Authorization: 'Bearer test-debug-token' },
  })
  await cancelBody(settingsRes)
  expect(settingsRes.status).toBe(401)

  // A settings cookie must NOT authenticate an operator route.
  const operatorRes = await fetch(`http://127.0.0.1:${TEST_PORT}/admin/llm`, {
    headers: { Cookie: 'papai_settings_session=anything' },
  })
  await cancelBody(operatorRes)
  expect(operatorRes.status).toBe(401)
})
```

> If `tests/debug/server.test.ts` starts the server with a `DEBUG_TOKEN` set (check the `startDebugServer`/`beforeAll` setup at the top of the file), reuse that exact token string in the `Authorization` header above. If it starts **without** a token, set `process.env['DEBUG_TOKEN'] = 'test-debug-token'` in this test's body before the fetches and delete it afterward, so the operator route actually enforces the token. Match whatever the file's existing setup does.

- [ ] **Step 7: Run the server test to verify it passes**

Run: `bun test tests/debug/server.test.ts`
Expected: PASS, including the new isolation test. (This test builds the client bundle first; allow extra time.)

- [ ] **Step 8: Run the full settings + debug suites**

Run: `bun test tests/settings tests/debug/settings-router.test.ts tests/debug/settings-routes.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/debug/settings-router.ts src/debug/server.ts tests/debug/settings-router.test.ts tests/debug/server.test.ts
git commit -m "feat(settings): wire trust-isolated /settings router into debug server"
```

---

## Task 14: Issue the settings link from `/config`

**Files:**

- Modify: `src/commands/config.ts`
- Test: `tests/commands/config.test.ts` (extend)

When `SETTINGS_PUBLIC_BASE_URL` is configured, the DM `/config` flow replies with a one-time settings link. When it is not configured, it falls back to the existing in-chat selection flow (preserving current behavior until the Command Retirement spec removes it).

- [ ] **Step 1: Write the failing test**

Add to `tests/commands/config.test.ts` a new `describe` block (keep existing tests untouched). It uses the standard helpers and seeds the DB so `issueAuthCode` can write:

```typescript
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { registerConfigCommand } from '../../src/commands/config.js'
import {
  createAuth,
  createDmMessage,
  createMockChat,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('/config settings link issuance', () => {
  const original = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['SETTINGS_PUBLIC_BASE_URL']
  })

  afterEach(() => {
    if (original === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = original
  })

  test('replies with a single-use settings link when configured', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    const chat = createMockChat()
    registerConfigCommand(chat)
    const handler = chat.getCommandHandler('config')
    const reply = createMockReply()

    await handler(createDmMessage({ text: '/config' }), reply.reply, createAuth({ allowed: true }))

    const formatted = reply.calls.formatted.join('\n')
    expect(formatted).toContain('https://bot.example.com/settings?code=')
    expect(formatted.toLowerCase()).toContain('single-use')
  })
})
```

> Adapt the exact helper call shapes to match what `tests/commands/config.test.ts` and `tests/utils/test-helpers.ts` already expose (`createMockChat`/`createMockChatForBot`, how `getCommandHandler` is named, and the `createMockReply` result shape — see `createMockReply` at `tests/utils/test-helpers.ts:252`). Use the file's existing pattern for invoking a registered command handler rather than inventing a new accessor.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/commands/config.test.ts`
Expected: FAIL — the handler still calls the selection flow; no link is produced.

- [ ] **Step 3: Modify the `/config` handler**

In `src/commands/config.ts`, add the import near the other local imports:

```typescript
import { issueSettingsLink } from '../settings/issue-link.js'
```

Then update the DM branch of the handler in `registerConfigCommand`. Replace the body after the group-context early return:

```typescript
log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command called')
const sourceChat = resolveSourceChatProvider(chat, msg.platformInstanceId)
const interactiveButtons = supportsInteractiveButtons(sourceChat)

log.info({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command executed')
if (!supportsMessageDeletion(sourceChat)) {
  await reply.text(NO_DELETE_WARNING)
}
await replyWithConfigSelection(reply, msg.user.id, msg.platformInstanceId, interactiveButtons)
```

with:

```typescript
log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command called')

const link = issueSettingsLink({ platformInstanceId: msg.platformInstanceId, platformUserId: msg.user.id })
if (link.kind === 'ok') {
  log.info({ userId: msg.user.id }, '/config issued settings link')
  await reply.formatted(
    `🔧 Open your settings: ${link.url}\n\n⚠️ This link is single-use and expires in 10 minutes. Do not share it.`,
  )
  return
}
if (link.kind === 'rate_limited') {
  const minutes = Math.max(1, Math.ceil(link.retryAfterSec / 60))
  await reply.text(`Too many settings links requested. Please try again in ${minutes} minute(s).`)
  return
}

// link.kind === 'not_configured' → fall back to the legacy in-chat flow.
const sourceChat = resolveSourceChatProvider(chat, msg.platformInstanceId)
const interactiveButtons = supportsInteractiveButtons(sourceChat)

log.info({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command executed (legacy)')
if (!supportsMessageDeletion(sourceChat)) {
  await reply.text(NO_DELETE_WARNING)
}
await replyWithConfigSelection(reply, msg.user.id, msg.platformInstanceId, interactiveButtons)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/commands/config.test.ts`
Expected: PASS — both the new link test and the existing legacy-flow tests (which run with `SETTINGS_PUBLIC_BASE_URL` unset) pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/config.ts tests/commands/config.test.ts
git commit -m "feat(settings): issue settings link from /config when configured"
```

---

## Task 15: Documentation & full verification

**Files:**

- Modify: `CLAUDE.md` (architecture: add `src/settings/` module; env: add `SETTINGS_PUBLIC_BASE_URL`)

- [ ] **Step 1: Document the new module and env var**

In `CLAUDE.md`, under "Optional but important runtime flags include:", add:

```markdown
- `SETTINGS_PUBLIC_BASE_URL` — external base URL (e.g. `https://bot.example.com`)
  used to build single-use settings links and scope the `Secure` settings
  session cookie. When unset, `/config` falls back to the legacy in-chat flow.
```

In the "Main Modules" list, add an entry:

```markdown
- `src/settings/` — settings web UI access model: one-time auth-code issuance
  (`issue-link.ts`, `auth-code-store.ts`), SQLite-backed sessions with
  synchronizer-token CSRF (`session-store.ts`), per-request principal resolution
  (`principal.ts`), the `requireScope` guard (`scope-guard.ts`), context listing
  (`contexts.ts`), and cookie/request auth helpers. HTTP handlers live in
  `src/debug/settings-routes.ts` and are dispatched by `src/debug/settings-router.ts`,
  which the debug server routes to **before** any `DEBUG_TOKEN` check so the
  per-user settings trust domain stays strictly separate from the operator domain.
  Tables `settings_auth_codes`, `settings_sessions`, `settings_rate_limit` are
  created by migration `047_settings_auth`.
```

- [ ] **Step 2: Run the full check suite**

Run: `bun typecheck`
Expected: no errors.

Run: `bun lint`
Expected: no errors.

Run: `bun test tests/settings tests/debug/settings-router.test.ts tests/debug/settings-routes.test.ts tests/debug/server.test.ts tests/commands/config.test.ts tests/db/settings-auth-schema.test.ts`
Expected: all PASS.

Run: `bun knip`
Expected: no new unused exports. (If `knip` flags `deleteSessionsForPrincipal` or `ADMIN_SYSTEM_CONTEXT_ID` as unused, that is expected — they are the documented integration surface for the Surface spec's admin "revoke all sessions" and admin-tier routes. Add them to the knip ignore config only if the repo's convention is to do so; otherwise leave the note for the Surface spec to consume them.)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(settings): document access-model module and SETTINGS_PUBLIC_BASE_URL"
```

---

## Out of scope (delivered by sibling specs)

- The per-capability `/settings/api/*` write routes (config fields, tool prefs, MCP endpoints, plugin enablement, group membership, admin roster, instances, system LLM, announce) and the field-visibility/masking layer (`getConfigFieldsForContext`, `isSensitiveKey`, `maskSensitiveValue`) — **Surface spec**. These routes call `authenticateSettingsRequest` + `verifyCsrf` + `requireScope` from this plan.
- The `client/settings/` Svelte SPA and static serving under `/settings` — **Surface spec**.
- Hard removal of the legacy interaction routers / wizard / config-editor and the `/config` legacy fallback branch — **Command Retirement spec**.
- Reverse-proxy / TLS deployment configuration — operational, out of code scope (only `SETTINGS_PUBLIC_BASE_URL` lands here).
- Auto-redaction of the chat message after exchange (OQ-A5) — deferred.

## Self-review notes

- **Spec coverage:** code issuance (T4, T7, T14), exchange endpoint (T12), code-vs-session separation (T4/T5), SQLite sessions (T5, migration T3), cookie attributes (T11), synchronizer CSRF (T5 rotation + T11 verify + T12), logout/revocation (T5 `deleteSession`/`deleteSessionsForPrincipal`, T12), trust isolation from `DEBUG_TOKEN` (T13), rate limiting for exchange & issuance (T6, T7, T12), exposure config `SETTINGS_PUBLIC_BASE_URL` (T1), per-request principal resolution (T8), scope guard + capability rules (T9), context switcher (T10), reuse of existing authorization stores with no parallel tables (T8 imports `isAdmin`/`isSuperAdmin`/`isAuthorized`/`listManageableGroups`).
- **Type consistency:** `AuthCodePrincipal`/`SessionPrincipal` share the `{platformInstanceId, platformUserId}` shape; `SettingsPrincipal` is produced by `resolveSettingsPrincipal` and consumed by `requireScope`/`listAvailableContexts`/`request-auth`; `SessionRecord` is returned by `getSession` and consumed by `verifyCsrf`; `consumeSettingsQuota` signature is identical at every call site.
- **Config-field visibility / masking** is intentionally deferred to the Surface spec (it belongs to the write routes), matching the spec's division of labor.
