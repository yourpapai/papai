<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# BYOK LLM Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-gated BYOK LLM credentials for selected personal/group contexts while non-enabled contexts continue using global LLM settings.

**Architecture:** Add a dedicated encrypted BYOK table and store module keyed by config context ID. Add a shared effective LLM config resolver, then route all context-bound LLM calls through it. Expose admin enablement and context-manager credential editing through settings APIs and Svelte settings UI.

**Tech Stack:** Bun, TypeScript, Drizzle SQLite schema, Bun migrations, Vercel AI SDK OpenAI-compatible provider, Svelte settings UI, `bun:test`.

---

## File Structure

Create or modify these files:

- Create `src/db/migrations/052_byok_llm_credentials.ts`: creates the `byok_llm_credentials` table.
- Modify `src/db/index.ts`: imports and registers migration 052 after migration 051.
- Create `tests/db/migrations/052_byok_llm_credentials.test.ts`: validates migration ID, table shape, and index creation.
- Create `src/db/byok-llm-schema.ts`: Drizzle schema for BYOK rows.
- Modify `src/db/schema.ts`: exports the BYOK schema.
- Create `tests/db/byok-llm-schema.test.ts`: schema-level insert/select smoke test.
- Create `src/instances/config-key.ts`: shared `INSTANCE_CONFIG_KEY` resolution and key-derivation logic.
- Create `src/secret-payload-crypto.ts`: shared AES-256-GCM encode/decode helpers using `resolveInstanceConfigKey()` from `src/instances/config-key.ts`.
- Modify `src/instances/encryption.ts`: delegates JSON payload encryption/decryption to the shared helper while preserving instance config API and re-exporting key-resolution helpers.
- Create `tests/secret-payload-crypto.test.ts`: round-trip, wrong key, and malformed payload tests.
- Create `src/byok-llm/types.ts`: BYOK payload, field, snapshot, and result types.
- Create `src/byok-llm/store.ts`: enable/disable, encrypted payload write, masked snapshots, admin summaries, and completeness checks.
- Create `tests/byok-llm/store.test.ts`: storage, masking, encryption, and completeness tests.
- Create `src/llm-config-resolver.ts`: effective global/BYOK resolver.
- Modify `src/llm-orchestrator-config.ts`: keeps compatibility helpers while delegating LLM resolution.
- Create `tests/llm-config-resolver.test.ts`: global/BYOK/missing/error resolution tests.
- Modify `tests/llm-orchestrator-config.test.ts`: update old central-only assertions for disabled BYOK and add compatibility assertions.
- Modify `src/llm-orchestrator.ts`: resolve BYOK-aware config for normal turns and pass config context into history trimming.
- Modify `src/conversation.ts`: accept config context for background trimming and use resolver.
- Modify `src/deferred-prompts/proactive-llm.ts`: resolve BYOK-aware config for lightweight/context/full modes.
- Modify `src/web/distill.ts`: accept optional config context and resolve BYOK-aware small model.
- Modify `src/embeddings.ts`: add a resolver-backed embedding helper or thread resolved config into existing calls.
- Modify `src/tools/lookup-group-history.ts`: use config context and resolver for small-model lookup.
- Modify tests for each touched caller: `tests/llm-orchestrator.test.ts`, `tests/deferred-prompts/proactive-llm.test.ts`, `tests/web/distill.test.ts`, `tests/conversation.test.ts`, `tests/tools/lookup-group-history.test.ts`, and `tests/embeddings.test.ts`.
- Create `src/debug/settings/byok-routes.ts`: context-manager BYOK credentials GET/PATCH routes.
- Create `src/debug/settings/admin/byok-routes.ts`: bot-admin BYOK status and enable/disable routes.
- Modify `src/debug/settings-api-router.ts`: routes `/settings/api/byok` and `/settings/api/admin/byok`.
- Create `tests/debug/settings/byok-routes.test.ts`: context route authorization and masking tests.
- Create `tests/debug/settings/admin/byok-routes.test.ts`: admin route authorization and enable/disable tests.
- Modify `client/settings/fetcher-schemas.ts`: BYOK response schemas and types.
- Modify `client/settings/fetchers.ts`: context BYOK fetch/patch functions.
- Modify `client/settings/admin-fetchers.ts`: admin BYOK fetch/patch functions.
- Create `client/settings/sections/ByokSection.svelte`: context credentials form.
- Create `client/settings/sections/admin/AdminByokSection.svelte`: admin enablement/status table.
- Modify `client/settings/SettingsApp.svelte`: adds BYOK sections to sidebar and page.
- Create `tests/client/settings/byok-fetchers.test.ts`, `tests/client/settings/byok-fetcher-schemas.test.ts`, `tests/client/settings/byok-section.test.ts`, and `tests/client/settings/admin-byok-section.test.ts`.

---

### Task 1: Migration And Schema

**Files:**

- Create: `src/db/migrations/052_byok_llm_credentials.ts`
- Modify: `src/db/index.ts`
- Create: `src/db/byok-llm-schema.ts`
- Modify: `src/db/schema.ts`
- Create: `tests/db/migrations/052_byok_llm_credentials.test.ts`
- Create: `tests/db/byok-llm-schema.test.ts`

- [ ] **Step 1: Write failing migration test**

Create `tests/db/migrations/052_byok_llm_credentials.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration052ByokLlmCredentials } from '../../../src/db/migrations/052_byok_llm_credentials.js'
import { mockLogger } from '../../utils/test-helpers.js'

const tableSql = (db: Database, name: string): string | null =>
  db.query<{ sql: string }, [string]>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
    ?.sql ?? null

const indexExists = (db: Database, name: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name) !==
  null

describe('migration052ByokLlmCredentials', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 052_byok_llm_credentials', () => {
    expect(migration052ByokLlmCredentials.id).toBe('052_byok_llm_credentials')
  })

  test('creates byok_llm_credentials table and updated index', () => {
    migration052ByokLlmCredentials.up(db)

    const sql = tableSql(db, 'byok_llm_credentials')
    expect(sql).toContain('context_id TEXT PRIMARY KEY')
    expect(sql).toContain('enabled INTEGER NOT NULL DEFAULT 0')
    expect(sql).toContain('encrypted_config TEXT')
    expect(sql).toContain('updated_at INTEGER NOT NULL')
    expect(sql).toContain('updated_by TEXT NOT NULL')
    expect(indexExists(db, 'idx_byok_llm_credentials_updated_at')).toBe(true)
  })

  test('allows enabled row without encrypted config for incomplete setup state', () => {
    migration052ByokLlmCredentials.up(db)
    db.run(
      `INSERT INTO byok_llm_credentials (context_id, enabled, encrypted_config, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
      ['ctx-1', 1, null, 1000, 'admin-1'],
    )

    expect(
      db.query(`SELECT enabled, encrypted_config FROM byok_llm_credentials WHERE context_id = 'ctx-1'`).get(),
    ).toEqual({
      enabled: 1,
      encrypted_config: null,
    })
  })
})
```

- [ ] **Step 2: Run migration test to verify it fails**

Run: `bun test tests/db/migrations/052_byok_llm_credentials.test.ts`

Expected: FAIL with module not found for `052_byok_llm_credentials.js`.

- [ ] **Step 3: Implement migration**

Create `src/db/migrations/052_byok_llm_credentials.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:052' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS byok_llm_credentials (
      context_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      encrypted_config TEXT,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_byok_llm_credentials_updated_at ON byok_llm_credentials (updated_at)`)
  log.info('migration 052: BYOK LLM credentials table created')
}

export const migration052ByokLlmCredentials: Migration = {
  id: '052_byok_llm_credentials',
  up,
}

export default migration052ByokLlmCredentials
```

- [ ] **Step 4: Register migration**

Modify `src/db/index.ts`:

```ts
import { migration052ByokLlmCredentials } from './migrations/052_byok_llm_credentials.js'
```

Add it after `migration051LegacyContextIdBackfill` in `MIGRATIONS`:

```ts
  migration051LegacyContextIdBackfill,
  migration052ByokLlmCredentials,
]
```

- [ ] **Step 5: Run migration test to verify it passes**

Run: `bun test tests/db/migrations/052_byok_llm_credentials.test.ts`

Expected: PASS.

- [ ] **Step 6: Write failing schema test**

