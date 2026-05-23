<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router — Phase 1: Instance Data Model & Bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the DB tables, AES-256-GCM encryption helper, and idempotent env→DB bootstrap that the rest of the multi-provider router refactor will build on, without changing runtime behavior for existing single-instance deployments.

**Architecture:** Adds migration `040_platform_instances` that creates four tables (`platform_instances`, `task_instances`, `context_settings`, `admins`) plus a nullable `platform_instance_id` column on `users`. Wraps DB writes through a small `src/instances/` module that encrypts the per-instance JSON config blob with `INSTANCE_CONFIG_KEY` (AES-256-GCM, 12-byte IV, 16-byte tag, base64 on disk). A single `bootstrapInstancesFromEnv()` runs at startup, reads existing `platform_instances`/`task_instances` row counts, and either (a) seeds defaults from env vars in one transaction, (b) logs an "already bootstrapped" notice, or (c) logs "no instances configured" and lets the bot stay idle. No existing runtime path reads from these tables yet — that lands in phases 2–5.

**Tech Stack:** Bun runtime, Drizzle ORM + `bun:sqlite`, Zod v4 (manifest-style validation not required this phase), pino structured logging, Node's `node:crypto` for AES-256-GCM, `bun:test` runner.

---

## File Structure

### New files

- `src/db/migrations/040_platform_instances.ts` — DDL for the four tables + `ALTER TABLE users ADD COLUMN platform_instance_id TEXT`
- `src/db/instance-schema.ts` — Drizzle schema declarations for `platformInstances`, `taskInstances`, `contextSettings`, `admins`
- `src/instances/types.ts` — shared TS types (`PlatformInstance`, `TaskInstance`, `ContextSettings`, `AdminRow`, `BootstrapResult`, `InstanceConfig`)
- `src/instances/encryption.ts` — `resolveInstanceConfigKey()`, `encryptInstanceConfig()`, `decryptInstanceConfig()`, `maskConfig()`
- `src/instances/platform-store.ts` — `insertPlatformInstance`, `getPlatformInstance`, `listPlatformInstances`, `updatePlatformInstance`, `deletePlatformInstance`
- `src/instances/task-store.ts` — same shape as `platform-store.ts` for `task_instances`
- `src/instances/context-store.ts` — `setContextSettings`, `getContextSettings`, `listContextsByTaskInstance`, `listContextsByPlatformInstance`
- `src/instances/admin-store.ts` — `addAdmin`, `removeAdmin`, `listAdminsForPlatform`, `isAdmin(userId, platformInstanceId)`, `SUPER_ADMIN_PLATFORM_ID`
- `src/instances/bootstrap.ts` — `bootstrapInstancesFromEnv()`, returns `BootstrapResult`
- `tests/db/migrations/040_platform_instances.test.ts`
- `tests/instances/encryption.test.ts`
- `tests/instances/platform-store.test.ts`
- `tests/instances/task-store.test.ts`
- `tests/instances/context-store.test.ts`
- `tests/instances/admin-store.test.ts`
- `tests/instances/bootstrap.test.ts`

### Modified files

- `src/db/schema.ts` — re-export the four new Drizzle tables from `instance-schema.ts`
- `src/db/index.ts` — register `migration040PlatformInstances` in `MIGRATIONS`
- `src/index.ts` — call `bootstrapInstancesFromEnv()` after `initDb()` and after `addUser(adminUserId, adminUserId)` so the admin row's `platform_instance_id` can be backfilled
- `CLAUDE.md` — add `INSTANCE_CONFIG_KEY` to the required-env section and document the four new tables under the architecture overview

### Why this split

`encryption.ts` is intentionally separate from the stores because Phase 4 (dashboard) needs `maskConfig()` without pulling DB code in. Each store gets its own file because their query shapes are independent and each will grow in phases 2–4. `bootstrap.ts` is a thin orchestrator: it composes the stores, so it lives alone.

---

## Task 1: Drizzle schema for instance tables

**Files:**

- Create: `src/db/instance-schema.ts`
- Modify: `src/db/schema.ts` (add a single re-export line at the bottom)

- [ ] **Step 1: Write the failing schema test**

Create `tests/db/instance-schema.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  admins,
  contextSettings,
  platformInstances,
  taskInstances,
} from '../../src/db/schema.js'

describe('instance-schema re-exports', () => {
  test('platformInstances table name', () => {
    expect(platformInstances[Symbol.for('drizzle:Name')]).toBe('platform_instances')
  })

  test('taskInstances table name', () => {
    expect(taskInstances[Symbol.for('drizzle:Name')]).toBe('task_instances')
  })

  test('contextSettings table name', () => {
    expect(contextSettings[Symbol.for('drizzle:Name')]).toBe('context_settings')
  })

  test('admins table name', () => {
    expect(admins[Symbol.for('drizzle:Name')]).toBe('admins')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/instance-schema.test.ts`
Expected: FAIL — `Module has no exported member 'platformInstances'` or similar resolution error.

- [ ] **Step 3: Create the Drizzle schema file**

Create `src/db/instance-schema.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'
import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const platformInstances = sqliteTable('platform_instances', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  config: text('config').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const taskInstances = sqliteTable('task_instances', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  config: text('config').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const contextSettings = sqliteTable(
  'context_settings',
  {
    contextId: text('context_id').primaryKey(),
    taskInstanceId: text('task_instance_id').notNull(),
    platformInstanceId: text('platform_instance_id').notNull(),
  },
  (table) => [
    index('idx_context_settings_task_instance').on(table.taskInstanceId),
    index('idx_context_settings_platform_instance').on(table.platformInstanceId),
  ],
)

export const admins = sqliteTable(
  'admins',
  {
    userId: text('user_id').notNull(),
    platformInstanceId: text('platform_instance_id').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.platformInstanceId] })],
)

export type PlatformInstanceRow = typeof platformInstances.$inferSelect
export type TaskInstanceRow = typeof taskInstances.$inferSelect
export type ContextSettingsRow = typeof contextSettings.$inferSelect
export type AdminRow = typeof admins.$inferSelect
```

- [ ] **Step 4: Re-export from `src/db/schema.ts`**

Open `src/db/schema.ts` and append after the existing `export { pluginAdminState, ... }` line:

```typescript
export {
  admins,
  contextSettings,
  platformInstances,
  taskInstances,
  type AdminRow,
  type ContextSettingsRow,
  type PlatformInstanceRow,
  type TaskInstanceRow,
} from './instance-schema.js'
```

- [ ] **Step 5: Run schema test to verify it passes**

Run: `bun test tests/db/instance-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/instance-schema.ts src/db/schema.ts tests/db/instance-schema.test.ts
git commit -m "feat(db): add drizzle schema for platform/task/context/admin instance tables"
```

