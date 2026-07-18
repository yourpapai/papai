<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the multi-provider router refactor (`docs/superpowers/specs/2026-04-13-multi-provider-router-design.md`) so a single papai process serves multiple chat platforms and multiple task trackers from DB-stored instance rows, with the plugin system aligned per Section 9 of the spec.

**Architecture:** Adds four DB tables (`platform_instances`, `task_instances`, `context_settings`, `admins`) and a stable `INSTANCE_CONFIG_KEY`-encrypted config column. Wraps existing `ChatProvider` adapters behind a `ChatRouter` that fans out commands/messages and tags every `IncomingMessage` with `platformInstanceId`. Replaces `buildProviderForUser` with `TaskProviderResolver.resolve(contextId)`, which merges per-instance config with per-context credentials. Bootstraps from env vars exactly once; from then on, the DB is the source of truth and dashboard CRUD drives runtime state.

**Tech Stack:** Bun runtime, Drizzle ORM + bun:sqlite, Zod v4, Vercel AI SDK, Grammy / Mattermost REST+WebSocket / discord.js, pino, pre-existing pluggable `obra/superpowers` skills.

---

## Scope note

This spec spans 8 sections and four loosely-coupled subsystems (data model, ChatRouter, TaskProviderResolver, admin/dashboard). I am writing it as a single plan with hard phase boundaries because the data model and resolver must land together to be useful, and the router needs the same data model. If you prefer one PR per phase, treat each phase boundary below as a stop-and-merge point — phases 1–3 are required for any value, phases 4–6 layer on top.

**Phases:**

| Phase | Scope                                                                                                                  | Independently shippable?         |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1     | Schema, encryption helper, system bootstrap, idempotency                                                               | Yes                              |
| 2     | `TaskProviderResolver`, dynamic config keys, plumbing through llm-orchestrator / scheduler / poller                    | Yes (still single chat instance) |
| 3     | `ChatRouter`, `platformInstanceId` on `IncomingMessage`, multi-chat-instance start/stop                                | Yes                              |
| 4     | `/setup` wizard task-instance step, `/config` editor task-instance step, `/set` validation                             | Yes                              |
| 5     | Admin model (`admins` table, `isAdmin(userId, platformInstanceId)`), `/user` retargeting, `/plugin` super-admin gating | Yes                              |
| 6     | Dashboard pages and API endpoints, `INSTANCE_CONFIG_KEY` masking                                                       | Yes                              |
| 7     | Plugin-system alignment (`capability_missing` eligibility, plugin compat eval against active-instance union)           | Yes                              |

---

## File Structure

### New files

| File                                          | Responsibility                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/db/migrations/040_platform_instances.ts` | `platform_instances` + `task_instances` + `context_settings` + `admins` tables                                        |
| `src/db/instance-schema.ts`                   | Drizzle table definitions and row types for instance tables                                                           |
| `src/instances/types.ts`                      | `PlatformInstanceRow`, `TaskInstanceRow`, `ContextAssignment`, `InstanceStatus` types                                 |
| `src/instances/encryption.ts`                 | AES-256-GCM encrypt/decrypt helpers keyed off `INSTANCE_CONFIG_KEY`                                                   |
| `src/instances/platform-store.ts`             | CRUD for `platform_instances` (insert / update status / list active / delete)                                         |
| `src/instances/task-store.ts`                 | CRUD for `task_instances`                                                                                             |
| `src/instances/context-store.ts`              | CRUD for `context_settings` (assign / read / unassign)                                                                |
| `src/instances/bootstrap.ts`                  | First-run env → DB seeding, idempotency check, log notice                                                             |
| `src/instances/admin-store.ts`                | CRUD for `admins` table, `isSuperAdmin`, `isPlatformAdmin`, `isAdmin`                                                 |
| `src/chat/router.ts`                          | `ChatRouter implements ChatProvider`, instance lifecycle, command replay, fan-out                                     |
| `src/providers/resolver.ts`                   | `TaskProviderResolver.resolve(contextId)` with strict/non-strict modes                                                |
| `src/types/config-dynamic.ts`                 | `getConfigKeysForContext(contextId)`, replaces `CONFIG_KEYS` constant                                                 |
| `src/debug/instance-routes.ts`                | `GET/POST/DELETE /api/platform-instances`, `/api/task-instances`, `/api/admins`, `POST /api/platform-instances/apply` |
| `client/admin/src/pages/InstancesPage.tsx`    | Platform Instances + Task Instances + Admins UI under `/admin#instances`                                              |
| `tests/instances/encryption.test.ts`          | Encryption round-trip, fallback-key warning, tamper detection                                                         |
| `tests/instances/platform-store.test.ts`      | Platform CRUD coverage                                                                                                |
| `tests/instances/task-store.test.ts`          | Task CRUD coverage                                                                                                    |
| `tests/instances/context-store.test.ts`       | Assignment + unassignment + listing                                                                                   |
| `tests/instances/admin-store.test.ts`         | Super-admin / platform-admin checks                                                                                   |
| `tests/instances/bootstrap.test.ts`           | Empty-DB env seeding, idempotency, empty-env warning                                                                  |
| `tests/chat/router.test.ts`                   | Command replay, `platformInstanceId` injection, sendMessage routing, lifecycle, failure isolation                     |
| `tests/providers/resolver.test.ts`            | DM/group resolution, missing assignment, missing creds, strict throw                                                  |
| `tests/types/config-dynamic.test.ts`          | Per-context key derivation, plugin-key merge                                                                          |
| `tests/debug/instance-routes.test.ts`         | API endpoint coverage + masked secrets                                                                                |

### Modified files

| File                             | Reason                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/index.ts`                | Register migration 040                                                                                                                          |
| `src/db/schema.ts`               | Re-export instance schemas; add `platform_instance_id` to `users` table type                                                                    |
| `src/index.ts`                   | Replace direct `buildProviderForUser` / `setupBot(chatProvider)` calls with bootstrap → resolver/router wiring                                  |
| `src/llm-orchestrator.ts`        | Switch `deps.buildProviderForUser(contextId)` → `deps.resolve(contextId)`                                                                       |
| `src/llm-orchestrator-types.ts`  | Replace `buildProviderForUser` field with `resolve` returning `TaskProvider \| null`                                                            |
| `src/scheduler.ts`               | Use resolver instead of internal `buildProviderForUser`                                                                                         |
| `src/deferred-prompts/poller.ts` | `BuildProviderFn` signature → `(contextId: string) => TaskProvider \| null`                                                                     |
| `src/chat/types.ts`              | Add `platformInstanceId: string` to `IncomingMessage` and `IncomingInteraction`                                                                 |
| `src/types/config.ts`            | Remove module-level `CONFIG_KEYS` constant; re-export `getConfigKeysForContext`                                                                 |
| `src/providers/factory.ts`       | Delete (replaced by resolver). Keep one barrel re-export for `createProvider`                                                                   |
| `src/commands/setup.ts`          | Insert "select task instance" first wizard step                                                                                                 |
| `src/commands/config.ts`         | Insert task-instance edit option                                                                                                                |
| `src/commands/set.ts`            | Validate against `getConfigKeysForContext(contextId)`                                                                                           |
| `src/commands/user.ts`           | Use `isAdmin(userId, platformInstanceId)` instead of `ADMIN_USER_ID === userId`                                                                 |
| `src/commands/plugin.ts`         | Require super-admin for `approve` / `reject`; keep enable/disable on per-context admin                                                          |
| `src/users.ts`                   | Authorization now keyed by `(platformUserId, platformInstanceId)`                                                                               |
| `src/plugins/registry.ts`        | `evaluateCompatibility` uses union of capabilities across active task instances; `getPluginContextEligibility` adds `capability_missing` reason |
| `src/plugins/contributions.ts`   | Plugin scheduled-job dispatch resolves per-context provider; null skips with warning                                                            |
| `client/admin/src/App.tsx`       | Add `/admin#instances` route                                                                                                                    |
| `CLAUDE.md`                      | Mention `INSTANCE_CONFIG_KEY` env var; update Required Environment Variables section                                                            |

---

## Conventions baked into every task

- Use `bun test path/to/file.test.ts --bail` for the targeted run. Expected outputs assume the curated `bun test` suite.
- Every Bash code block runs from repo root unless otherwise stated.
- Every commit message follows existing repo style: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. No trailers, no body unless the message spans multiple changes.
- All new files start with the existing BUSL-1.1 SPDX header used elsewhere in the repo:
  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.
  ```
- DI: every new module exports a pure-function or class with mockable dependencies — no `mock.module()` in new tests. Look at `src/usage/` and `src/stats/` for the established DI shape.

---

## Phase 1 — Schema, encryption, bootstrap

### Task 1.1: Migration 040 — instance and admin tables

**Files:**

- Create: `src/db/migrations/040_platform_instances.ts`
- Modify: `src/db/index.ts` (registration only)
- Test: `tests/db/migrations/040_platform_instances.test.ts`

- [ ] **Step 1: Write the failing migration test**

```ts
// tests/db/migrations/040_platform_instances.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { migration040PlatformInstances } from '../../../src/db/migrations/040_platform_instances.js'

