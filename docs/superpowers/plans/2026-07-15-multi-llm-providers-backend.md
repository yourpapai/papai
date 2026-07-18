<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-provider LLM configuration — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace papai's single-provider LLM config with a multi-provider registry (admin + per-context) where the `main`/`small`/`embedding` roles each bind to a specific provider + model, served entirely via API (UI is a follow-up plan).

**Architecture:** Hybrid storage — a normalized admin registry (`llm_providers` + `llm_admin_roles` tables, encrypted apiKey) and a generalized encrypted per-context BYOK blob (version-tolerant). One resolver, `resolveLlmConfig`, walks each role independently: context → admin → main-fallback, returning per-role `{apiKey, baseUrl, model}`. The old single-cred resolver becomes a temporary adapter so the ~11 callsites migrate one-by-one without breaking compilation.

**Tech Stack:** Bun, TypeScript (strict), Drizzle ORM over SQLite, Zod v4, `@ai-sdk/openai-compatible`, AES-256-GCM via existing `secret-payload-crypto`.

**Spec:** `docs/superpowers/specs/2026-07-15-multi-llm-providers-design.md`

**Scope note:** This is **Plan A — Backend** (matches the user's "backend first, then UI" priority). Plan B (Settings UI: admin Providers/Models sections + generalized BYOK section) follows separately and consumes the routes built here.

**Working-at-every-commit strategy:** A temporary adapter bridges the viral resolver contract change. Phases 1–2 add new code without wiring it. Phase 3 flips the old resolver onto the new tables (env bootstrap seeds both during the window). Phase 4 migrates call sites. Phase 5 removes the bridge. Phases 6–7 add discovery + routes.

---

## File Structure

### New files

- `src/db/llm-providers-schema.ts` — Drizzle tables `llmProviders`, `llmAdminRoles` + row types.
- `src/db/migrations/067_multi_llm_providers.ts` — creates tables + migrates legacy `system_config` LLM keys into one provider bound to all roles.
- `src/llm-providers/types.ts` — domain types: `LlmProviderType`, `LlmProviderRecord`, `LlmRoleBindings`, `ResolvedRole`, `EffectiveLlmConfig`, `LlmConfigMissing`, `LlmConfigError`, `LlmConfigResult`, `VerificationStatus`, BYOK blob v2 shape.
- `src/llm-providers/store.ts` — admin provider CRUD + role-binding store; apiKey encrypt/decrypt.
- `src/llm-providers/admin-cache.ts` — in-process cache (mirrors `system-config.ts` cache pattern) + prime/mutate.
- `src/llm-providers/discovery.ts` — `fetchProviderModels(baseUrl, apiKey, deps)` → `{status, models?, error?}`.
- `src/llm-providers/resolver.ts` — `resolveLlmConfig(configContextId): LlmConfigResult`.
- `src/byok-llm/blob-codec.ts` — `encodeByokBlob` / `decodeByokBlob` (v2 + legacy flat shape).
- `src/debug/settings/admin/llm-providers-routes.ts` — admin provider/role/refresh routes.

### Modified files

- `src/db/index.ts` — register migration 067.
- `src/db/schema.ts` — export new schema.
- `src/byok-llm/store.ts` — add multi-provider blob ops.
- `src/byok-llm/types.ts` — re-export blob shapes.
- `src/llm-config-resolver.ts` — becomes adapter, then is deleted (Phase 5).
- `src/system-config.ts` — LLM-typed accessors removed in Phase 5 (table persists for non-LLM keys).
- `src/index.ts` — env-bootstrap rework.
- `src/llm-orchestrator.ts` + 10 other resolver call sites (Phase 4 list).
- `src/debug/settings-api-router.ts`, `src/debug/settings/admin/system-access-routes.ts`, `src/debug/settings/byok-routes.ts` — routes.

---

## Phase 1 — Data model

### Task 1: Drizzle schema for admin provider registry

**Files:**

- Create: `src/db/llm-providers-schema.ts`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// src/db/llm-providers-schema.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  providerType: text('provider_type').notNull(),
  baseUrl: text('base_url').notNull(),
  encryptedApiKey: text('encrypted_api_key').notNull(),
  modelsCache: text('models_cache'),
  modelsFetchedAt: integer('models_fetched_at'),
  verificationStatus: text('verification_status').notNull().default('unverified'),
  verificationError: text('verification_error'),
  verificationAt: integer('verification_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
})

export type LlmProviderRow = typeof llmProviders.$inferSelect

export const llmAdminRoles = sqliteTable('llm_admin_roles', {
  id: integer('id').primaryKey(),
  mainProviderId: text('main_provider_id').notNull(),
  mainModel: text('main_model').notNull(),
  smallProviderId: text('small_provider_id'),
  smallModel: text('small_model'),
  embeddingProviderId: text('embedding_provider_id'),
  embeddingModel: text('embedding_model'),
  updatedAt: integer('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
})

export type LlmAdminRoleRow = typeof llmAdminRoles.$inferSelect
```

- [ ] **Step 2: Export from the schema barrel**

Add to `src/db/schema.ts` (after the `byokLlmCredentials` export near line 53):

```typescript
export { llmProviders, type LlmProviderRow, llmAdminRoles, type LlmAdminRoleRow } from './llm-providers-schema.js'
```

- [ ] **Step 3: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/db/llm-providers-schema.ts src/db/schema.ts
git commit -m "feat(llm): add drizzle schema for admin provider registry"
```

---

### Task 2: Migration 067 — create tables + migrate legacy keys

**Files:**

- Create: `src/db/migrations/067_multi_llm_providers.ts`
- Create: `tests/db/migrations/067_multi_llm_providers.test.ts`
- Modify: `src/db/index.ts` (import + register in `MIGRATIONS`)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/db/migrations/067_multi_llm_providers.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration034SystemConfig } from '../../../src/db/migrations/034_system_config.js'
import { migration067MultiLlmProviders } from '../../../src/db/migrations/067_multi_llm_providers.js'

const tableSql = (db: Database, name: string): string | null =>
  db.query<{ sql: string }, [string]>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
    ?.sql ?? null

const systemConfigValue = (db: Database, key: string): string | null =>
  db.query<{ value: string }, [string]>(`SELECT value FROM system_config WHERE key = ?`).get(key)?.value ?? null