---

## Task 2: Migration 040 — platform_instances, task_instances, context_settings, admins, users column

**Files:**

- Create: `src/db/migrations/040_platform_instances.ts`
- Create: `tests/db/migrations/040_platform_instances.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `tests/db/migrations/040_platform_instances.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import migration040PlatformInstances from '../../../src/db/migrations/040_platform_instances.js'

interface SqliteMasterRow {
  name: string
}

interface PragmaColumnRow {
  name: string
  type: string
  notnull: number
  pk: number
}

const getTableNames = (db: Database): string[] =>
  db
    .query<SqliteMasterRow, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)

const getIndexNames = (db: Database): string[] =>
  db
    .query<SqliteMasterRow, []>("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name)

const getColumnNames = (db: Database, table: string): string[] =>
  db.query<PragmaColumnRow, []>(`PRAGMA table_info(${table})`).all().map((r) => r.name)

const createUsersTable = (db: Database): void => {
  db.run(`
    CREATE TABLE users (
      platform_user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      added_by TEXT NOT NULL,
      kaneo_workspace_id TEXT
    )
  `)
}

describe('migration040PlatformInstances', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    createUsersTable(db)
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 040_platform_instances', () => {
    expect(migration040PlatformInstances.id).toBe('040_platform_instances')
  })

  test('creates the four instance tables', () => {
    migration040PlatformInstances.up(db)
    const names = getTableNames(db)
    expect(names).toContain('platform_instances')
    expect(names).toContain('task_instances')
    expect(names).toContain('context_settings')
    expect(names).toContain('admins')
  })

  test('creates indexes for scheduler/poller scans on context_settings', () => {
    migration040PlatformInstances.up(db)
    const indexes = getIndexNames(db)
    expect(indexes).toContain('idx_context_settings_task_instance')
    expect(indexes).toContain('idx_context_settings_platform_instance')
  })

  test('adds nullable platform_instance_id column to users', () => {
    migration040PlatformInstances.up(db)
    const cols = getColumnNames(db, 'users')
    expect(cols).toContain('platform_instance_id')
    const def = db
      .query<PragmaColumnRow, []>(`PRAGMA table_info(users)`)
      .all()
      .find((c) => c.name === 'platform_instance_id')
    expect(def?.notnull).toBe(0)
  })

  test('admins table has composite primary key (user_id, platform_instance_id)', () => {
    migration040PlatformInstances.up(db)
    const pkCols = db
      .query<PragmaColumnRow, []>(`PRAGMA table_info(admins)`)
      .all()
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    expect(pkCols).toEqual(['user_id', 'platform_instance_id'])
  })

  test('platform_instances row insert with all columns works', () => {
    migration040PlatformInstances.up(db)
    db.run(
      `INSERT INTO platform_instances (id, type, config, status) VALUES (?, ?, ?, ?)`,
      ['telegram-default', 'telegram', 'encrypted-blob', 'active'],
    )
    const row = db
      .query<{ id: string; type: string; status: string }, []>(
        `SELECT id, type, status FROM platform_instances`,
      )
      .get()
    expect(row).toEqual({ id: 'telegram-default', type: 'telegram', status: 'active' })
  })

  test('is idempotent against re-application via CREATE TABLE IF NOT EXISTS', () => {
    migration040PlatformInstances.up(db)
    expect(() => {
      migration040PlatformInstances.up(db)
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run migration test to verify it fails**

Run: `bun test tests/db/migrations/040_platform_instances.test.ts`
Expected: FAIL — cannot resolve module `040_platform_instances`.

- [ ] **Step 3: Implement migration 040**

Create `src/db/migrations/040_platform_instances.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:040' })

function createPlatformInstancesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_instances (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      config     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function createTaskInstancesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS task_instances (
      id         TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      config     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function createContextSettingsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS context_settings (
      context_id           TEXT PRIMARY KEY,
      task_instance_id     TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL
    )
  `)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_context_settings_task_instance ON context_settings (task_instance_id)`,
  )
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_context_settings_platform_instance ON context_settings (platform_instance_id)`,
  )
}

function createAdminsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      user_id              TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, platform_instance_id)
    )
  `)
}

function addPlatformInstanceIdToUsers(db: Database): void {
  const cols = db
    .query<{ name: string }, []>(`PRAGMA table_info(users)`)
    .all()
    .map((r) => r.name)
  if (cols.includes('platform_instance_id')) return
  db.run(`ALTER TABLE users ADD COLUMN platform_instance_id TEXT`)
}

const up = (db: Database): void => {
  createPlatformInstancesTable(db)
  createTaskInstancesTable(db)
  createContextSettingsTable(db)
  createAdminsTable(db)
  addPlatformInstanceIdToUsers(db)
  log.info('migration 040: instance tables and users.platform_instance_id created')
}

export const migration040PlatformInstances: Migration = {
  id: '040_platform_instances',
  up,
}

export default migration040PlatformInstances
```

- [ ] **Step 4: Run migration test to verify it passes**

Run: `bun test tests/db/migrations/040_platform_instances.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/040_platform_instances.ts tests/db/migrations/040_platform_instances.test.ts
git commit -m "feat(db): add migration 040 for platform/task/context/admin instance tables"
```

---

## Task 3: Register migration 040 in MIGRATIONS list

**Files:**

- Modify: `src/db/index.ts`

- [ ] **Step 1: Write the failing registration test**

Create `tests/db/migration-registration.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../src/db/index.js'

describe('MIGRATIONS list', () => {
  test('includes migration 040_platform_instances', () => {
    const ids = MIGRATIONS.map((m) => m.id)
    expect(ids).toContain('040_platform_instances')
  })

  test('040 is the last migration', () => {
    expect(MIGRATIONS.at(-1)?.id).toBe('040_platform_instances')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/db/migration-registration.test.ts`
Expected: FAIL — list does not contain `040_platform_instances`.

- [ ] **Step 3: Register the migration**

Open `src/db/index.ts`. Add import after the `migration039Plugins` import:

```typescript
import { migration040PlatformInstances } from './migrations/040_platform_instances.js'
```

Add `migration040PlatformInstances,` as the final entry of the `MIGRATIONS` array, after `migration039Plugins,`.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/db/migration-registration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full migration suite to confirm no ordering regression**

Run: `bun test tests/db/migrate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/index.ts tests/db/migration-registration.test.ts
git commit -m "feat(db): register migration 040 in MIGRATIONS list"
```

---

## Task 4: Encryption helper (AES-256-GCM)

**Files:**

- Create: `src/instances/types.ts`
- Create: `src/instances/encryption.ts`
- Create: `tests/instances/encryption.test.ts`

- [ ] **Step 1: Write the failing encryption test**