describe('migration 040 platform instances', () => {
  let db: Database
  beforeEach(() => {
    db = new Database(':memory:')
  })

  it('creates platform_instances table with required columns', () => {
    migration040PlatformInstances.up(db)
    const cols = db.query("PRAGMA table_info('platform_instances')").all() as Array<{
      name: string
    }>
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual(['config', 'created_at', 'id', 'status', 'type'])
  })

  it('creates task_instances table with required columns', () => {
    migration040PlatformInstances.up(db)
    const cols = db.query("PRAGMA table_info('task_instances')").all() as Array<{ name: string }>
    expect(cols.map((c) => c.name).sort()).toEqual(['config', 'created_at', 'id', 'status', 'type'])
  })

  it('creates context_settings table with required columns and PK on context_id', () => {
    migration040PlatformInstances.up(db)
    const cols = db.query("PRAGMA table_info('context_settings')").all() as Array<{
      name: string
      pk: number
    }>
    expect(cols.map((c) => c.name).sort()).toEqual(['context_id', 'platform_instance_id', 'task_instance_id'])
    expect(cols.find((c) => c.name === 'context_id')?.pk).toBe(1)
  })

  it('creates admins table with composite PK', () => {
    migration040PlatformInstances.up(db)
    const cols = db.query("PRAGMA table_info('admins')").all() as Array<{
      name: string
      pk: number
    }>
    const pkCols = cols
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .sort()
    expect(pkCols).toEqual(['platform_instance_id', 'user_id'])
  })

  it('adds platform_instance_id column to users table when users table exists', () => {
    db.run('CREATE TABLE users (platform_user_id TEXT PRIMARY KEY, username TEXT)')
    migration040PlatformInstances.up(db)
    const cols = db.query("PRAGMA table_info('users')").all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toContain('platform_instance_id')
  })

  it('is idempotent', () => {
    migration040PlatformInstances.up(db)
    expect(() => migration040PlatformInstances.up(db)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
bun test tests/db/migrations/040_platform_instances.test.ts --bail
```

Expected: FAIL — `Cannot find module ../../../src/db/migrations/040_platform_instances.js`.

- [ ] **Step 3: Write the migration**

```ts
// src/db/migrations/040_platform_instances.ts
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
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function createTaskInstancesTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS task_instances (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function createContextSettingsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS context_settings (
      context_id TEXT PRIMARY KEY,
      task_instance_id TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_context_settings_task ON context_settings (task_instance_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_context_settings_platform ON context_settings (platform_instance_id)')
}

function createAdminsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      user_id TEXT NOT NULL,
      platform_instance_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, platform_instance_id)
    )
  `)
}

function addPlatformInstanceIdToUsers(db: Database): void {
  const cols = db.query("PRAGMA table_info('users')").all() as Array<{ name: string }>
  if (cols.length === 0) return
  if (cols.some((c) => c.name === 'platform_instance_id')) return
  db.run('ALTER TABLE users ADD COLUMN platform_instance_id TEXT')
}

const up = (db: Database): void => {
  createPlatformInstancesTable(db)
  createTaskInstancesTable(db)
  createContextSettingsTable(db)
  createAdminsTable(db)
  addPlatformInstanceIdToUsers(db)
  log.info('migration 040: instance/admin tables created')
}

export const migration040PlatformInstances: Migration = {
  id: '040_platform_instances',
  up,
}

export default migration040PlatformInstances
```

- [ ] **Step 4: Register the migration in `src/db/index.ts`**

```ts
// after the existing migration039 import:
import { migration040PlatformInstances } from './migrations/040_platform_instances.js'

// in MIGRATIONS array, append after migration039Plugins:
//   migration039Plugins,
//   migration040PlatformInstances,
```

- [ ] **Step 5: Run the test, expect PASS**

```bash
bun test tests/db/migrations/040_platform_instances.test.ts --bail
```

Expected: 6 tests pass.

- [ ] **Step 6: Run the broader DB suite, confirm no regressions**

```bash
bun test tests/db --bail
```

Expected: all DB tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/040_platform_instances.ts src/db/index.ts tests/db/migrations/040_platform_instances.test.ts
git commit -m "feat(db): add migration 040 for platform/task/context/admin tables"
```

---

### Task 1.2: Drizzle schema + row types for instance tables

**Files:**

- Create: `src/db/instance-schema.ts`
- Modify: `src/db/schema.ts` (re-export)
- Create: `src/instances/types.ts`
- Test: `tests/db/instance-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
// tests/db/instance-schema.test.ts
import { describe, it, expect } from 'bun:test'
import { platformInstances, taskInstances, contextSettings, admins } from '../../src/db/instance-schema.js'

describe('instance Drizzle schema', () => {
  it('exposes platform_instances table object', () => {
    expect(platformInstances).toBeDefined()
  })
  it('exposes task_instances table object', () => {
    expect(taskInstances).toBeDefined()
  })
  it('exposes context_settings table object', () => {
    expect(contextSettings).toBeDefined()
  })
  it('exposes admins table object', () => {
    expect(admins).toBeDefined()
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/db/instance-schema.test.ts --bail
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/db/instance-schema.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'
import { sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core'

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
    index('idx_context_settings_task').on(table.taskInstanceId),
    index('idx_context_settings_platform').on(table.platformInstanceId),
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

```ts
// add at the bottom, alongside the existing re-exports:
export {
  platformInstances,
  taskInstances,
  contextSettings,
  admins,
  type PlatformInstanceRow,
  type TaskInstanceRow,
  type ContextSettingsRow,
  type AdminRow,
} from './instance-schema.js'
```

- [ ] **Step 5: Create `src/instances/types.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type InstanceStatus = 'pending' | 'active' | 'stopped'

export type PlatformInstance = {
  id: string
  type: 'telegram' | 'mattermost' | 'discord'
  config: Record<string, string>
  status: InstanceStatus
  createdAt: string
}

export type TaskInstance = {
  id: string
  type: 'kaneo' | 'youtrack'
  config: Record<string, string>
  status: InstanceStatus
  createdAt: string
}

export type ContextAssignment = {
  contextId: string
  taskInstanceId: string
  platformInstanceId: string
}
```

- [ ] **Step 6: Run tests, expect PASS**

```bash
bun test tests/db/instance-schema.test.ts --bail
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/instance-schema.ts src/db/schema.ts src/instances/types.ts tests/db/instance-schema.test.ts
git commit -m "feat(db): add Drizzle schema for instance tables"
```

---

### Task 1.3: Encryption helper for instance configs

**Files:**

- Create: `src/instances/encryption.ts`
- Test: `tests/instances/encryption.test.ts`

- [ ] **Step 1: Write the failing encryption test**

```ts
// tests/instances/encryption.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { encryptInstanceConfig, decryptInstanceConfig, isDerivedKeyMode } from '../../src/instances/encryption.js'

describe('instance config encryption', () => {
  const originalKey = process.env['INSTANCE_CONFIG_KEY']
  beforeEach(() => {
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64) // 32 bytes hex
  })
  afterEach(() => {
    if (originalKey === undefined) delete process.env['INSTANCE_CONFIG_KEY']
    else process.env['INSTANCE_CONFIG_KEY'] = originalKey
  })

  it('round-trips a config map', () => {
    const ct = encryptInstanceConfig({ apiKey: 'secret', baseUrl: 'https://x' })
    const pt = decryptInstanceConfig(ct)
    expect(pt).toEqual({ apiKey: 'secret', baseUrl: 'https://x' })
  })

  it('emits non-deterministic ciphertexts for the same plaintext (IV is random)', () => {
    const ct1 = encryptInstanceConfig({ a: '1' })
    const ct2 = encryptInstanceConfig({ a: '1' })
    expect(ct1).not.toBe(ct2)
  })

  it('throws on tamper (modified ciphertext)', () => {
    const ct = encryptInstanceConfig({ a: '1' })
    const tampered = ct.slice(0, -2) + (ct.endsWith('=') ? 'AA' : 'A=')
    expect(() => decryptInstanceConfig(tampered)).toThrow()
  })

  it('falls back to a derived key when INSTANCE_CONFIG_KEY is unset and reports derived mode', () => {
    delete process.env['INSTANCE_CONFIG_KEY']
    expect(isDerivedKeyMode()).toBe(true)
    const ct = encryptInstanceConfig({ a: '1' })
    expect(decryptInstanceConfig(ct)).toEqual({ a: '1' })
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/instances/encryption.test.ts --bail
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/instances/encryption.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'instances:encryption' })
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

let warnedAboutFallback = false

function resolveKey(): { key: Buffer; derived: boolean } {
  const envKey = process.env['INSTANCE_CONFIG_KEY']
  if (envKey !== undefined && envKey !== '') {
    const hex = envKey.length === 64 ? envKey : createHash('sha256').update(envKey).digest('hex')
    return { key: Buffer.from(hex, 'hex'), derived: false }
  }
  if (!warnedAboutFallback) {
    log.warn('INSTANCE_CONFIG_KEY not set — using derived host-local key. Set INSTANCE_CONFIG_KEY in production.')
    warnedAboutFallback = true
  }
  const derived = createHash('sha256').update('papai:instance-config:fallback').digest()
  return { key: derived, derived: true }
}

export function isDerivedKeyMode(): boolean {
  return resolveKey().derived
}

export function encryptInstanceConfig(plain: Record<string, string>): string {
  const { key } = resolveKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const json = JSON.stringify(plain)
  const enc = Buffer.concat([cipher.update(Buffer.from(json, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptInstanceConfig(payload: string): Record<string, string> {
  const { key } = resolveKey()
  const raw = Buffer.from(payload, 'base64')
  if (raw.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('Encrypted payload too short')
  }
  const iv = raw.subarray(0, IV_BYTES)
  const tag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES)
  const data = raw.subarray(IV_BYTES + AUTH_TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(data), decipher.final()])
  const parsed = JSON.parse(dec.toString('utf8')) as unknown
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Decrypted payload is not an object')
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') throw new Error(`Decrypted config value at ${k} is not a string`)
    out[k] = v
  }
  return out
}

export function maskConfig(plain: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(plain)) {
    if (/token|key|secret|password|cookie/iu.test(k)) {
      out[k] = v.length <= 4 ? '****' : `****${v.slice(-4)}`
    } else {
      out[k] = v
    }
  }
  return out
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/instances/encryption.test.ts --bail
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/instances/encryption.ts tests/instances/encryption.test.ts
git commit -m "feat(instances): add AES-256-GCM encryption for instance configs"
```

---

### Task 1.4: Platform / task / context / admin stores

**Files:**

- Create: `src/instances/platform-store.ts`
- Create: `src/instances/task-store.ts`
- Create: `src/instances/context-store.ts`
- Create: `src/instances/admin-store.ts`
- Test: `tests/instances/platform-store.test.ts`, `tests/instances/task-store.test.ts`, `tests/instances/context-store.test.ts`, `tests/instances/admin-store.test.ts`

- [ ] **Step 1: Write the failing platform-store test**

```ts
// tests/instances/platform-store.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import {
  insertPlatformInstance,
  listPlatformInstances,
  listActivePlatformInstances,
  updatePlatformInstanceStatus,
  deletePlatformInstance,
  getPlatformInstance,
} from '../../src/instances/platform-store.js'
import { resetMemoryDb } from '../utils/db-test-helpers.js'

describe('platform store', () => {
  beforeEach(() => {
    resetMemoryDb()
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  })

  it('inserts and reads a platform instance', () => {
    insertPlatformInstance({
      id: 'tg-prod',
      type: 'telegram',
      config: { token: 'abc123' },
      status: 'pending',
    })
    const row = getPlatformInstance('tg-prod')
    expect(row?.type).toBe('telegram')
    expect(row?.config.token).toBe('abc123')
  })

  it('lists only active instances', () => {
    insertPlatformInstance({ id: 'a', type: 'telegram', config: { token: 'x' }, status: 'active' })
    insertPlatformInstance({
      id: 'b',
      type: 'telegram',
      config: { token: 'y' },
      status: 'stopped',
    })
    const active = listActivePlatformInstances()
    expect(active.map((r) => r.id)).toEqual(['a'])
  })

  it('updates status', () => {
    insertPlatformInstance({
      id: 'a',
      type: 'telegram',
      config: { token: 'x' },
      status: 'pending',
    })
    updatePlatformInstanceStatus('a', 'active')
    expect(getPlatformInstance('a')?.status).toBe('active')
  })

  it('deletes', () => {
    insertPlatformInstance({
      id: 'a',
      type: 'telegram',
      config: { token: 'x' },
      status: 'pending',
    })
    deletePlatformInstance('a')
    expect(getPlatformInstance('a')).toBeUndefined()
  })
})
```

(Repeat the same shape for `task-store.test.ts`, `context-store.test.ts`, `admin-store.test.ts`. Inline them now — DRY does not apply across test files in this codebase. Test names follow the existing pattern from `tests/usage/llm-usage-store.test.ts`.)

```ts
// tests/instances/task-store.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import {
  insertTaskInstance,
  getTaskInstance,
  listTaskInstances,
  updateTaskInstanceStatus,
  deleteTaskInstance,
} from '../../src/instances/task-store.js'
import { resetMemoryDb } from '../utils/db-test-helpers.js'

describe('task store', () => {
  beforeEach(() => {
    resetMemoryDb()
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  })

  it('inserts and reads', () => {
    insertTaskInstance({
      id: 'k1',
      type: 'kaneo',
      config: { baseUrl: 'https://k' },
      status: 'active',
    })
    expect(getTaskInstance('k1')?.config.baseUrl).toBe('https://k')
  })

  it('lists', () => {
    insertTaskInstance({
      id: 'k1',
      type: 'kaneo',
      config: { baseUrl: 'https://k' },
      status: 'active',
    })
    insertTaskInstance({
      id: 'y1',
      type: 'youtrack',
      config: { baseUrl: 'https://y' },
      status: 'active',
    })
    expect(
      listTaskInstances()
        .map((r) => r.id)
        .sort(),
    ).toEqual(['k1', 'y1'])
  })

  it('updates status', () => {
    insertTaskInstance({
      id: 'k1',
      type: 'kaneo',
      config: { baseUrl: 'https://k' },
      status: 'pending',
    })
    updateTaskInstanceStatus('k1', 'active')
    expect(getTaskInstance('k1')?.status).toBe('active')
  })

  it('deletes', () => {
    insertTaskInstance({
      id: 'k1',
      type: 'kaneo',
      config: { baseUrl: 'https://k' },
      status: 'active',
    })
    deleteTaskInstance('k1')
    expect(getTaskInstance('k1')).toBeUndefined()
  })
})
```

```ts
// tests/instances/context-store.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import {
  assignContext,
  getContextAssignment,
  unassignContext,
  listContextsForTaskInstance,
} from '../../src/instances/context-store.js'
import { resetMemoryDb } from '../utils/db-test-helpers.js'

describe('context store', () => {
  beforeEach(() => resetMemoryDb())

  it('assigns and reads', () => {
    assignContext({ contextId: 'u-1', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
    expect(getContextAssignment('u-1')).toEqual({
      contextId: 'u-1',
      taskInstanceId: 'k1',
      platformInstanceId: 'tg-prod',
    })
  })

  it('returns undefined for unknown contextId', () => {
    expect(getContextAssignment('nope')).toBeUndefined()
  })

  it('unassigns', () => {
    assignContext({ contextId: 'u-1', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
    unassignContext('u-1')
    expect(getContextAssignment('u-1')).toBeUndefined()
  })

  it('lists contexts assigned to a task instance', () => {
    assignContext({ contextId: 'u-1', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
    assignContext({ contextId: 'u-2', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
    assignContext({ contextId: 'u-3', taskInstanceId: 'y1', platformInstanceId: 'tg-prod' })
    expect(listContextsForTaskInstance('k1').sort()).toEqual(['u-1', 'u-2'])
  })
})
```

```ts
// tests/instances/admin-store.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import {
  insertAdmin,
  removeAdmin,
  isSuperAdmin,
  isPlatformAdmin,
  isAdmin,
  listSuperAdmins,
  listPlatformAdmins,
} from '../../src/instances/admin-store.js'
import { resetMemoryDb } from '../utils/db-test-helpers.js'

describe('admin store', () => {
  beforeEach(() => resetMemoryDb())

  it('marks a super-admin', () => {
    insertAdmin('u-1', '__super__')
    expect(isSuperAdmin('u-1')).toBe(true)
    expect(isPlatformAdmin('u-1', 'tg-prod')).toBe(false)
  })

  it('marks a platform admin', () => {
    insertAdmin('u-2', 'tg-prod')
    expect(isPlatformAdmin('u-2', 'tg-prod')).toBe(true)
    expect(isPlatformAdmin('u-2', 'tg-staging')).toBe(false)
    expect(isSuperAdmin('u-2')).toBe(false)
  })

  it('isAdmin returns true for super-admins on any platform', () => {
    insertAdmin('u-3', '__super__')
    expect(isAdmin('u-3', 'tg-prod')).toBe(true)
    expect(isAdmin('u-3', 'tg-staging')).toBe(true)
  })

  it('lists super-admins and platform admins separately', () => {
    insertAdmin('u-1', '__super__')
    insertAdmin('u-2', 'tg-prod')
    insertAdmin('u-3', 'tg-prod')
    expect(listSuperAdmins()).toEqual(['u-1'])
    expect(listPlatformAdmins('tg-prod').sort()).toEqual(['u-2', 'u-3'])
  })

  it('removes', () => {
    insertAdmin('u-1', '__super__')
    removeAdmin('u-1', '__super__')
    expect(isSuperAdmin('u-1')).toBe(false)
  })
})
```

- [ ] **Step 2: Add `resetMemoryDb` helper if missing**

```ts
// tests/utils/db-test-helpers.ts
import { resetDrizzleDb } from '../../src/db/drizzle.js'
import { runAllMigrations } from '../../src/db/index.js'

export function resetMemoryDb(): void {
  resetDrizzleDb(':memory:')
  runAllMigrations()
}
```

(If `resetDrizzleDb` / `runAllMigrations` are not already exported, expose them from `src/db/drizzle.ts` and `src/db/index.ts` in this same task — both are already used by other tests.)

- [ ] **Step 3: Run all four tests, expect failure**

```bash
bun test tests/instances --bail
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `src/instances/platform-store.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { platformInstances, type PlatformInstanceRow } from '../db/schema.js'
import { logger } from '../logger.js'
import { decryptInstanceConfig, encryptInstanceConfig } from './encryption.js'
import type { InstanceStatus, PlatformInstance } from './types.js'

const log = logger.child({ scope: 'instances:platform-store' })

function rowToInstance(row: PlatformInstanceRow): PlatformInstance {
  return {
    id: row.id,
    type: row.type as PlatformInstance['type'],
    config: decryptInstanceConfig(row.config),
    status: row.status as InstanceStatus,
    createdAt: row.createdAt,
  }
}

export function insertPlatformInstance(instance: Omit<PlatformInstance, 'createdAt'>): void {
  const db = getDrizzleDb()
  db.insert(platformInstances)
    .values({
      id: instance.id,
      type: instance.type,
      config: encryptInstanceConfig(instance.config),
      status: instance.status,
    })
    .run()
  log.info({ id: instance.id, type: instance.type }, 'Platform instance inserted')
}

export function getPlatformInstance(id: string): PlatformInstance | undefined {
  const db = getDrizzleDb()
  const row = db.select().from(platformInstances).where(eq(platformInstances.id, id)).get()
  return row === undefined ? undefined : rowToInstance(row)
}

export function listPlatformInstances(): PlatformInstance[] {
  return getDrizzleDb().select().from(platformInstances).all().map(rowToInstance)
}

export function listActivePlatformInstances(): PlatformInstance[] {
  const db = getDrizzleDb()
  return db.select().from(platformInstances).where(eq(platformInstances.status, 'active')).all().map(rowToInstance)
}

export function updatePlatformInstanceStatus(id: string, status: InstanceStatus): void {
  getDrizzleDb().update(platformInstances).set({ status }).where(eq(platformInstances.id, id)).run()
}

export function deletePlatformInstance(id: string): void {
  getDrizzleDb().delete(platformInstances).where(eq(platformInstances.id, id)).run()
}
```

- [ ] **Step 5: Implement `src/instances/task-store.ts` (parallel shape to platform-store)**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { taskInstances, type TaskInstanceRow } from '../db/schema.js'
import { logger } from '../logger.js'
import { decryptInstanceConfig, encryptInstanceConfig } from './encryption.js'
import type { InstanceStatus, TaskInstance } from './types.js'

const log = logger.child({ scope: 'instances:task-store' })

function rowToInstance(row: TaskInstanceRow): TaskInstance {
  return {
    id: row.id,
    type: row.type as TaskInstance['type'],
    config: decryptInstanceConfig(row.config),
    status: row.status as InstanceStatus,
    createdAt: row.createdAt,
  }
}

export function insertTaskInstance(instance: Omit<TaskInstance, 'createdAt'>): void {
  getDrizzleDb()
    .insert(taskInstances)
    .values({
      id: instance.id,
      type: instance.type,
      config: encryptInstanceConfig(instance.config),
      status: instance.status,
    })
    .run()
  log.info({ id: instance.id, type: instance.type }, 'Task instance inserted')
}

export function getTaskInstance(id: string): TaskInstance | undefined {
  const row = getDrizzleDb().select().from(taskInstances).where(eq(taskInstances.id, id)).get()
  return row === undefined ? undefined : rowToInstance(row)
}

export function listTaskInstances(): TaskInstance[] {
  return getDrizzleDb().select().from(taskInstances).all().map(rowToInstance)
}

export function updateTaskInstanceStatus(id: string, status: InstanceStatus): void {
  getDrizzleDb().update(taskInstances).set({ status }).where(eq(taskInstances.id, id)).run()
}

export function deleteTaskInstance(id: string): void {
  getDrizzleDb().delete(taskInstances).where(eq(taskInstances.id, id)).run()
}
```

- [ ] **Step 6: Implement `src/instances/context-store.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { contextSettings } from '../db/schema.js'
import type { ContextAssignment } from './types.js'

export function assignContext(assignment: ContextAssignment): void {
  const db = getDrizzleDb()
  db.insert(contextSettings)
    .values(assignment)
    .onConflictDoUpdate({
      target: contextSettings.contextId,
      set: {
        taskInstanceId: assignment.taskInstanceId,
        platformInstanceId: assignment.platformInstanceId,
      },
    })
    .run()
}

export function getContextAssignment(contextId: string): ContextAssignment | undefined {
  const row = getDrizzleDb().select().from(contextSettings).where(eq(contextSettings.contextId, contextId)).get()
  return row === undefined
    ? undefined
    : {
        contextId: row.contextId,
        taskInstanceId: row.taskInstanceId,
        platformInstanceId: row.platformInstanceId,
      }
}

export function unassignContext(contextId: string): void {
  getDrizzleDb().delete(contextSettings).where(eq(contextSettings.contextId, contextId)).run()
}

export function listContextsForTaskInstance(taskInstanceId: string): string[] {
  return getDrizzleDb()
    .select({ id: contextSettings.contextId })
    .from(contextSettings)
    .where(eq(contextSettings.taskInstanceId, taskInstanceId))
    .all()
    .map((r) => r.id)
}

export function listContextsForPlatformInstance(platformInstanceId: string): string[] {
  return getDrizzleDb()
    .select({ id: contextSettings.contextId })
    .from(contextSettings)
    .where(eq(contextSettings.platformInstanceId, platformInstanceId))
    .all()
    .map((r) => r.id)
}
```

- [ ] **Step 7: Implement `src/instances/admin-store.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { admins } from '../db/schema.js'

export const SUPER_ADMIN_SCOPE = '__super__'

export function insertAdmin(userId: string, platformInstanceId: string): void {
  getDrizzleDb().insert(admins).values({ userId, platformInstanceId }).onConflictDoNothing().run()
}

export function removeAdmin(userId: string, platformInstanceId: string): void {
  getDrizzleDb()
    .delete(admins)
    .where(and(eq(admins.userId, userId), eq(admins.platformInstanceId, platformInstanceId)))
    .run()
}

export function isSuperAdmin(userId: string): boolean {
  return (
    getDrizzleDb()
      .select({ userId: admins.userId })
      .from(admins)
      .where(and(eq(admins.userId, userId), eq(admins.platformInstanceId, SUPER_ADMIN_SCOPE)))
      .get() !== undefined
  )
}

export function isPlatformAdmin(userId: string, platformInstanceId: string): boolean {
  return (
    getDrizzleDb()
      .select({ userId: admins.userId })
      .from(admins)
      .where(and(eq(admins.userId, userId), eq(admins.platformInstanceId, platformInstanceId)))
      .get() !== undefined
  )
}

export function isAdmin(userId: string, platformInstanceId: string): boolean {
  return isSuperAdmin(userId) || isPlatformAdmin(userId, platformInstanceId)
}

export function listSuperAdmins(): string[] {
  return getDrizzleDb()
    .select({ userId: admins.userId })
    .from(admins)
    .where(eq(admins.platformInstanceId, SUPER_ADMIN_SCOPE))
    .all()
    .map((r) => r.userId)
}

export function listPlatformAdmins(platformInstanceId: string): string[] {
  return getDrizzleDb()
    .select({ userId: admins.userId })
    .from(admins)
    .where(eq(admins.platformInstanceId, platformInstanceId))
    .all()
    .map((r) => r.userId)
    .filter((id) => id !== '') // defensive
}
```

- [ ] **Step 8: Run all instance tests, expect PASS**

```bash
bun test tests/instances --bail
```

Expected: 18 tests pass across the four files.

- [ ] **Step 9: Commit**

```bash
git add src/instances tests/instances tests/utils/db-test-helpers.ts
git commit -m "feat(instances): add platform/task/context/admin stores"
```

---

### Task 1.5: Bootstrap from environment on first run

**Files:**

- Create: `src/instances/bootstrap.ts`
- Test: `tests/instances/bootstrap.test.ts`

- [ ] **Step 1: Write the failing bootstrap test**

```ts
// tests/instances/bootstrap.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { bootstrapInstancesFromEnv } from '../../src/instances/bootstrap.js'
import { listPlatformInstances } from '../../src/instances/platform-store.js'
import { listTaskInstances } from '../../src/instances/task-store.js'
import { listSuperAdmins, listPlatformAdmins } from '../../src/instances/admin-store.js'
import { resetMemoryDb } from '../utils/db-test-helpers.js'

const KEYS = [
  'INSTANCE_CONFIG_KEY',
  'CHAT_PROVIDER',
  'TASK_PROVIDER',
  'ADMIN_USER_ID',
  'TELEGRAM_BOT_TOKEN',
  'MATTERMOST_URL',
  'MATTERMOST_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'KANEO_CLIENT_URL',
  'YOUTRACK_URL',
] as const

describe('bootstrap from env', () => {
  const snapshot = new Map<string, string | undefined>()
  beforeEach(() => {
    resetMemoryDb()
    for (const k of KEYS) snapshot.set(k, process.env[k])
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  })
  afterEach(() => {
    for (const [k, v] of snapshot.entries()) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('creates a telegram platform instance, kaneo task instance, and admin entries from env', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TELEGRAM_BOT_TOKEN'] = 'token-abc'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'
    process.env['ADMIN_USER_ID'] = 'admin-1'

    const result = bootstrapInstancesFromEnv()
    expect(result.bootstrapped).toBe(true)

    const platforms = listPlatformInstances()
    expect(platforms).toHaveLength(1)
    expect(platforms[0]?.type).toBe('telegram')
    expect(platforms[0]?.status).toBe('active')

    const tasks = listTaskInstances()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.type).toBe('kaneo')

    expect(listSuperAdmins()).toEqual(['admin-1'])
    expect(listPlatformAdmins(platforms[0]!.id)).toEqual(['admin-1'])
  })

  it('is idempotent — second invocation does not create more rows', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TELEGRAM_BOT_TOKEN'] = 'token-abc'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'
    process.env['ADMIN_USER_ID'] = 'admin-1'

    bootstrapInstancesFromEnv()
    const result = bootstrapInstancesFromEnv()
    expect(result.bootstrapped).toBe(false)
    expect(listPlatformInstances()).toHaveLength(1)
  })

  it('reports skipped=true with no rows when env vars are absent', () => {
    delete process.env['CHAT_PROVIDER']
    delete process.env['TASK_PROVIDER']
    delete process.env['ADMIN_USER_ID']

    const result = bootstrapInstancesFromEnv()
    expect(result.bootstrapped).toBe(false)
    expect(result.reason).toBe('no-env')
    expect(listPlatformInstances()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/instances/bootstrap.test.ts --bail
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/instances/bootstrap.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { insertAdmin, SUPER_ADMIN_SCOPE } from './admin-store.js'
import { insertPlatformInstance, listPlatformInstances } from './platform-store.js'
import { insertTaskInstance, listTaskInstances } from './task-store.js'

const log = logger.child({ scope: 'instances:bootstrap' })

export type BootstrapResult =
  | { bootstrapped: true; platformInstanceId: string; taskInstanceId: string }
  | {
      bootstrapped: false
      reason: 'already-bootstrapped' | 'no-env' | 'partial-env'
      missing?: readonly string[]
    }

function readPlatformConfig(type: string): {
  config: Record<string, string>
  missing: readonly string[]
} {
  const required: Record<string, readonly string[]> = {
    telegram: ['TELEGRAM_BOT_TOKEN'],
    mattermost: ['MATTERMOST_URL', 'MATTERMOST_BOT_TOKEN'],
    discord: ['DISCORD_BOT_TOKEN'],
  }
  const keys = required[type] ?? []
  const config: Record<string, string> = {}
  const missing: string[] = []
  for (const k of keys) {
    const v = process.env[k]
    if (v === undefined || v === '') {
      missing.push(k)
      continue
    }
    config[k] = v
  }
  return { config, missing }
}

function readTaskConfig(type: string): {
  config: Record<string, string>
  missing: readonly string[]
} {
  const required: Record<string, readonly string[]> = {
    kaneo: ['KANEO_CLIENT_URL'],
    youtrack: ['YOUTRACK_URL'],
  }
  const keys = required[type] ?? []
  const config: Record<string, string> = {}
  const missing: string[] = []
  for (const k of keys) {
    const v = process.env[k]
    if (v === undefined || v === '') {
      missing.push(k)
      continue
    }
    config[k] = v
  }
  return { config, missing }
}

export function bootstrapInstancesFromEnv(): BootstrapResult {
  if (listPlatformInstances().length > 0 || listTaskInstances().length > 0) {
    log.info('Instances present in DB — env vars ignored')
    return { bootstrapped: false, reason: 'already-bootstrapped' }
  }

  const chatType = process.env['CHAT_PROVIDER']
  const taskType = process.env['TASK_PROVIDER']
  const adminUserId = process.env['ADMIN_USER_ID']
  if (chatType === undefined || taskType === undefined || adminUserId === undefined) {
    log.warn('CHAT_PROVIDER, TASK_PROVIDER, or ADMIN_USER_ID missing — skipping bootstrap')
    return { bootstrapped: false, reason: 'no-env' }
  }

  const platform = readPlatformConfig(chatType)
  const task = readTaskConfig(taskType)
  const missing = [...platform.missing, ...task.missing]
  if (missing.length > 0) {
    log.warn({ missing }, 'Bootstrap aborted: provider env vars incomplete')
    return { bootstrapped: false, reason: 'partial-env', missing }
  }

  const platformId = `${chatType}-default`
  const taskId = `${taskType}-default`

  insertPlatformInstance({
    id: platformId,
    type: chatType as 'telegram' | 'mattermost' | 'discord',
    config: platform.config,
    status: 'active',
  })
  insertTaskInstance({
    id: taskId,
    type: taskType as 'kaneo' | 'youtrack',
    config: task.config,
    status: 'active',
  })
  insertAdmin(adminUserId, SUPER_ADMIN_SCOPE)
  insertAdmin(adminUserId, platformId)

  log.info(
    { platformId, taskId, adminUserId },
    'Bootstrapped from environment variables. DB is now the source of truth.',
  )
  return { bootstrapped: true, platformInstanceId: platformId, taskInstanceId: taskId }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/instances/bootstrap.test.ts --bail
```

Expected: 3 tests pass.

- [ ] **Step 5: Run the whole instance suite to be sure nothing regressed**

```bash
bun test tests/instances --bail
```

Expected: 21 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/instances/bootstrap.ts tests/instances/bootstrap.test.ts
git commit -m "feat(instances): bootstrap from env vars exactly once"
```

---

### Task 1.6: Document `INSTANCE_CONFIG_KEY` in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the existing "Required Environment Variables" section and add a new subsection**

In `CLAUDE.md`, under the existing "Required Environment Variables" section, after the chat-provider/task-provider blocks, append:

```markdown
### Instance Config Encryption

- `INSTANCE_CONFIG_KEY` — 32-byte (64 hex) AES-256-GCM key used to encrypt
  `platform_instances.config` and `task_instances.config`. If unset, a
  derived host-local fallback is used and a startup `WARN` is logged. Set
  this in production.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document INSTANCE_CONFIG_KEY env var"
```

---

## Phase 2 — `TaskProviderResolver` and dynamic config keys

### Task 2.1: `TaskProviderResolver` against the new tables

**Files:**

- Create: `src/providers/resolver.ts`
- Test: `tests/providers/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/providers/resolver.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { TaskProviderResolver } from '../../src/providers/resolver.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { assignContext } from '../../src/instances/context-store.js'
import { setConfig } from '../../src/config.js'
import { resetMemoryDb } from '../utils/db-test-helpers.js'

describe('TaskProviderResolver', () => {
  beforeEach(() => {
    resetMemoryDb()
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
    insertTaskInstance({
      id: 'k1',
      type: 'kaneo',
      config: { baseUrl: 'https://k.example', workspaceId: 'w1' },
      status: 'active',
    })
  })

  it('returns null when context has no assignment', () => {
    const r = new TaskProviderResolver()
    expect(r.resolve('user-no-setup')).toBeNull()
  })

  it('returns null when credentials are missing', () => {
    assignContext({ contextId: 'u-1', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
    const r = new TaskProviderResolver()
    expect(r.resolve('u-1')).toBeNull()
  })

  it('returns a provider when assignment + credentials exist', () => {
    assignContext({ contextId: 'u-1', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
    setConfig('u-1', 'kaneo_apikey', 'key-abc')
    const r = new TaskProviderResolver()
    const provider = r.resolve('u-1')
    expect(provider).not.toBeNull()
    expect(typeof provider?.searchTasks).toBe('function')
  })

  it('resolveStrict throws on missing setup', () => {
    const r = new TaskProviderResolver()
    expect(() => r.resolveStrict('nope')).toThrow(/setup/iu)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/providers/resolver.test.ts --bail
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/providers/resolver.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfig } from '../config.js'
import { getContextAssignment } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import type { TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { createProvider } from './registry.js'
import type { TaskProvider } from './types.js'

const log = logger.child({ scope: 'providers:resolver' })

function mergeCredentials(contextId: string, instance: TaskInstance): Record<string, string> | null {
  if (instance.type === 'kaneo') {
    const apiKey = getConfig(contextId, 'kaneo_apikey')
    if (apiKey === null) return null
    return { ...instance.config, apiKey }
  }
  if (instance.type === 'youtrack') {
    const token = getConfig(contextId, 'youtrack_token')
    if (token === null) return null
    return { ...instance.config, token }
  }
  log.warn({ type: instance.type }, 'Unknown task instance type')
  return null
}

export class TaskProviderResolver {
  resolve(contextId: string): TaskProvider | null {
    const assignment = getContextAssignment(contextId)
    if (assignment === undefined) {
      log.debug({ contextId }, 'No context assignment')
      return null
    }
    const instance = getTaskInstance(assignment.taskInstanceId)
    if (instance === undefined) {
      log.warn({ contextId, taskInstanceId: assignment.taskInstanceId }, 'Assigned task instance no longer exists')
      return null
    }
    const config = mergeCredentials(contextId, instance)
    if (config === null) {
      log.debug({ contextId, taskInstanceId: instance.id }, 'Missing credentials for assigned task instance')
      return null
    }
    return createProvider(instance.type, config)
  }

  resolveStrict(contextId: string): TaskProvider {
    const provider = this.resolve(contextId)
    if (provider === null) {
      throw new Error(`Context ${contextId} needs /setup`)
    }
    return provider
  }
}

export const defaultTaskProviderResolver = new TaskProviderResolver()
```

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/providers/resolver.test.ts --bail
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/resolver.ts tests/providers/resolver.test.ts
git commit -m "feat(providers): add TaskProviderResolver against context_settings"
```

---

### Task 2.2: Replace `buildProviderForUser` in `llm-orchestrator`

**Files:**

- Modify: `src/llm-orchestrator-types.ts`
- Modify: `src/llm-orchestrator.ts`
- Modify: `tests/llm-orchestrator.test.ts` (fixture rename only)

- [ ] **Step 1: Update fixtures and write a regression test**

In `tests/llm-orchestrator.test.ts`, replace every `buildProviderForUser` field on `LlmOrchestratorDeps` fixtures with a `resolve` field that returns the existing mock provider. Run the file to confirm it fails:

```bash
bun test tests/llm-orchestrator.test.ts --bail
```

Expected: FAIL — current code references `buildProviderForUser`.

- [ ] **Step 2: Update `src/llm-orchestrator-types.ts`**

```ts
// Replace the `buildProviderForUser` field
export interface LlmOrchestratorDeps {
  generateText: typeof generateText
  stepCountIs: typeof stepCountIs
  buildOpenAI: (apiKey: string, baseURL: string) => ReturnType<typeof createOpenAICompatible>
  resolve: (contextId: string) => TaskProvider | null
  getKaneoWorkspace: (userId: string) => string | null
  maybeProvisionKaneo: (reply: ReplyFn, contextId: string, username: string | null) => Promise<void>
  stagedDownloadFn?: StagedFileDownloadFn
}
```

- [ ] **Step 3: Update `src/llm-orchestrator.ts`**

Replace:

```ts
import { buildProviderForUser } from './providers/factory.js'
// ...
buildProviderForUser: (userId: string) => buildProviderForUser(userId, true),
// ...
const provider = deps.buildProviderForUser(configId)
```

With:

```ts
import { defaultTaskProviderResolver } from './providers/resolver.js'
// ...
resolve: (contextId: string) => defaultTaskProviderResolver.resolve(contextId),
// ...
const provider = deps.resolve(configId)
if (provider === null) {
  await reply('I need /setup before I can do that.')
  return
}
```

(Use the existing reply mechanism in the same function — find the spot where `provider` is dereferenced, and add the null guard just before it.)

- [ ] **Step 4: Run orchestrator tests, expect PASS**

```bash
bun test tests/llm-orchestrator.test.ts --bail
```

Expected: all orchestrator tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-types.ts src/llm-orchestrator.ts tests/llm-orchestrator.test.ts
git commit -m "refactor(llm): switch orchestrator from buildProviderForUser to resolver"
```

---

### Task 2.3: Replace `buildProviderForUser` in `scheduler` and `deferred-prompts/poller`

**Files:**

- Modify: `src/scheduler.ts`
- Modify: `src/deferred-prompts/poller.ts`
- Modify: `tests/scheduler.test.ts`, `tests/deferred-prompts/poller.test.ts`

- [ ] **Step 1: Update scheduler fixtures**

In `tests/scheduler.test.ts`, replace `buildProviderForUser` test fixtures with a `resolve(contextId)` function. Run:

```bash
bun test tests/scheduler.test.ts --bail
```

Expected: FAIL — `buildProviderForUser` signature mismatch.

- [ ] **Step 2: Rewrite the internal helper in `src/scheduler.ts`**

Find the existing internal `buildProviderForUser(userId, deps)` and replace it with a thin wrapper that calls `deps.resolve(userId)`. Update `SchedulerDeps` accordingly:

```ts
export interface SchedulerDeps {
  resolve: (contextId: string) => TaskProvider | null
  // ... rest unchanged
}
```

- [ ] **Step 3: Run scheduler tests, expect PASS**

```bash
bun test tests/scheduler.test.ts --bail
```

- [ ] **Step 4: Repeat for `deferred-prompts/poller.ts`**

`BuildProviderFn` becomes `(contextId: string) => TaskProvider | null`. Update both the type and every callsite. Update `tests/deferred-prompts/poller.test.ts` fixtures.

```bash
bun test tests/deferred-prompts/poller.test.ts --bail
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts src/deferred-prompts/poller.ts tests/scheduler.test.ts tests/deferred-prompts/poller.test.ts
git commit -m "refactor(scheduler,deferred): switch to resolver signature"
```

---

### Task 2.4: Replace `src/providers/factory.ts` callsites and delete the file

**Files:**

- Delete: `src/providers/factory.ts`
- Modify: `src/index.ts`
- Modify: any remaining importers (grep first)

- [ ] **Step 1: Find every importer**

```bash
grep -rn "from .*providers/factory" src tests
```

- [ ] **Step 2: Replace each importer with the resolver**

For every remaining `buildProviderForUser` callsite (outside the orchestrator/scheduler/poller which are already updated), replace with `defaultTaskProviderResolver.resolve(contextId)` and handle the `null` case explicitly. Example for `src/index.ts:146` and `src/index.ts:159`:

```ts
import { defaultTaskProviderResolver } from './providers/resolver.js'

// ...
startPollers(chatProvider, (contextId) => defaultTaskProviderResolver.resolve(contextId))
// ...
const adminProvider = defaultTaskProviderResolver.resolve(adminUserId)
if (adminProvider === null) {
  log.warn({ adminUserId }, 'Admin has no task assignment; skipping admin warmup')
} else {
  // existing warmup logic, but on adminProvider
}
```

- [ ] **Step 3: Delete `src/providers/factory.ts`**

```bash
git rm src/providers/factory.ts
```

- [ ] **Step 4: Run the full curated suite**

```bash
bun test --bail
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(providers): remove factory.ts in favor of resolver"
```

---

### Task 2.5: Dynamic `getConfigKeysForContext`

**Files:**

- Create: `src/types/config-dynamic.ts`
- Modify: `src/types/config.ts` (remove `CONFIG_KEYS` constant, re-export new function)
- Test: `tests/types/config-dynamic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/types/config-dynamic.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { getConfigKeysForContext } from '../../src/types/config-dynamic.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { assignContext } from '../../src/instances/context-store.js'
import { resetMemoryDb } from '../utils/db-test-helpers.js'

describe('getConfigKeysForContext', () => {
  beforeEach(() => {
    resetMemoryDb()
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  })

  it('returns only preference keys when context has no task assignment', () => {
    expect(getConfigKeysForContext('u-1')).toEqual(['timezone'])
  })

  it('returns kaneo keys when context is assigned to a kaneo instance', () => {
    insertTaskInstance({
      id: 'k1',
      type: 'kaneo',
      config: { baseUrl: 'https://k' },
      status: 'active',
    })
    assignContext({ contextId: 'u-1', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
    expect(getConfigKeysForContext('u-1').sort()).toEqual(['kaneo_apikey', 'timezone'])
  })

  it('returns youtrack keys when context is assigned to a youtrack instance', () => {
    insertTaskInstance({
      id: 'y1',
      type: 'youtrack',
      config: { baseUrl: 'https://y' },
      status: 'active',
    })
    assignContext({ contextId: 'u-2', taskInstanceId: 'y1', platformInstanceId: 'tg-prod' })
    expect(getConfigKeysForContext('u-2').sort()).toEqual(['timezone', 'youtrack_token'])
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/types/config-dynamic.test.ts --bail
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/types/config-dynamic.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextAssignment } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import type { ConfigKey, PreferenceConfigKey } from './config.js'

const PREFERENCE_KEYS: readonly PreferenceConfigKey[] = ['timezone']

export function getConfigKeysForContext(contextId: string): readonly ConfigKey[] {
  const assignment = getContextAssignment(contextId)
  if (assignment === undefined) return PREFERENCE_KEYS
  const instance = getTaskInstance(assignment.taskInstanceId)
  if (instance === undefined) return PREFERENCE_KEYS
  if (instance.type === 'kaneo') return ['kaneo_apikey', ...PREFERENCE_KEYS]
  if (instance.type === 'youtrack') return ['youtrack_token', ...PREFERENCE_KEYS]
  return PREFERENCE_KEYS
}
```

- [ ] **Step 4: Drop the module-level `CONFIG_KEYS` constant in `src/types/config.ts`**

Remove the `getConfigKeysForProvider` helper and the `CONFIG_KEYS` export. Keep `ALL_CONFIG_KEYS`, `isConfigKey`, and the type aliases. Re-export `getConfigKeysForContext` from `./config-dynamic.js`.

- [ ] **Step 5: Find every importer of `CONFIG_KEYS` and replace**

```bash
grep -rn "CONFIG_KEYS\b" src tests --include="*.ts"
```

For each importer that previously used `CONFIG_KEYS` at module-level, pass `contextId` and call `getConfigKeysForContext(contextId)` instead. The most common callers are `src/config.ts` (in the seeding loop) and the `/setup` and `/config` commands — update them in this same task.

- [ ] **Step 6: Run the full suite**

```bash
bun test --bail
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/types tests/types
git commit -m "refactor(config): make config keys per-context dynamic"
```

---

## Phase 3 — `ChatRouter` + `platformInstanceId` plumbing

### Task 3.1: Add `platformInstanceId` to `IncomingMessage` / `IncomingInteraction`

**Files:**

- Modify: `src/chat/types.ts`
- Modify: existing test fixtures (`tests/bot.ts`, `tests/utils/messages.ts` if present)

- [ ] **Step 1: Write a typecheck-only test**

```ts
// tests/chat/incoming-message-shape.test.ts
import { describe, it, expect } from 'bun:test'
import type { IncomingMessage } from '../../src/chat/types.js'

describe('IncomingMessage shape', () => {
  it('requires platformInstanceId', () => {
    const m: IncomingMessage = {
      user: { id: 'u', username: null, isAdmin: false },
      contextId: 'u',
      contextType: 'dm',
      isMentioned: false,
      text: 'hi',
      platformInstanceId: 'tg-prod',
    }
    expect(m.platformInstanceId).toBe('tg-prod')
  })
})
```

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: ERROR — `platformInstanceId` does not exist on `IncomingMessage`.

- [ ] **Step 3: Add the field to `src/chat/types.ts`**

```ts
// In IncomingMessage:
export type IncomingMessage = {
  user: ChatUser
  contextId: string
  contextType: ContextType
  isMentioned: boolean
  text: string
  /** ID of the chat instance this message arrived on. Set by ChatRouter. */
  platformInstanceId: string
} & Partial<{
  /* unchanged optional fields */
}>

// In IncomingInteraction:
export type IncomingInteraction = {
  kind: 'button'
  user: ChatUser
  contextId: string
  contextType: ContextType
  platformInstanceId: string
  /* rest unchanged */
}
```

- [ ] **Step 4: Update all `createDmMessage` / `createGroupMessage` / interaction-test factories to default `platformInstanceId: 'test-instance'`**

```bash
grep -rn "createDmMessage\|createGroupMessage\|createTestInteraction" tests --include="*.ts" -l
```

For each match, set `platformInstanceId: overrides?.platformInstanceId ?? 'test-instance'` in the factory.

- [ ] **Step 5: Run typecheck and full test suite**

```bash
bun typecheck && bun test --bail
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(chat): add platformInstanceId to IncomingMessage/IncomingInteraction"
```

---

### Task 3.2: `ChatRouter` implementation

**Files:**

- Create: `src/chat/router.ts`
- Test: `tests/chat/router.test.ts`

- [ ] **Step 1: Write the failing router tests**

```ts
// tests/chat/router.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { ChatRouter, type ManagedChatInstanceFactory } from '../../src/chat/router.js'
import type { ChatProvider, IncomingMessage } from '../../src/chat/types.js'

function makeFakeProvider(id: string, capture: { commands: string[]; received: IncomingMessage[] }): ChatProvider {
  const handlers: Array<(m: IncomingMessage, r: any) => Promise<void>> = []
  return {
    name: id,
    capabilities: new Set(),
    traits: { observedGroupMessages: 'all' },
    configRequirements: [],
    registerCommand: (name) => {
      capture.commands.push(`${id}:${name}`)
    },
    onMessage: (h) => {
      handlers.push(h)
    },
    sendMessage: mock(async () => {}),
    renderContext: () => ({ headerLines: [], footerLines: [] }) as any,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    __deliver: async (m: IncomingMessage) => {
      for (const h of handlers) await h(m, async () => {})
    },
  } as unknown as ChatProvider
}

describe('ChatRouter', () => {
  let capture: { commands: string[]; received: IncomingMessage[] }
  let factory: ManagedChatInstanceFactory
  beforeEach(() => {
    capture = { commands: [], received: [] }
    factory = (type) => makeFakeProvider(type, capture)
  })

  it('fans out registerCommand to all active instances and replays for instances added later', async () => {
    const router = new ChatRouter(factory)
    router.addInstance('tg-prod', 'telegram', {})
    router.registerCommand('help', async () => {})
    expect(capture.commands).toEqual(['telegram:help'])

    router.addInstance('mm-team', 'mattermost', {})
    // replay
    expect(capture.commands).toEqual(['telegram:help', 'mattermost:help'])
  })

  it('injects platformInstanceId into IncomingMessage before forwarding', async () => {
    const router = new ChatRouter(factory)
    router.addInstance('tg-prod', 'telegram', {})
    router.onMessage(async (m) => {
      capture.received.push(m)
    })
    const inner = router.getInstance('tg-prod') as any
    await inner.provider.__deliver({
      user: { id: 'u', username: null, isAdmin: false },
      contextId: 'u',
      contextType: 'dm',
      isMentioned: false,
      text: 'hello',
    } as IncomingMessage)
    expect(capture.received[0]?.platformInstanceId).toBe('tg-prod')
  })

  it('routes sendMessage to the specified instance', async () => {
    const router = new ChatRouter(factory)
    router.addInstance('tg-prod', 'telegram', {})
    router.addInstance('mm-team', 'mattermost', {})
    await router.sendMessage('tg-prod', { contextId: 'u' } as any, 'hi')
    const tg = router.getInstance('tg-prod') as any
    const mm = router.getInstance('mm-team') as any
    expect(tg.provider.sendMessage).toHaveBeenCalledTimes(1)
    expect(mm.provider.sendMessage).toHaveBeenCalledTimes(0)
  })

  it('isolates a failing instance start from the others', async () => {
    const factoryFail: ManagedChatInstanceFactory = (type) => {
      const p = makeFakeProvider(type, capture)
      if (type === 'mattermost')
        (p.start as any) = mock(async () => {
          throw new Error('boom')
        })
      return p
    }
    const router = new ChatRouter(factoryFail)
    router.addInstance('tg-prod', 'telegram', {})
    router.addInstance('mm-team', 'mattermost', {})
    await router.start()
    expect(router.getInstance('tg-prod')?.status).toBe('active')
    expect(router.getInstance('mm-team')?.status).toBe('stopped')
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/chat/router.test.ts --bail
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/chat/router.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { ChatProvider, CommandHandler, IncomingInteraction, IncomingMessage, ReplyFn } from './types.js'
import type { DeferredDeliveryTarget } from './deferred-target.js'

const log = logger.child({ scope: 'chat:router' })

export type ManagedChatInstance = {
  id: string
  type: string
  provider: ChatProvider
  status: 'pending' | 'active' | 'stopped'
}

export type ManagedChatInstanceFactory = (type: string, config: Record<string, string>) => ChatProvider

export class ChatRouter {
  private readonly instances = new Map<string, ManagedChatInstance>()
  private readonly registeredCommands = new Map<string, CommandHandler>()
  private messageHandler: ((m: IncomingMessage, r: ReplyFn) => Promise<void>) | null = null
  private interactionHandler: ((i: IncomingInteraction, r: ReplyFn) => Promise<void>) | null = null

  constructor(private readonly factory: ManagedChatInstanceFactory) {}

  addInstance(id: string, type: string, config: Record<string, string>): void {
    if (this.instances.has(id)) throw new Error(`Instance ${id} already exists`)
    const provider = this.factory(type, config)
    const instance: ManagedChatInstance = { id, type, provider, status: 'pending' }
    this.instances.set(id, instance)
    this.replayRegistrations(instance)
    log.info({ id, type }, 'Instance added')
  }

  async removeInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) return
    try {
      await instance.provider.stop()
    } catch (err) {
      log.error({ id, err }, 'Error stopping instance during remove')
    }
    this.instances.delete(id)
  }

  async startInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) throw new Error(`Instance ${id} unknown`)
    try {
      await instance.provider.start()
      instance.status = 'active'
    } catch (err) {
      instance.status = 'stopped'
      log.error({ id, err }, 'Instance failed to start')
    }
  }

  async stopInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) return
    await instance.provider.stop()
    instance.status = 'stopped'
  }

  getInstance(id: string): ManagedChatInstance | undefined {
    return this.instances.get(id)
  }

  listInstances(): ManagedChatInstance[] {
    return Array.from(this.instances.values())
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.registeredCommands.set(name, handler)
    for (const instance of this.instances.values()) {
      instance.provider.registerCommand(name, handler)
    }
  }

  onMessage(handler: (m: IncomingMessage, r: ReplyFn) => Promise<void>): void {
    this.messageHandler = handler
    for (const instance of this.instances.values()) {
      this.bindMessageHandler(instance)
    }
  }

  onInteraction(handler: (i: IncomingInteraction, r: ReplyFn) => Promise<void>): void {
    this.interactionHandler = handler
    for (const instance of this.instances.values()) {
      this.bindInteractionHandler(instance)
    }
  }

  async sendMessage(platformInstanceId: string, target: DeferredDeliveryTarget, markdown: string): Promise<void> {
    const instance = this.instances.get(platformInstanceId)
    if (instance === undefined) {
      log.warn({ platformInstanceId }, 'sendMessage to unknown instance')
      return
    }
    await instance.provider.sendMessage(target, markdown)
  }

  async start(): Promise<void> {
    for (const instance of this.instances.values()) {
      await this.startInstance(instance.id)
    }
  }

  async stop(): Promise<void> {
    for (const instance of this.instances.values()) {
      await this.stopInstance(instance.id)
    }
  }

  private replayRegistrations(instance: ManagedChatInstance): void {
    for (const [name, handler] of this.registeredCommands.entries()) {
      instance.provider.registerCommand(name, handler)
    }
    if (this.messageHandler !== null) this.bindMessageHandler(instance)
    if (this.interactionHandler !== null) this.bindInteractionHandler(instance)
  }

  private bindMessageHandler(instance: ManagedChatInstance): void {
    const outer = this.messageHandler
    if (outer === null) return
    instance.provider.onMessage(async (msg, reply) => {
      const tagged: IncomingMessage = { ...msg, platformInstanceId: instance.id }
      await outer(tagged, reply)
    })
  }

  private bindInteractionHandler(instance: ManagedChatInstance): void {
    const outer = this.interactionHandler
    if (outer === null) return
    const provider = instance.provider as ChatProvider & {
      onInteraction?: (h: (i: IncomingInteraction, r: ReplyFn) => Promise<void>) => void
    }
    if (provider.onInteraction === undefined) return
    provider.onInteraction(async (interaction, reply) => {
      const tagged: IncomingInteraction = { ...interaction, platformInstanceId: instance.id }
      await outer(tagged, reply)
    })
  }
}
```

- [ ] **Step 4: Run router test, expect PASS**

```bash
bun test tests/chat/router.test.ts --bail
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/chat/router.ts tests/chat/router.test.ts
git commit -m "feat(chat): add ChatRouter implementing ChatProvider fan-out"
```

---

### Task 3.3: Wire `ChatRouter` into `src/index.ts`

**Files:**

- Modify: `src/index.ts`

- [ ] **Step 1: Replace existing single-provider construction with the router**

Locate the existing `chatProvider = createChatProvider(...)` site. Replace with:

```ts
import { ChatRouter } from './chat/router.js'
import { createChatProvider } from './chat/registry.js'
import { bootstrapInstancesFromEnv } from './instances/bootstrap.js'
import { listActivePlatformInstances } from './instances/platform-store.js'

// after migrations have run:
bootstrapInstancesFromEnv()

const router = new ChatRouter((type, config) => createChatProvider(type, config))
for (const instance of listActivePlatformInstances()) {
  router.addInstance(instance.id, instance.type, instance.config)
}

const chatProvider = router // ChatRouter implements ChatProvider
```

- [ ] **Step 2: Build and start**

```bash
bun typecheck && bun test --bail
```

Expected: green. (If a chat adapter's `createChatProvider` does not accept the new shape, fix that in this same task.)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(chat): start the bot through ChatRouter and bootstrap"
```

---

## Phase 4 — `/setup`, `/config`, `/set` per-context

### Task 4.1: `/setup` wizard gains a task-instance pick step

**Files:**

- Modify: `src/commands/setup.ts`
- Test: `tests/commands/setup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/commands/setup.test.ts (extend the existing file)
it('first prompts the user to pick a task instance when context has no assignment', async () => {
  insertTaskInstance({
    id: 'k1',
    type: 'kaneo',
    config: { baseUrl: 'https://k' },
    status: 'active',
  })
  insertTaskInstance({
    id: 'y1',
    type: 'youtrack',
    config: { baseUrl: 'https://y' },
    status: 'active',
  })

  const reply = mock(async () => {})
  await runSetupWizard(makeDmMessage({ contextId: 'u-1' }), reply)
  const firstCall = reply.mock.calls[0]?.[0] as string
  expect(firstCall).toMatch(/pick.*task tracker/iu)
  expect(firstCall).toMatch(/k1/u)
  expect(firstCall).toMatch(/y1/u)
})

it('after pick, persists the assignment and proceeds to credential prompts', async () => {
  insertTaskInstance({
    id: 'k1',
    type: 'kaneo',
    config: { baseUrl: 'https://k' },
    status: 'active',
  })
  // simulate the pick callback or text input "k1"
  await handleSetupPick(
    makeDmMessage({ contextId: 'u-1', text: 'k1' }),
    mock(async () => {}),
  )
  expect(getContextAssignment('u-1')).toMatchObject({ taskInstanceId: 'k1' })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/commands/setup.test.ts --bail
```

Expected: FAIL — `runSetupWizard` does not yet branch on assignment.

- [ ] **Step 3: Update `src/commands/setup.ts`**

Add an early step at the top of the wizard: if `getContextAssignment(contextId) === undefined`, list active task instances and ask the user to pick. On pick, call `assignContext({ contextId, taskInstanceId, platformInstanceId: msg.platformInstanceId })`. Then resume the existing credential-prompt flow, but using `getConfigKeysForContext(contextId)`.

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/commands/setup.test.ts --bail
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/setup.ts tests/commands/setup.test.ts
git commit -m "feat(setup): add task-instance selection step to /setup wizard"
```

---

### Task 4.2: `/config` shows task-instance entry, `/set` validates per-context

**Files:**

- Modify: `src/commands/config.ts`
- Modify: `src/commands/set.ts`
- Test: extend existing `tests/commands/config.test.ts`, `tests/commands/set.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// in tests/commands/set.test.ts
it('rejects kaneo_apikey on a youtrack-assigned context', async () => {
  insertTaskInstance({
    id: 'y1',
    type: 'youtrack',
    config: { baseUrl: 'https://y' },
    status: 'active',
  })
  assignContext({ contextId: 'u-1', taskInstanceId: 'y1', platformInstanceId: 'tg-prod' })

  const reply = mock(async () => {})
  await runSet(makeDmMessage({ contextId: 'u-1', text: '/set kaneo_apikey foo' }), reply)
  expect((reply.mock.calls[0]?.[0] as string).toLowerCase()).toMatch(/not valid for this context/iu)
})

it('allows plugin-namespaced keys for plugins enabled on the context', async () => {
  // (existing plugin enable harness)
  await runSet(
    makeDmMessage({ contextId: 'u-1', text: '/set plugin.hello-world.greeting_prefix Hey' }),
    mock(async () => {}),
  )
  expect(getConfig('u-1', 'plugin.hello-world.greeting_prefix')).toBe('Hey')
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/commands/set.test.ts --bail
```

- [ ] **Step 3: Update `src/commands/set.ts`**

Replace the existing key validation against the static `CONFIG_KEYS` with:

```ts
import { getConfigKeysForContext } from '../types/config-dynamic.js'
// ...
const validKeys = new Set<string>(getConfigKeysForContext(msg.contextId))
const isPluginKey = key.startsWith('plugin.') // gated by plugin eligibility, but allowed at /set level
if (!validKeys.has(key) && !isPluginKey) {
  await reply(`Config key "${key}" is not valid for this context. Run /config to see allowed keys.`)
  return
}
```

- [ ] **Step 4: Update `src/commands/config.ts`**

Render the assigned task instance ID at the top of the `/config` display, and render the dynamic keys returned by `getConfigKeysForContext(msg.contextId)`. The existing Plugins section (rendered by the plugin system) stays unchanged.

- [ ] **Step 5: Run, expect PASS**

```bash
bun test tests/commands/set.test.ts tests/commands/config.test.ts --bail
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/config.ts src/commands/set.ts tests/commands
git commit -m "feat(commands): make /set and /config context-aware"
```

---

## Phase 5 — Admin model

### Task 5.1: Authorization via `admins` table

**Files:**

- Modify: `src/users.ts`
- Modify: `src/bot.ts` (auth check call sites)
- Modify: `src/commands/user.ts`
- Test: extend `tests/users.test.ts`, add cases to `tests/commands/user.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/users.test.ts
it('isAuthorized(userId, platformInstanceId) returns true for users added on that instance', () => {
  insertAuthorizedUser({ platformUserId: 'u-1', platformInstanceId: 'tg-prod', addedBy: 'admin' })
  expect(isAuthorized('u-1', 'tg-prod')).toBe(true)
  expect(isAuthorized('u-1', 'mm-team')).toBe(false)
})

it('isAuthorized returns true for any super-admin regardless of platform', () => {
  insertAdmin('super-1', '__super__')
  expect(isAuthorized('super-1', 'tg-prod')).toBe(true)
  expect(isAuthorized('super-1', 'mm-team')).toBe(true)
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/users.test.ts --bail
```

- [ ] **Step 3: Update `src/users.ts`**

```ts
import { isSuperAdmin } from './instances/admin-store.js'

export function isAuthorized(userId: string, platformInstanceId: string): boolean {
  if (isSuperAdmin(userId)) return true
  const row = getDrizzleDb()
    .select({ userId: users.platformUserId })
    .from(users)
    .where(and(eq(users.platformUserId, userId), eq(users.platformInstanceId, platformInstanceId)))
    .get()
  return row !== undefined
}
```

(Note: `users.platformInstanceId` column was added in migration 040.)

- [ ] **Step 4: Update all `isAuthorized(userId)` callers in `src/bot.ts` and elsewhere**

```bash
grep -rn "isAuthorized(" src --include="*.ts"
```

Pass `msg.platformInstanceId` at every callsite.

- [ ] **Step 5: Update `/user add` and `/user remove`**

Inside `src/commands/user.ts`, replace the existing string-equality `ADMIN_USER_ID === userId` check with `isAdmin(msg.user.id, msg.platformInstanceId)`. When a platform admin adds a user, insert the new user with `platformInstanceId: msg.platformInstanceId`.

- [ ] **Step 6: Run, expect PASS**

```bash
bun test tests/users.test.ts tests/commands/user.test.ts --bail
```

- [ ] **Step 7: Commit**

```bash
git add src/users.ts src/bot.ts src/commands/user.ts tests/users.test.ts tests/commands/user.test.ts
git commit -m "feat(auth): per-platform-instance authorization via admins table"
```

---

### Task 5.2: `/plugin` super-admin gating

**Files:**

- Modify: `src/commands/plugin.ts`
- Test: extend `tests/commands/plugin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// in tests/commands/plugin.test.ts
it('rejects /plugin approve when caller is a platform admin (not super-admin)', async () => {
  insertAdmin('platform-admin', 'tg-prod')
  const reply = mock(async () => {})
  await runPluginCommand(
    makeDmMessage({
      contextId: 'platform-admin',
      text: '/plugin approve hello-world',
      user: { id: 'platform-admin', username: null, isAdmin: true },
    }),
    reply,
  )
  expect((reply.mock.calls[0]?.[0] as string).toLowerCase()).toMatch(/super.admin/iu)
})

it('allows /plugin approve for super-admin', async () => {
  insertAdmin('super-1', '__super__')
  pluginRegistry.registerDiscovered(/* fixture */)
  await runPluginCommand(
    makeDmMessage({ contextId: 'super-1', text: '/plugin approve hello-world' }),
    mock(async () => {}),
  )
  expect(pluginRegistry.getEntry('hello-world')?.state).toBe('approved')
})

it('allows /plugin enable for any admin scoped to the target context', async () => {
  insertAdmin('platform-admin', 'tg-prod')
  // hello-world is already active in fixture
  await runPluginCommand(
    makeDmMessage({ contextId: 'platform-admin', text: '/plugin enable hello-world' }),
    mock(async () => {}),
  )
  expect(isPluginActiveForContext('hello-world', 'platform-admin')).toBe(true)
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/commands/plugin.test.ts --bail
```

- [ ] **Step 3: Update `src/commands/plugin.ts`**

```ts
import { isSuperAdmin, isAdmin } from '../instances/admin-store.js'

// ...
switch (subcommand) {
  case 'approve':
  case 'reject':
    if (!isSuperAdmin(msg.user.id)) {
      await reply('Only super-admins can approve or reject plugins.')
      return
    }
    // existing logic
    break
  case 'enable':
  case 'disable':
    if (!isAdmin(msg.user.id, msg.platformInstanceId)) {
      await reply('You must be an admin on this instance to enable/disable plugins.')
      return
    }
    // existing logic
    break
  // list / info — no admin gating change
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/commands/plugin.test.ts --bail
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/plugin.ts tests/commands/plugin.test.ts
git commit -m "feat(plugin): require super-admin for /plugin approve|reject"
```

---

## Phase 6 — Dashboard API + UI

### Task 6.1: Instance HTTP routes

**Files:**

- Create: `src/debug/instance-routes.ts`
- Modify: `src/debug/server.ts` (wire routes in)
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/debug/instance-routes.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { handleInstanceRequest } from '../../src/debug/instance-routes.js'
import { resetMemoryDb } from '../utils/db-test-helpers.js'

describe('instance routes', () => {
  beforeEach(() => {
    resetMemoryDb()
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  })

  it('GET /api/platform-instances returns []', async () => {
    const res = await handleInstanceRequest(new Request('http://x/api/platform-instances'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ instances: [] })
  })

  it('POST /api/platform-instances creates and masks the response', async () => {
    const res = await handleInstanceRequest(
      new Request('http://x/api/platform-instances', {
        method: 'POST',
        body: JSON.stringify({
          id: 'tg-prod',
          type: 'telegram',
          config: { TELEGRAM_BOT_TOKEN: 'longtokenABCD' },
        }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { instance: { config: Record<string, string> } }
    expect(body.instance.config['TELEGRAM_BOT_TOKEN']).toMatch(/^\*{4}/u)
  })

  it('DELETE /api/platform-instances/:id removes the row', async () => {
    await handleInstanceRequest(
      new Request('http://x/api/platform-instances', {
        method: 'POST',
        body: JSON.stringify({
          id: 'tg-prod',
          type: 'telegram',
          config: { TELEGRAM_BOT_TOKEN: 'x' },
        }),
      }),
    )
    const res = await handleInstanceRequest(
      new Request('http://x/api/platform-instances/tg-prod', { method: 'DELETE' }),
    )
    expect(res.status).toBe(204)
  })

  it('POST /api/admins inserts a super-admin when platformInstanceId omitted', async () => {
    const res = await handleInstanceRequest(
      new Request('http://x/api/admins', {
        method: 'POST',
        body: JSON.stringify({ userId: 'u-1' }),
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { admin: { platformInstanceId: string } }
    expect(body.admin.platformInstanceId).toBe('__super__')
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/debug/instance-routes.test.ts --bail
```

- [ ] **Step 3: Implement `src/debug/instance-routes.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { insertPlatformInstance, listPlatformInstances, deletePlatformInstance } from '../instances/platform-store.js'
import { insertTaskInstance, listTaskInstances, deleteTaskInstance } from '../instances/task-store.js'
import {
  insertAdmin,
  listSuperAdmins,
  listPlatformAdmins,
  removeAdmin,
  SUPER_ADMIN_SCOPE,
} from '../instances/admin-store.js'
import { maskConfig } from '../instances/encryption.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'debug:instance-routes' })

const platformBodySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['telegram', 'mattermost', 'discord']),
  config: z.record(z.string(), z.string()),
})

const taskBodySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['kaneo', 'youtrack']),
  config: z.record(z.string(), z.string()),
})

const adminBodySchema = z.object({
  userId: z.string().min(1),
  platformInstanceId: z.string().min(1).optional(),
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function handlePlatform(req: Request, suffix: string): Promise<Response | null> {
  if (req.method === 'GET' && suffix === '') {
    const instances = listPlatformInstances().map((i) => ({ ...i, config: maskConfig(i.config) }))
    return json(200, { instances })
  }
  if (req.method === 'POST' && suffix === '') {
    const parsed = platformBodySchema.safeParse(await req.json())
    if (!parsed.success) return json(400, { error: parsed.error.issues })
    insertPlatformInstance({ ...parsed.data, status: 'pending' })
    const stored = listPlatformInstances().find((i) => i.id === parsed.data.id)
    if (stored === undefined) return json(500, { error: 'insert failed' })
    return json(201, { instance: { ...stored, config: maskConfig(stored.config) } })
  }
  if (req.method === 'DELETE' && suffix.length > 0) {
    deletePlatformInstance(suffix.slice(1))
    return new Response(null, { status: 204 })
  }
  return null
}

async function handleTask(req: Request, suffix: string): Promise<Response | null> {
  if (req.method === 'GET' && suffix === '') {
    const instances = listTaskInstances().map((i) => ({ ...i, config: maskConfig(i.config) }))
    return json(200, { instances })
  }
  if (req.method === 'POST' && suffix === '') {
    const parsed = taskBodySchema.safeParse(await req.json())
    if (!parsed.success) return json(400, { error: parsed.error.issues })
    insertTaskInstance({ ...parsed.data, status: 'active' })
    const stored = listTaskInstances().find((i) => i.id === parsed.data.id)
    if (stored === undefined) return json(500, { error: 'insert failed' })
    return json(201, { instance: { ...stored, config: maskConfig(stored.config) } })
  }
  if (req.method === 'DELETE' && suffix.length > 0) {
    deleteTaskInstance(suffix.slice(1))
    return new Response(null, { status: 204 })
  }
  return null
}

async function handleAdmins(req: Request, suffix: string): Promise<Response | null> {
  if (req.method === 'GET' && suffix === '') {
    const supers = listSuperAdmins().map((userId) => ({
      userId,
      platformInstanceId: SUPER_ADMIN_SCOPE,
    }))
    const platforms = listPlatformInstances().flatMap((p) =>
      listPlatformAdmins(p.id).map((userId) => ({ userId, platformInstanceId: p.id })),
    )
    return json(200, { admins: [...supers, ...platforms] })
  }
  if (req.method === 'POST' && suffix === '') {
    const parsed = adminBodySchema.safeParse(await req.json())
    if (!parsed.success) return json(400, { error: parsed.error.issues })
    const scope = parsed.data.platformInstanceId ?? SUPER_ADMIN_SCOPE
    insertAdmin(parsed.data.userId, scope)
    return json(201, { admin: { userId: parsed.data.userId, platformInstanceId: scope } })
  }
  if (req.method === 'DELETE' && suffix.length > 0) {
    const [userId, platformInstanceId] = suffix.slice(1).split('/')
    if (userId === undefined || platformInstanceId === undefined) return json(400, { error: 'malformed path' })
    removeAdmin(userId, platformInstanceId)
    return new Response(null, { status: 204 })
  }
  return null
}

export async function handleInstanceRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  if (path.startsWith('/api/platform-instances')) {
    const res = await handlePlatform(req, path.slice('/api/platform-instances'.length))
    if (res !== null) return res
  } else if (path.startsWith('/api/task-instances')) {
    const res = await handleTask(req, path.slice('/api/task-instances'.length))
    if (res !== null) return res
  } else if (path.startsWith('/api/admins')) {
    const res = await handleAdmins(req, path.slice('/api/admins'.length))
    if (res !== null) return res
  }
  log.debug({ method: req.method, path }, 'instance route not matched')
  return new Response('Not Found', { status: 404 })
}
```

- [ ] **Step 4: Wire into `src/debug/server.ts`**

In the existing request dispatcher, add:

```ts
import { handleInstanceRequest } from './instance-routes.js'

if (
  url.pathname.startsWith('/api/platform-instances') ||
  url.pathname.startsWith('/api/task-instances') ||
  url.pathname.startsWith('/api/admins')
) {
  return handleInstanceRequest(req)
}
```

Apply the same `DEBUG_TOKEN` gating used by `admin-llm.ts` for `POST`/`DELETE` requests.

- [ ] **Step 5: Run, expect PASS**

```bash
bun test tests/debug/instance-routes.test.ts --bail
```

- [ ] **Step 6: Commit**

```bash
git add src/debug/instance-routes.ts src/debug/server.ts tests/debug/instance-routes.test.ts
git commit -m "feat(debug): add /api/platform-instances /api/task-instances /api/admins"
```

---

### Task 6.2: Admin UI — Instances page under `/admin#instances`

**Files:**

- Create: `client/admin/src/pages/InstancesPage.tsx`
- Modify: `client/admin/src/App.tsx`
- Test: `tests/client/admin/instances-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/client/admin/instances-page.test.tsx
import { describe, it, expect } from 'bun:test'
import { render, screen, waitFor } from '@testing-library/react'
import { setMockFetch, restoreFetch } from '../../utils/test-helpers.js'
import { InstancesPage } from '../../../client/admin/src/pages/InstancesPage.tsx'

describe('InstancesPage', () => {
  it('renders platform instances from API and shows masked config', async () => {
    setMockFetch({
      '/api/platform-instances': () =>
        new Response(
          JSON.stringify({
            instances: [
              {
                id: 'tg-prod',
                type: 'telegram',
                config: { TELEGRAM_BOT_TOKEN: '****ABCD' },
                status: 'active',
                createdAt: 'now',
              },
            ],
          }),
        ),
      '/api/task-instances': () => new Response(JSON.stringify({ instances: [] })),
      '/api/admins': () => new Response(JSON.stringify({ admins: [] })),
    })
    try {
      render(<InstancesPage />)
      await waitFor(() => expect(screen.getByText('tg-prod')).toBeInTheDocument())
      expect(screen.getByText(/\*{4}ABCD/u)).toBeInTheDocument()
    } finally {
      restoreFetch()
    }
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test:client --bail
```

- [ ] **Step 3: Implement `client/admin/src/pages/InstancesPage.tsx`**

(Mirror the file structure of the existing pages under `client/admin/src/pages/` — pick the closest comparable, eg `SystemPage.tsx`. The page has three sections: Platform Instances table, Task Instances table, and Admins table. Each section has a small "Add" form and per-row Delete buttons. Configs are rendered exactly as the API returns them — already masked.)

- [ ] **Step 4: Add the route in `client/admin/src/App.tsx`**

```tsx
import { InstancesPage } from './pages/InstancesPage.tsx'
// ...
;<Route path="instances" element={<InstancesPage />} />
```

- [ ] **Step 5: Build and run client tests**

```bash
bun build:client && bun test:client --bail
```

- [ ] **Step 6: Commit**

```bash
git add client/admin tests/client/admin/instances-page.test.tsx
git commit -m "feat(admin-ui): add /admin#instances page for platform/task/admin CRUD"
```

---

## Phase 7 — Plugin-system alignment

### Task 7.1: Capability eval across active instance union

**Files:**

- Modify: `src/plugins/compatibility.ts`
- Modify: `src/plugins/registry.ts`
- Test: extend `tests/plugins/compatibility.test.ts`, `tests/plugins/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// in tests/plugins/registry.test.ts
it('marks a plugin compatible at startup when at least one active task instance supplies the required capability', () => {
  const manifest = makeManifest({ requiredTaskCapabilities: ['comments.read'] })
  pluginRegistry.registerDiscovered({ manifest /* ... */ })
  pluginRegistry.approve(manifest.id, 'admin', 'hash')

  pluginRegistry.evaluateCompatibilityAcrossInstances([
    { taskCapabilities: new Set(['comments.read']), chatCapabilities: new Set() },
    { taskCapabilities: new Set(), chatCapabilities: new Set() },
  ])
  expect(pluginRegistry.getEntry(manifest.id)?.state).toBe('approved')
})

it('marks incompatible when no active instance supplies the capability', () => {
  const manifest = makeManifest({ requiredTaskCapabilities: ['comments.read'] })
  pluginRegistry.registerDiscovered({ manifest /* ... */ })
  pluginRegistry.approve(manifest.id, 'admin', 'hash')

  pluginRegistry.evaluateCompatibilityAcrossInstances([{ taskCapabilities: new Set(), chatCapabilities: new Set() }])
  expect(pluginRegistry.getEntry(manifest.id)?.state).toBe('incompatible')
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/plugins/registry.test.ts --bail
```

- [ ] **Step 3: Add `evaluateCompatibilityAcrossInstances` to `PluginRegistry`**

```ts
evaluateCompatibilityAcrossInstances(
  instances: ReadonlyArray<{ taskCapabilities: ReadonlySet<TaskCapability>; chatCapabilities: ReadonlySet<ChatCapability> }>,
): void {
  for (const entry of this.entries.values()) {
    if (entry.state !== 'approved') continue
    const compatibleSomewhere = instances.some((i) =>
      checkPluginCompatibility(entry.discoveredPlugin.manifest, i.taskCapabilities, i.chatCapabilities).compatible,
    )
    if (!compatibleSomewhere) {
      entry.state = 'incompatible'
      entry.compatibilityReason = 'No active instance satisfies required capabilities'
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/plugins/registry.test.ts --bail
```

- [ ] **Step 5: Commit**

```bash
git add src/plugins/registry.ts src/plugins/compatibility.ts tests/plugins
git commit -m "feat(plugins): evaluate compatibility across active-instance union"
```

---

### Task 7.2: Per-context `capability_missing` eligibility

**Files:**

- Modify: `src/plugins/registry.ts`
- Test: extend `tests/plugins/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('returns capability_missing for a context whose task instance lacks the required capability', () => {
  insertTaskInstance({
    id: 'k1',
    type: 'kaneo',
    config: { baseUrl: 'https://k' },
    status: 'active',
  })
  assignContext({ contextId: 'u-1', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
  pluginRegistry.markActive(plugin.id)
  setPluginEnabledForContext(plugin.id, 'u-1', true)
  // plugin requires comments.read which kaneo lacks for this test
  expect(getPluginContextEligibility(plugin.id, 'u-1')).toEqual({
    eligible: false,
    reason: 'capability_missing',
    missingCapabilities: ['comments.read'],
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/plugins/registry.test.ts --bail
```

- [ ] **Step 3: Extend `PluginContextEligibility` and `getPluginContextEligibility`**

```ts
export type PluginContextEligibility =
  | { eligible: true }
  | {
      eligible: false
      reason: 'inactive' | 'disabled' | 'config_missing'
      missingKeys?: readonly string[]
    }
  | { eligible: false; reason: 'capability_missing'; missingCapabilities: readonly string[] }
```

Inside `getPluginContextEligibility`, after the config check, resolve the context's task instance through the resolver and the platform instance through `getContextAssignment`. Build the capability sets from those concrete instances (the task provider exposes `capabilities`, the chat provider's capability set comes from `ChatRouter.getInstance(...).provider.capabilities`). If any required capability is missing, return `capability_missing`.

```ts
const assignment = getContextAssignment(contextId)
if (assignment !== undefined) {
  const taskInstance = getTaskInstance(assignment.taskInstanceId)
  const taskCaps = taskInstance === undefined ? new Set<TaskCapability>() : getCapabilitiesForTaskInstance(taskInstance)
  const chatCaps = getCapabilitiesForPlatformInstance(assignment.platformInstanceId)
  const missingTask = entry.discoveredPlugin.manifest.requiredTaskCapabilities.filter((c) => !taskCaps.has(c))
  const missingChat = entry.discoveredPlugin.manifest.requiredChatCapabilities.filter((c) => !chatCaps.has(c))
  if (missingTask.length + missingChat.length > 0) {
    return {
      eligible: false,
      reason: 'capability_missing',
      missingCapabilities: [...missingTask, ...missingChat],
    }
  }
}
```

`getCapabilitiesForTaskInstance` lives in `src/providers/registry.ts` (look at how the provider classes already expose `capabilities`). `getCapabilitiesForPlatformInstance` reads from the ChatRouter — import a small accessor `getPlatformInstanceCapabilities(id)` added in this same task.

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/plugins/registry.test.ts --bail
```

- [ ] **Step 5: Commit**

```bash
git add src/plugins/registry.ts src/providers/registry.ts src/chat/router.ts tests/plugins
git commit -m "feat(plugins): add capability_missing eligibility per context"
```

---

### Task 7.3: Plugin scheduled-job dispatch uses resolver

**Files:**

- Modify: `src/plugins/contributions.ts`
- Test: extend `tests/plugins/contributions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('runPluginScheduledJob skips contexts where the resolver returns null', async () => {
  // enable plugin for two contexts, only one has setup
  setPluginContextEnabled('hello-world', 'u-with-setup', true)
  setPluginContextEnabled('hello-world', 'u-without-setup', true)
  insertTaskInstance({
    id: 'k1',
    type: 'kaneo',
    config: { baseUrl: 'https://k' },
    status: 'active',
  })
  assignContext({ contextId: 'u-with-setup', taskInstanceId: 'k1', platformInstanceId: 'tg-prod' })
  setConfig('u-with-setup', 'kaneo_apikey', 'key')

  const executions: string[] = []
  contributionRegistry.register(
    'hello-world',
    {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [
        {
          name: 'tick',
          intervalMs: 60_000,
          execute: (ctx) => {
            executions.push(ctx)
          },
        },
      ],
    },
    makeManifest({ id: 'hello-world', contributes: { jobs: ['tick'] } }),
  )

  await runPluginScheduledJob('hello-world', 'tick')
  expect(executions).toEqual(['u-with-setup'])
})
```

- [ ] **Step 2: Run, expect failure**

```bash
bun test tests/plugins/contributions.test.ts --bail
```

- [ ] **Step 3: Update `runPluginScheduledJob`**

```ts
export async function runPluginScheduledJob(pluginId: string, jobName: string): Promise<void> {
  const contributions = contributionRegistry.getContributions(pluginId)
  const job = contributions?.jobs.find((candidate) => candidate.name === jobName)
  if (job === undefined) return

  for (const contextId of getEnabledContextsForPlugin(pluginId)) {
    const provider = defaultTaskProviderResolver.resolve(contextId)
    if (provider === null) {
      log.warn({ pluginId, jobName, contextId }, 'Plugin job skipping context — no resolver result')
      continue
    }
    try {
      await job.execute(contextId)
    } catch (err) {
      log.error({ pluginId, jobName, contextId, err }, 'Plugin job execute threw')
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/plugins/contributions.test.ts --bail
```

- [ ] **Step 5: Commit**

```bash
git add src/plugins/contributions.ts tests/plugins/contributions.test.ts
git commit -m "feat(plugins): scheduled jobs skip contexts without resolver result"
```

---

## Phase end checkpoint — full suite + manual smoke

After each phase, before opening a PR, run:

```bash
bun lint && bun typecheck && bun test --bail && bun knip
```

Expected: all green. Investigate any non-test failure before continuing.

Phase 3 and Phase 6 also require a manual smoke run because the dev loop exercises chat adapters and the dashboard:

```bash
bun start:debug
```

For Phase 3 smoke, send a message on the configured chat platform and confirm the bot's logs show `platformInstanceId` set on the incoming message. For Phase 6 smoke, visit `http://localhost:<DEBUG_PORT>/admin#instances`, add a synthetic task instance, and confirm it shows up after page reload.

---

## Self-Review

I ran the self-review checklist after writing the plan.

**Spec coverage:**

| Spec section                                            | Covered by                        |
| ------------------------------------------------------- | --------------------------------- |
| 1. Data Model (new tables)                              | Task 1.1, 1.2                     |
| 1. Config key changes                                   | Task 2.5                          |
| 2. ChatRouter                                           | Task 3.1, 3.2, 3.3                |
| 3. TaskProviderResolver                                 | Task 2.1                          |
| 3. What changes (orchestrator/scheduler/poller/factory) | Task 2.2, 2.3, 2.4                |
| 3. /setup wizard task-instance step                     | Task 4.1                          |
| 4. Admin Model + bootstrap of super-admin               | Task 1.5, 5.1                     |
| 4. Platform admin commands                              | Task 5.1                          |
| 4. Plugin admin authority                               | Task 5.2                          |
| 5. Dashboard pages + endpoints                          | Task 6.1, 6.2                     |
| 5. Config encryption                                    | Task 1.3                          |
| 6. Bootstrap and migration                              | Task 1.5                          |
| 7. Error handling — capability gating                   | Task 7.1, 7.2                     |
| 7. Scheduler & poller resilience for plugin jobs        | Task 7.3                          |
| 8. Testing strategy (router, resolver, instances)       | Tasks include matching test files |
| 9. Plugin system interactions                           | Phase 7                           |

**Placeholder scan:** I searched for `TBD`, `TODO`, `implement later`, `add validation`, `similar to`, `fill in` — none remain in the plan body. Two references say "extend the existing file" with an inline new test block; the block contains complete code, so that is not a placeholder.

**Type consistency:**

- `InstanceStatus` is defined once in `src/instances/types.ts` and used everywhere.
- `PlatformInstance.config` / `TaskInstance.config` are `Record<string, string>` everywhere (storage encrypts on write, decrypts on read).
- `IncomingMessage.platformInstanceId` is `string` everywhere (Task 3.1 establishes; Task 3.2 / 3.3 / 5.x consume).
- `defaultTaskProviderResolver` is the singleton everywhere; `TaskProviderResolver` is the class. Both used consistently.
- `PluginContextEligibility` discriminant union: `inactive | disabled | config_missing | capability_missing`. Task 7.2 adds `capability_missing` and threads it through the existing union, matching the existing names.

**Gaps I noticed and folded back into the plan:**

- The plan originally only updated `src/users.ts` but missed the bot.ts auth callsite — added that to Task 5.1, Step 4.
- The plan originally tested encryption without tamper-detection — added a tamper test in Task 1.3.
- The plan originally implied dashboard `Apply` button without saying what it does. The spec calls for `POST /api/platform-instances/apply` to re-sync the running `ChatRouter` from DB. I did not yet write that endpoint — it deserves its own task. Adding:

### Task 6.3: `POST /api/platform-instances/apply` re-syncs ChatRouter

**Files:**

- Modify: `src/debug/instance-routes.ts`
- Test: extend `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('POST /api/platform-instances/apply re-syncs the ChatRouter from DB', async () => {
  const router = makeFakeChatRouter()
  setApplyTarget(router)
  insertPlatformInstance({
    id: 'tg-prod',
    type: 'telegram',
    config: { TELEGRAM_BOT_TOKEN: 'x' },
    status: 'active',
  })
  const res = await handleInstanceRequest(new Request('http://x/api/platform-instances/apply', { method: 'POST' }))
  expect(res.status).toBe(200)
  expect(router.listInstances().map((i) => i.id)).toEqual(['tg-prod'])
})
```

- [ ] **Step 2: Add `setApplyTarget` + `POST .../apply` handler in `src/debug/instance-routes.ts`**

```ts
let applyTarget: {
  listInstances: () => ManagedChatInstance[]
  addInstance: (...args: any[]) => void
  removeInstance: (id: string) => Promise<void>
  startInstance: (id: string) => Promise<void>
  stopInstance: (id: string) => Promise<void>
} | null = null

export function setApplyTarget(router: typeof applyTarget): void {
  applyTarget = router
}

// inside handlePlatform:
if (req.method === 'POST' && suffix === '/apply') {
  if (applyTarget === null) return json(503, { error: 'router not initialised' })
  const desired = listActivePlatformInstances()
  const existingIds = new Set(applyTarget.listInstances().map((i) => i.id))
  for (const existing of applyTarget.listInstances()) {
    if (!desired.some((d) => d.id === existing.id)) await applyTarget.removeInstance(existing.id)
  }
  for (const want of desired) {
    if (!existingIds.has(want.id)) {
      applyTarget.addInstance(want.id, want.type, want.config)
      await applyTarget.startInstance(want.id)
    }
  }
  return json(200, { applied: desired.length })
}
```

- [ ] **Step 3: Wire `setApplyTarget(router)` in `src/index.ts`** right after the router is constructed.

- [ ] **Step 4: Run, expect PASS**

```bash
bun test tests/debug/instance-routes.test.ts --bail
```

- [ ] **Step 5: Commit**

```bash
git add src/debug/instance-routes.ts src/index.ts tests/debug/instance-routes.test.ts
git commit -m "feat(admin): POST /api/platform-instances/apply re-syncs ChatRouter"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-multi-provider-router-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a refactor of this size because each task is small and independently reviewable.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints. Better if you want me to keep all context in one thread.

Which approach?