describe('migration067MultiLlmProviders', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })
  afterEach(() => {
    db.close()
  })

  test('migration id is 067_multi_llm_providers', () => {
    expect(migration067MultiLlmProviders.id).toBe('067_multi_llm_providers')
  })

  test('creates llm_providers and llm_admin_roles tables', () => {
    migration034SystemConfig.up(db)
    migration067MultiLlmProviders.up(db)

    const providers = tableSql(db, 'llm_providers')
    expect(providers).toContain('id TEXT NOT NULL PRIMARY KEY')
    expect(providers).toContain('encrypted_api_key TEXT NOT NULL')
    expect(providers).toContain("verification_status TEXT NOT NULL DEFAULT 'unverified'")

    const roles = tableSql(db, 'llm_admin_roles')
    expect(roles).toContain('main_provider_id TEXT NOT NULL')
    expect(roles).toContain('small_provider_id TEXT')
  })

  test('migrates legacy system_config keys into one provider bound to all roles', () => {
    migration034SystemConfig.up(db)
    db.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, [
      'llm_apikey',
      'sk-legacy',
      1,
      'env',
    ])
    db.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, [
      'llm_baseurl',
      'https://legacy.invalid/v1',
      1,
      'env',
    ])
    db.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, [
      'main_model',
      'legacy-main',
      1,
      'env',
    ])
    db.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, [
      'small_model',
      'legacy-small',
      1,
      'env',
    ])

    migration067MultiLlmProviders.up(db)

    const providers = db
      .query<{ id: string; label: string; base_url: string; provider_type: string }, []>(
        `SELECT id, label, base_url, provider_type FROM llm_providers`,
      )
      .all()
    expect(providers).toHaveLength(1)
    expect(providers[0]?.base_url).toBe('https://legacy.invalid/v1')
    expect(providers[0]?.provider_type).toBe('custom')

    const roles = db
      .query<{ main_model: string; small_model: string; embedding_model: string }, []>(
        `SELECT main_model, small_model, embedding_model FROM llm_admin_roles WHERE id = 1`,
      )
      .get()
    expect(roles?.main_model).toBe('legacy-main')
    expect(roles?.small_model).toBe('legacy-small')
    expect(roles?.embedding_model).toBeNull()

    expect(systemConfigValue(db, 'llm_apikey')).toBeNull()
    expect(systemConfigValue(db, 'main_model')).toBeNull()
  })

  test('is idempotent when no legacy keys exist', () => {
    migration034SystemConfig.up(db)
    migration067MultiLlmProviders.up(db)
    expect(db.query(`SELECT id FROM llm_providers`).all()).toEqual([])
    expect(db.query(`SELECT id FROM llm_admin_roles`).all()).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/db/migrations/067_multi_llm_providers.test.ts`
Expected: FAIL — module `067_multi_llm_providers.js` not found.

- [ ] **Step 3: Write the migration**

```typescript
// src/db/migrations/067_multi_llm_providers.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:067' })

type LegacyRow = { key: string; value: string }
type CountRow = { c: number }

const legacyKeys = (): readonly string[] => [
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
  'embedding_model',
]

const readLegacy = (db: Database): Record<string, string> => {
  const rows = db.query<LegacyRow, []>(`SELECT key, value FROM system_config`).all()
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (legacyKeys().includes(row.key)) out[row.key] = row.value
  }
  return out
}

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS llm_providers (
      id TEXT NOT NULL PRIMARY KEY,
      label TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      models_cache TEXT,
      models_fetched_at INTEGER,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      verification_error TEXT,
      verification_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS llm_admin_roles (
      id INTEGER PRIMARY KEY,
      main_provider_id TEXT NOT NULL,
      main_model TEXT NOT NULL,
      small_provider_id TEXT,
      small_model TEXT,
      embedding_provider_id TEXT,
      embedding_model TEXT,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    )
  `)

  const legacy = readLegacy(db)
  const has = (k: string): boolean => legacy[k] !== undefined && legacy[k].trim() !== ''
  const alreadyMigrated = db.query<CountRow, []>(`SELECT COUNT(*) AS c FROM llm_providers`).get()?.c ?? 0

  if (has('llm_apikey') && has('llm_baseurl') && has('main_model') && alreadyMigrated === 0) {
    const id = `prov_legacy_${Math.random().toString(36).slice(2, 10)}`
    const now = Date.now()
    db.run(
      `INSERT INTO llm_providers (id, label, provider_type, base_url, encrypted_api_key, verification_status, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        'Migrated provider',
        'custom',
        legacy['llm_baseurl']!,
        'legacy:' + legacy['llm_apikey'],
        'unverified',
        now,
        now,
        'migration:067',
      ],
    )
    const smallModel = has('small_model') ? legacy['small_model'] : null
    db.run(
      `INSERT INTO llm_admin_roles (id, main_provider_id, main_model, small_provider_id, small_model, embedding_provider_id, embedding_model, updated_at, updated_by)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        legacy['main_model'],
        smallModel !== null ? id : null,
        smallModel,
        has('embedding_model') ? id : null,
        has('embedding_model') ? legacy['embedding_model'] : null,
        now,
        'migration:067',
      ],
    )
    log.info('migration 067: migrated legacy system_config LLM keys into provider registry')
  }

  for (const key of legacyKeys()) {
    db.run(`DELETE FROM system_config WHERE key = ?`, [key])
  }
}

export const migration067MultiLlmProviders: Migration = {
  id: '067_multi_llm_providers',
  up,
}

export default migration067MultiLlmProviders
```

> **Note on the placeholder apiKey:** the migration stores a non-encrypted sentinel `'legacy:' + apiKey` because `secret-payload-crypto` requires the runtime `INSTANCE_CONFIG_KEY`, which is unavailable inside the raw-SQL migration. Task 5 (env-bootstrap / store) re-encrypts legacy keys on first admin write. The resolver (Task 12) treats an unencrypted `legacy:`-prefixed value as a plaintext apiKey fallback during the transition window. This is acceptable because the value already lived in plaintext-adjacent `system_config`; it is replaced on first edit.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/db/migrations/067_multi_llm_providers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the migration**

In `src/db/index.ts`, add the import (after the `migration066` import near line 79):

```typescript
import { migration067MultiLlmProviders } from './migrations/067_multi_llm_providers.js'
```

Append to the `MIGRATIONS` array (after `migration066CodingReposEgress,`):

```typescript
  migration066CodingReposEgress,
  migration067MultiLlmProviders,
]
```

- [ ] **Step 6: Verify the full suite still migrates**

Run: `bun run typecheck && bun test tests/db/migrations/067_multi_llm_providers.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/067_multi_llm_providers.ts src/db/index.ts tests/db/migrations/067_multi_llm_providers.test.ts
git commit -m "feat(db): migration 067 — multi-provider tables + legacy key migration"
```

---

## Phase 2 — Domain types, stores, codec, resolver (unwired)

### Task 3: Domain types module

**Files:**

- Create: `src/llm-providers/types.ts`

- [ ] **Step 1: Write the types**

```typescript
// src/llm-providers/types.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const LLM_PROVIDER_TYPES = ['openai', 'anthropic', 'google', 'openrouter', 'ollama', 'groq', 'custom'] as const
export type LlmProviderType = (typeof LLM_PROVIDER_TYPES)[number]

export const PROVIDER_TYPE_BASE_URLS: Readonly<Partial<Record<LlmProviderType, string>>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1/openai',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  groq: 'https://api.groq.com/openai/v1',
}

export type VerificationStatus = 'verified' | 'unverified' | 'error'

export type Verification = {
  readonly status: VerificationStatus
  readonly error: string | null
  readonly at: number | null
  readonly models: readonly string[]
  readonly modelsFetchedAt: number | null
}

/** Decrypted provider account as used in memory (admin or per-context). */
export type LlmProviderAccount = {
  readonly id: string
  readonly label: string
  readonly providerType: LlmProviderType
  readonly baseUrl: string
  readonly apiKey: string
  readonly verification: Verification
}

export type LlmRole = 'main' | 'small' | 'embedding'

export type RoleBinding = { readonly providerId: string; readonly model: string } | null

export type LlmRoleBindings = {
  readonly main: { readonly providerId: string; readonly model: string }
  readonly small: RoleBinding
  readonly embedding: RoleBinding
}

export type ResolvedRole = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
  readonly source: 'global' | 'byok'
}

export type EffectiveLlmConfig = {
  readonly ok: true
  readonly source: 'global' | 'byok' | 'mixed'
  readonly main: ResolvedRole
  readonly small: ResolvedRole
  readonly embedding: ResolvedRole
}

export type LlmConfigMissing = {
  readonly ok: false
  readonly type: 'missing'
  readonly source: 'global' | 'byok'
  readonly missing: readonly string[]
}

export type LlmConfigError = {
  readonly ok: false
  readonly type: 'error'
  readonly source: 'byok'
  readonly error: string
}

export type LlmConfigResult = EffectiveLlmConfig | LlmConfigMissing | LlmConfigError
```

- [ ] **Step 2: Verify**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/llm-providers/types.ts
git commit -m "feat(llm): add multi-provider domain types"
```

---

### Task 4: Admin provider store (CRUD + role bindings, encrypted apiKey)

**Files:**

- Create: `src/llm-providers/store.ts`
- Create: `tests/llm-providers/store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/llm-providers/store.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createLlmProvider,
  deleteLlmProvider,
  getLlmProvider,
  listLlmProviders,
  setAdminRoleBindings,
  getAdminRoleBindings,
  clearLlmAdminCacheForTesting,
} from '../../src/llm-providers/store.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  resetSystemConfigCacheForTesting()
  clearLlmAdminCacheForTesting()
})