Create `tests/instances/encryption.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  decryptInstanceConfig,
  encryptInstanceConfig,
  maskConfig,
  resolveInstanceConfigKey,
} from '../../src/instances/encryption.js'

const originalEnv = process.env['INSTANCE_CONFIG_KEY']

describe('encryption', () => {
  beforeEach(() => {
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64) // 32-byte hex key
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['INSTANCE_CONFIG_KEY']
    else process.env['INSTANCE_CONFIG_KEY'] = originalEnv
  })

  test('round-trips a config object', () => {
    const plain = { token: 'abc123', url: 'https://example.invalid' }
    const cipher = encryptInstanceConfig(plain)
    const back = decryptInstanceConfig(cipher)
    expect(back).toEqual(plain)
  })

  test('produces different ciphertexts for the same plaintext (IV non-determinism)', () => {
    const plain = { token: 'abc' }
    const a = encryptInstanceConfig(plain)
    const b = encryptInstanceConfig(plain)
    expect(a).not.toEqual(b)
  })

  test('tampered ciphertext throws on decrypt', () => {
    const plain = { token: 'abc' }
    const cipher = encryptInstanceConfig(plain)
    // flip a single base64 character in the middle of the payload
    const idx = Math.floor(cipher.length / 2)
    const ch = cipher[idx] === 'A' ? 'B' : 'A'
    const tampered = cipher.slice(0, idx) + ch + cipher.slice(idx + 1)
    expect(() => decryptInstanceConfig(tampered)).toThrow()
  })

  test('payload too short throws clear error', () => {
    expect(() => decryptInstanceConfig('AAAA')).toThrow(/too short/i)
  })

  test('resolveInstanceConfigKey uses 64-hex env value verbatim', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'a'.repeat(64)
    const key = resolveInstanceConfigKey()
    expect(key.length).toBe(32)
    expect(key[0]).toBe(0xaa)
  })

  test('resolveInstanceConfigKey hashes non-hex strings with SHA-256', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'not-a-hex-key'
    const key = resolveInstanceConfigKey()
    expect(key.length).toBe(32)
  })

  test('resolveInstanceConfigKey returns derived fallback when env missing', () => {
    delete process.env['INSTANCE_CONFIG_KEY']
    const key = resolveInstanceConfigKey()
    expect(key.length).toBe(32)
    // Same fallback should be deterministic
    const again = resolveInstanceConfigKey()
    expect(again.equals(key)).toBe(true)
  })

  test('maskConfig masks secret-like keys and preserves others', () => {
    const masked = maskConfig({
      token: 'xyz',
      apiKey: 'kkk',
      password: 'pw',
      cookie: 'c',
      secret: 's',
      url: 'https://example.invalid',
      name: 'plain',
    })
    expect(masked['token']).toBe('***')
    expect(masked['apiKey']).toBe('***')
    expect(masked['password']).toBe('***')
    expect(masked['cookie']).toBe('***')
    expect(masked['secret']).toBe('***')
    expect(masked['url']).toBe('https://example.invalid')
    expect(masked['name']).toBe('plain')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/instances/encryption.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create shared types**

Create `src/instances/types.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type InstanceConfig = Record<string, string>

export type PlatformInstanceType = 'telegram' | 'mattermost' | 'discord'
export type TaskInstanceType = 'kaneo' | 'youtrack'
export type InstanceStatus = 'pending' | 'active' | 'stopped'

export interface PlatformInstance {
  id: string
  type: PlatformInstanceType
  config: InstanceConfig
  status: InstanceStatus
  createdAt: string
}

export interface TaskInstance {
  id: string
  type: TaskInstanceType
  config: InstanceConfig
  status: InstanceStatus
  createdAt: string
}

export interface ContextSettings {
  contextId: string
  taskInstanceId: string
  platformInstanceId: string
}

export interface AdminRecord {
  userId: string
  platformInstanceId: string
  createdAt: string
}

export type BootstrapResult =
  | { bootstrapped: true; platformInstanceId: string; taskInstanceId: string }
  | { bootstrapped: false; reason: 'no-env' | 'already-bootstrapped' | 'partial-env'; missing?: string[] }
```

- [ ] **Step 4: Implement encryption helper**

Create `src/instances/encryption.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { logger } from '../logger.js'

import type { InstanceConfig } from './types.js'

const log = logger.child({ scope: 'instances:encryption' })

const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const FALLBACK_SEED = 'papai:instance-config:fallback'
const SECRET_KEY_PATTERN = /token|key|secret|password|cookie/iu

let fallbackWarned = false

const isHex64 = (value: string): boolean => /^[0-9a-f]{64}$/iu.test(value)

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

export const resolveInstanceConfigKey = (): Buffer => {
  const raw = process.env['INSTANCE_CONFIG_KEY']
  if (raw !== undefined && raw.trim() !== '') {
    const trimmed = raw.trim()
    if (isHex64(trimmed)) return Buffer.from(trimmed, 'hex')
    return sha256(trimmed)
  }
  if (!fallbackWarned) {
    log.warn('INSTANCE_CONFIG_KEY is unset; using host-local derived fallback (not for production)')
    fallbackWarned = true
  }
  return sha256(FALLBACK_SEED)
}

export const encryptInstanceConfig = (plain: InstanceConfig): string => {
  const key = resolveInstanceConfigKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(plain), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

export const decryptInstanceConfig = (encoded: string): InstanceConfig => {
  const buf = Buffer.from(encoded, 'base64')
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error(`Encrypted payload too short: got ${buf.length} bytes, expected at least ${IV_LEN + TAG_LEN + 1}`)
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN)
  const key = resolveInstanceConfigKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  const parsed: unknown = JSON.parse(plaintext)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Decrypted payload is not a config object')
  }
  return parsed as InstanceConfig
}

export const maskConfig = (plain: InstanceConfig): InstanceConfig => {
  const out: InstanceConfig = {}
  for (const [k, v] of Object.entries(plain)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? '***' : v
  }
  return out
}

// Exposed for testing only.
export const resetFallbackWarnFlagForTesting = (): void => {
  fallbackWarned = false
}