Create `tests/db/byok-llm-schema.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { byokLlmCredentials } from '../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('byokLlmCredentials schema', () => {
  test('inserts and reads a BYOK row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({
        contextId: 'ctx-1',
        enabled: true,
        encryptedConfig: 'payload',
        updatedAt: 1710000000000,
        updatedBy: 'admin-1',
      })
      .run()

    const row = getDrizzleDb().select().from(byokLlmCredentials).get()
    expect(row).toEqual({
      contextId: 'ctx-1',
      enabled: true,
      encryptedConfig: 'payload',
      updatedAt: 1710000000000,
      updatedBy: 'admin-1',
    })
  })
})
```

- [ ] **Step 7: Run schema test to verify it fails**

Run: `bun test tests/db/byok-llm-schema.test.ts`

Expected: FAIL with module not found for `byok-llm-schema.js`.

- [ ] **Step 8: Implement Drizzle schema**

Create `src/db/byok-llm-schema.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const byokLlmCredentials = sqliteTable(
  'byok_llm_credentials',
  {
    contextId: text('context_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    encryptedConfig: text('encrypted_config'),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [index('idx_byok_llm_credentials_updated_at').on(table.updatedAt)],
)

export type ByokLlmCredentialRow = typeof byokLlmCredentials.$inferSelect
```

Modify `src/db/schema.ts` near other schema exports:

```ts
export { byokLlmCredentials, type ByokLlmCredentialRow } from './byok-llm-schema.js'
```

- [ ] **Step 9: Run schema and migration tests**

Run: `bun test tests/db/migrations/052_byok_llm_credentials.test.ts tests/db/byok-llm-schema.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/db/migrations/052_byok_llm_credentials.ts src/db/index.ts src/db/byok-llm-schema.ts src/db/schema.ts tests/db/migrations/052_byok_llm_credentials.test.ts tests/db/byok-llm-schema.test.ts
git commit -m "feat(byok): add llm credentials schema"
```

---

### Task 2: Shared Secret Payload Crypto

**Files:**

- Create: `src/secret-payload-crypto.ts`
- Create: `src/instances/config-key.ts`
- Modify: `src/instances/encryption.ts`
- Create: `tests/secret-payload-crypto.test.ts`
- Test: `tests/instances/encryption.test.ts`

- [ ] **Step 1: Write failing crypto tests**

Create `tests/secret-payload-crypto.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { decryptSecretPayload, encryptSecretPayload } from '../src/secret-payload-crypto.js'

const originalKey = process.env['INSTANCE_CONFIG_KEY']

afterEach(() => {
  if (originalKey === undefined) delete process.env['INSTANCE_CONFIG_KEY']
  else process.env['INSTANCE_CONFIG_KEY'] = originalKey
})

describe('secret-payload-crypto', () => {
  test('round-trips a string record without exposing plaintext in encoded payload', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'a'.repeat(64)
    const encoded = encryptSecretPayload({ llm_apikey: 'sk-test', main_model: 'gpt-test' })

    expect(encoded).not.toContain('sk-test')
    expect(decryptSecretPayload(encoded)).toEqual({ llm_apikey: 'sk-test', main_model: 'gpt-test' })
  })

  test('rejects payload encrypted with a different key', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'a'.repeat(64)
    const encoded = encryptSecretPayload({ token: 'secret' })

    process.env['INSTANCE_CONFIG_KEY'] = 'b'.repeat(64)
    expect(() => decryptSecretPayload(encoded)).toThrow()
  })

  test('rejects payload that is too short to contain iv tag and ciphertext', () => {
    process.env['INSTANCE_CONFIG_KEY'] = 'a'.repeat(64)
    expect(() => decryptSecretPayload(Buffer.from('short').toString('base64'))).toThrow('Encrypted payload too short')
  })
})
```

- [ ] **Step 2: Run crypto test to verify it fails**

Run: `bun test tests/secret-payload-crypto.test.ts`

Expected: FAIL with module not found for `secret-payload-crypto.js`.

- [ ] **Step 3: Extract instance config key resolver**

Create `src/instances/config-key.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { scryptSync } from 'node:crypto'
import { homedir, hostname } from 'node:os'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'instances:config-key' })

const PASSPHRASE_SALT = 'papai:instance-config:passphrase:v1'
const HOST_FALLBACK_SALT = 'papai:instance-config:host-fallback:v1'
const HOST_FALLBACK_WARNING =
  'INSTANCE_CONFIG_KEY is unset; using host-local fallback. DB copies are not portable; production must set INSTANCE_CONFIG_KEY.'

let fallbackWarned = false

const isHex64 = (value: string): boolean => /^[0-9a-f]{64}$/iu.test(value)

export type InstanceConfigKeyMode = 'explicit' | 'passphrase' | 'host-local-fallback'

export type InstanceConfigKeyInfo = Readonly<{
  key: Buffer
  mode: InstanceConfigKeyMode
  warning?: string
}>

export type InstanceConfigKeyDeps = Readonly<{
  hostname: () => string
  homeDir: () => string
}>

const defaultKeyDeps: InstanceConfigKeyDeps = {
  hostname,
  homeDir: homedir,
}

const deriveKey = (secret: string, salt: string): Buffer => scryptSync(secret, salt, 32)

const hostFallbackMaterial = (deps: InstanceConfigKeyDeps): string => `${deps.hostname()}\n${deps.homeDir()}`

export const resolveInstanceConfigKeyInfo = (deps: InstanceConfigKeyDeps = defaultKeyDeps): InstanceConfigKeyInfo => {
  const raw = process.env['INSTANCE_CONFIG_KEY']
  if (raw !== undefined && raw.trim() !== '') {
    const trimmed = raw.trim()
    if (isHex64(trimmed)) return { key: Buffer.from(trimmed, 'hex'), mode: 'explicit' }
    return { key: deriveKey(trimmed, PASSPHRASE_SALT), mode: 'passphrase' }
  }
  if (!fallbackWarned) {
    log.warn(HOST_FALLBACK_WARNING)
    fallbackWarned = true
  }
  return {
    key: deriveKey(hostFallbackMaterial(deps), HOST_FALLBACK_SALT),
    mode: 'host-local-fallback',
    warning: HOST_FALLBACK_WARNING,
  }
}

export const resolveInstanceConfigKey = (): Buffer => resolveInstanceConfigKeyInfo().key
```

- [ ] **Step 4: Implement shared crypto helper**

Create `src/secret-payload-crypto.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { resolveInstanceConfigKey } from './instances/config-key.js'

const IV_LEN = 12
const TAG_LEN = 16

export type SecretPayload = Record<string, string>

const assertSecretPayload = (value: unknown): SecretPayload => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Decrypted payload is not a config object')
  }
  const result: SecretPayload = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue !== 'string') {
      throw new TypeError(`Decrypted payload field "${key}" is not a string`)
    }
    result[key] = nestedValue
  }
  return result
}

export const encryptSecretPayload = (plain: SecretPayload): string => {
  const key = resolveInstanceConfigKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  const plaintext = Buffer.from(JSON.stringify(plain), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

export const decryptSecretPayload = (encoded: string): SecretPayload => {
  const buf = Buffer.from(encoded, 'base64')
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error(`Encrypted payload too short: got ${buf.length} bytes, expected at least ${IV_LEN + TAG_LEN + 1}`)
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN)
  const key = resolveInstanceConfigKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return assertSecretPayload(JSON.parse(plaintext))
}
```

- [ ] **Step 5: Refactor instance encryption to delegate to shared helper**

Modify `src/instances/encryption.ts` imports:

```ts
import { logger } from '../logger.js'
import { decryptSecretPayload, encryptSecretPayload } from '../secret-payload-crypto.js'
export {
  resolveInstanceConfigKey,
  resolveInstanceConfigKeyInfo,
  type InstanceConfigKeyDeps,
  type InstanceConfigKeyInfo,
  type InstanceConfigKeyMode,
} from './config-key.js'
import type { InstanceConfig } from './types.js'
```

Replace `encryptInstanceConfig` and `decryptInstanceConfig` with:

```ts
export const encryptInstanceConfig = (plain: InstanceConfig): string => encryptSecretPayload(plain)

export const decryptInstanceConfig = (encoded: string): InstanceConfig => decryptSecretPayload(encoded)
```

Remove `createCipheriv`, `createDecipheriv`, `randomBytes`, `scryptSync`, `homedir`, `hostname`, `IV_LEN`, `TAG_LEN`, key-derivation constants, `fallbackWarned`, and key resolver implementations from `src/instances/encryption.ts`.

- [ ] **Step 6: Run crypto and instance tests**

Run: `bun test tests/secret-payload-crypto.test.ts tests/instances/encryption.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/instances/config-key.ts src/secret-payload-crypto.ts src/instances/encryption.ts tests/secret-payload-crypto.test.ts
git commit -m "refactor(instances): share encrypted secret payload crypto"
```