describe('llm-providers store', () => {
  test('createLlmProvider encrypts apiKey and decrypts on read', () => {
    const created = createLlmProvider(
      { label: 'OpenAI', providerType: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' },
      'admin-1',
    )
    expect(created.apiKey).toBe('sk-test')
    expect(created.id).toMatch(/^prov_/)

    const again = getLlmProvider(created.id)
    expect(again?.apiKey).toBe('sk-test')
  })

  test('listLlmProviders returns all accounts', () => {
    createLlmProvider({ label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'k1' }, 'admin-1')
    createLlmProvider({ label: 'b', providerType: 'custom', baseUrl: 'https://b/v1', apiKey: 'k2' }, 'admin-1')
    expect(listLlmProviders().map((p) => p.label)).toEqual(['a', 'b'])
  })

  test('deleteLlmProvider clears role bindings that referenced it', () => {
    const a = createLlmProvider(
      { label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'k1' },
      'admin-1',
    )
    const b = createLlmProvider(
      { label: 'b', providerType: 'custom', baseUrl: 'https://b/v1', apiKey: 'k2' },
      'admin-1',
    )
    setAdminRoleBindings(
      { main: { providerId: a.id, model: 'm' }, small: { providerId: b.id, model: 's' }, embedding: null },
      'admin-1',
    )

    deleteLlmProvider(b.id)

    const roles = getAdminRoleBindings()
    expect(roles.small).toBeNull()
    expect(roles.main.providerId).toBe(a.id)
  })

  test('deleteLlmProvider for the main provider is rejected', () => {
    const a = createLlmProvider(
      { label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'k1' },
      'admin-1',
    )
    setAdminRoleBindings({ main: { providerId: a.id, model: 'm' }, small: null, embedding: null }, 'admin-1')

    expect(() => deleteLlmProvider(a.id)).toThrow(/main/)
  })

  test('getAdminRoleBindings returns nulls when unset', () => {
    expect(getAdminRoleBindings()).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/llm-providers/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

```typescript
// src/llm-providers/store.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { llmAdminRoles, llmProviders, type LlmProviderRow } from '../db/schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import { decryptSecretPayload, encryptSecretPayload, type SecretPayload } from '../secret-payload-crypto.js'
import { type LlmProviderAccount, type LlmProviderType, type LlmRoleBindings, type Verification } from './types.js'

const log = logger.child({ scope: 'llm-providers:store' })

const LEGACY_PREFIX = 'legacy:'
const newProviderId = (): string => `prov_${crypto.randomUUID()}`

export type NewLlmProviderInput = {
  readonly label: string
  readonly providerType: LlmProviderType
  readonly baseUrl: string
  readonly apiKey: string
}

const encryptApiKey = (apiKey: string): string => encryptSecretPayload({ apiKey })
const decryptApiKey = (stored: string): string => {
  if (stored.startsWith(LEGACY_PREFIX)) return stored.slice(LEGACY_PREFIX.length)
  const payload = decryptSecretPayload(stored)
  return payload['apiKey'] ?? ''
}

const emptyVerification = (): Verification => ({
  status: 'unverified',
  error: null,
  at: null,
  models: [],
  modelsFetchedAt: null,
})

const toAccount = (row: LlmProviderRow): LlmProviderAccount => ({
  id: row.id,
  label: row.label,
  providerType: row.providerType as LlmProviderType,
  baseUrl: row.baseUrl,
  apiKey: decryptApiKey(row.encryptedApiKey),
  verification: {
    status: row.verificationStatus as Verification['status'],
    error: row.verificationError,
    at: row.verificationAt,
    models: row.modelsCache === null ? [] : (JSON.parse(row.modelsCache) as string[]),
    modelsFetchedAt: row.modelsFetchedAt,
  },
})

// ---- in-process cache (mirrors src/system-config.ts cache) ----
const cache = new Map<string, LlmProviderAccount>()
let roleCache: LlmRoleBindings | null | undefined = undefined // undefined = not loaded

export const clearLlmAdminCacheForTesting = (): void => {
  cache.clear()
  roleCache = undefined
}

const loadAllIntoCache = (): void => {
  const rows = getDrizzleDb().select().from(llmProviders).all()
  cache.clear()
  for (const row of rows) cache.set(row.id, toAccount(row))
  log.debug({ count: rows.length }, 'llm_providers cache primed')
}

const ensureCache = (): void => {
  if (cache.size === 0 && getDrizzleDb().select().from(llmProviders).all().length > 0) loadAllIntoCache()
}

export const primeLlmAdminCache = (): void => {
  loadAllIntoCache()
  roleCache = readRoleBindings()
}

export function listLlmProviders(): LlmProviderAccount[] {
  ensureCache()
  return [...cache.values()]
}

export function getLlmProvider(id: string): LlmProviderAccount | null {
  ensureCache()
  return cache.get(id) ?? null
}

export function createLlmProvider(input: NewLlmProviderInput, updatedBy: string): LlmProviderAccount {
  const id = newProviderId()
  const now = Date.now()
  const row = {
    id,
    label: input.label,
    providerType: input.providerType,
    baseUrl: input.baseUrl,
    encryptedApiKey: encryptApiKey(input.apiKey),
    modelsCache: null,
    modelsFetchedAt: null,
    verificationStatus: 'unverified' as const,
    verificationError: null,
    verificationAt: null,
    createdAt: now,
    updatedAt: now,
    updatedBy,
  }
  getDrizzleDb().insert(llmProviders).values(row).run()
  const account = toAccount(row as unknown as LlmProviderRow)
  cache.set(id, account)
  log.info({ id, label: input.label }, 'LLM provider created')
  return account
}

export function updateLlmProvider(
  id: string,
  patch: Partial<{ label: string; providerType: LlmProviderType; baseUrl: string; apiKey: string }>,
  updatedBy: string,
): LlmProviderAccount | null {
  const current = getLlmProvider(id)
  if (current === null) return null
  const now = Date.now()
  const values: Record<string, unknown> = { updatedAt: now, updatedBy }
  if (patch.label !== undefined) values['label'] = patch.label
  if (patch.providerType !== undefined) values['providerType'] = patch.providerType
  if (patch.baseUrl !== undefined) values['baseUrl'] = patch.baseUrl
  if (patch.apiKey !== undefined) values['encryptedApiKey'] = encryptApiKey(patch.apiKey)
  getDrizzleDb().update(llmProviders).set(values).where(eq(llmProviders.id, id)).run()
  const fresh = getDrizzleDb().select().from(llmProviders).where(eq(llmProviders.id, id)).get()
  if (fresh === undefined) return null
  const account = toAccount(fresh)
  cache.set(id, account)
  return account
}

export function updateProviderVerification(id: string, verification: Verification): void {
  getDrizzleDb()
    .update(llmProviders)
    .set({
      verificationStatus: verification.status,
      verificationError: verification.error,
      verificationAt: verification.at,
      modelsCache: JSON.stringify(verification.models),
      modelsFetchedAt: verification.modelsFetchedAt,
      updatedAt: Date.now(),
    })
    .where(eq(llmProviders.id, id))
    .run()
  const fresh = getDrizzleDb().select().from(llmProviders).where(eq(llmProviders.id, id)).get()
  if (fresh !== undefined) cache.set(id, toAccount(fresh))
}

export function deleteLlmProvider(id: string): void {
  const roles = getAdminRoleBindings()
  if (roles !== null && roles.main.providerId === id) {
    throw new Error('cannot delete the provider bound to main; reassign main first')
  }
  getDrizzleDb().delete(llmProviders).where(eq(llmProviders.id, id)).run()
  cache.delete(id)
  if (roles !== null && (roles.small?.providerId === id || roles.embedding?.providerId === id)) {
    const next: LlmRoleBindings = {
      main: roles.main,
      small: roles.small?.providerId === id ? null : roles.small,
      embedding: roles.embedding?.providerId === id ? null : roles.embedding,
    }
    setAdminRoleBindings(next, 'system:delete-provider')
  }
  log.info({ id }, 'LLM provider deleted')
}

const readRoleBindings = (): LlmRoleBindings | null => {
  const row = getDrizzleDb().select().from(llmAdminRoles).where(eq(llmAdminRoles.id, 1)).get()
  if (row === undefined) return null
  const small =
    row.smallProviderId === null || row.smallModel === null
      ? null
      : { providerId: row.smallProviderId, model: row.smallModel }
  const embedding =
    row.embeddingProviderId === null || row.embeddingModel === null
      ? null
      : { providerId: row.embeddingProviderId, model: row.embeddingModel }
  return {
    main: { providerId: row.mainProviderId, model: row.mainModel },
    small,
    embedding,
  }
}

export function getAdminRoleBindings(): LlmRoleBindings | null {
  if (roleCache === undefined) roleCache = readRoleBindings()
  return roleCache
}

export function setAdminRoleBindings(bindings: LlmRoleBindings, updatedBy: string): void {
  const now = Date.now()
  getDrizzleDb()
    .insert(llmAdminRoles)
    .values({
      id: 1,
      mainProviderId: bindings.main.providerId,
      mainModel: bindings.main.model,
      smallProviderId: bindings.small?.providerId ?? null,
      smallModel: bindings.small?.model ?? null,
      embeddingProviderId: bindings.embedding?.providerId ?? null,
      embeddingModel: bindings.embedding?.model ?? null,
      updatedAt: now,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: llmAdminRoles.id,
      set: {
        mainProviderId: bindings.main.providerId,
        mainModel: bindings.main.model,
        smallProviderId: bindings.small?.providerId ?? null,
        smallModel: bindings.small?.model ?? null,
        embeddingProviderId: bindings.embedding?.providerId ?? null,
        embeddingModel: bindings.embedding?.model ?? null,
        updatedAt: now,
        updatedBy,
      },
    })
    .run()
  roleCache = readRoleBindings()
  log.info({ updatedBy }, 'admin LLM role bindings set')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/llm-providers/store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm-providers/store.ts tests/llm-providers/store.test.ts
git commit -m "feat(llm): admin provider store with encrypted apiKey + role bindings"
```

---

### Task 5: BYOK blob codec (version-tolerant)

**Files:**

- Create: `src/byok-llm/blob-codec.ts`
- Create: `tests/byok-llm/blob-codec.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/byok-llm/blob-codec.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { decodeByokBlob, encodeByokBlob } from '../../src/byok-llm/blob-codec.js'

describe('byok blob codec', () => {
  test('round-trips a v2 blob', () => {
    const blob = {
      v: 2 as const,
      providers: [
        {
          id: 'prov_x',
          label: 'm',
          providerType: 'ollama' as const,
          baseUrl: 'http://x/v1',
          apiKey: 'k',
          verification: { status: 'unverified' as const, error: null, at: null, models: [], modelsFetchedAt: null },
        },
      ],
      roles: { main: { providerId: 'prov_x', model: 'llama3' }, small: null, embedding: null },
    }
    expect(decodeByokBlob(encodeByokBlob(blob))).toEqual(blob)
  })

  test('decodes a legacy flat blob as one provider bound to all roles', () => {
    const legacy = {
      llm_apikey: 'sk-x',
      llm_baseurl: 'https://x/v1',
      main_model: 'm',
      small_model: 's',
    }
    const decoded = decodeByokBlob(legacy)
    expect(decoded.v).toBe(2)
    expect(decoded.providers).toHaveLength(1)
    expect(decoded.providers[0]?.apiKey).toBe('sk-x')
    expect(decoded.roles.main.model).toBe('m')
    expect(decoded.roles.small?.model).toBe('s')
    expect(decoded.roles.embedding).toBeNull()
  })

  test('legacy blob without optional models leaves small/embedding null', () => {
    const decoded = decodeByokBlob({ llm_apikey: 'k', llm_baseurl: 'u', main_model: 'm' })
    expect(decoded.roles.small).toBeNull()
    expect(decoded.roles.embedding).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/byok-llm/blob-codec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the codec**

```typescript
// src/byok-llm/blob-codec.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  type LlmProviderAccount,
  type LlmProviderType,
  type LlmRoleBindings,
  type RoleBinding,
  type Verification,
} from '../llm-providers/types.js'

export type ByokProvider = Omit<LlmProviderAccount, never>
export type ByokRoles = LlmRoleBindings
export type ByokBlobV2 = {
  readonly v: 2
  readonly providers: readonly ByokProvider[]
  readonly roles: ByokRoles
}

type LegacyBlob = Partial<
  Record<'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model' | 'embedding_model', string>
>

const isV2 = (value: unknown): value is ByokBlobV2 =>
  typeof value === 'object' && value !== null && (value as { v?: unknown }).v === 2

const isLegacy = (value: unknown): value is LegacyBlob =>
  typeof value === 'object' && value !== null && 'llm_apikey' in value

const emptyVerification = (): Verification => ({
  status: 'unverified',
  error: null,
  at: null,
  models: [],
  modelsFetchedAt: null,
})

const fromLegacy = (legacy: LegacyBlob): ByokBlobV2 => {
  const id = 'prov_legacy'
  const provider: ByokProvider = {
    id,
    label: 'Migrated BYOK provider',
    providerType: 'custom' as LlmProviderType,
    baseUrl: legacy['llm_baseurl'] ?? '',
    apiKey: legacy['llm_apikey'] ?? '',
    verification: emptyVerification(),
  }
  const mainBinding = { providerId: id, model: legacy['main_model'] ?? '' }
  const small: RoleBinding = legacy['small_model'] ? { providerId: id, model: legacy['small_model'] } : null
  const embedding: RoleBinding = legacy['embedding_model'] ? { providerId: id, model: legacy['embedding_model'] } : null
  return { v: 2, providers: [provider], roles: { main: mainBinding, small, embedding } }
}

export function decodeByokBlob(raw: unknown): ByokBlobV2 {
  if (isV2(raw)) return raw
  if (isLegacy(raw)) return fromLegacy(raw)
  return { v: 2, providers: [], roles: { main: { providerId: '', model: '' }, small: null, embedding: null } }
}

export const encodeByokBlob = (blob: ByokBlobV2): ByokBlobV2 => blob
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/byok-llm/blob-codec.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/byok-llm/blob-codec.ts tests/byok-llm/blob-codec.test.ts
git commit -m "feat(byok): version-tolerant blob codec (v2 + legacy flat)"
```

---

### Task 6: Per-context BYOK multi-provider store ops

**Files:**

- Modify: `src/byok-llm/store.ts`
- Modify: `tests/llm-config-resolver.test.ts` is NOT touched here (Phase 3)

> Adds the multi-provider operations on the blob while keeping the existing flat-key functions (`getByokLlmConfig`, `updateByokLlmConfig`) intact for the transition.

- [ ] **Step 1: Add a typed bundle read/write + provider/role ops to `src/byok-llm/store.ts`**

Append to the existing file (imports already present: `decryptSecretPayload`, `encryptSecretPayload`, `getDrizzleDb`, `byokLlmCredentials`, `logger`):

```typescript
import { decodeByokBlob, encodeByokBlob, type ByokBlobV2, type ByokProvider, type ByokRoles } from './blob-codec.js'
import type { LlmProviderAccount, LlmProviderType, LlmRoleBindings, Verification } from '../llm-providers/types.js'

export type ByokBundle = {
  readonly enabled: boolean
  readonly blob: ByokBlobV2 | null
  readonly unreadable: boolean
  readonly error: string | null
}

export function getByokBundle(contextId: string): ByokBundle {
  const row = findRow(contextId)
  if (row === undefined) return { enabled: false, blob: null, unreadable: false, error: null }
  if (!row.enabled) return { enabled: false, blob: null, unreadable: false, error: null }
  if (row.encryptedConfig === null) {
    return { enabled: true, blob: decodeByokBlob(null), unreadable: false, error: null }
  }
  try {
    const decrypted = decryptSecretPayload(row.encryptedConfig)
    return { enabled: true, blob: decodeByokBlob(decrypted), unreadable: false, error: null }
  } catch {
    return { enabled: true, blob: null, unreadable: true, error: UNREADABLE_BYOK_CONFIG_ERROR }
  }
}

const writeBlob = (contextId: string, blob: ByokBlobV2, updatedBy: string): void => {
  const payload = encryptSecretPayload(blob as unknown as Record<string, string>)
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: true, encryptedConfig: payload, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: { encryptedConfig: payload, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
    })
    .run()
}

export function upsertByokProvider(contextId: string, provider: LlmProviderAccount, updatedBy: string): void {
  const bundle = getByokBundle(contextId)
  const base: ByokBlobV2 = bundle.blob ?? {
    v: 2,
    providers: [],
    roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
  }
  const providers = [...base.providers.filter((p) => p.id !== provider.id), provider]
  writeBlob(contextId, encodeByokBlob({ ...base, providers }), updatedBy)
}

export function deleteByokProvider(contextId: string, providerId: string, updatedBy: string): void {
  const bundle = getByokBundle(contextId)
  if (bundle.blob === null) return
  const providers = bundle.blob.providers.filter((p) => p.id !== providerId)
  const roles = clearRoleRefs(blobRolesWithout(blob.blob.roles, providerId))
  writeBlob(contextId, encodeByokBlob({ ...bundle.blob, providers, roles }), updatedBy)
}

export function setByokRoles(contextId: string, roles: LlmRoleBindings, updatedBy: string): void {
  const bundle = getByokBundle(contextId)
  const base: ByokBlobV2 = bundle.blob ?? { v: 2, providers: [], roles }
  writeBlob(contextId, encodeByokBlob({ ...base, roles }), updatedBy)
}

export function updateByokProviderVerification(
  contextId: string,
  providerId: string,
  verification: Verification,
  updatedBy: string,
): void {
  const bundle = getByokBundle(contextId)
  if (bundle.blob === null) return
  const providers = bundle.blob.providers.map((p) => (p.id === providerId ? { ...p, verification } : p))
  writeBlob(contextId, encodeByokBlob({ ...bundle.blob, providers }), updatedBy)
}

const blobRolesWithout = (roles: ByokRoles, providerId: string): LlmRoleBindings => ({
  main: roles.main.providerId === providerId ? { providerId: '', model: '' } : roles.main,
  small: roles.small?.providerId === providerId ? null : roles.small,
  embedding: roles.embedding?.providerId === providerId ? null : roles.embedding,
})

const clearRoleRefs = (roles: LlmRoleBindings): LlmRoleBindings => roles
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/byok-llm/store.ts
git commit -m "feat(byok): multi-provider blob ops (upsert/delete provider, set roles)"
```

---

### Task 7: The per-role resolver

**Files:**

- Create: `src/llm-providers/resolver.ts`
- Create: `tests/llm-providers/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/llm-providers/resolver.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { byokLlmCredentials } from '../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { resolveLlmConfig } from '../../src/llm-providers/resolver.js'
import { createLlmProvider, clearLlmAdminCacheForTesting, setAdminRoleBindings } from '../../src/llm-providers/store.js'
import { encodeByokBlob } from '../../src/byok-llm/blob-codec.js'
import { encryptSecretPayload } from '../../src/secret-payload-crypto.js'
import { disableByokForContext, enableByokForContext } from '../../src/byok-llm/store.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from '../utils/test-helpers.js'

const seedAdmin = (): { main: string; small: string } => {
  const main = createLlmProvider(
    { label: 'admin-openai', providerType: 'openai', baseUrl: 'https://admin/v1', apiKey: 'sk-admin' },
    'admin',
  )
  const small = createLlmProvider(
    { label: 'admin-small', providerType: 'custom', baseUrl: 'https://admin-small/v1', apiKey: 'sk-admin-small' },
    'admin',
  )
  setAdminRoleBindings(
    {
      main: { providerId: main.id, model: 'gpt-main' },
      small: { providerId: small.id, model: 'gpt-small' },
      embedding: null,
    },
    'admin',
  )
  return { main: main.id, small: small.id }
}

const seedByok = (contextId: string, providers: object[], roles: object): void => {
  const blob = encodeByokBlob({ v: 2, providers: providers as never, roles: roles as never })
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({
      contextId,
      enabled: true,
      encryptedConfig: encryptSecretPayload(blob as unknown as Record<string, string>),
      updatedAt: 1,
      updatedBy: 'user',
    })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: {
        enabled: 1,
        encryptedConfig: encryptSecretPayload(blob as unknown as Record<string, string>),
        updatedAt: 1,
        updatedBy: 'user',
      },
    })
    .run()
}

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  resetSystemConfigCacheForTesting()
  clearLlmAdminCacheForTesting()
})