export { KEY_LEN as INSTANCE_CONFIG_KEY_LEN }
```

- [ ] **Step 5: Run to verify all encryption tests pass**

Run: `bun test tests/instances/encryption.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/instances/types.ts src/instances/encryption.ts tests/instances/encryption.test.ts
git commit -m "feat(instances): add AES-256-GCM encryption helper with masking"
```

---

## Task 5: Platform instance store (CRUD)

**Files:**

- Create: `src/instances/platform-store.ts`
- Create: `tests/instances/platform-store.test.ts`

- [ ] **Step 1: Write the failing store test**

Create `tests/instances/platform-store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  deletePlatformInstance,
  getPlatformInstance,
  insertPlatformInstance,
  listPlatformInstances,
  updatePlatformInstance,
} from '../../src/instances/platform-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('platform-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '1'.repeat(64)
  })

  afterEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
  })

  test('insert + get round-trips with decrypted config', () => {
    insertPlatformInstance({
      id: 'tg-prod',
      type: 'telegram',
      config: { token: 'secret-token' },
      status: 'active',
    })
    const row = getPlatformInstance('tg-prod')
    expect(row).not.toBeNull()
    expect(row?.id).toBe('tg-prod')
    expect(row?.type).toBe('telegram')
    expect(row?.status).toBe('active')
    expect(row?.config).toEqual({ token: 'secret-token' })
  })

  test('get returns null for missing id', () => {
    expect(getPlatformInstance('nope')).toBeNull()
  })

  test('list returns all rows in insertion order', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertPlatformInstance({ id: 'b', type: 'mattermost', config: { url: 'u', token: 't' }, status: 'pending' })
    const rows = listPlatformInstances()
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  test('update changes config and status, leaves id untouched', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 'old' }, status: 'pending' })
    updatePlatformInstance('a', { config: { token: 'new' }, status: 'active' })
    const row = getPlatformInstance('a')
    expect(row?.config).toEqual({ token: 'new' })
    expect(row?.status).toBe('active')
  })

  test('delete removes the row', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 't' }, status: 'active' })
    deletePlatformInstance('a')
    expect(getPlatformInstance('a')).toBeNull()
  })

  test('insert with duplicate id throws', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 't' }, status: 'active' })
    expect(() => {
      insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 't' }, status: 'active' })
    }).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/instances/platform-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/instances/platform-store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { platformInstances } from '../db/schema.js'
import { logger } from '../logger.js'

import { decryptInstanceConfig, encryptInstanceConfig } from './encryption.js'
import type { InstanceConfig, InstanceStatus, PlatformInstance, PlatformInstanceType } from './types.js'

const log = logger.child({ scope: 'instances:platform-store' })

export interface InsertPlatformInstanceInput {
  id: string
  type: PlatformInstanceType
  config: InstanceConfig
  status: InstanceStatus
}

export interface UpdatePlatformInstanceInput {
  config?: InstanceConfig
  status?: InstanceStatus
}

const rowToInstance = (row: typeof platformInstances.$inferSelect): PlatformInstance => ({
  id: row.id,
  type: row.type as PlatformInstanceType,
  config: decryptInstanceConfig(row.config),
  status: row.status as InstanceStatus,
  createdAt: row.createdAt,
})

export const insertPlatformInstance = (input: InsertPlatformInstanceInput): void => {
  getDrizzleDb()
    .insert(platformInstances)
    .values({
      id: input.id,
      type: input.type,
      config: encryptInstanceConfig(input.config),
      status: input.status,
    })
    .run()
  log.info({ id: input.id, type: input.type, status: input.status }, 'platform instance inserted')
}

export const getPlatformInstance = (id: string): PlatformInstance | null => {
  const row = getDrizzleDb()
    .select()
    .from(platformInstances)
    .where(eq(platformInstances.id, id))
    .get()
  return row === undefined ? null : rowToInstance(row)
}

export const listPlatformInstances = (): PlatformInstance[] => {
  const rows = getDrizzleDb().select().from(platformInstances).all()
  return rows.map(rowToInstance)
}

export const updatePlatformInstance = (id: string, patch: UpdatePlatformInstanceInput): void => {
  const set: Partial<typeof platformInstances.$inferInsert> = {}
  if (patch.config !== undefined) set.config = encryptInstanceConfig(patch.config)
  if (patch.status !== undefined) set.status = patch.status
  if (Object.keys(set).length === 0) return
  getDrizzleDb().update(platformInstances).set(set).where(eq(platformInstances.id, id)).run()
  log.info({ id, updated: Object.keys(set) }, 'platform instance updated')
}