---

### Task 3: BYOK Store

**Files:**

- Create: `src/byok-llm/types.ts`
- Create: `src/byok-llm/store.ts`
- Create: `tests/byok-llm/store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `tests/byok-llm/store.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { byokLlmCredentials } from '../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  disableByokForContext,
  enableByokForContext,
  getByokCredentialState,
  getByokLlmConfig,
  listByokAdminSummaries,
  updateByokLlmConfig,
} from '../../src/byok-llm/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const originalKey = process.env['INSTANCE_CONFIG_KEY']

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'c'.repeat(64)
  await setupTestDb()
})

afterEach(() => {
  if (originalKey === undefined) delete process.env['INSTANCE_CONFIG_KEY']
  else process.env['INSTANCE_CONFIG_KEY'] = originalKey
})

describe('byok-llm store', () => {
  test('enable creates an incomplete enabled row', () => {
    enableByokForContext('ctx-1', 'admin-1')

    expect(getByokCredentialState('ctx-1')).toEqual({
      enabled: true,
      complete: false,
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
    })
  })

  test('update stores encrypted config and returns masked snapshot', () => {
    enableByokForContext('ctx-1', 'admin-1')
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: 'sk-byok-1234', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )

    const raw = getDrizzleDb().select().from(byokLlmCredentials).get()
    expect(raw?.encryptedConfig).not.toContain('sk-byok-1234')
    expect(getByokLlmConfig('ctx-1')).toEqual({
      llm_apikey: 'sk-byok-1234',
      llm_baseurl: 'https://byok.invalid/v1',
      main_model: 'byok-main',
    })
    expect(getByokCredentialState('ctx-1')).toEqual({ enabled: true, complete: true, missing: [] })
  })

  test('disable keeps encrypted config but resolver state is disabled', () => {
    enableByokForContext('ctx-1', 'admin-1')
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )

    disableByokForContext('ctx-1', 'admin-2')

    expect(getByokCredentialState('ctx-1')).toEqual({ enabled: false, complete: false, missing: [] })
    expect(getByokLlmConfig('ctx-1')).toEqual({
      llm_apikey: 'sk-byok',
      llm_baseurl: 'https://byok.invalid/v1',
      main_model: 'byok-main',
    })
  })

  test('admin summaries expose metadata without decrypted secrets', () => {
    enableByokForContext('ctx-1', 'admin-1')
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: 'sk-byok-9999', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )

    expect(listByokAdminSummaries()).toEqual([
      {
        contextId: 'ctx-1',
        enabled: true,
        complete: true,
        missing: [],
        updatedAt: expect.any(Number),
        updatedBy: 'user-1',
      },
    ])
  })
})
```

- [ ] **Step 2: Run store tests to verify they fail**

Run: `bun test tests/byok-llm/store.test.ts`

Expected: FAIL with module not found for `byok-llm/store.js`.

- [ ] **Step 3: Add BYOK types**

Create `src/byok-llm/types.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const BYOK_LLM_KEYS = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'] as const
export const REQUIRED_BYOK_LLM_KEYS = ['llm_apikey', 'llm_baseurl', 'main_model'] as const

export type ByokLlmKey = (typeof BYOK_LLM_KEYS)[number]
export type RequiredByokLlmKey = (typeof REQUIRED_BYOK_LLM_KEYS)[number]
export type ByokLlmConfig = Partial<Record<ByokLlmKey, string>> & Record<RequiredByokLlmKey, string>
export type PartialByokLlmConfig = Partial<Record<ByokLlmKey, string>>

export type ByokCredentialState = {
  readonly enabled: boolean
  readonly complete: boolean
  readonly missing: readonly RequiredByokLlmKey[]
}

export type ByokAdminSummary = ByokCredentialState & {
  readonly contextId: string
  readonly updatedAt: number
  readonly updatedBy: string
}
```

- [ ] **Step 4: Implement store**

Create `src/byok-llm/store.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { byokLlmCredentials } from '../db/byok-llm-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import { decryptSecretPayload, encryptSecretPayload } from '../secret-payload-crypto.js'
import {
  REQUIRED_BYOK_LLM_KEYS,
  type ByokAdminSummary,
  type ByokCredentialState,
  type PartialByokLlmConfig,
} from './types.js'

const log = logger.child({ scope: 'byok-llm:store' })

const now = (): number => Date.now()

const cleanConfig = (input: PartialByokLlmConfig): PartialByokLlmConfig => {
  const out: PartialByokLlmConfig = {}
  for (const [key, value] of Object.entries(input)) {
    const trimmed = value.trim()
    if (trimmed.length > 0) out[key as keyof PartialByokLlmConfig] = trimmed
  }
  return out
}

const missingRequired = (config: PartialByokLlmConfig | null): ByokCredentialState['missing'] =>
  REQUIRED_BYOK_LLM_KEYS.filter((key) => config?.[key] === undefined || config[key]?.trim() === '')

const decryptConfig = (encryptedConfig: string | null): PartialByokLlmConfig | null => {
  if (encryptedConfig === null) return null
  return decryptSecretPayload(encryptedConfig) as PartialByokLlmConfig
}

export function enableByokForContext(contextId: string, updatedBy: string): void {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: true, encryptedConfig: null, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: { enabled: true, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
    })
    .run()
  log.info({ contextId, updatedBy }, 'BYOK enabled for context')
}

export function disableByokForContext(contextId: string, updatedBy: string): void {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: false, encryptedConfig: null, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: { enabled: false, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
    })
    .run()
  log.info({ contextId, updatedBy }, 'BYOK disabled for context')
}