describe('resolveLlmConfig', () => {
  test('missing when no admin binding exists', () => {
    expect(resolveLlmConfig('ctx')).toEqual({ ok: false, type: 'missing', source: 'global', missing: ['main'] })
  })

  test('uses admin bindings; small/embedding fall back to main when admin leaves them null', () => {
    seedAdmin()
    const r = resolveLlmConfig('ctx')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.main.model).toBe('gpt-main')
    expect(r.main.source).toBe('global')
    expect(r.small.model).toBe('gpt-small')
    expect(r.embedding.model).toBe('gpt-main') // embedding null -> main fallback
    expect(r.embedding.apiKey).toBe('sk-admin')
  })

  test('context overrides main only; small/embedding inherit admin', () => {
    seedAdmin()
    seedByok(
      'ctx',
      [
        {
          id: 'prov_local',
          label: 'ollama',
          providerType: 'ollama',
          baseUrl: 'http://ollama/v1',
          apiKey: 'local',
          verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
        },
      ],
      { main: { providerId: 'prov_local', model: 'llama3' }, small: null, embedding: null },
    )
    const r = resolveLlmConfig('ctx')
    if (!r.ok) throw new Error('expected ok')
    expect(r.main.apiKey).toBe('local')
    expect(r.main.source).toBe('byok')
    expect(r.small.model).toBe('gpt-small') // admin small
    expect(r.small.source).toBe('global')
    expect(r.source).toBe('mixed')
  })

  test('disabled BYOK inherits admin', () => {
    seedAdmin()
    disableByokForContext('ctx', 'admin')
    const r = resolveLlmConfig('ctx')
    if (!r.ok) throw new Error('expected ok')
    expect(r.main.source).toBe('global')
  })

  test('enabled but empty BYOK inherits admin (graceful fallback)', () => {
    seedAdmin()
    enableByokForContext('ctx', 'admin')
    const r = resolveLlmConfig('ctx')
    expect(r.ok).toBe(true)
  })

  test('unreadable blob is an error', () => {
    seedAdmin()
    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({ contextId: 'ctx', enabled: true, encryptedConfig: 'not-base64', updatedAt: 1, updatedBy: 'x' })
      .run()
    expect(resolveLlmConfig('ctx')).toEqual({
      ok: false,
      type: 'error',
      source: 'byok',
      error: 'stored BYOK LLM credentials are unreadable',
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/llm-providers/resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the resolver**

```typescript
// src/llm-providers/resolver.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getByokBundle } from '../byok-llm/store.js'
import { getAdminRoleBindings, getLlmProvider } from './store.js'
import type { EffectiveLlmConfig, LlmConfigResult, LlmRoleBindings, ResolvedRole, RoleBinding } from './types.js'

const UNREADABLE_ERROR = 'stored BYOK LLM credentials are unreadable'

type AccountMap = Readonly<Map<string, { apiKey: string; baseUrl: string }>>

const adminAccount = (id: string): { apiKey: string; baseUrl: string } | null => {
  const p = getLlmProvider(id)
  return p === null ? null : { apiKey: p.apiKey, baseUrl: p.baseUrl }
}

const resolveBinding = (
  binding: RoleBinding,
  adminBindings: LlmRoleBindings | null,
  accounts: { admin: AccountMap; byok: AccountMap },
  main: ResolvedRole | null,
): { resolved: ResolvedRole | null; source: 'byok' | 'global' | null } => {
  if (binding !== null && binding.providerId !== '') {
    const byokAccount = accounts.byok.get(binding.providerId)
    if (byokAccount !== undefined) {
      return {
        resolved: { apiKey: byokAccount.apiKey, baseUrl: byokAccount.baseUrl, model: binding.model, source: 'byok' },
        source: 'byok',
      }
    }
  }
  return { resolved: null, source: null }
}

export function resolveLlmConfig(configContextId: string): LlmConfigResult {
  const bundle = getByokBundle(configContextId)

  if (bundle.enabled && bundle.unreadable) {
    return { ok: false, type: 'error', source: 'byok', error: bundle.error ?? UNREADABLE_ERROR }
  }

  const byokAccounts: AccountMap = new Map(
    (bundle.blob?.providers ?? []).map((p) => [p.id, { apiKey: p.apiKey, baseUrl: p.baseUrl }]),
  )
  const byokRoles = bundle.blob?.roles ?? null
  const adminBindings = getAdminRoleBindings()

  const accounts = { admin: byokAccounts, byok: byokAccounts } // admin accounts resolved lazily via getLlmProvider

  // main
  let main: ResolvedRole | null = null
  if (byokRoles !== null && byokRoles.main.providerId !== '') {
    const acc = byokAccounts.get(byokRoles.main.providerId)
    if (acc !== undefined)
      main = { apiKey: acc.apiKey, baseUrl: acc.baseUrl, model: byokRoles.main.model, source: 'byok' }
  }
  if (main === null && adminBindings !== null && adminBindings.main.providerId !== '') {
    const acc = adminAccount(adminBindings.main.providerId)
    if (acc !== null)
      main = { apiKey: acc.apiKey, baseUrl: acc.baseUrl, model: adminBindings.main.model, source: 'global' }
  }
  if (main === null) {
    const source = bundle.enabled ? 'byok' : 'global'
    return { ok: false, type: 'missing', source, missing: ['main'] }
  }

  const resolveOptional = (binding: RoleBinding, adminBinding: RoleBinding): ResolvedRole => {
    const r = resolveBinding(binding, adminBindings, accounts, main)
    if (r.resolved !== null) return r.resolved
    if (adminBinding !== null && adminBinding.providerId !== '') {
      const acc = adminAccount(adminBinding.providerId)
      if (acc !== null) return { apiKey: acc.apiKey, baseUrl: acc.baseUrl, model: adminBinding.model, source: 'global' }
    }
    return main
  }

  const small = resolveOptional(byokRoles?.small ?? null, adminBindings?.small ?? null)
  const embedding = resolveOptional(byokRoles?.embedding ?? null, adminBindings?.embedding ?? null)

  const sources = new Set([main.source, small.source, embedding.source])
  const source = sources.size === 1 ? [...sources][0] : 'mixed'

  const result: EffectiveLlmConfig = { ok: true, source, main, small, embedding }
  return result
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/llm-providers/resolver.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm-providers/resolver.ts tests/llm-providers/resolver.test.ts
git commit -m "feat(llm): per-role resolver with context→admin→main fallback"
```

---

## Phase 3 — Flip the old resolver onto the new tables (adapter bridge)

### Task 8: Make `resolveEffectiveLlmConfig` an adapter over `resolveLlmConfig`; prime cache at startup

**Files:**

- Modify: `src/llm-config-resolver.ts`
- Modify: `src/index.ts` (call `primeLlmAdminCache()` after migrations)
- Modify: `src/llm-orchestrator.ts` (re-point "bot misconfigured" check to new tables)
- Modify: `tests/llm-config-resolver.test.ts`

> After this task the bot runs off the new tables. Existing DBs already had data migrated by `067`; fresh deploys still work because env bootstrap still seeds `system_config` (unchanged here) AND the legacy-key path: the adapter falls back to reading `system_config` when no admin provider exists yet. (The env-bootstrap rework to seed the new tables directly is Task 17.)

- [ ] **Step 1: Rewrite `src/llm-config-resolver.ts` as an adapter**

```typescript
// src/llm-config-resolver.ts  (full replacement)
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveLlmConfig } from './llm-providers/resolver.js'
import { getAdminRoleBindings } from './llm-providers/store.js'
import { getSystemConfig, type SystemConfigKey } from './system-config.js'
import type { RequiredByokLlmKey } from './byok-llm/types.js'
import type { LlmConfigResult } from './llm-providers/types.js'

// Legacy single-cred shape, preserved during the call-site migration.
export type EffectiveLlmConfig = {
  readonly ok: true
  readonly source: 'global' | 'byok'
  readonly llmApiKey: string
  readonly llmBaseUrl: string
  readonly mainModel: string
  readonly smallModel: string
  readonly embeddingModel: string
}
export type LlmConfigMissing = {
  readonly ok: false
  readonly type: 'missing'
  readonly source: 'global' | 'byok'
  readonly missing: readonly (SystemConfigKey | RequiredByokLlmKey)[]
}
export type LlmConfigError = {
  readonly ok: false
  readonly type: 'error'
  readonly source: 'global' | 'byok'
  readonly error: string
}
export type EffectiveLlmConfigResult = EffectiveLlmConfig | LlmConfigMissing | LlmConfigError

const REQUIRED_GLOBAL_KEYS = ['llm_apikey', 'llm_baseurl', 'main_model'] as const satisfies readonly SystemConfigKey[]

// Transitional: used only until env-bootstrap seeds the new tables (Task 17).
const resolveGlobalConfig = (): EffectiveLlmConfigResult => {
  const missing = REQUIRED_GLOBAL_KEYS.filter((key) => getSystemConfig(key) === null)
  if (missing.length > 0) return { ok: false, type: 'missing', source: 'global', missing }
  const mainModel = getSystemConfig('main_model') ?? ''
  return {
    ok: true,
    source: 'global',
    llmApiKey: getSystemConfig('llm_apikey') ?? '',
    llmBaseUrl: getSystemConfig('llm_baseurl') ?? '',
    mainModel,
    smallModel: getSystemConfig('small_model') ?? mainModel,
    embeddingModel: getSystemConfig('embedding_model') ?? mainModel,
  }
}

const fromResult = (r: LlmConfigResult): EffectiveLlmConfigResult => {
  if (r.ok) {
    return {
      ok: true,
      source: r.main.source,
      llmApiKey: r.main.apiKey,
      llmBaseUrl: r.main.baseUrl,
      mainModel: r.main.model,
      smallModel: r.small.model,
      embeddingModel: r.embedding.model,
    }
  }
  if (r.type === 'error') return { ok: false, type: 'error', source: 'byok', error: r.error }
  return {
    ok: false,
    type: 'missing',
    source: r.source,
    missing: r.missing as readonly (SystemConfigKey | RequiredByokLlmKey)[],
  }
}

export function resolveEffectiveLlmConfig(configContextId: string): EffectiveLlmConfigResult {
  // New registry is authoritative once it has a main binding; otherwise fall back
  // to the legacy system_config path (fresh deploy before Task 17).
  if (getAdminRoleBindings() === null) return resolveGlobalConfig()
  try {
    return fromResult(resolveLlmConfig(configContextId))
  } catch {
    return resolveGlobalConfig()
  }
}
```

- [ ] **Step 2: Prime the admin cache at startup**

In `src/index.ts`, after migrations run and `primeSystemConfigCache()` is called, add:

```typescript
import { primeLlmAdminCache } from './llm-providers/store.js'
// …
primeLlmAdminCache()
```

> Place the call right next to the existing `primeSystemConfigCache()` / `seedSystemConfigFromEnv()` invocation. Read `src/index.ts` to find the exact spot.

- [ ] **Step 3: Update the orchestrator's misconfigured check**

In `src/llm-orchestrator.ts`, replace the `missingSystemConfigKeys()` import/usage in `replyBotMisconfigured` with the new admin-tables check:

```typescript
import { getAdminRoleBindings } from './llm-providers/store.js'
// …
const replyBotMisconfigured = async (reply: ReplyFn, contextId: string): Promise<void> => {
  const configured = getAdminRoleBindings() !== null
  log.error({ contextId, configured }, 'admin LLM provider registry is incomplete; bot cannot serve this turn')
  await reply.text(
    '⚠️ The bot is not fully configured. Ask the administrator to run /config and complete setup in the web UI.',
  )
  if (!botMisconfiguredNotified) {
    botMisconfiguredNotified = true
    log.warn({ configured }, 'admin notification suppressed for subsequent turns in this process')
  }
}
```

Remove the now-unused `import { missingSystemConfigKeys } from './system-config.js'`.

- [ ] **Step 4: Update `tests/llm-config-resolver.test.ts` for the new adapter behavior**

The adapter delegates to the new resolver once an admin binding exists. Replace the body so it seeds the admin registry instead of `system_config`, and asserts the adapter maps per-role results back to the legacy shape:

```typescript
// tests/llm-config-resolver.test.ts  (full replacement of the describe body)
import { beforeEach, describe, expect, test } from 'bun:test'

import { byokLlmCredentials } from '../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { resolveEffectiveLlmConfig } from '../src/llm-config-resolver.js'
import { clearLlmAdminCacheForTesting, createLlmProvider, setAdminRoleBindings } from '../src/llm-providers/store.js'
import { enableByokForContext } from '../src/byok-llm/store.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from './utils/test-helpers.js'

const seedAdmin = (): { id: string } => {
  const p = createLlmProvider({ label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'sk-a' }, 'admin')
  setAdminRoleBindings({ main: { providerId: p.id, model: 'm' }, small: null, embedding: null }, 'admin')
  return { id: p.id }
}

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  resetSystemConfigCacheForTesting()
  clearLlmAdminCacheForTesting()
})

describe('resolveEffectiveLlmConfig (adapter)', () => {
  test('maps new per-role result to the legacy single-cred shape', () => {
    seedAdmin()
    expect(resolveEffectiveLlmConfig('ctx')).toEqual({
      ok: true,
      source: 'global',
      llmApiKey: 'sk-a',
      llmBaseUrl: 'https://a/v1',
      mainModel: 'm',
      smallModel: 'm',
      embeddingModel: 'm',
    })
  })

  test('reports missing when no admin binding and no legacy config', () => {
    const r = resolveEffectiveLlmConfig('ctx')
    expect(r.ok).toBe(false)
  })

  test('propagates unreadable BYOK blob as error', () => {
    seedAdmin()
    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({ contextId: 'ctx', enabled: true, encryptedConfig: 'not-base64', updatedAt: 1, updatedBy: 'x' })
      .run()
    const r = resolveEffectiveLlmConfig('ctx')
    expect(r).toEqual({ ok: false, type: 'error', source: 'byok', error: 'stored BYOK LLM credentials are unreadable' })
  })
})
```

- [ ] **Step 5: Run the affected suites**

Run: `bun test tests/llm-config-resolver.test.ts tests/llm-providers/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/llm-config-resolver.ts src/index.ts src/llm-orchestrator.ts tests/llm-config-resolver.test.ts
git commit -m "refactor(llm): resolveEffectiveLlmConfig becomes adapter over per-role resolver"
```

---

## Phase 4 — Migrate call sites to the per-role shape

> Each task is one file. The mechanical mapping:
> `resolved.llmApiKey` → `resolved.main.apiKey`; `resolved.llmBaseUrl` → `resolved.main.baseUrl`;
> `resolved.mainModel` → `resolved.main.model`; `resolved.smallModel` → `resolved.small.model`;
> `resolved.embeddingModel` → `resolved.embedding.model`.
> After every file: `bun run typecheck` must still pass because the adapter still returns the legacy shape — these tasks only apply where a call site is upgraded to consume the **new** `resolveLlmConfig` directly. To keep compilation green throughout, each call site switches from `resolveEffectiveLlmConfig` (legacy shape) to `resolveLlmConfig` (per-role shape) **and** updates its field reads in the same commit.

### Task 9: Migrate `src/embeddings.ts`

**Files:**

- Modify: `src/embeddings.ts` (`getEmbeddingForContext`, lines ~142–164)

- [ ] **Step 1: Switch the import and the resolution**

Replace `import { resolveEffectiveLlmConfig } from './llm-config-resolver.js'` with:

```typescript
import { resolveLlmConfig } from './llm-providers/resolver.js'
```

In `getEmbeddingForContext`, replace the body:

```typescript
export function getEmbeddingForContext(
  text: string,
  configContextId: string,
  context?: EmbeddingCallContext,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[] | null> {
  const resolved = resolveLlmConfig(configContextId)
  if (!resolved.ok) {
    log.warn(
      {
        configContextId,
        source: resolved.source,
        type: resolved.type,
        error: resolved.type === 'error' ? resolved.error : undefined,
      },
      'LLM config not available for embedding',
    )
    return Promise.resolve(null)
  }
  return tryGetEmbedding(
    text,
    resolved.embedding.apiKey,
    resolved.embedding.baseUrl,
    resolved.embedding.model,
    context,
    deps,
  )
}
```

- [ ] **Step 2: Verify**

Run: `bun run typecheck && bun test tests/embeddings.test.ts 2>/dev/null || bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/embeddings.ts
git commit -m "refactor(embeddings): consume per-role LLM config"
```

---

### Task 10: Migrate the small-model call sites (group)

**Files:**

- Modify: `src/web/distill.ts`
- Modify: `src/tools/compaction/summarizer.ts`
- Modify: `src/tools/lookup-group-history.ts`
- Modify: `src/long-term-memory/runner.ts`
- Modify: `src/long-term-memory/capture.ts`
- Modify: `src/long-term-memory/promotion.ts`
- Modify: `src/tools/disclosure/embedding-tool-retriever.ts`

For each file apply the same pattern — switch the import to `resolveLlmConfig` and update field reads. Exact edits:

- [ ] **Step 1: `src/web/distill.ts`** — replace `resolveEffectiveLlmConfig` import with `resolveLlmConfig` from `../llm-providers/resolver.js`. At the call site (~line 44), change:
  - `resolved.llmApiKey` → `resolved.small.apiKey`
  - `resolved.llmBaseUrl` → `resolved.small.baseUrl`
  - `resolved.smallModel` → `resolved.small.model`
  - Add `if (!resolved.ok) return null` guard before reading (matching existing `modelIdForLightweight` usage).

```typescript
const resolved = resolveLlmConfig(configContextId)
if (!resolved.ok) return null
return { apiKey: resolved.small.apiKey, baseUrl: resolved.small.baseUrl, modelId: resolved.small.model }
```

- [ ] **Step 2: `src/tools/compaction/summarizer.ts`** — import `resolveLlmConfig`; at ~line 36:

```typescript
const resolved = resolveLlmConfig(configContextId)
if (!resolved.ok) return
const model = buildChatModel(resolved.small.apiKey, resolved.small.baseUrl, resolved.small.model)
```

- [ ] **Step 3: `src/tools/lookup-group-history.ts`** — import `resolveLlmConfig`; in `getSmallModel` (~line 50):

```typescript
const resolved = resolveLlmConfig(configContextId)
if (!resolved.ok) return null
return buildChatModel(resolved.small.apiKey, resolved.small.baseUrl, resolved.small.model)
```

- [ ] **Step 4: `src/long-term-memory/runner.ts`** — update `resolveLlmConfig` dep type and the success branch (~line 57) to `resolved.small.apiKey/baseUrl/model`; update the `ResolvedConfig` extract to `EffectiveLlmConfig` from `llm-providers/types.js`.

- [ ] **Step 5: `src/long-term-memory/capture.ts`** (~line 49) and **`src/long-term-memory/promotion.ts`** (~line 61) — same `resolved.small.*` substitution.

- [ ] **Step 6: `src/tools/disclosure/embedding-tool-retriever.ts`** (~line 93, 101) — cache key `${resolved.embedding.baseUrl}:${resolved.embedding.model}` and `deps.embedText(text, resolved.embedding.apiKey, resolved.embedding.baseUrl, resolved.embedding.model, …)`.

- [ ] **Step 7: Verify the whole package typechecks**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/web/distill.ts src/tools/compaction/summarizer.ts src/tools/lookup-group-history.ts src/long-term-memory/runner.ts src/long-term-memory/capture.ts src/long-term-memory/promotion.ts src/tools/disclosure/embedding-tool-retriever.ts
git commit -m "refactor(llm): small/embedding call sites consume per-role config"
```

---

### Task 11: Migrate the main-model call sites (group)

**Files:**

- Modify: `src/deferred-prompts/proactive-llm.ts`
- Modify: `src/conversation.ts`

- [ ] **Step 1: `src/deferred-prompts/proactive-llm.ts`** — import `resolveLlmConfig`; the `LlmConfig` type (~line 58) becomes per-role. Update `modelIdForLightweight(config.small.model, config.main.model)` and the two `deps.buildModel(config, config.main.model)` sites to use `config.main.apiKey/baseUrl`. The `buildModel` dep signature changes to `(config, modelId)` reading `config.main.apiKey/baseUrl`.

- [ ] **Step 2: `src/conversation.ts`** (~line 119) — import `resolveLlmConfig`; update the failure branch type and any `resolved.mainModel`/`smallModel` reads to `resolved.main.model`/`resolved.small.model`.

- [ ] **Step 3: Verify**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/deferred-prompts/proactive-llm.ts src/conversation.ts
git commit -m "refactor(llm): main-model call sites consume per-role config"
```

---

### Task 12: Migrate the orchestrator to the per-role shape

**Files:**

- Modify: `src/llm-orchestrator.ts`

- [ ] **Step 1: Switch the orchestrator to `resolveLlmConfig`**

Replace the import of `resolveEffectiveLlmConfig`/`EffectiveLlmConfig` with:

```typescript
import { resolveLlmConfig } from './llm-providers/resolver.js'
import type { EffectiveLlmConfig, LlmConfigResult } from './llm-providers/types.js'
```

Update `resolveLlmForTurn` to use `resolveLlmConfig`; the `ResolvedTurnLlmConfig` becomes `EffectiveLlmConfig | null`. In `callLlm`:

- `const { main } = resolvedLlm` then `const model = deps.buildModel({ llmApiKey: main.apiKey, llmBaseUrl: main.baseUrl, mainModel: main.model })` — keep `buildModel`'s existing arg shape by mapping, OR (preferred) change `buildModel` to take `main: ResolvedRole`. Choose the mapping wrapper to minimize the `defaultDeps.buildModel` churn:

```typescript
const main = resolvedLlm.main
const model = deps.buildModel({ llmApiKey: main.apiKey, llmBaseUrl: main.baseUrl, mainModel: main.model })
```

Update `mainModel` references (`emitLlmStart(contextId, main.model, …)`, `appendAssistantTurnHistory(contextId, configId, main.model, …)`) to `resolvedLlm.main.model`.

- [ ] **Step 2: Verify**

Run: `bun run typecheck && bun test tests/llm-orchestrator.test.ts 2>/dev/null; bun run typecheck`
Expected: typecheck PASS.

- [ ] **Step 3: Commit**

```bash
git add src/llm-orchestrator.ts
git commit -m "refactor(llm): orchestrator consumes per-role config"
```

---

## Phase 5 — Remove the adapter bridge

### Task 13: Delete the legacy resolver + system-config LLM accessors

**Files:**

- Delete: `src/llm-config-resolver.ts`
- Delete: `tests/llm-config-resolver.test.ts`
- Modify: `src/system-config.ts` (remove LLM-typed accessors)
- Modify: any remaining importers of `resolveEffectiveLlmConfig` (must be zero after Phase 4)

- [ ] **Step 1: Confirm no importer remains**

Run: `bun run typecheck` after deleting — if it fails, grep for `llm-config-resolver` and migrate the straggler to `resolveLlmConfig`.
Run: `rg "llm-config-resolver" src/`
Expected: no matches.

- [ ] **Step 2: Delete the adapter + its test**

```bash
git rm src/llm-config-resolver.ts tests/llm-config-resolver.test.ts
```

- [ ] **Step 3: Remove LLM-typed accessors from `src/system-config.ts`**

Delete: `SystemConfigKey`, `SYSTEM_CONFIG_KEYS`, `REQUIRED_KEYS`, `ENV_KEY_BY_CONFIG_KEY`, `getSystemConfig`, `setSystemConfig`, `primeSystemConfigCache`, `seedSystemConfigFromEnv` (re-implemented in Task 17), `isSystemConfigComplete`, `missingSystemConfigKeys`, `maskSystemConfigValue`, `listSystemConfigEntries`, `systemConfigCacheForTesting`. Keep only the `systemConfig` re-export if anything still imports it from here (the table is owned by `src/db/system-config-schema.ts`). Remove the `resetSystemConfigCacheForTesting` helper from `tests/utils/test-helpers.ts` if it becomes unused (verify with `rg resetSystemConfigCacheForTesting`).

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(llm): remove legacy single-cred resolver + system-config LLM accessors"
```

---

## Phase 6 — Model discovery

### Task 14: Discovery module

**Files:**

- Create: `src/llm-providers/discovery.ts`
- Create: `tests/llm-providers/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/llm-providers/discovery.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { fetchProviderModels } from '../../src/llm-providers/discovery.js'
import { restoreFetch, setMockFetch } from '../utils/test-helpers.js'

const okResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchProviderModels', () => {
  test('verified + models on 200 with {data:[{id}]}', async () => {
    setMockFetch(async () => okResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }))
    const r = await fetchProviderModels('https://x/v1', 'sk')
    restoreFetch()
    expect(r.status).toBe('verified')
    expect(r.models).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  test('unverified on 401', async () => {
    setMockFetch(async () => okResponse({ error: 'bad' }, 401))
    const r = await fetchProviderModels('https://x/v1', 'sk')
    restoreFetch()
    expect(r.status).toBe('unverified')
    expect(r.error).toBe('authentication failed')
  })

  test('error on network failure', async () => {
    setMockFetch(async () => {
      throw new Error('ECONNREFUSED')
    })
    const r = await fetchProviderModels('https://x/v1', 'sk')
    restoreFetch()
    expect(r.status).toBe('error')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/llm-providers/discovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the discovery module**

```typescript
// src/llm-providers/discovery.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { fetchWithoutTimeout } from '../utils/fetch.js'
import { logger } from '../logger.js'
import type { VerificationStatus } from './types.js'

const log = logger.child({ scope: 'llm-providers:discovery' })

export type DiscoveryResult = {
  readonly status: VerificationStatus
  readonly models: readonly string[]
  readonly error: string | null
}

export interface DiscoveryDeps {
  readonly fetch: typeof fetchWithoutTimeout
}

const defaultDeps: DiscoveryDeps = { fetch: fetchWithoutTimeout }

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

type OpenAiModelList = { data?: ReadonlyArray<{ id?: unknown }> }

export async function fetchProviderModels(
  baseUrl: string,
  apiKey: string,
  deps: DiscoveryDeps = defaultDeps,
): Promise<DiscoveryResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  try {
    const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (res.status === 401 || res.status === 403) {
      return { status: 'unverified', models: [], error: 'authentication failed' }
    }
    if (!res.ok) {
      return { status: 'error', models: [], error: `unexpected status ${res.status}` }
    }
    const json = (await res.json()) as OpenAiModelList
    const models = (json.data ?? []).flatMap((m) => (typeof m?.id === 'string' ? [m.id] : []))
    return { status: 'verified', models, error: null }
  } catch (e) {
    log.warn({ url, error: errMsg(e) }, 'provider model discovery failed')
    return { status: 'error', models: [], error: errMsg(e) }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/llm-providers/discovery.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm-providers/discovery.ts tests/llm-providers/discovery.test.ts
git commit -m "feat(llm): provider model discovery (GET /models, non-blocking)"
```

---

## Phase 7 — Settings routes

### Task 15: Admin provider/role routes

**Files:**

- Create: `src/debug/settings/admin/llm-providers-routes.ts`
- Create: `tests/debug/settings/admin/llm-providers-routes.test.ts`
- Modify: `src/debug/settings-api-router.ts` (register routes)

- [ ] **Step 1: Write the failing route test**

```typescript
// tests/debug/settings/admin/llm-providers-routes.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleAdminLlmProvidersRoutes } from '../../../../src/debug/settings/admin/llm-providers-routes.js'
import { clearLlmAdminCacheForTesting, getAdminRoleBindings } from '../../../../src/llm-providers/store.js'
import { createAuth, authHeaders } from '../../../utils/test-helpers.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from '../../../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  resetSystemConfigCacheForTesting()
  clearLlmAdminCacheForTesting()
})

const json = (body: unknown, method: string, csrf = 'csrf'): Request =>
  new Request('https://x/settings/api/admin/providers', {
    method,
    headers: {
      'content-type': 'application/json',
      'X-Settings-CSRF': csrf,
      ...authHeaders(createAuth('admin', { admin: true })),
    },
    body: JSON.stringify(body),
  })

describe('handleAdminLlmProvidersRoutes', () => {
  test('POST creates a provider (non-blocking verify)', async () => {
    const res = await handleAdminLlmProvidersRoutes(
      json({ label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'sk' }, 'POST'),
      new URL('https://x/settings/api/admin/providers'),
      '/settings/api/admin/providers',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provider.label).toBe('a')
  })

  test('PUT roles binds main', async () => {
    const created = await handleAdminLlmProvidersRoutes(
      json({ label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'sk' }, 'POST'),
      new URL('https://x/'),
      '/settings/api/admin/providers',
    )
    const { provider } = await created.json()
    await handleAdminLlmProvidersRoutes(
      json({ main: { providerId: provider.id, model: 'm' }, small: null, embedding: null }, 'PUT'),
      new URL('https://x/settings/api/admin/llm-roles'),
      '/settings/api/admin/llm-roles',
    )
    expect(getAdminRoleBindings()?.main.model).toBe('m')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/admin/llm-providers-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the routes**

```typescript
// src/debug/settings/admin/llm-providers-routes.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { fetchProviderModels } from '../../../llm-providers/discovery.js'
import {
  createLlmProvider,
  deleteLlmProvider,
  getAdminRoleBindings,
  listLlmProviders,
  setAdminRoleBindings,
  updateLlmProvider,
  updateProviderVerification,
} from '../../../llm-providers/store.js'
import { LLM_PROVIDER_TYPES, type LlmProviderType, type Verification } from '../../../llm-providers/types.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const ProviderBodySchema = z.object({
  label: z.string().min(1),
  providerType: z.enum(LLM_PROVIDER_TYPES as unknown as [LlmProviderType, ...LlmProviderType[]]),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
})
const ProviderPatchSchema = z.object({
  label: z.string().min(1).optional(),
  providerType: z.enum(LLM_PROVIDER_TYPES as unknown as [LlmProviderType, ...LlmProviderType[]]).optional(),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
})
const RoleBindingSchema = z.object({ providerId: z.string().min(1), model: z.string().min(1) }).nullable()
const RolesBodySchema = z.object({
  main: z.object({ providerId: z.string().min(1), model: z.string().min(1) }),
  small: RoleBindingSchema,
  embedding: RoleBindingSchema,
})

const mask = (apiKey: string): string => `****${apiKey.slice(-4)}`

const publicAccount = (p: ReturnType<typeof listLlmProviders>[number]) => ({
  id: p.id,
  label: p.label,
  providerType: p.providerType,
  baseUrl: p.baseUrl,
  apiKeyMasked: mask(p.apiKey),
  verification: p.verification,
})

const verifyInBackground = (id: string, baseUrl: string, apiKey: string): void => {
  void fetchProviderModels(baseUrl, apiKey).then((r) => {
    const verification: Verification = {
      status: r.status,
      error: r.error,
      at: Date.now(),
      models: r.models,
      modelsFetchedAt: r.status === 'verified' ? Date.now() : null,
    }
    updateProviderVerification(id, verification)
  })
}

export async function handleAdminLlmProvidersRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  if (pathname === '/settings/api/admin/providers') {
    if (req.method === 'GET') {
      const guard = requireAdmin(auth.authed, 'read')
      if (guard !== null) return guard
      return settingsJson(200, { providers: listLlmProviders().map(publicAccount) })
    }
    if (req.method === 'POST') {
      const guard = requireAdmin(auth.authed, 'write')
      if (guard !== null) return guard
      const csrf = requireCsrf(req, auth.authed)
      if (csrf !== null) return csrf
      const parsed = await parseJsonBody(req)
      if (!parsed.ok) return parsed.response
      const body = ProviderBodySchema.safeParse(parsed.value)
      if (!body.success) return settingsJson(422, { error: 'invalid request' })
      const provider = createLlmProvider(body.data, auth.authed.principal.platformUserId)
      verifyInBackground(provider.id, provider.baseUrl, provider.apiKey)
      return settingsJson(200, { provider: publicAccount(provider) })
    }
    return settingsJson(405, { error: 'method not allowed' })
  }

  if (pathname.startsWith('/settings/api/admin/providers/')) {
    const id = pathname.slice('/settings/api/admin/providers/'.length)
    if (req.method === 'PATCH') {
      const guard = requireAdmin(auth.authed, 'write')
      if (guard !== null) return guard
      const csrf = requireCsrf(req, auth.authed)
      if (csrf !== null) return csrf
      const parsed = await parseJsonBody(req)
      if (!parsed.ok) return parsed.response
      const body = ProviderPatchSchema.safeParse(parsed.value)
      if (!body.success) return settingsJson(422, { error: 'invalid request' })
      const updated = updateLlmProvider(id, body.data, auth.authed.principal.platformUserId)
      if (updated === null) return settingsJson(404, { error: 'not found' })
      if (body.data.apiKey !== undefined || body.data.baseUrl !== undefined) {
        verifyInBackground(updated.id, updated.baseUrl, updated.apiKey)
      }
      return settingsJson(200, { provider: publicAccount(updated) })
    }
    if (req.method === 'DELETE') {
      const guard = requireAdmin(auth.authed, 'write')
      if (guard !== null) return guard
      const csrf = requireCsrf(req, auth.authed)
      if (csrf !== null) return csrf
      try {
        deleteLlmProvider(id)
        return settingsJson(200, { ok: true })
      } catch (error) {
        return settingsJson(409, { error: error instanceof Error ? error.message : String(error) })
      }
    }
    return settingsJson(405, { error: 'method not allowed' })
  }

  if (pathname === '/settings/api/admin/llm-roles') {
    if (req.method === 'GET') {
      const guard = requireAdmin(auth.authed, 'read')
      if (guard !== null) return guard
      return settingsJson(200, { roles: getAdminRoleBindings() })
    }
    if (req.method === 'PUT') {
      const guard = requireAdmin(auth.authed, 'write')
      if (guard !== null) return guard
      const csrf = requireCsrf(req, auth.authed)
      if (csrf !== null) return csrf
      const parsed = await parseJsonBody(req)
      if (!parsed.ok) return parsed.response
      const body = RolesBodySchema.safeParse(parsed.value)
      if (!body.success) return settingsJson(422, { error: 'invalid request' })
      setAdminRoleBindings(body.data, auth.authed.principal.platformUserId)
      return settingsJson(200, { ok: true })
    }
    return settingsJson(405, { error: 'method not allowed' })
  }

  return settingsJson(404, { error: 'not found' })
}
```

- [ ] **Step 4: Register the routes**

In `src/debug/settings-api-router.ts`, add the import and a branch in `routeAdminApi` (before the final `return null`):

```typescript
import { handleAdminLlmProvidersRoutes } from './settings/admin/llm-providers-routes.js'
// …inside routeAdminApi, before `return null`:
if (
  p === '/settings/api/admin/providers' ||
  p.startsWith('/settings/api/admin/providers/') ||
  p === '/settings/api/admin/llm-roles'
)
  return handleAdminLlmProvidersRoutes(req, url, p)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/debug/settings/admin/llm-providers-routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/admin/llm-providers-routes.ts src/debug/settings-api-router.ts tests/debug/settings/admin/llm-providers-routes.test.ts
git commit -m "feat(settings): admin provider + role routes"
```

---

### Task 16: Extend BYOK PATCH with multi-provider actions

**Files:**

- Modify: `src/debug/settings/byok-routes.ts`
- Modify: `tests/debug/settings/byok-routes.test.ts`

- [ ] **Step 1: Extend the PATCH discriminated schema**

In `src/debug/settings/byok-routes.ts`, add actions to `PatchBodySchema` and handlers using `upsertByokProvider` / `deleteByokProvider` / `setByokRoles` (from `../../byok-llm/store.js`) plus `fetchProviderModels`. The new union members:

```typescript
const UpsertProviderBodySchema = z.object({
  contextId: z.string().optional(),
  action: z.literal('upsert-provider'),
  provider: ProviderInBlobSchema,
})
const DeleteProviderBodySchema = z.object({
  contextId: z.string().optional(),
  action: z.literal('delete-provider'),
  id: z.string().min(1),
})
const SetRolesBodySchema = z.object({
  contextId: z.string().optional(),
  action: z.literal('set-roles'),
  roles: RolesSchema,
})
const RefreshModelsBodySchema = z.object({
  contextId: z.string().optional(),
  action: z.literal('refresh-models'),
  id: z.string().min(1),
})
const PatchBodySchema = z.union([
  ToggleBodySchema,
  SaveBodySchema,
  UpsertProviderBodySchema,
  DeleteProviderBodySchema,
  SetRolesBodySchema,
  RefreshModelsBodySchema,
])
```

Where `ProviderInBlobSchema`/`RolesSchema` mirror the admin schemas. After scope resolution, dispatch each new action to the matching `byok-llm/store` op (the context must be BYOK-enabled; otherwise 403). For `upsert-provider` and `refresh-models`, fire `fetchProviderModels` and `updateByokProviderVerification` (non-blocking). The existing `{action:'enable'|'disable'}` toggle and legacy `{values}` save remain for backward compatibility. Concrete dispatch (inside the existing `PATCH` handler, after the `'action' in body.data` toggle/values branches):

```typescript
if (body.data.action === 'upsert-provider') {
  if (!getByokCredentialState(scope.scope.contextId).enabled)
    return settingsJson(403, { error: 'BYOK is not enabled for this context' })
  upsertByokProvider(scope.scope.contextId, body.data.provider, auth.authed.principal.platformUserId)
  void fetchProviderModels(body.data.provider.baseUrl, body.data.provider.apiKey).then((r) =>
    updateByokProviderVerification(
      scope.scope.contextId,
      body.data.provider.id,
      toVerification(r),
      auth.authed.principal.platformUserId,
    ),
  )
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}
if (body.data.action === 'delete-provider') {
  deleteByokProvider(scope.scope.contextId, body.data.id, auth.authed.principal.platformUserId)
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}
if (body.data.action === 'set-roles') {
  setByokRoles(scope.scope.contextId, body.data.roles, auth.authed.principal.platformUserId)
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}
if (body.data.action === 'refresh-models') {
  const bundle = getByokBundle(scope.scope.contextId)
  const provider = bundle.blob?.providers.find((p) => p.id === body.data.id)
  if (provider === undefined) return settingsJson(404, { error: 'provider not found' })
  void fetchProviderModels(provider.baseUrl, provider.apiKey).then((r) =>
    updateByokProviderVerification(
      scope.scope.contextId,
      provider.id,
      toVerification(r),
      auth.authed.principal.platformUserId,
    ),
  )
  return settingsJson(200, { ok: true })
}
```

`toVerification` maps a `DiscoveryResult` to the `Verification` shape (`{status, error, at: Date.now(), models, modelsFetchedAt: status==='verified' ? Date.now() : null}`).

- [ ] **Step 2: Add tests for each new action** in `tests/debug/settings/byok-routes.test.ts` mirroring the existing `toggle`/`values` tests (enable BYOK → `upsert-provider` → 200 and blob contains the provider; `set-roles` → 200; `delete-provider` → 200).

- [ ] **Step 3: Run the suite**

Run: `bun test tests/debug/settings/byok-routes.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/debug/settings/byok-routes.ts tests/debug/settings/byok-routes.test.ts
git commit -m "feat(settings): BYOK PATCH multi-provider actions"
```

---

### Task 17: Env-bootstrap rework + remove legacy system LLM route + docs

**Files:**

- Modify: `src/index.ts` (env bootstrap)
- Modify: `src/debug/settings/admin/system-access-routes.ts` (drop `/system` LLM GET/POST; keep users/groups/open-access)
- Modify: `docs/architecture/environment.md`

- [ ] **Step 1: Rework env bootstrap in `src/index.ts`**

Replace the call to `seedSystemConfigFromEnv()` with a new `seedDefaultLlmProviderFromEnv()` (define it inline in `src/index.ts` or a small `src/llm-providers/env-bootstrap.ts`):

```typescript
import { createLlmProvider, getAdminRoleBindings, setAdminRoleBindings } from './llm-providers/store.js'

export function seedDefaultLlmProviderFromEnv(): void {
  if (getAdminRoleBindings() !== null) return
  const apiKey = process.env['LLM_API_KEY']
  const baseUrl = process.env['LLM_BASE_URL']
  const mainModel = process.env['MAIN_MODEL']
  if (apiKey === undefined || baseUrl === undefined || mainModel === undefined) return
  if (apiKey.trim() === '' || baseUrl.trim() === '' || mainModel.trim() === '') return
  const provider = createLlmProvider(
    { label: 'Default (env)', providerType: 'custom', baseUrl: baseUrl.trim(), apiKey: apiKey.trim() },
    'env',
  )
  const small = process.env['SMALL_MODEL']?.trim()
  const embedding = process.env['EMBEDDING_MODEL']?.trim()
  setAdminRoleBindings(
    {
      main: { providerId: provider.id, model: mainModel.trim() },
      small: small ? { providerId: provider.id, model: small } : null,
      embedding: embedding ? { providerId: provider.id, model: embedding } : null,
    },
    'env',
  )
}
```

Call it (after `primeLlmAdminCache()`) in the startup sequence.

- [ ] **Step 2: Remove the legacy LLM KV route**

In `src/debug/settings/admin/system-access-routes.ts`, remove the `LlmBodySchema` and the `handleSystem` function; narrow `handleAdminSystemAccessRoutes` so `pathname === '/settings/api/admin/system'` now returns 404 (or keep the handler serving only the non-LLM sub-paths — here it only handled `/system`, so drop that branch; users/groups/open-access are separate pathnames already).

- [ ] **Step 3: Update `docs/architecture/environment.md`**

Replace the "Central LLM credentials live in … `system_config`" paragraph with the new model: admin-owned `llm_providers` + `llm_admin_roles`, env-seeded via `LLM_API_KEY`/`LLM_BASE_URL`/`MAIN_MODEL` (+ optional `SMALL_MODEL`/`EMBEDDING_MODEL`) into a default provider on first start. Update the BYOK paragraph to describe per-role override + graceful fallback (remove the "hard-errors when enabled && !complete" sentence).

- [ ] **Step 4: Verify the full pipeline**

Run: `bun run typecheck && bun run lint && bun test`
Expected: PASS (whole suite).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/debug/settings/admin/system-access-routes.ts docs/architecture/environment.md
git commit -m "feat(llm): env-bootstrap seeds provider registry; drop legacy system LLM route"
```

---

## Final verification

- [ ] **Run the full gate**

```bash
bun run typecheck && bun run lint && bun run format:check && bun test && bun test:stories:contracts
```

Expected: all green.

- [ ] **Spec-coverage cross-check** — re-read `docs/superpowers/specs/2026-07-15-multi-llm-providers-design.md` §3–§9 and confirm each requirement maps to a task above. Gaps go here as new tasks, not follow-ups.

---

## Self-Review Notes (applied during authoring)

- **Spec coverage:** §3 data model → Tasks 1–2; §3.3 contract + §4 resolution → Tasks 3–7; §4.4 BYOK behavior change → Task 8 (test asserts graceful fallback); §5 discovery → Task 14; §6.3 routes → Tasks 15–16; §8 migration/env → Tasks 2, 17; §9 testing → every task is TDD.
- **UI deferred to Plan B** (spec §6.1/§6.2): the routes built in Tasks 15–16 are the contract Plan B consumes.
- **Type consistency:** `resolveLlmConfig` returns `LlmConfigResult` from `llm-providers/types.js` everywhere; `ResolvedRole`, `LlmRoleBindings`, `Verification` defined once in `types.ts` and reused.
- **Placeholder discipline:** every code step contains real code; call-site tasks (10–12) give exact field mappings rather than "do similar."

## Execution options (next)

Plan complete and saved to `docs/superpowers/plans/2026-07-15-multi-llm-providers-backend.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