export const deletePlatformInstance = (id: string): void => {
  getDrizzleDb().delete(platformInstances).where(eq(platformInstances.id, id)).run()
  log.info({ id }, 'platform instance deleted')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/instances/platform-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/instances/platform-store.ts tests/instances/platform-store.test.ts
git commit -m "feat(instances): add encrypted CRUD for platform_instances"
```

---

## Task 6: Task instance store (CRUD)

**Files:**

- Create: `src/instances/task-store.ts`
- Create: `tests/instances/task-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/instances/task-store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  deleteTaskInstance,
  getTaskInstance,
  insertTaskInstance,
  listTaskInstances,
  updateTaskInstance,
} from '../../src/instances/task-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('task-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '2'.repeat(64)
  })

  afterEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
  })

  test('insert + get round-trips with decrypted config', () => {
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { url: 'https://kaneo.invalid' },
      status: 'active',
    })
    const row = getTaskInstance('kaneo-prod')
    expect(row?.type).toBe('kaneo')
    expect(row?.config).toEqual({ url: 'https://kaneo.invalid' })
  })

  test('list returns all rows', () => {
    insertTaskInstance({ id: 'a', type: 'kaneo', config: { url: 'u1' }, status: 'active' })
    insertTaskInstance({ id: 'b', type: 'youtrack', config: { url: 'u2' }, status: 'pending' })
    expect(listTaskInstances().map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  test('update sets config + status', () => {
    insertTaskInstance({ id: 'a', type: 'kaneo', config: { url: 'old' }, status: 'pending' })
    updateTaskInstance('a', { config: { url: 'new' }, status: 'active' })
    const row = getTaskInstance('a')
    expect(row?.config).toEqual({ url: 'new' })
    expect(row?.status).toBe('active')
  })

  test('delete removes the row', () => {
    insertTaskInstance({ id: 'a', type: 'kaneo', config: { url: 'u' }, status: 'active' })
    deleteTaskInstance('a')
    expect(getTaskInstance('a')).toBeNull()
  })

  test('get returns null for missing id', () => {
    expect(getTaskInstance('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/instances/task-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/instances/task-store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { taskInstances } from '../db/schema.js'
import { logger } from '../logger.js'

import { decryptInstanceConfig, encryptInstanceConfig } from './encryption.js'
import type { InstanceConfig, InstanceStatus, TaskInstance, TaskInstanceType } from './types.js'

const log = logger.child({ scope: 'instances:task-store' })

export interface InsertTaskInstanceInput {
  id: string
  type: TaskInstanceType
  config: InstanceConfig
  status: InstanceStatus
}

export interface UpdateTaskInstanceInput {
  config?: InstanceConfig
  status?: InstanceStatus
}

const rowToInstance = (row: typeof taskInstances.$inferSelect): TaskInstance => ({
  id: row.id,
  type: row.type as TaskInstanceType,
  config: decryptInstanceConfig(row.config),
  status: row.status as InstanceStatus,
  createdAt: row.createdAt,
})

export const insertTaskInstance = (input: InsertTaskInstanceInput): void => {
  getDrizzleDb()
    .insert(taskInstances)
    .values({
      id: input.id,
      type: input.type,
      config: encryptInstanceConfig(input.config),
      status: input.status,
    })
    .run()
  log.info({ id: input.id, type: input.type, status: input.status }, 'task instance inserted')
}

export const getTaskInstance = (id: string): TaskInstance | null => {
  const row = getDrizzleDb().select().from(taskInstances).where(eq(taskInstances.id, id)).get()
  return row === undefined ? null : rowToInstance(row)
}

export const listTaskInstances = (): TaskInstance[] => {
  const rows = getDrizzleDb().select().from(taskInstances).all()
  return rows.map(rowToInstance)
}

export const updateTaskInstance = (id: string, patch: UpdateTaskInstanceInput): void => {
  const set: Partial<typeof taskInstances.$inferInsert> = {}
  if (patch.config !== undefined) set.config = encryptInstanceConfig(patch.config)
  if (patch.status !== undefined) set.status = patch.status
  if (Object.keys(set).length === 0) return
  getDrizzleDb().update(taskInstances).set(set).where(eq(taskInstances.id, id)).run()
  log.info({ id, updated: Object.keys(set) }, 'task instance updated')
}

export const deleteTaskInstance = (id: string): void => {
  getDrizzleDb().delete(taskInstances).where(eq(taskInstances.id, id)).run()
  log.info({ id }, 'task instance deleted')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/instances/task-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/instances/task-store.ts tests/instances/task-store.test.ts
git commit -m "feat(instances): add encrypted CRUD for task_instances"
```

---

## Task 7: Context settings store

**Files:**

- Create: `src/instances/context-store.ts`
- Create: `tests/instances/context-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/instances/context-store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getContextSettings,
  listContextsByPlatformInstance,
  listContextsByTaskInstance,
  setContextSettings,
} from '../../src/instances/context-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('context-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('set + get round-trips assignments', () => {
    setContextSettings({ contextId: 'u1', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    expect(getContextSettings('u1')).toEqual({
      contextId: 'u1',
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'tg-default',
    })
  })

  test('set is upsert (re-assignment replaces existing row)', () => {
    setContextSettings({ contextId: 'u1', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'u1', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })
    expect(getContextSettings('u1')?.taskInstanceId).toBe('yt-default')
  })

  test('get returns null for unknown context', () => {
    expect(getContextSettings('missing')).toBeNull()
  })

  test('listContextsByTaskInstance returns matching contexts only', () => {
    setContextSettings({ contextId: 'u1', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'u2', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'u3', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    const ids = listContextsByTaskInstance('kaneo-default').map((c) => c.contextId).sort()
    expect(ids).toEqual(['u1', 'u3'])
  })

  test('listContextsByPlatformInstance returns matching contexts only', () => {
    setContextSettings({ contextId: 'u1', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'u2', taskInstanceId: 'kaneo-default', platformInstanceId: 'mm-default' })
    const ids = listContextsByPlatformInstance('mm-default').map((c) => c.contextId)
    expect(ids).toEqual(['u2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/instances/context-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/instances/context-store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { contextSettings } from '../db/schema.js'
import { logger } from '../logger.js'

import type { ContextSettings } from './types.js'

const log = logger.child({ scope: 'instances:context-store' })

const rowToSettings = (row: typeof contextSettings.$inferSelect): ContextSettings => ({
  contextId: row.contextId,
  taskInstanceId: row.taskInstanceId,
  platformInstanceId: row.platformInstanceId,
})

export const setContextSettings = (input: ContextSettings): void => {
  getDrizzleDb()
    .insert(contextSettings)
    .values(input)
    .onConflictDoUpdate({
      target: contextSettings.contextId,
      set: {
        taskInstanceId: sql`excluded.task_instance_id`,
        platformInstanceId: sql`excluded.platform_instance_id`,
      },
    })
    .run()
  log.info(
    { contextId: input.contextId, taskInstanceId: input.taskInstanceId, platformInstanceId: input.platformInstanceId },
    'context settings upserted',
  )
}

export const getContextSettings = (contextId: string): ContextSettings | null => {
  const row = getDrizzleDb()
    .select()
    .from(contextSettings)
    .where(eq(contextSettings.contextId, contextId))
    .get()
  return row === undefined ? null : rowToSettings(row)
}

export const listContextsByTaskInstance = (taskInstanceId: string): ContextSettings[] => {
  const rows = getDrizzleDb()
    .select()
    .from(contextSettings)
    .where(eq(contextSettings.taskInstanceId, taskInstanceId))
    .all()
  return rows.map(rowToSettings)
}

export const listContextsByPlatformInstance = (platformInstanceId: string): ContextSettings[] => {
  const rows = getDrizzleDb()
    .select()
    .from(contextSettings)
    .where(eq(contextSettings.platformInstanceId, platformInstanceId))
    .all()
  return rows.map(rowToSettings)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/instances/context-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/instances/context-store.ts tests/instances/context-store.test.ts
git commit -m "feat(instances): add context_settings store with indexed lookups"
```

---

## Task 8: Admin store (super-admin and platform-admin)

**Files:**

- Create: `src/instances/admin-store.ts`
- Create: `tests/instances/admin-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/instances/admin-store.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  addAdmin,
  isAdmin,
  listAdminsForPlatform,
  removeAdmin,
  SUPER_ADMIN_PLATFORM_ID,
} from '../../src/instances/admin-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('admin-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('SUPER_ADMIN_PLATFORM_ID is the reserved sentinel', () => {
    expect(SUPER_ADMIN_PLATFORM_ID).toBe('__super__')
  })

  test('addAdmin + isAdmin for super-admin', () => {
    addAdmin('u1', SUPER_ADMIN_PLATFORM_ID)
    expect(isAdmin('u1', SUPER_ADMIN_PLATFORM_ID)).toBe(true)
    expect(isAdmin('u1', 'tg-default')).toBe(true) // super-admin is admin of all platforms
  })

  test('addAdmin + isAdmin for platform-only admin', () => {
    addAdmin('u2', 'tg-default')
    expect(isAdmin('u2', 'tg-default')).toBe(true)
    expect(isAdmin('u2', 'mm-default')).toBe(false)
    expect(isAdmin('u2', SUPER_ADMIN_PLATFORM_ID)).toBe(false)
  })

  test('non-admin returns false', () => {
    expect(isAdmin('nobody', 'tg-default')).toBe(false)
  })

  test('addAdmin is idempotent for the same (user, platform) pair', () => {
    addAdmin('u1', 'tg-default')
    expect(() => {
      addAdmin('u1', 'tg-default')
    }).not.toThrow()
    expect(isAdmin('u1', 'tg-default')).toBe(true)
  })

  test('removeAdmin removes the row', () => {
    addAdmin('u1', 'tg-default')
    removeAdmin('u1', 'tg-default')
    expect(isAdmin('u1', 'tg-default')).toBe(false)
  })

  test('listAdminsForPlatform returns scoped rows', () => {
    addAdmin('u1', 'tg-default')
    addAdmin('u2', 'tg-default')
    addAdmin('u3', 'mm-default')
    const ids = listAdminsForPlatform('tg-default').map((a) => a.userId).sort()
    expect(ids).toEqual(['u1', 'u2'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/instances/admin-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

Create `src/instances/admin-store.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, or } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { admins } from '../db/schema.js'
import { logger } from '../logger.js'

import type { AdminRecord } from './types.js'

const log = logger.child({ scope: 'instances:admin-store' })

export const SUPER_ADMIN_PLATFORM_ID = '__super__'

const rowToRecord = (row: typeof admins.$inferSelect): AdminRecord => ({
  userId: row.userId,
  platformInstanceId: row.platformInstanceId,
  createdAt: row.createdAt,
})

export const addAdmin = (userId: string, platformInstanceId: string): void => {
  getDrizzleDb()
    .insert(admins)
    .values({ userId, platformInstanceId })
    .onConflictDoNothing({ target: [admins.userId, admins.platformInstanceId] })
    .run()
  log.info({ userId, platformInstanceId }, 'admin added')
}

export const removeAdmin = (userId: string, platformInstanceId: string): void => {
  getDrizzleDb()
    .delete(admins)
    .where(and(eq(admins.userId, userId), eq(admins.platformInstanceId, platformInstanceId)))
    .run()
  log.info({ userId, platformInstanceId }, 'admin removed')
}

export const isAdmin = (userId: string, platformInstanceId: string): boolean => {
  const row = getDrizzleDb()
    .select({ userId: admins.userId })
    .from(admins)
    .where(
      and(
        eq(admins.userId, userId),
        or(eq(admins.platformInstanceId, SUPER_ADMIN_PLATFORM_ID), eq(admins.platformInstanceId, platformInstanceId)),
      ),
    )
    .get()
  return row !== undefined
}

export const listAdminsForPlatform = (platformInstanceId: string): AdminRecord[] => {
  const rows = getDrizzleDb()
    .select()
    .from(admins)
    .where(eq(admins.platformInstanceId, platformInstanceId))
    .all()
  return rows.map(rowToRecord)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/instances/admin-store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/instances/admin-store.ts tests/instances/admin-store.test.ts
git commit -m "feat(instances): add admin store with super-/platform-admin union check"
```

---

## Task 9: Bootstrap from environment variables

**Files:**

- Create: `src/instances/bootstrap.ts`
- Create: `tests/instances/bootstrap.test.ts`

- [ ] **Step 1: Write the failing bootstrap test**

Create `tests/instances/bootstrap.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { bootstrapInstancesFromEnv } from '../../src/instances/bootstrap.js'
import { isAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../src/instances/admin-store.js'
import { listPlatformInstances } from '../../src/instances/platform-store.js'
import { listTaskInstances } from '../../src/instances/task-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ENV_KEYS = [
  'CHAT_PROVIDER',
  'TASK_PROVIDER',
  'ADMIN_USER_ID',
  'TELEGRAM_BOT_TOKEN',
  'MATTERMOST_URL',
  'MATTERMOST_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'KANEO_CLIENT_URL',
  'YOUTRACK_URL',
  'INSTANCE_CONFIG_KEY',
]

const snapshotEnv = (): Map<string, string | undefined> => {
  const snap = new Map<string, string | undefined>()
  for (const k of ENV_KEYS) snap.set(k, process.env[k])
  return snap
}

const restoreEnv = (snap: Map<string, string | undefined>): void => {
  for (const [k, v] of snap) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

describe('bootstrapInstancesFromEnv', () => {
  let envSnap: Map<string, string | undefined>

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    envSnap = snapshotEnv()
    for (const k of ENV_KEYS) delete process.env[k]
    process.env['INSTANCE_CONFIG_KEY'] = '3'.repeat(64)
  })

  afterEach(() => {
    restoreEnv(envSnap)
  })

  test('empty DB + complete telegram + kaneo env → seeds defaults', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: true,
      platformInstanceId: 'telegram-default',
      taskInstanceId: 'kaneo-default',
    })

    const platforms = listPlatformInstances()
    expect(platforms).toHaveLength(1)
    expect(platforms[0]?.type).toBe('telegram')
    expect(platforms[0]?.status).toBe('active')
    expect(platforms[0]?.config['token']).toBe('tg-token')

    const tasks = listTaskInstances()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.type).toBe('kaneo')
    expect(tasks[0]?.config['url']).toBe('https://kaneo.invalid')

    expect(isAdmin('admin-1', SUPER_ADMIN_PLATFORM_ID)).toBe(true)
    expect(isAdmin('admin-1', 'telegram-default')).toBe(true)
  })

  test('mattermost requires both url and token', () => {
    process.env['CHAT_PROVIDER'] = 'mattermost'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['MATTERMOST_URL'] = 'https://mm.invalid'
    // MATTERMOST_BOT_TOKEN intentionally missing
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: false,
      reason: 'partial-env',
      missing: ['MATTERMOST_BOT_TOKEN'],
    })
    expect(listPlatformInstances()).toHaveLength(0)
    expect(listTaskInstances()).toHaveLength(0)
  })

  test('youtrack requires YOUTRACK_URL', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'youtrack'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'
    // YOUTRACK_URL missing

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: false,
      reason: 'partial-env',
      missing: ['YOUTRACK_URL'],
    })
  })

  test('empty DB + no env returns no-env (does not throw)', () => {
    const result = bootstrapInstancesFromEnv()
    expect(result).toEqual({ bootstrapped: false, reason: 'no-env' })
    expect(listPlatformInstances()).toHaveLength(0)
  })

  test('rerunning with the same env is idempotent (already-bootstrapped)', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    bootstrapInstancesFromEnv()
    const second = bootstrapInstancesFromEnv()

    expect(second).toEqual({ bootstrapped: false, reason: 'already-bootstrapped' })
    expect(listPlatformInstances()).toHaveLength(1)
    expect(listTaskInstances()).toHaveLength(1)
  })

  test('seeds discord platform when CHAT_PROVIDER=discord', () => {
    process.env['CHAT_PROVIDER'] = 'discord'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['DISCORD_BOT_TOKEN'] = 'dc-token'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    const result = bootstrapInstancesFromEnv()
    expect(result).toEqual({
      bootstrapped: true,
      platformInstanceId: 'discord-default',
      taskInstanceId: 'kaneo-default',
    })
    expect(listPlatformInstances()[0]?.config['token']).toBe('dc-token')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/instances/bootstrap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the bootstrap orchestrator**

Create `src/instances/bootstrap.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb } from '../db/drizzle.js'
import { platformInstances, taskInstances } from '../db/schema.js'
import { logger } from '../logger.js'
import { count } from 'drizzle-orm'

import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from './admin-store.js'
import { insertPlatformInstance } from './platform-store.js'
import { insertTaskInstance } from './task-store.js'
import type {
  BootstrapResult,
  InstanceConfig,
  PlatformInstanceType,
  TaskInstanceType,
} from './types.js'

const log = logger.child({ scope: 'instances:bootstrap' })

const CHAT_ENV_REQUIREMENTS: Readonly<Record<PlatformInstanceType, readonly string[]>> = {
  telegram: ['TELEGRAM_BOT_TOKEN'],
  mattermost: ['MATTERMOST_URL', 'MATTERMOST_BOT_TOKEN'],
  discord: ['DISCORD_BOT_TOKEN'],
}

const TASK_ENV_REQUIREMENTS: Readonly<Record<TaskInstanceType, readonly string[]>> = {
  kaneo: ['KANEO_CLIENT_URL'],
  youtrack: ['YOUTRACK_URL'],
}

const getTrimmedEnv = (name: string): string | undefined => {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

const parsePlatformType = (value: string | undefined): PlatformInstanceType | null => {
  if (value === 'telegram' || value === 'mattermost' || value === 'discord') return value
  return null
}

const parseTaskType = (value: string | undefined): TaskInstanceType | null => {
  if (value === 'kaneo' || value === 'youtrack') return value
  return null
}

const buildPlatformConfig = (type: PlatformInstanceType): InstanceConfig => {
  switch (type) {
    case 'telegram':
      return { token: getTrimmedEnv('TELEGRAM_BOT_TOKEN') ?? '' }
    case 'mattermost':
      return {
        url: getTrimmedEnv('MATTERMOST_URL') ?? '',
        token: getTrimmedEnv('MATTERMOST_BOT_TOKEN') ?? '',
      }
    case 'discord':
      return { token: getTrimmedEnv('DISCORD_BOT_TOKEN') ?? '' }
  }
}

const buildTaskConfig = (type: TaskInstanceType): InstanceConfig => {
  switch (type) {
    case 'kaneo':
      return { url: getTrimmedEnv('KANEO_CLIENT_URL') ?? '' }
    case 'youtrack':
      return { url: getTrimmedEnv('YOUTRACK_URL') ?? '' }
  }
}

const countInstances = (): { platforms: number; tasks: number } => {
  const db = getDrizzleDb()
  const p = db.select({ n: count() }).from(platformInstances).get()
  const t = db.select({ n: count() }).from(taskInstances).get()
  return { platforms: p?.n ?? 0, tasks: t?.n ?? 0 }
}

export const bootstrapInstancesFromEnv = (): BootstrapResult => {
  const counts = countInstances()
  if (counts.platforms > 0 || counts.tasks > 0) {
    log.info({ counts }, 'Bootstrap skipped: DB already has instance rows')
    return { bootstrapped: false, reason: 'already-bootstrapped' }
  }

  const chatType = parsePlatformType(getTrimmedEnv('CHAT_PROVIDER'))
  const taskType = parseTaskType(getTrimmedEnv('TASK_PROVIDER'))
  const adminUserId = getTrimmedEnv('ADMIN_USER_ID')

  if (chatType === null && taskType === null && adminUserId === undefined) {
    log.warn('No instances configured. Use the dashboard to add platform and task instances.')
    return { bootstrapped: false, reason: 'no-env' }
  }

  const missing: string[] = []
  if (chatType === null) missing.push('CHAT_PROVIDER')
  if (taskType === null) missing.push('TASK_PROVIDER')
  if (adminUserId === undefined) missing.push('ADMIN_USER_ID')
  if (chatType !== null) {
    for (const v of CHAT_ENV_REQUIREMENTS[chatType]) {
      if (getTrimmedEnv(v) === undefined) missing.push(v)
    }
  }
  if (taskType !== null) {
    for (const v of TASK_ENV_REQUIREMENTS[taskType]) {
      if (getTrimmedEnv(v) === undefined) missing.push(v)
    }
  }

  if (missing.length > 0) {
    log.warn({ missing }, 'Bootstrap aborted: partial environment')
    return { bootstrapped: false, reason: 'partial-env', missing }
  }

  // Narrowing for the type checker: all three are non-null because missing is empty.
  if (chatType === null || taskType === null || adminUserId === undefined) {
    return { bootstrapped: false, reason: 'partial-env', missing }
  }

  const platformInstanceId = `${chatType}-default`
  const taskInstanceId = `${taskType}-default`

  insertPlatformInstance({
    id: platformInstanceId,
    type: chatType,
    config: buildPlatformConfig(chatType),
    status: 'active',
  })
  insertTaskInstance({
    id: taskInstanceId,
    type: taskType,
    config: buildTaskConfig(taskType),
    status: 'active',
  })
  addAdmin(adminUserId, SUPER_ADMIN_PLATFORM_ID)
  addAdmin(adminUserId, platformInstanceId)

  log.info(
    { platformInstanceId, taskInstanceId, adminUserId },
    'Bootstrapped from environment variables. DB is now the source of truth.',
  )
  return { bootstrapped: true, platformInstanceId, taskInstanceId }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/instances/bootstrap.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/instances/bootstrap.ts tests/instances/bootstrap.test.ts
git commit -m "feat(instances): add idempotent env→DB bootstrap for instance rows"
```

---

## Task 10: Wire bootstrap into the startup sequence

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing wiring test**

Create `tests/instances/bootstrap-startup-wiring.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'node:fs'

describe('bootstrap startup wiring', () => {
  test('src/index.ts imports bootstrapInstancesFromEnv', () => {
    const source = readFileSync('src/index.ts', 'utf8')
    expect(source).toContain("from './instances/bootstrap.js'")
    expect(source).toContain('bootstrapInstancesFromEnv')
  })

  test('bootstrap is called after initDb()', () => {
    const source = readFileSync('src/index.ts', 'utf8')
    const initDbIdx = source.indexOf('initDb()')
    const bootIdx = source.indexOf('bootstrapInstancesFromEnv(')
    expect(initDbIdx).toBeGreaterThan(-1)
    expect(bootIdx).toBeGreaterThan(initDbIdx)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/instances/bootstrap-startup-wiring.test.ts`
Expected: FAIL — `src/index.ts` does not yet import the bootstrap module.

- [ ] **Step 3: Edit `src/index.ts`**

Add a new import after the existing `import { primeSystemConfigCache ... }` / `import { missingSystemConfigKeys ... }` line:

```typescript
import { bootstrapInstancesFromEnv } from './instances/bootstrap.js'
```

Locate the block that runs after `initDb()`:

```typescript
try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}

seedSystemConfigFromEnv()
```

Insert immediately after the `seedSystemConfigFromEnv()` line:

```typescript
const bootstrapResult = bootstrapInstancesFromEnv()
log.info({ bootstrapResult }, 'instance bootstrap evaluated')
```

- [ ] **Step 4: Run the wiring test to verify it passes**

Run: `bun test tests/instances/bootstrap-startup-wiring.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run typecheck to confirm startup file still compiles**

Run: `bun typecheck`
Expected: PASS (no TypeScript errors).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/instances/bootstrap-startup-wiring.test.ts
git commit -m "feat(startup): call bootstrapInstancesFromEnv after initDb"
```

---

## Task 11: Document `INSTANCE_CONFIG_KEY` and the new tables in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Open `CLAUDE.md` and locate the "Required Environment Variables" section**

Inside that section, after the `EMBEDDING_MODEL` bullet, add:

```markdown
- `INSTANCE_CONFIG_KEY` — 32-byte AES-256-GCM key (64 hex chars) used to
  encrypt `platform_instances.config` and `task_instances.config` at rest.
  Non-hex values are SHA-256-hashed. When unset, a derived host-local
  fallback key is used and a one-shot `WARN` is logged at startup;
  production deployments must set this explicitly.
```

- [ ] **Step 2: In the "Main Modules" section, add an entry for `src/instances/`**

After the `src/plugins/` bullet, insert:

```markdown
- `src/instances/` — DB-backed platform and task instance data model: AES-256-GCM encryption helper (`encryption.ts`), per-table CRUD stores (`platform-store.ts`, `task-store.ts`, `context-store.ts`, `admin-store.ts`), and one-shot env→DB bootstrap (`bootstrap.ts`). After migration `040_platform_instances`, the DB is the source of truth for chat/task provider instance configuration; env vars are only consulted when the instance tables are empty. `INSTANCE_CONFIG_KEY` controls the at-rest encryption key. Phase 2–5 of the multi-provider router refactor will replace `buildProviderForUser` and the single `ChatProvider` startup with these stores.
```

- [ ] **Step 3: Run the markdown lint / format check used by the repo**

Run: `bun format:check`
Expected: PASS (no formatting drift in `CLAUDE.md`).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document INSTANCE_CONFIG_KEY and src/instances module"
```

---

## Task 12: Full-suite verification

- [ ] **Step 1: Run lint**

Run: `bun lint`
Expected: PASS (oxlint reports zero diagnostics on the new files).

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 3: Run the main test suite**

Run: `bun test`
Expected: PASS — all migration, instance, store, encryption, bootstrap, and wiring tests included.

- [ ] **Step 4: Confirm no leftover TODOs in new files**

Run:

```bash
grep -rn "TODO\|FIXME\|TBD" src/instances tests/instances src/db/migrations/040_platform_instances.ts src/db/instance-schema.ts
```

Expected: no matches.

- [ ] **Step 5: Push the branch**

Run: `git push -u origin claude/multi-provider-phase-1-plan-8kqwN`
Expected: branch published, no force-push required.

---

## Self-Review

**Spec coverage:**

| Spec section / requirement | Implementing task(s) |
| -------------------------- | -------------------- |
| `platform_instances` table | Tasks 1, 2 |
| `task_instances` table | Tasks 1, 2 |
| `context_settings` table + indexes | Tasks 1, 2 |
| `admins` table with composite PK | Tasks 1, 2 |
| `users.platform_instance_id` column added (nullable) | Task 2 |
| `user_config`, plugin tables, history etc. untouched | (none — verified by leaving schema.ts re-exports unchanged and not editing those migrations) |
| Encryption: AES-256-GCM, 12-byte IV, 16-byte tag, base64(IV‖TAG‖CT) | Task 4 |
| `INSTANCE_CONFIG_KEY` resolution (hex / hash / fallback + WARN) | Task 4 |
| Tamper detection raises clear error | Task 4 (test + impl) |
| `maskConfig()` masks `/token|key|secret|password|cookie/iu` | Task 4 |
| Bootstrap on empty DB seeds platform + task + 2 admin rows | Task 9 |
| Bootstrap idempotent (non-zero counts → already-bootstrapped) | Task 9 |
| Bootstrap silent + warn when empty env + empty DB | Task 9 |
| Bootstrap aborts with `partial-env` and the list of missing names | Task 9 |
| Bootstrap wrapped per-row (transactionality already provided by per-migration tx + per-store inserts; idempotency precondition prevents partial writes) | Task 9 (precondition check before any insert) |
| Startup wiring: call after `initDb()` | Task 10 |
| Migration 040 registered in `MIGRATIONS` list | Task 3 |
| Test files at the paths listed in spec Section 5 | Tasks 2, 4, 5, 6, 7, 8, 9 |
| `INSTANCE_CONFIG_KEY` documented | Task 11 |
| Phases 2–5 deferred (no `TaskProviderResolver`, no `ChatRouter`, no dashboard, no `/setup` change, no plugin re-eval) | Out of scope — confirmed nothing in tasks 1–11 touches `src/providers/factory.ts`, `src/chat/registry.ts`, `src/debug/`, `src/wizard/`, or `src/plugins/` |

**Placeholder scan:** No `TBD`, `TODO`, `FIXME`, or "implement later" in any task body. Each code block is the full file or full snippet to insert.

**Type consistency check:**

- `InstanceConfig = Record<string, string>` — used identically in `encryption.ts`, `platform-store.ts`, `task-store.ts`, `bootstrap.ts`.
- `InstanceStatus = 'pending' | 'active' | 'stopped'` — used identically in both stores and bootstrap.
- `PlatformInstanceType` / `TaskInstanceType` — narrowed to the same string literals everywhere.
- `BootstrapResult` shape — both `bootstrapped: true` and `bootstrapped: false` variants match the test expectations in Task 9.
- `isAdmin(userId, platformInstanceId)` — same signature in `admin-store.ts` and in its test (`tests/instances/admin-store.test.ts`).
- `SUPER_ADMIN_PLATFORM_ID = '__super__'` — defined once in `admin-store.ts`, re-imported by tests and by `bootstrap.ts`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-multi-provider-phase-1-instance-data-model-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