export function updateByokLlmConfig(contextId: string, config: PartialByokLlmConfig, updatedBy: string): void {
  const current = getByokLlmConfig(contextId) ?? {}
  const merged = cleanConfig({ ...current, ...config })
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: true, encryptedConfig: encryptSecretPayload(merged), updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: byokLlmCredentials.contextId,
      set: {
        encryptedConfig: sql`excluded.encrypted_config`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
  log.info({ contextId, updatedBy, keys: Object.keys(config) }, 'BYOK LLM config updated')
}

export function getByokLlmConfig(contextId: string): PartialByokLlmConfig | null {
  const row = getDrizzleDb().select().from(byokLlmCredentials).where(eq(byokLlmCredentials.contextId, contextId)).get()
  if (row === undefined) return null
  return decryptConfig(row.encryptedConfig)
}

export function getByokCredentialState(contextId: string): ByokCredentialState {
  const row = getDrizzleDb().select().from(byokLlmCredentials).where(eq(byokLlmCredentials.contextId, contextId)).get()
  if (row === undefined || !row.enabled) return { enabled: false, complete: false, missing: [] }
  const missing = missingRequired(decryptConfig(row.encryptedConfig))
  return { enabled: true, complete: missing.length === 0, missing }
}

export function listByokAdminSummaries(): ByokAdminSummary[] {
  return getDrizzleDb()
    .select()
    .from(byokLlmCredentials)
    .all()
    .map((row): ByokAdminSummary => {
      const config = decryptConfig(row.encryptedConfig)
      const missing = row.enabled ? missingRequired(config) : []
      return {
        contextId: row.contextId,
        enabled: row.enabled,
        complete: row.enabled && missing.length === 0,
        missing,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      }
    })
}
```

- [ ] **Step 5: Run store tests**

Run: `bun test tests/byok-llm/store.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/byok-llm/types.ts src/byok-llm/store.ts tests/byok-llm/store.test.ts
git commit -m "feat(byok): add encrypted llm credential store"
```

---

### Task 4: Effective LLM Config Resolver

**Files:**

- Create: `src/llm-config-resolver.ts`
- Modify: `src/llm-orchestrator-config.ts`
- Create: `tests/llm-config-resolver.test.ts`
- Modify: `tests/llm-orchestrator-config.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `tests/llm-config-resolver.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { enableByokForContext, updateByokLlmConfig } from '../src/byok-llm/store.js'
import { resolveEffectiveLlmConfig } from '../src/llm-config-resolver.js'
import { setSystemConfig } from '../src/system-config.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from './utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  resetSystemConfigCacheForTesting()
})

const seedGlobal = (): void => {
  setSystemConfig('llm_apikey', 'sk-global', 'env')
  setSystemConfig('llm_baseurl', 'https://global.invalid/v1', 'env')
  setSystemConfig('main_model', 'global-main', 'env')
  setSystemConfig('small_model', 'global-small', 'env')
  setSystemConfig('embedding_model', 'global-embed', 'env')
}

describe('resolveEffectiveLlmConfig', () => {
  test('returns global config when BYOK is disabled', () => {
    seedGlobal()
    expect(resolveEffectiveLlmConfig('ctx-1')).toEqual({
      ok: true,
      source: 'global',
      llmApiKey: 'sk-global',
      llmBaseUrl: 'https://global.invalid/v1',
      mainModel: 'global-main',
      smallModel: 'global-small',
      embeddingModel: 'global-embed',
    })
  })

  test('returns complete BYOK config with optional model fallback to BYOK main', () => {
    seedGlobal()
    enableByokForContext('ctx-1', 'admin-1')
    updateByokLlmConfig(
      'ctx-1',
      { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )

    expect(resolveEffectiveLlmConfig('ctx-1')).toEqual({
      ok: true,
      source: 'byok',
      llmApiKey: 'sk-byok',
      llmBaseUrl: 'https://byok.invalid/v1',
      mainModel: 'byok-main',
      smallModel: 'byok-main',
      embeddingModel: 'byok-main',
    })
  })

  test('returns BYOK missing result without global fallback', () => {
    seedGlobal()
    enableByokForContext('ctx-1', 'admin-1')

    expect(resolveEffectiveLlmConfig('ctx-1')).toEqual({
      ok: false,
      type: 'missing',
      source: 'byok',
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
    })
  })

  test('returns BYOK error result for unreadable encrypted payload', () => {
    seedGlobal()
    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({ contextId: 'ctx-bad', enabled: true, encryptedConfig: 'not-base64', updatedAt: 1, updatedBy: 'admin' })
      .run()

    const result = resolveEffectiveLlmConfig('ctx-bad')
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ type: 'error', source: 'byok' })
  })
})
```

Add imports for the unreadable-payload test:

```ts
import { byokLlmCredentials } from '../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
```

- [ ] **Step 2: Run resolver tests to verify they fail**

Run: `bun test tests/llm-config-resolver.test.ts`

Expected: FAIL with module not found for `llm-config-resolver.js`.

- [ ] **Step 3: Implement resolver**

Create `src/llm-config-resolver.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getByokCredentialState, getByokLlmConfig } from './byok-llm/store.js'
import type { RequiredByokLlmKey } from './byok-llm/types.js'
import { getSystemConfig, type SystemConfigKey } from './system-config.js'

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

const requiredGlobalKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const

export function resolveEffectiveLlmConfig(configContextId: string): EffectiveLlmConfigResult {
  let state: ReturnType<typeof getByokCredentialState>
  try {
    state = getByokCredentialState(configContextId)
  } catch (error) {
    return {
      ok: false,
      type: 'error',
      source: 'byok',
      error: error instanceof Error ? error.message : String(error),
    }
  }
  if (state.enabled) {
    if (!state.complete) return { ok: false, type: 'missing', source: 'byok', missing: state.missing }
    let config: ReturnType<typeof getByokLlmConfig>
    try {
      config = getByokLlmConfig(configContextId)
    } catch (error) {
      return {
        ok: false,
        type: 'error',
        source: 'byok',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    if (config === null) return { ok: false, type: 'missing', source: 'byok', missing: state.missing }
    return {
      ok: true,
      source: 'byok',
      llmApiKey: config.llm_apikey ?? '',
      llmBaseUrl: config.llm_baseurl ?? '',
      mainModel: config.main_model ?? '',
      smallModel: config.small_model ?? config.main_model ?? '',
      embeddingModel: config.embedding_model ?? config.main_model ?? '',
    }
  }

  const missing = requiredGlobalKeys.filter((key) => getSystemConfig(key) === null)
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
```

- [ ] **Step 4: Update compatibility helper**

Modify `src/llm-orchestrator-config.ts`:

```ts
import { resolveEffectiveLlmConfig } from './llm-config-resolver.js'
```

Replace `getLlmConfig` with compatibility behavior for existing callers:

```ts
export const getLlmConfig = (configContextId = ''): LlmConfig => {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) {
    throw new Error(`${resolved.source} LLM config is incomplete: missing ${resolved.missing.join(', ')}`)
  }
  return { llmApiKey: resolved.llmApiKey, llmBaseUrl: resolved.llmBaseUrl, mainModel: resolved.mainModel }
}
```

- [ ] **Step 5: Update `tests/llm-orchestrator-config.test.ts`**

Add this test under `describe('getLlmConfig')`:

```ts
test('reads BYOK config when a config context has BYOK enabled', () => {
  setSystemConfig('llm_apikey', 'sk-system', 'env')
  setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
  setSystemConfig('main_model', 'main-system', 'env')
  enableByokForContext('ctx-byok', 'admin')
  updateByokLlmConfig(
    'ctx-byok',
    { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok/v1', main_model: 'main-byok' },
    'user',
  )

  expect(getLlmConfig('ctx-byok')).toEqual({
    llmApiKey: 'sk-byok',
    llmBaseUrl: 'https://byok/v1',
    mainModel: 'main-byok',
  })
})
```

Add imports:

```ts
import { enableByokForContext, updateByokLlmConfig } from '../src/byok-llm/store.js'
```

- [ ] **Step 6: Run resolver and compatibility tests**

Run: `bun test tests/llm-config-resolver.test.ts tests/llm-orchestrator-config.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/llm-config-resolver.ts src/llm-orchestrator-config.ts tests/llm-config-resolver.test.ts tests/llm-orchestrator-config.test.ts
git commit -m "feat(byok): resolve effective llm config by context"
```

---

### Task 5: Main Orchestrator Integration

**Files:**

- Modify: `src/llm-orchestrator.ts`
- Modify: `tests/llm-orchestrator.test.ts`
- Modify: `tests/llm-orchestrator-errors.test.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Add these tests to `tests/llm-orchestrator.test.ts` in the existing `processMessage` suite using local helper patterns:

```ts
test('uses BYOK credentials for the main model when enabled for config context', async () => {
  seedSystemLlmConfig()
  enableByokForContext('cfg-byok', 'admin-1')
  updateByokLlmConfig(
    'cfg-byok',
    { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
    'user-1',
  )
  const calls: Array<{ apiKey: string; baseURL: string; model: string }> = []
  const deps = {
    ...defaultDeps,
    buildOpenAI: (apiKey: string, baseURL: string) => {
      calls.push({ apiKey, baseURL, model: '' })
      return (model: string) => {
        calls[calls.length - 1] = { apiKey, baseURL, model }
        return model as never
      }
    },
    generateText: mockGenerateTextReturning('ok'),
    resolve: () => null,
  }

  await processMessage(createMockReply(), 'ctx-storage', 'chat-user-1', null, 'hello', 'dm', 'cfg-byok', deps)

  expect(calls).toEqual([{ apiKey: 'sk-byok', baseURL: 'https://byok.invalid/v1', model: 'byok-main' }])
})

test('blocks main model call when BYOK is enabled but incomplete', async () => {
  seedSystemLlmConfig()
  enableByokForContext('cfg-byok', 'admin-1')
  const reply = createMockReply()
  const deps = { ...defaultDeps, generateText: mock(() => Promise.reject(new Error('must not call model'))) }

  await processMessage(reply, 'ctx-storage', 'chat-user-1', null, 'hello', 'dm', 'cfg-byok', deps)

  expect(reply.textMessages.join('\n')).toContain('BYOK is enabled for this context')
  expect(deps.generateText).not.toHaveBeenCalled()
})
```

Add this local helper near the other test helpers in `tests/llm-orchestrator.test.ts`:

```ts
const mockGenerateTextReturning = (text: string): typeof generateText =>
  mock(async () => ({
    text,
    toolCalls: [],
    toolResults: [],
    steps: [],
    response: { messages: [{ role: 'assistant', content: text }] },
    usage: { inputTokens: 0, outputTokens: 0 },
    finishReason: 'stop',
  })) as unknown as typeof generateText
```

- [ ] **Step 2: Run orchestrator tests to verify they fail**

Run: `bun test tests/llm-orchestrator.test.ts`

Expected: FAIL because `processMessage` still checks global config before resolving BYOK and builds the model from global settings.

- [ ] **Step 3: Implement BYOK-aware main resolution**

Modify `src/llm-orchestrator.ts`:

```ts
import { resolveEffectiveLlmConfig } from './llm-config-resolver.js'
```

Add a helper near `replyBotMisconfigured`:

```ts
const replyByokIncomplete = async (reply: ReplyFn, contextId: string, missing: readonly string[]): Promise<void> => {
  log.warn({ contextId, missing }, 'BYOK LLM config is incomplete; context cannot serve this turn')
  await reply.text(
    `BYOK is enabled for this context, but required LLM settings are missing: ${missing.join(', ')}. Use /config to complete API key, base URL, and main model.`,
  )
}

const replyByokUnreadable = async (reply: ReplyFn, contextId: string): Promise<void> => {
  log.warn({ contextId }, 'BYOK LLM config is unreadable; context cannot serve this turn')
  await reply.text(
    'BYOK is enabled for this context, but the stored LLM settings could not be read. Ask a bot admin to re-enable BYOK or replace the credentials in /config.',
  )
}
```

In `callLlm`, replace global `getLlmConfig()` with:

```ts
const resolvedLlm = resolveEffectiveLlmConfig(configId)
if (!resolvedLlm.ok) {
  if (resolvedLlm.source === 'byok') {
    if (resolvedLlm.type === 'missing') await replyByokIncomplete(reply, contextId, resolvedLlm.missing)
    else await replyByokUnreadable(reply, contextId)
    throw new Error(`BYOK configuration ${resolvedLlm.type}`)
  }
  throw new Error('system_config is incomplete: required LLM keys are missing')
}
const { llmApiKey, llmBaseUrl, mainModel } = resolvedLlm
const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
```

In `processMessage`, replace the early global completeness guard with a global-only fallback check after resolving `configContextId`:

```ts
const configId = resolveConfigId(contextId, configContextId)
const resolvedLlm = resolveEffectiveLlmConfig(configId)
if (!resolvedLlm.ok && resolvedLlm.source === 'global') {
  await replyBotMisconfigured(reply, contextId)
  return
}
```

Keep the global missing-config check before `buildHistory`. For BYOK missing config, perform the resolver check before appending user history so an incomplete enabled context blocks cleanly without adding a failed turn to history.

- [ ] **Step 4: Run orchestrator tests**

Run: `bun test tests/llm-orchestrator.test.ts tests/llm-orchestrator-errors.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator.ts tests/llm-orchestrator.test.ts tests/llm-orchestrator-errors.test.ts
git commit -m "feat(byok): use context llm config in orchestrator"
```

---

### Task 6: Helper LLM Call Integration

**Files:**

- Modify: `src/conversation.ts`
- Modify: `src/deferred-prompts/proactive-llm.ts`
- Modify: `src/web/distill.ts`
- Modify: `src/embeddings.ts`
- Modify: `src/tools/lookup-group-history.ts`
- Modify: `tests/deferred-prompts/proactive-llm.test.ts`, `tests/web/distill.test.ts`, `tests/tools/lookup-group-history.test.ts`, `tests/conversation.test.ts`, and `tests/embeddings.test.ts`.

- [ ] **Step 1: Write failing helper tests**

Add one focused BYOK test per helper path:

`tests/deferred-prompts/proactive-llm.test.ts`:

```ts
test('uses BYOK config for full deferred prompt generation', async () => {
  enableByokForContext('cfg-1', 'admin')
  updateByokLlmConfig(
    'cfg-1',
    { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok/v1', main_model: 'byok-main' },
    'user',
  )
  const calls: Array<{ apiKey: string; baseURL: string; modelId: string }> = []
  const deps = {
    generateText: mockGenerateTextReturning('done'),
    stepCountIs,
    buildModel: (config: { apiKey: string; baseURL: string }, modelId: string) => {
      calls.push({ ...config, modelId })
      return modelId as never
    },
  }

  await dispatchExecution(
    execCtxForStorageContext('storage-1'),
    'scheduled',
    'prompt',
    fullMetadata(),
    () => null,
    undefined,
    deps,
  )

  expect(calls).toContainEqual({ apiKey: 'sk-byok', baseURL: 'https://byok/v1', modelId: 'byok-main' })
})
```

`tests/web/distill.test.ts`:

```ts
test('uses BYOK small model for context distillation', async () => {
  enableByokForContext('ctx-1', 'admin')
  updateByokLlmConfig(
    'ctx-1',
    { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok/v1', main_model: 'byok-main', small_model: 'byok-small' },
    'user',
  )
  const calls: Array<{ apiKey: string; baseUrl: string; modelId: string }> = []
  await distillWebContent(
    { storageContextId: 'ctx-1', title: 'T', content: 'x'.repeat(9000), configContextId: 'ctx-1' },
    {
      generateText: mockGenerateTextReturning('summary\n\nexcerpt'),
      buildModel: (apiKey, baseUrl, modelId) => {
        calls.push({ apiKey, baseUrl, modelId })
        return modelId as never
      },
    },
  )
  expect(calls).toEqual([{ apiKey: 'sk-byok', baseUrl: 'https://byok/v1', modelId: 'byok-small' }])
})
```

`tests/tools/lookup-group-history.test.ts`:

```ts
test('uses BYOK small model when searching group history from enabled context', async () => {
  enableByokForContext('group-main', 'admin')
  updateByokLlmConfig(
    'group-main',
    { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok/v1', main_model: 'byok-main' },
    'user',
  )
  const model = getLookupGroupHistoryModel('group-main')
  expect(model).not.toBeNull()
})
```

Add missing local helper functions in each test file before the new tests. The helper bodies must return concrete objects accepted by the existing function signatures; do not leave helper names unresolved. The assertions must prove the helper does not read global config when BYOK is enabled.

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `bun test tests/deferred-prompts/proactive-llm.test.ts tests/web/distill.test.ts tests/tools/lookup-group-history.test.ts`

Expected: FAIL because helper paths still read `system_config` directly or lack `configContextId`.

- [ ] **Step 3: Update `conversation.ts` trimming**

Change `runTrimInBackground` signature:

```ts
export const runTrimInBackground = async (
  userId: string,
  history: readonly ModelMessage[],
  deps: ConversationDeps = defaultConversationDeps,
  configContextId = userId,
): Promise<void> => {
```

Replace direct `getSystemConfig` reads with:

```ts
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (resolved.ok) {
    try {
      const existing = loadSummary(userId)
      const model = deps.buildModel(resolved.llmApiKey, resolved.llmBaseUrl, resolved.smallModel)
```

In the missing branch, log `source` and `missing` without secrets.

- [ ] **Step 4: Update deferred prompts**

In `src/deferred-prompts/proactive-llm.ts`, replace `getLlmConfigFromSystem()` with:

```ts
function getLlmConfigForContext(configContextId: string): LlmConfig | string {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) {
    const missing = resolved.type === 'missing' ? resolved.missing : []
    log.warn(
      { configContextId, source: resolved.source, type: resolved.type, missing },
      'Missing LLM config for deferred prompt',
    )
    return resolved.source === 'byok'
      ? 'Deferred prompt skipped: BYOK is enabled for this context, but required LLM settings are missing. Use /config to complete setup.'
      : 'Deferred prompt skipped: the bot is not fully configured. The administrator has been notified.'
  }
  return { apiKey: resolved.llmApiKey, baseURL: resolved.llmBaseUrl, mainModel: resolved.mainModel }
}
```

For lightweight/context/full modes, compute:

```ts
const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
const config = getLlmConfigForContext(configContextId)
```

For lightweight small-model selection, use `resolved.smallModel` by extending `LlmConfig` to include `smallModel`.

- [ ] **Step 5: Update web distillation**

In `src/web/distill.ts`, add `configContextId?: string` to `DistillInput` and replace `getModelConfig()` with:

```ts
const getModelConfig = (configContextId: string): { apiKey: string; baseUrl: string; modelId: string } => {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) {
    const details = resolved.type === 'missing' ? resolved.missing.join(', ') : resolved.error
    throw new Error(`Missing ${resolved.source} LLM config: ${details}`)
  }
  return { apiKey: resolved.llmApiKey, baseUrl: resolved.llmBaseUrl, modelId: resolved.smallModel }
}
```

Call it with:

```ts
const { apiKey, baseUrl, modelId } = getModelConfig(input.configContextId ?? input.storageContextId)
```

- [ ] **Step 6: Update embeddings**

Keep existing low-level `getEmbedding(text, apiKey, baseUrl, model, context, deps)` unchanged. Add a convenience wrapper:

```ts
export async function getEmbeddingForContext(
  text: string,
  configContextId: string,
  context?: EmbeddingCallContext,
  deps: EmbeddingsDeps = defaultEmbeddingsDeps,
): Promise<number[] | null> {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) {
    const missing = resolved.type === 'missing' ? resolved.missing : []
    log.warn({ configContextId, source: resolved.source, type: resolved.type, missing }, 'Embedding config unavailable')
    return null
  }
  return tryGetEmbedding(text, resolved.llmApiKey, resolved.llmBaseUrl, resolved.embeddingModel, context, deps)
}
```

Update call sites that currently pass `getSystemConfig('embedding_model')` to use `getEmbeddingForContext`.

- [ ] **Step 7: Update group-history lookup**

Change `LookupGroupHistoryDeps.getSmallModel` to accept a config context ID:

```ts
getSmallModel: (configContextId: string) => LanguageModel | null
```

Default implementation:

```ts
getSmallModel: (configContextId) => {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) return null
  return createOpenAICompatible({
    name: 'openai-compatible',
    apiKey: resolved.llmApiKey,
    baseURL: resolved.llmBaseUrl,
  })(resolved.smallModel)
}
```

Call it with the main group config context derived from `groupId`.

- [ ] **Step 8: Run helper tests**

Run: `bun test tests/deferred-prompts/proactive-llm.test.ts tests/web/distill.test.ts tests/tools/lookup-group-history.test.ts tests/conversation.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/conversation.ts src/deferred-prompts/proactive-llm.ts src/web/distill.ts src/embeddings.ts src/tools/lookup-group-history.ts tests/deferred-prompts/proactive-llm.test.ts tests/web/distill.test.ts tests/tools/lookup-group-history.test.ts tests/conversation.test.ts
git commit -m "feat(byok): use context llm config in helper calls"
```

---

### Task 7: Settings API Routes

**Files:**

- Create: `src/debug/settings/byok-routes.ts`
- Create: `src/debug/settings/admin/byok-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Create: `tests/debug/settings/byok-routes.test.ts`
- Create: `tests/debug/settings/admin/byok-routes.test.ts`

- [ ] **Step 1: Write failing admin route tests**

Create `tests/debug/settings/admin/byok-routes.test.ts` with these core assertions:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { getByokCredentialState } from '../../../../src/byok-llm/store.js'
import { handleAdminByokRoutes } from '../../../../src/debug/settings/admin/byok-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const SummarySchema = z.object({ contexts: z.array(z.object({ contextId: z.string(), enabled: z.boolean() })) })

describe('settings admin BYOK routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('admin can enable BYOK for a context', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: 'ctx-1', enabled: true }),
      }),
      url,
    )
    expect(res.status).toBe(200)
    expect(getByokCredentialState('ctx-1').enabled).toBe(true)
  })

  test('non-admin cannot enable BYOK', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextId: 'ctx-1', enabled: true }),
      }),
      url,
    )
    expect(res.status).toBe(403)
  })

  test('GET returns summary array without secrets', async () => {
    const url = new URL('https://x/settings/api/admin/byok')
    const res = await handleAdminByokRoutes(new Request(url, { headers: authHeaders(adminSession) }), url)
    expect(res.status).toBe(200)
    SummarySchema.parse(await res.json())
  })
})
```

- [ ] **Step 2: Write failing context route tests**

Create `tests/debug/settings/byok-routes.test.ts` with these assertions:

```ts
test('GET returns disabled state when BYOK is not enabled for the context', async () => {
  const res = await handleByokRoutes(
    new Request('https://x/settings/api/byok', { headers: authHeaders(session) }),
    new URL('https://x/settings/api/byok'),
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ enabled: false, fields: [] })
})

test('PATCH rejects credential update before admin enablement', async () => {
  const res = await handleByokRoutes(
    new Request('https://x/settings/api/byok', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { llm_apikey: 'sk', llm_baseurl: 'https://api/v1', main_model: 'gpt' } }),
    }),
    new URL('https://x/settings/api/byok'),
  )
  expect(res.status).toBe(403)
})

test('PATCH stores enabled context credentials and GET masks api key', async () => {
  enableByokForContext(personalConfigContextId, 'admin')
  const patch = await handleByokRoutes(
    new Request('https://x/settings/api/byok', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: { llm_apikey: 'sk-secret-1234', llm_baseurl: 'https://api/v1', main_model: 'gpt' },
      }),
    }),
    new URL('https://x/settings/api/byok'),
  )
  expect(patch.status).toBe(200)
  const get = await handleByokRoutes(
    new Request('https://x/settings/api/byok', { headers: authHeaders(session) }),
    new URL('https://x/settings/api/byok'),
  )
  expect(JSON.stringify(await get.json())).not.toContain('sk-secret-1234')
})
```

Use the same session setup pattern as `tests/debug/settings/config-routes.test.ts`: call `mockLogger()`, `setupTestDb()`, `seedTestPlatformInstance({ id: 'pi-1' })`, `addUser(...)`, and `establishSession(...)` in `beforeEach`, then use `authHeaders(session, true)` for PATCH requests.

- [ ] **Step 3: Run route tests to verify they fail**

Run: `bun test tests/debug/settings/admin/byok-routes.test.ts tests/debug/settings/byok-routes.test.ts`

Expected: FAIL with module not found for BYOK routes.

- [ ] **Step 4: Implement admin route**

Create `src/debug/settings/admin/byok-routes.ts`:

```ts
import { z } from 'zod'

import { disableByokForContext, enableByokForContext, listByokAdminSummaries } from '../../../byok-llm/store.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const PatchSchema = z.object({ contextId: z.string().min(1), enabled: z.boolean() })

export async function handleAdminByokRoutes(req: Request, _url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  if (req.method === 'GET') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return guard
    return settingsJson(200, { contexts: listByokAdminSummaries() })
  }
  if (req.method === 'PATCH') {
    const guard = requireAdmin(auth.authed, 'write')
    if (guard !== null) return guard
    const csrf = requireCsrf(req, auth.authed)
    if (csrf !== null) return csrf
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = PatchSchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    if (body.data.enabled) enableByokForContext(body.data.contextId, auth.authed.principal.platformUserId)
    else disableByokForContext(body.data.contextId, auth.authed.principal.platformUserId)
    return settingsJson(200, { ok: true, contextId: body.data.contextId, enabled: body.data.enabled })
  }
  return settingsJson(405, { error: 'method not allowed' })
}
```

- [ ] **Step 5: Implement context route**

Create `src/debug/settings/byok-routes.ts`:

```ts
import { z } from 'zod'

import { getByokCredentialState, getByokLlmConfig, updateByokLlmConfig } from '../../byok-llm/store.js'
import { maskSensitiveValue } from '../../config.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const BYOK_FIELDS = [
  { key: 'llm_apikey', label: 'LLM API Key', required: true, sensitive: true },
  { key: 'llm_baseurl', label: 'LLM Base URL', required: true, sensitive: false },
  { key: 'main_model', label: 'Main Model', required: true, sensitive: false },
  { key: 'small_model', label: 'Small Model', required: false, sensitive: false },
  { key: 'embedding_model', label: 'Embedding Model', required: false, sensitive: false },
] as const

const PatchSchema = z.object({
  contextId: z.string().optional(),
  values: z.record(z.string(), z.string()),
})

const fieldResponse = (contextId: string) => {
  const state = getByokCredentialState(contextId)
  if (!state.enabled) return { enabled: false, complete: false, missing: [], fields: [] }
  const config = getByokLlmConfig(contextId) ?? {}
  const fields = BYOK_FIELDS.map((field) => {
    const raw = config[field.key] ?? ''
    const hasValue = raw.length > 0
    return {
      ...field,
      hasValue,
      value: hasValue && field.sensitive ? maskSensitiveValue(raw) : raw,
    }
  })
  return { enabled: state.enabled, complete: state.complete, missing: state.missing, fields }
}

const valuesToPersist = (contextId: string, values: Record<string, string>): Record<string, string> => {
  const current = getByokLlmConfig(contextId) ?? {}
  const allowed = new Set(BYOK_FIELDS.map((field) => field.key))
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) continue
    const field = BYOK_FIELDS.find((candidate) => candidate.key === key)
    if (field?.sensitive === true) {
      const existing = current[key] ?? ''
      if (value.length === 0 || (existing.length > 0 && value === maskSensitiveValue(existing))) continue
    }
    out[key] = value
  }
  return out
}

export async function handleByokRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response

  if (req.method === 'GET') {
    const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
    if (!scope.ok) return scope.response
    return settingsJson(200, fieldResponse(scope.scope.contextId))
  }

  if (req.method === 'PATCH') {
    const csrf = requireCsrf(req, auth.authed)
    if (csrf !== null) return csrf
    const parsed = await parseJsonBody(req)
    if (!parsed.ok) return parsed.response
    const body = PatchSchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })
    const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
    if (!scope.ok) return scope.response
    const state = getByokCredentialState(scope.scope.contextId)
    if (!state.enabled) return settingsJson(403, { error: 'BYOK is not enabled for this context' })
    updateByokLlmConfig(
      scope.scope.contextId,
      valuesToPersist(scope.scope.contextId, body.data.values),
      auth.authed.principal.platformUserId,
    )
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
```

- [ ] **Step 6: Register routes**

Modify `src/debug/settings-api-router.ts` imports:

```ts
import { handleAdminByokRoutes } from './settings/admin/byok-routes.js'
import { handleByokRoutes } from './settings/byok-routes.js'
```

Add routes:

```ts
if (url.pathname === '/settings/api/admin/byok') return handleAdminByokRoutes(req, url)
if (url.pathname === '/settings/api/byok') return handleByokRoutes(req, url)
```

- [ ] **Step 7: Run settings route tests**

Run: `bun test tests/debug/settings/admin/byok-routes.test.ts tests/debug/settings/byok-routes.test.ts tests/debug/settings-api-router.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/debug/settings/byok-routes.ts src/debug/settings/admin/byok-routes.ts src/debug/settings-api-router.ts tests/debug/settings/byok-routes.test.ts tests/debug/settings/admin/byok-routes.test.ts
git commit -m "feat(settings): add byok llm api routes"
```

---

### Task 8: Settings Client Fetchers And Schemas

**Files:**

- Modify: `client/settings/fetcher-schemas.ts`
- Modify: `client/settings/fetchers.ts`
- Modify: `client/settings/admin-fetchers.ts`
- Create: `tests/client/settings/byok-fetchers.test.ts`
- Create: `tests/client/settings/byok-fetcher-schemas.test.ts`

- [ ] **Step 1: Write failing client schema tests**

Create `tests/client/settings/byok-fetcher-schemas.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { AdminByokResponseSchema, ByokResponseSchema } from '../../../client/settings/fetcher-schemas.js'

describe('BYOK fetcher schemas', () => {
  test('parses context BYOK response', () => {
    expect(
      ByokResponseSchema.parse({
        enabled: true,
        complete: false,
        missing: ['llm_apikey'],
        fields: [
          { key: 'llm_apikey', label: 'LLM API Key', required: true, sensitive: true, hasValue: false, value: '' },
        ],
      }).enabled,
    ).toBe(true)
  })

  test('parses admin BYOK summaries', () => {
    expect(
      AdminByokResponseSchema.parse({
        contexts: [
          { contextId: 'ctx-1', enabled: true, complete: true, missing: [], updatedAt: 1, updatedBy: 'admin' },
        ],
      }).contexts[0]?.contextId,
    ).toBe('ctx-1')
  })
})
```

- [ ] **Step 2: Write failing fetcher tests**

Create `tests/client/settings/byok-fetchers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchByok, patchByok } from '../../../client/settings/fetchers.js'
import { fetchAdminByok, patchAdminByok } from '../../../client/settings/admin-fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const captured: Array<{ url: string; init: RequestInit | undefined }> = []

beforeEach(() => (captured.length = 0))
afterEach(() => restoreFetch())

const installFetch = (payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
}

describe('BYOK fetchers', () => {
  test('fetches context BYOK state', async () => {
    installFetch({ enabled: false, complete: false, missing: [], fields: [] })
    expect((await fetchByok('ctx-1')).enabled).toBe(false)
    expect(captured[0]?.url).toBe('/settings/api/byok?contextId=ctx-1')
  })

  test('patches context BYOK values', async () => {
    installFetch({ ok: true })
    await patchByok({ contextId: 'ctx-1', values: { main_model: 'gpt' } })
    expect(captured[0]?.init?.method).toBe('PATCH')
  })

  test('fetches and patches admin BYOK summaries', async () => {
    installFetch({ contexts: [] })
    await fetchAdminByok()
    expect(captured[0]?.url).toBe('/settings/api/admin/byok')
  })
})
```

- [ ] **Step 3: Run client fetcher tests to verify they fail**

Run: `bun test:client tests/client/settings/byok-fetcher-schemas.test.ts tests/client/settings/byok-fetchers.test.ts`

Expected: FAIL because schemas/fetchers are not exported.

- [ ] **Step 4: Add schemas and fetchers**

In `client/settings/fetcher-schemas.ts` add:

```ts
export const ByokFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean(),
  value: z.string(),
})
export const ByokResponseSchema = z.object({
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  fields: z.array(ByokFieldSchema),
})
export type ByokField = z.infer<typeof ByokFieldSchema>
export type ByokResponse = z.infer<typeof ByokResponseSchema>

export const AdminByokContextSchema = z.object({
  contextId: z.string(),
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  updatedAt: z.number(),
  updatedBy: z.string(),
})
export const AdminByokResponseSchema = z.object({ contexts: z.array(AdminByokContextSchema) })
export type AdminByokContext = z.infer<typeof AdminByokContextSchema>
export type AdminByokResponse = z.infer<typeof AdminByokResponseSchema>
```

In `client/settings/fetchers.ts` add:

```ts
export const fetchByok = (contextId: string): Promise<ByokResponse> =>
  getJson(`/settings/api/byok?contextId=${encodeURIComponent(contextId)}`, (b) => ByokResponseSchema.parse(b))

export const patchByok = (input: { contextId: string; values: Record<string, string> }): Promise<unknown> =>
  writeJson('/settings/api/byok', 'PATCH', input, (b) => b)
```

In `client/settings/admin-fetchers.ts` add:

```ts
export const fetchAdminByok = (): Promise<AdminByokResponse> =>
  getJson('/settings/api/admin/byok', (b) => AdminByokResponseSchema.parse(b))

export const patchAdminByok = (input: { contextId: string; enabled: boolean }): Promise<unknown> =>
  writeJson('/settings/api/admin/byok', 'PATCH', input, (b) => b)
```

- [ ] **Step 5: Run client fetcher tests**

Run: `bun test:client tests/client/settings/byok-fetcher-schemas.test.ts tests/client/settings/byok-fetchers.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/fetchers.ts client/settings/admin-fetchers.ts tests/client/settings/byok-fetcher-schemas.test.ts tests/client/settings/byok-fetchers.test.ts
git commit -m "feat(settings): add byok client fetchers"
```

---

### Task 9: Settings UI Sections

**Files:**

- Create: `client/settings/sections/ByokSection.svelte`
- Create: `client/settings/sections/admin/AdminByokSection.svelte`
- Modify: `client/settings/SettingsApp.svelte`
- Create: `tests/client/settings/byok-section.test.ts`
- Create: `tests/client/settings/admin-byok-section.test.ts`
- Modify: `tests/client/settings/SettingsApp.test.ts`

- [ ] **Step 1: Write failing UI tests**

Add to `tests/client/settings/SettingsApp.test.ts` admin section list:

```ts
'byok-admin',
```

Create `tests/client/settings/byok-section.test.ts` asserting disabled and enabled render states:

```ts
test('shows disabled BYOK placeholder when not enabled', async () => {
  installFetch({ enabled: false, complete: false, missing: [], fields: [] })
  mount(ByokSection, { target, props: { contextId: 'ctx-1' } })
  await drain()
  expect(target.textContent).toContain('BYOK is not enabled')
})

test('renders enabled fields and masks API key', async () => {
  installFetch({
    enabled: true,
    complete: true,
    missing: [],
    fields: [
      { key: 'llm_apikey', label: 'LLM API Key', required: true, sensitive: true, hasValue: true, value: '****1234' },
    ],
  })
  mount(ByokSection, { target, props: { contextId: 'ctx-1' } })
  await drain()
  expect(target.textContent).toContain('LLM API Key')
  expect(target.textContent).not.toContain('sk-secret')
})
```

Create `tests/client/settings/admin-byok-section.test.ts` asserting enable action sends PATCH.

- [ ] **Step 2: Run UI tests to verify they fail**

Run: `bun test:client tests/client/settings/byok-section.test.ts tests/client/settings/admin-byok-section.test.ts tests/client/settings/SettingsApp.test.ts`

Expected: FAIL because components and app sections do not exist.

- [ ] **Step 3: Implement context BYOK section**

Create `client/settings/sections/ByokSection.svelte`:

```svelte
<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import { fetchByok, patchByok } from '../fetchers.js'
  import type { ByokField } from '../fetcher-schemas.js'

  interface Props { contextId: string }
  let { contextId }: Props = $props()
  let enabled = $state(false)
  let complete = $state(false)
  let missing: string[] = $state([])
  let fields: ByokField[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)

  async function load(): Promise<void> {
    error = null; loading = true
    try {
      const res = await fetchByok(contextId)
      enabled = res.enabled; complete = res.complete; missing = res.missing; fields = res.fields
    } catch (err) { error = err instanceof Error ? err.message : String(err) }
    finally { loading = false }
  }

  async function saveField(field: ByokField, value: string): Promise<void> {
    await patchByok({ contextId, values: { [field.key]: value } })
    await load()
  }

  let drafts: Record<string, string> = $state({})
  let replacing: Record<string, boolean> = $state({})

  function setDraft(key: string, value: string): void {
    drafts = { ...drafts, [key]: value }
  }

  function setReplacing(key: string, value: boolean): void {
    replacing = { ...replacing, [key]: value }
  }

  $effect(() => { void load() })
</script>

<section id="byok" class="settings-section">
  <PageHeader eyebrow="Personal" title="BYOK LLM">
    {#snippet action()}<IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="byok-refresh" />{/snippet}
  </PageHeader>
  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if !enabled}
    <p class="placeholder">BYOK is not enabled for this context. Ask a bot admin to enable it.</p>
  {:else}
    {#if !complete}<p class="status-error">Missing required fields: {missing.join(', ')}</p>{/if}
    <div class="settings-field-list">
      {#each fields as field (field.key)}
        <div class="settings-field" data-testid={`byok-row-${field.key}`}>
          <div class="settings-field__head">
            <span class="t-label settings-field__label">{field.label}{field.required ? ' *' : ''}</span>
            {#if field.sensitive && field.hasValue && replacing[field.key] !== true}
              <Secret value={field.value} />
              <Btn variant="secondary" size="sm" testid={`byok-replace-${field.key}`} onClick={() => setReplacing(field.key, true)}>
                {#snippet children()}Replace{/snippet}
              </Btn>
            {/if}
          </div>
          {#if !field.sensitive || !field.hasValue || replacing[field.key] === true}
            <div class="settings-field__editor">
              <Input
                type={field.sensitive ? 'password' : 'text'}
                value={drafts[field.key] ?? (field.sensitive ? '' : field.value)}
                placeholder={field.sensitive ? 'enter a new value' : ''}
                onInput={(v) => setDraft(field.key, v)}
                testid={`byok-input-${field.key}`} />
              <Btn
                variant="primary"
                size="sm"
                testid={`byok-save-${field.key}`}
                onClick={() => void saveField(field, drafts[field.key] ?? (field.sensitive ? '' : field.value))}>
                {#snippet children()}Save{/snippet}
              </Btn>
              {#if field.sensitive && field.hasValue}
                <Btn variant="ghost" size="sm" testid={`byok-cancel-${field.key}`} onClick={() => setReplacing(field.key, false)}>
                  {#snippet children()}Cancel{/snippet}
                </Btn>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
```

- [ ] **Step 4: Implement admin BYOK section**

Create `client/settings/sections/admin/AdminByokSection.svelte`:

```svelte
<script lang="ts">
  import Btn from '../../../shared/ui/Btn.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import { fetchAdminByok, patchAdminByok } from '../../admin-fetchers.js'
  import type { AdminByokContext } from '../../fetcher-schemas.js'

  let contexts: AdminByokContext[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)

  async function load(): Promise<void> {
    error = null; loading = true
    try { contexts = (await fetchAdminByok()).contexts }
    catch (err) { error = err instanceof Error ? err.message : String(err) }
    finally { loading = false }
  }

  async function toggle(row: AdminByokContext): Promise<void> {
    await patchAdminByok({ contextId: row.contextId, enabled: !row.enabled })
    await load()
  }

  $effect(() => { void load() })
</script>

<section id="byok-admin" class="settings-section">
  <PageHeader eyebrow="Admin" title="BYOK LLM">
    {#snippet action()}<IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="admin-byok-refresh" />{/snippet}
  </PageHeader>
  {#if error !== null}<p class="status-error">{error}</p>{/if}
  <table class="settings-table">
    <thead><tr><th>Context</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
    <tbody>
      {#each contexts as row (row.contextId)}
        <tr>
          <td>{row.contextId}</td>
          <td>{row.enabled ? (row.complete ? 'Enabled · complete' : `Enabled · missing ${row.missing.join(', ')}`) : 'Disabled'}</td>
          <td>{row.updatedBy} · {new Date(row.updatedAt).toLocaleString()}</td>
          <td><Btn variant="secondary" size="sm" onClick={() => void toggle(row)}>{#snippet children()}{row.enabled ? 'Disable' : 'Enable'}{/snippet}</Btn></td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
```

- [ ] **Step 5: Wire sections into app**

Modify `client/settings/SettingsApp.svelte` imports:

```ts
import ByokSection from './sections/ByokSection.svelte'
import AdminByokSection from './sections/admin/AdminByokSection.svelte'
```

Add sidebar items:

```ts
{ id: 'byok', label: 'BYOK LLM' },
```

Under admin items:

```ts
{ id: 'byok-admin', label: 'BYOK LLM' },
```

Render sections:

```svelte
<ByokSection contextId={ctx} />
```

and in admin zone:

```svelte
<AdminByokSection />
```

- [ ] **Step 6: Run UI tests**

Run: `bun test:client tests/client/settings/byok-section.test.ts tests/client/settings/admin-byok-section.test.ts tests/client/settings/SettingsApp.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/settings/sections/ByokSection.svelte client/settings/sections/admin/AdminByokSection.svelte client/settings/SettingsApp.svelte tests/client/settings/byok-section.test.ts tests/client/settings/admin-byok-section.test.ts tests/client/settings/SettingsApp.test.ts
git commit -m "feat(settings): add byok llm UI"
```

---

### Task 10: Final Regression And Security Checks

**Files:**

- Modify tests only if regressions reveal a missing assertion.

- [ ] **Step 1: Run focused server tests**

Run:

```bash
bun test tests/byok-llm/store.test.ts tests/llm-config-resolver.test.ts tests/llm-orchestrator.test.ts tests/deferred-prompts/proactive-llm.test.ts tests/debug/settings/byok-routes.test.ts tests/debug/settings/admin/byok-routes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused client tests**

Run:

```bash
bun test:client tests/client/settings/byok-fetcher-schemas.test.ts tests/client/settings/byok-fetchers.test.ts tests/client/settings/byok-section.test.ts tests/client/settings/admin-byok-section.test.ts tests/client/settings/SettingsApp.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run full staged checks**

Run: `bun check`

Expected: PASS with lint, typecheck, format:check, and license headers.

- [ ] **Step 4: Run full server and client suites**

Run:

```bash
bun test
bun test:client
```

Expected: PASS.

- [ ] **Step 5: Inspect secret exposure manually**

Run:

```bash
git diff --cached
```

Check that no test secret such as `sk-byok`, `sk-secret`, or `sk-global` appears in production logging, response snapshots that represent stored secrets, or committed config. Test fixtures may contain fake secrets only inside test files.

- [ ] **Step 6: Commit final regression fixes only when files changed**

If the regression pass changed files, run `rtk git status --short`, inspect each changed path, and stage the concrete files shown by that status output. Use this commit message:

```bash
git commit -m "test(byok): cover llm credential regressions"
```

If no files changed, do not create an empty commit.

---

## Self-Review Notes

Spec coverage:

- Admin-gated enablement: Task 7 and Task 9.
- Context-manager credential editing: Task 7 and Task 9.
- Dedicated encrypted storage: Tasks 1 through 3.
- Shared resolver: Task 4.
- Main and helper LLM calls: Tasks 5 and 6.
- Incomplete BYOK blocks without global fallback: Tasks 4 through 7.
- Masking and no plaintext reveal: Tasks 3, 7, 8, 9, and 10.
- Non-BYOK global compatibility: Tasks 4, 5, and 10.

Type consistency:

- Stored BYOK keys use global key names: `llm_apikey`, `llm_baseurl`, `main_model`, `small_model`, `embedding_model`.
- Runtime resolver exposes TypeScript-friendly names: `llmApiKey`, `llmBaseUrl`, `mainModel`, `smallModel`, `embeddingModel`.
- Settings API and client keep wire keys as global key names.

Execution notes:

- Preserve unrelated untracked files in the worktree.
- Use `.js` extensions in imports.
- Do not add lint suppressions or type-ignore comments.
- Commit after each task so review can isolate behavior changes.
