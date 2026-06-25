<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 1 — Agent-Credential Vault + Per-Session Secret Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user (or group admin) store their own Anthropic API key in the settings web UI and have ACP coding sessions run the sandboxed agent with that key, with no agent credential ever set on the magi host.

**Architecture:** A new encrypted per-config-context vault in papai (`coding_session_credentials`, namespace `agent-provider`) reusing `secret-payload-crypto.ts`. A new first-party plugin capability `codingSecrets` resolves+maps the vault to `{ ANTHROPIC_API_KEY }` and the acp plugin injects it into magi's `POST /sessions`/`POST /reviews`. magi gains a per-session `secrets` channel: a request-sourced `SecretSource` staged by the existing `magi-init` mechanism, throwing when a required secret is absent. No central/global fallback, no `enabled` toggle, no `process.env` agent key, no geofront change.

**Tech Stack:** Bun + `bun:test`, Drizzle (SQLite), Zod v4, Svelte 5 (runes), settings SPA with happy-dom client tests. Two repos: **papai** (`/Users/ki/Projects/yourpapai/papai`) and **magi** (`/Users/ki/Projects/yourpapai/magi`).

**Spec:** `docs/superpowers/specs/2026-06-25-phase-1-agent-credential-vault-design.md`
**Parent:** `docs/superpowers/specs/2026-06-25-user-self-serve-coding-credentials-design.md`

> **Execute on a feature branch, not `master`** (both repos). papai's write-hooks enforce test-first (red→green); magi has its own file-level TDD hooks. Each task is test-first.

---

## File Structure

**Part A — papai** (`/Users/ki/Projects/yourpapai/papai`)

- Create `src/db/coding-credentials-schema.ts` — Drizzle table.
- Create `src/db/migrations/061_coding_session_credentials.ts` — `CREATE TABLE`.
- Modify `src/db/index.ts` — import + register migration 061.
- Modify `src/db/schema.ts` — re-export the new table.
- Create `src/coding-credentials/types.ts` — namespaces, fields, state type.
- Create `src/coding-credentials/store.ts` — encrypted CRUD (no `enabled`).
- Create `src/coding-credentials/resolve-agent-secrets.ts` — vault → env-name map.
- Modify `src/plugins/types.ts` — add `coding.secrets` permission + `codingSecrets` to `PluginToolRuntimeContext`.
- Modify `src/plugins/tool-runtime.ts` — `buildCodingSecretsFacade` + wire into builder.
- Create `src/debug/settings/coding-credentials-routes.ts` — `GET`/`PATCH` route.
- Modify `src/debug/settings-api-router.ts` — register route.
- Modify `plugins/acp/plugin.json` — declare `coding.secrets`.
- Modify `plugins/acp/tools.ts` — `RuntimeContext` field + pre-flight + inject in `start_session`/`review_pr`.
- Modify `client/settings/fetcher-schemas.ts` — response schema/type.
- Modify `client/settings/fetchers.ts` — fetch/patch/clear fetchers.
- Create `client/settings/sections/CodingCredentialsSection.svelte` — the section.
- Modify `client/settings/SettingsApp.svelte` — import, render, sidebar, `ADVANCED_IDS`.
- Modify `CLAUDE.md` — document the vault + capability.
- Tests under `tests/coding-credentials/`, `tests/plugins/`, `tests/debug/settings/`, `tests/client/settings/`, `tests/acp/` (mirror the byok suites).

**Part B — magi** (`/Users/ki/Projects/yourpapai/magi`)

- Modify `src/project/config.ts` — add `request` `SecretSource` variant.
- Modify `src/runtime/geofront/provisioning/secret-stager.ts` — request staging + throw-on-missing.
- Modify `src/runtime/geofront/provisioning/presets.ts` — claude preset request secrets.
- Modify `src/runtime/runtime.ts` — `provision` gains `secrets`.
- Modify `src/runtime/geofront/geofront-runtime.ts` — thread `secrets` to `stageSecrets`.
- Modify `src/runtime/stub/stub-runtime.ts` — `provision` signature.
- Modify `src/session/state.ts` — `StartSessionInput.secrets`.
- Modify `src/session/manager.ts` — pass `secrets` to `provision`.
- Modify `src/review/manager.ts` — `StartReviewInput.secrets` + pass to `provision`.
- Modify `src/server/router.ts` — parse `secrets` in `handleStart`/`handleReview`.
- Tests under `tests/runtime/geofront/provisioning/`, `tests/session/`, `tests/review/`, `tests/server/`.

---

# Part A — papai

## Task A1: Encrypted vault — schema, migration, types, store

**Files:**

- Create: `src/db/coding-credentials-schema.ts`
- Create: `src/db/migrations/061_coding_session_credentials.ts`
- Modify: `src/db/index.ts` (imports ~line 73; `MIGRATIONS` array ~line 168)
- Modify: `src/db/schema.ts:52` (re-export)
- Create: `src/coding-credentials/types.ts`
- Create: `src/coding-credentials/store.ts`
- Test: `tests/coding-credentials/store.test.ts`

- [ ] **Step 1: Write the failing store test**

```ts
// tests/coding-credentials/store.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  clearCodingCredentials,
  getCodingCredentialState,
  getCodingCredentials,
  updateCodingCredentials,
} from '../../src/coding-credentials/store.js'
import { closeDb, initDb } from '../../src/db/index.js'

const CTX = 'pi:telegram:ctx:user-1'
const NS = 'agent-provider' as const

describe('coding-credentials store', () => {
  beforeEach(() => {
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
    initDb(':memory:')
  })
  afterEach(() => {
    closeDb()
  })

  test('unconfigured context reports not configured', () => {
    const state = getCodingCredentialState(CTX, NS)
    expect(state.configured).toBe(false)
    expect(state.complete).toBe(false)
    expect(state.missing).toEqual(['provider_api_key'])
    expect(getCodingCredentials(CTX, NS)).toBeNull()
  })

  test('round-trips an encrypted api key and reports complete', () => {
    updateCodingCredentials(CTX, NS, { provider_api_key: 'sk-ant-xyz' }, 'user-1')
    const state = getCodingCredentialState(CTX, NS)
    expect(state.configured).toBe(true)
    expect(state.complete).toBe(true)
    expect(state.missing).toEqual([])
    expect(getCodingCredentials(CTX, NS)).toEqual({ provider_api_key: 'sk-ant-xyz' })
  })

  test('merges fields and clears with empty string', () => {
    updateCodingCredentials(CTX, NS, { provider_api_key: 'sk-1', provider_base_url: 'https://p.example' }, 'user-1')
    updateCodingCredentials(CTX, NS, { provider_base_url: '' }, 'user-1')
    expect(getCodingCredentials(CTX, NS)).toEqual({ provider_api_key: 'sk-1' })
  })

  test('clear removes the row', () => {
    updateCodingCredentials(CTX, NS, { provider_api_key: 'sk-1' }, 'user-1')
    clearCodingCredentials(CTX, NS, 'user-1')
    expect(getCodingCredentialState(CTX, NS).configured).toBe(false)
  })

  test('is keyed per context', () => {
    updateCodingCredentials(CTX, NS, { provider_api_key: 'sk-1' }, 'user-1')
    expect(getCodingCredentialState('pi:telegram:ctx:user-2', NS).configured).toBe(false)
  })
})
```

> Note: confirm `initDb`/`closeDb` are the test DB helpers used by `tests/byok-llm/*` — if the byok tests use a different bootstrap (e.g. `getDrizzleDb` with an injected DB), mirror that exact pattern instead.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/coding-credentials/store.test.ts`
Expected: FAIL — `Cannot find module '../../src/coding-credentials/store.js'`.

- [ ] **Step 3: Create the Drizzle schema**

```ts
// src/db/coding-credentials-schema.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const codingSessionCredentials = sqliteTable(
  'coding_session_credentials',
  {
    contextId: text('context_id').notNull(),
    namespace: text('namespace').notNull(),
    encryptedConfig: text('encrypted_config').notNull(),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.contextId, table.namespace] }),
    index('idx_coding_session_credentials_updated_at').on(table.updatedAt),
  ],
)

export type CodingSessionCredentialRow = typeof codingSessionCredentials.$inferSelect
```

- [ ] **Step 4: Create the migration**

```ts
// src/db/migrations/061_coding_session_credentials.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:061' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS coding_session_credentials (
      context_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      encrypted_config TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (context_id, namespace)
    )
  `)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_coding_session_credentials_updated_at ON coding_session_credentials (updated_at)`,
  )
  log.info('migration 061: coding_session_credentials table created')
}

export const migration061CodingSessionCredentials: Migration = {
  id: '061_coding_session_credentials',
  up,
}

export default migration061CodingSessionCredentials
```

- [ ] **Step 5: Register the migration in `src/db/index.ts`**

Add the import alongside the other migration imports (after the `migration060…` import line):

```ts
import { migration061CodingSessionCredentials } from './migrations/061_coding_session_credentials.js'
```

Add it to the end of the `MIGRATIONS` array (after `migration060KaneoWorkspaceMembers,`):

```ts
  migration060KaneoWorkspaceMembers,
  migration061CodingSessionCredentials,
]
```

- [ ] **Step 6: Re-export the table from `src/db/schema.ts`**

After the byok re-export (line 52), add:

```ts
export { codingSessionCredentials, type CodingSessionCredentialRow } from './coding-credentials-schema.js'
```

- [ ] **Step 7: Create the vault types**

```ts
// src/coding-credentials/types.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const CODING_NAMESPACES = ['agent-provider'] as const
export type CodingNamespace = (typeof CODING_NAMESPACES)[number]

export const AGENT_PROVIDER_FIELDS = ['provider_api_key', 'provider_base_url'] as const
export const REQUIRED_AGENT_PROVIDER_FIELDS = ['provider_api_key'] as const
export type AgentProviderField = (typeof AGENT_PROVIDER_FIELDS)[number]
export type RequiredAgentProviderField = (typeof REQUIRED_AGENT_PROVIDER_FIELDS)[number]

export type CodingCredentialConfig = Partial<Record<AgentProviderField, string>>

export type CodingCredentialState = {
  readonly configured: boolean
  readonly complete: boolean
  readonly missing: readonly RequiredAgentProviderField[]
} & Partial<{ readonly unreadable: true; readonly error: string }>

// Phase 1 implements only the agent-provider namespace; Phase 2 adds 'forge'.
export const FIELDS_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': AGENT_PROVIDER_FIELDS,
}
export const REQUIRED_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': REQUIRED_AGENT_PROVIDER_FIELDS,
}
```

- [ ] **Step 8: Create the store** (mirrors `src/byok-llm/store.ts` minus the `enabled` toggle)

```ts
// src/coding-credentials/store.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { codingSessionCredentials } from '../db/coding-credentials-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import { decryptSecretPayload, encryptSecretPayload, type SecretPayload } from '../secret-payload-crypto.js'
import {
  type CodingCredentialConfig,
  type CodingCredentialState,
  type CodingNamespace,
  FIELDS_BY_NAMESPACE,
  REQUIRED_BY_NAMESPACE,
} from './types.js'

const log = logger.child({ scope: 'coding-credentials:store' })
const UNREADABLE = 'stored coding credentials are unreadable'

const now = (): number => Date.now()

const cleanConfig = (namespace: CodingNamespace, input: CodingCredentialConfig): CodingCredentialConfig =>
  Object.fromEntries(
    FIELDS_BY_NAMESPACE[namespace].flatMap((key) => {
      const value = (input as Record<string, string | undefined>)[key]?.trim()
      return value === undefined || value.length === 0 ? [] : [[key, value]]
    }),
  )

const findRow = (contextId: string, namespace: CodingNamespace) =>
  getDrizzleDb()
    .select()
    .from(codingSessionCredentials)
    .where(and(eq(codingSessionCredentials.contextId, contextId), eq(codingSessionCredentials.namespace, namespace)))
    .get()

const decrypt = (contextId: string, blob: string): CodingCredentialConfig | 'unreadable' => {
  try {
    return decryptSecretPayload(blob) as CodingCredentialConfig
  } catch {
    log.warn({ contextId }, UNREADABLE)
    return 'unreadable'
  }
}

const missingRequired = (namespace: CodingNamespace, config: CodingCredentialConfig | null): string[] =>
  REQUIRED_BY_NAMESPACE[namespace].filter((key) => {
    const value = (config as Record<string, string | undefined> | null)?.[key]?.trim()
    return value === undefined || value.length === 0
  })

export function getCodingCredentialState(contextId: string, namespace: CodingNamespace): CodingCredentialState {
  const row = findRow(contextId, namespace)
  if (row === undefined) {
    return { configured: false, complete: false, missing: REQUIRED_BY_NAMESPACE[namespace] as never }
  }
  const decrypted = decrypt(contextId, row.encryptedConfig)
  if (decrypted === 'unreadable') {
    return {
      configured: true,
      complete: false,
      missing: REQUIRED_BY_NAMESPACE[namespace] as never,
      unreadable: true,
      error: UNREADABLE,
    }
  }
  const missing = missingRequired(namespace, decrypted)
  return { configured: true, complete: missing.length === 0, missing: missing as never }
}

export function getCodingCredentials(contextId: string, namespace: CodingNamespace): CodingCredentialConfig | null {
  const row = findRow(contextId, namespace)
  if (row === undefined) return null
  const decrypted = decrypt(contextId, row.encryptedConfig)
  return decrypted === 'unreadable' ? null : cleanConfig(namespace, decrypted)
}

export function updateCodingCredentials(
  contextId: string,
  namespace: CodingNamespace,
  config: CodingCredentialConfig,
  updatedBy: string,
): void {
  const current = getCodingCredentials(contextId, namespace) ?? {}
  const merged: CodingCredentialConfig = { ...current }
  for (const key of FIELDS_BY_NAMESPACE[namespace]) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue
    const value = (config as Record<string, string | undefined>)[key]?.trim() ?? ''
    if (value.length === 0) delete (merged as Record<string, string | undefined>)[key]
    else (merged as Record<string, string>)[key] = value
  }
  const cleaned = cleanConfig(namespace, merged)
  const encryptedConfig = encryptSecretPayload(cleaned as SecretPayload)
  getDrizzleDb()
    .insert(codingSessionCredentials)
    .values({ contextId, namespace, encryptedConfig, updatedAt: now(), updatedBy })
    .onConflictDoUpdate({
      target: [codingSessionCredentials.contextId, codingSessionCredentials.namespace],
      set: {
        encryptedConfig: sql`excluded.encrypted_config`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
  log.info({ contextId, namespace, updatedBy }, 'coding credentials updated')
}

export function clearCodingCredentials(contextId: string, namespace: CodingNamespace, updatedBy: string): void {
  getDrizzleDb()
    .delete(codingSessionCredentials)
    .where(and(eq(codingSessionCredentials.contextId, contextId), eq(codingSessionCredentials.namespace, namespace)))
    .run()
  log.info({ contextId, namespace, updatedBy }, 'coding credentials cleared')
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `bun test tests/coding-credentials/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 10: Commit**

```bash
git add src/db/coding-credentials-schema.ts src/db/migrations/061_coding_session_credentials.ts \
  src/db/index.ts src/db/schema.ts src/coding-credentials/ tests/coding-credentials/store.test.ts
git commit -m "feat(coding-credentials): encrypted per-context agent-provider vault"
```

---

## Task A2: `codingSecrets` plugin capability

**Files:**

- Create: `src/coding-credentials/resolve-agent-secrets.ts`
- Modify: `src/plugins/types.ts` (`PLUGIN_PERMISSIONS` ~line 47; `PluginToolRuntimeContext` type)
- Modify: `src/plugins/tool-runtime.ts` (`deny` helper exists; builder at line 191)
- Test: `tests/coding-credentials/resolve-agent-secrets.test.ts`, `tests/plugins/coding-secrets-facade.test.ts`

- [ ] **Step 1: Write the failing resolver test**

```ts
// tests/coding-credentials/resolve-agent-secrets.test.ts
import { afterEach, beforeEach, expect, test } from 'bun:test'

import { resolveAgentSecrets } from '../../src/coding-credentials/resolve-agent-secrets.js'
import { updateCodingCredentials } from '../../src/coding-credentials/store.js'
import { closeDb, initDb } from '../../src/db/index.js'

const STORAGE_CTX = 'pi:telegram:ctx:user-9'

beforeEach(() => {
  process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  initDb(':memory:')
})
afterEach(() => closeDb())

test('returns null when no api key configured', () => {
  expect(resolveAgentSecrets(STORAGE_CTX)).toBeNull()
})

test('maps the stored key to ANTHROPIC_API_KEY', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-ant-1' }, 'user-9')
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-1' })
})

test('includes ANTHROPIC_BASE_URL when set', () => {
  updateCodingCredentials(
    STORAGE_CTX,
    'agent-provider',
    { provider_api_key: 'sk-ant-1', provider_base_url: 'https://proxy.example' },
    'user-9',
  )
  expect(resolveAgentSecrets(STORAGE_CTX)).toEqual({
    ANTHROPIC_API_KEY: 'sk-ant-1',
    ANTHROPIC_BASE_URL: 'https://proxy.example',
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/coding-credentials/resolve-agent-secrets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the resolver**

```ts
// src/coding-credentials/resolve-agent-secrets.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getCodingCredentials } from './store.js'

/**
 * Resolve the acting context's agent-provider credentials and map them to the
 * env-name-keyed secrets the magi request expects. papai owns this mapping
 * (Phase 1: Anthropic only). Returns null when no complete credential exists.
 */
export function resolveAgentSecrets(storageContextId: string): Record<string, string> | null {
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  const creds = getCodingCredentials(configContextId, 'agent-provider')
  const apiKey = creds?.provider_api_key?.trim()
  if (apiKey === undefined || apiKey.length === 0) return null
  const out: Record<string, string> = { ANTHROPIC_API_KEY: apiKey }
  const baseUrl = creds?.provider_base_url?.trim()
  if (baseUrl !== undefined && baseUrl.length > 0) out.ANTHROPIC_BASE_URL = baseUrl
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/coding-credentials/resolve-agent-secrets.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the permission and the facade type to `src/plugins/types.ts`**

Add to `PLUGIN_PERMISSIONS` (after `'attachments.read',`):

```ts
  'attachments.read',
  'coding.secrets',
] as const
```

Add the `codingSecrets` field to the `PluginToolRuntimeContext` type (alongside `kv`, `adminConfig`, `contextConfig`, `attachments`):

```ts
  codingSecrets: { resolve(): Record<string, string> | null }
```

- [ ] **Step 6: Write the failing facade test**

```ts
// tests/plugins/coding-secrets-facade.test.ts
import { afterEach, beforeEach, expect, test } from 'bun:test'

import { updateCodingCredentials } from '../../src/coding-credentials/store.js'
import { closeDb, initDb } from '../../src/db/index.js'
import { buildCodingSecretsFacade } from '../../src/plugins/tool-runtime.js'

const STORAGE_CTX = 'pi:telegram:ctx:user-3'

beforeEach(() => {
  process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
  initDb(':memory:')
})
afterEach(() => closeDb())

test('resolve returns mapped secrets when configured', () => {
  updateCodingCredentials(STORAGE_CTX, 'agent-provider', { provider_api_key: 'sk-1' }, 'user-3')
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolve()).toEqual({ ANTHROPIC_API_KEY: 'sk-1' })
})

test('resolve returns null when not configured', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, true)
  expect(facade.resolve()).toBeNull()
})

test('resolve throws without the coding.secrets permission', () => {
  const facade = buildCodingSecretsFacade('acp', STORAGE_CTX, false)
  expect(() => facade.resolve()).toThrow("does not have 'coding.secrets' permission")
})
```

- [ ] **Step 7: Run to verify it fails**

Run: `bun test tests/plugins/coding-secrets-facade.test.ts`
Expected: FAIL — `buildCodingSecretsFacade` is not exported.

- [ ] **Step 8: Implement `buildCodingSecretsFacade` and wire it into the builder** (`src/plugins/tool-runtime.ts`)

Add the import near the other `coding`/store imports at the top:

```ts
import { resolveAgentSecrets } from '../coding-credentials/resolve-agent-secrets.js'
```

Add the builder function next to the other `build*` facade functions:

```ts
export function buildCodingSecretsFacade(
  pluginId: string,
  storageContextId: string,
  hasPermission: boolean,
): PluginToolRuntimeContext['codingSecrets'] {
  return Object.freeze({
    resolve(): Record<string, string> | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      return resolveAgentSecrets(storageContextId)
    },
  })
}
```

Wire it into `buildPluginToolRuntimeContext` (line 191), in the returned object alongside `attachments`:

```ts
    codingSecrets: buildCodingSecretsFacade(pluginId, runtime.storageContextId, permissions.has('coding.secrets')),
```

- [ ] **Step 9: Run to verify it passes**

Run: `bun test tests/plugins/coding-secrets-facade.test.ts tests/coding-credentials/resolve-agent-secrets.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/coding-credentials/resolve-agent-secrets.ts src/plugins/types.ts src/plugins/tool-runtime.ts \
  tests/coding-credentials/resolve-agent-secrets.test.ts tests/plugins/coding-secrets-facade.test.ts
git commit -m "feat(plugins): codingSecrets capability gated by coding.secrets permission"
```

---

## Task A3: Settings route `/settings/api/coding-credentials`

**Files:**

- Create: `src/debug/settings/coding-credentials-routes.ts`
- Modify: `src/debug/settings-api-router.ts` (import near line 13; dispatch near line 65)
- Test: `tests/debug/settings/coding-credentials-routes.test.ts`

- [ ] **Step 1: Write the failing route test** (mirror `tests/debug/settings/byok-routes.test.ts` setup for auth/principal/CSRF — copy that suite's harness helpers verbatim)

```ts
// tests/debug/settings/coding-credentials-routes.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { handleCodingCredentialsRoutes } from '../../../src/debug/settings/coding-credentials-routes.js'
import { closeDb, initDb } from '../../../src/db/index.js'
// Reuse the exact harness from byok-routes.test.ts:
import { authedGet, authedPatch, seedSession } from './byok-test-harness.js'

const CTX = 'pi:telegram:ctx:owner-1'

describe('coding-credentials routes', () => {
  beforeEach(() => {
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
    initDb(':memory:')
    seedSession(CTX) // principal authorized to write CTX
  })
  afterEach(() => closeDb())

  test('GET returns not-configured fields without secret values', async () => {
    const res = await handleCodingCredentialsRoutes(...authedGet(`/settings/api/coding-credentials?contextId=${CTX}`))
    const body = (await res.json()) as { configured: boolean; fields: { key: string }[] }
    expect(res.status).toBe(200)
    expect(body.configured).toBe(false)
    expect(body.fields.map((f) => f.key)).toEqual(['provider_api_key', 'provider_base_url'])
  })

  test('PATCH saves the key and GET reports configured + masked', async () => {
    await handleCodingCredentialsRoutes(
      ...authedPatch('/settings/api/coding-credentials', { contextId: CTX, values: { provider_api_key: 'sk-ant-1' } }),
    )
    const res = await handleCodingCredentialsRoutes(...authedGet(`/settings/api/coding-credentials?contextId=${CTX}`))
    const body = (await res.json()) as {
      configured: boolean
      complete: boolean
      fields: { key: string; value: string }[]
    }
    expect(body.configured).toBe(true)
    expect(body.complete).toBe(true)
    const keyField = body.fields.find((f) => f.key === 'provider_api_key')
    expect(keyField?.value).not.toContain('sk-ant-1') // masked, never the raw secret
  })

  test('PATCH with clear:true removes credentials', async () => {
    await handleCodingCredentialsRoutes(
      ...authedPatch('/settings/api/coding-credentials', { contextId: CTX, values: { provider_api_key: 'sk-1' } }),
    )
    await handleCodingCredentialsRoutes(
      ...authedPatch('/settings/api/coding-credentials', { contextId: CTX, clear: true }),
    )
    const res = await handleCodingCredentialsRoutes(...authedGet(`/settings/api/coding-credentials?contextId=${CTX}`))
    expect(((await res.json()) as { configured: boolean }).configured).toBe(false)
  })

  test('PATCH to an unmanageable context is forbidden', async () => {
    const res = await handleCodingCredentialsRoutes(
      ...authedPatch('/settings/api/coding-credentials', {
        contextId: 'pi:telegram:ctx:stranger',
        values: { provider_api_key: 'x' },
      }),
    )
    expect(res.status).toBe(403)
  })

  test('malformed body is rejected', async () => {
    const res = await handleCodingCredentialsRoutes(
      ...authedPatch('/settings/api/coding-credentials', { contextId: CTX, bogus: 1 }),
    )
    expect(res.status).toBe(422)
  })
})
```

> Extract the byok suite's request/auth/CSRF helpers into `tests/debug/settings/byok-test-harness.js` (or import them from wherever that suite already defines them) so `authedGet`/`authedPatch`/`seedSession` are shared, not duplicated. Match the byok suite's exact principal-seeding approach.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route** (mirrors `src/debug/settings/byok-routes.ts`)

```ts
// src/debug/settings/coding-credentials-routes.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  clearCodingCredentials,
  getCodingCredentialState,
  getCodingCredentials,
  updateCodingCredentials,
} from '../../coding-credentials/store.js'
import type { CodingCredentialConfig } from '../../coding-credentials/types.js'
import { maskSensitiveValue } from '../../config.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const NAMESPACE = 'agent-provider' as const

const CODING_FIELDS = [
  { key: 'provider_api_key', label: 'Anthropic API Key', required: true, sensitive: true },
  { key: 'provider_base_url', label: 'Anthropic Base URL (optional)', required: false, sensitive: false },
] as const

const SaveBodySchema = z.object({ contextId: z.string().optional(), values: z.record(z.string(), z.string()) }).strict()
const ClearBodySchema = z.object({ contextId: z.string().optional(), clear: z.literal(true) }).strict()
const PatchBodySchema = z.union([ClearBodySchema, SaveBodySchema])

const allowedKeys = new Set<string>(CODING_FIELDS.map((f) => f.key))

const fieldResponse = (contextId: string): unknown => {
  const state = getCodingCredentialState(contextId, NAMESPACE)
  const config = getCodingCredentials(contextId, NAMESPACE) ?? {}
  const fields = CODING_FIELDS.map((field) => {
    const raw = (config as Record<string, string | undefined>)[field.key] ?? ''
    const hasValue = raw.length > 0
    return { ...field, hasValue, value: hasValue && field.sensitive ? maskSensitiveValue(raw) : raw }
  })
  return { namespace: NAMESPACE, ...state, fields }
}

const valuesToPersist = (contextId: string, values: Record<string, string>): CodingCredentialConfig => {
  const current = getCodingCredentials(contextId, NAMESPACE) ?? {}
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      if (!allowedKeys.has(key)) return []
      const field = CODING_FIELDS.find((c) => c.key === key)
      const existing = (current as Record<string, string | undefined>)[key] ?? ''
      const keepExistingSensitive =
        field?.sensitive === true &&
        (value.length === 0 || (existing.length > 0 && value === maskSensitiveValue(existing)))
      return keepExistingSensitive ? [] : [[key, value]]
    }),
  ) as CodingCredentialConfig
}

export async function handleCodingCredentialsRoutes(req: Request, url: URL): Promise<Response> {
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
    const body = PatchBodySchema.safeParse(parsed.value)
    if (!body.success) return settingsJson(422, { error: 'invalid request' })

    const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
    if (!scope.ok) return scope.response

    if ('clear' in body.data) {
      clearCodingCredentials(scope.scope.contextId, NAMESPACE, auth.authed.principal.platformUserId)
      return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
    }
    updateCodingCredentials(
      scope.scope.contextId,
      NAMESPACE,
      valuesToPersist(scope.scope.contextId, body.data.values),
      auth.authed.principal.platformUserId,
    )
    return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
  }

  return settingsJson(405, { error: 'method not allowed' })
}
```

- [ ] **Step 4: Register the route in `src/debug/settings-api-router.ts`**

Add the import near the byok import (line 13):

```ts
import { handleCodingCredentialsRoutes } from './settings/coding-credentials-routes.js'
```

Add the dispatch next to the byok user route (line 65):

```ts
if (url.pathname === '/settings/api/coding-credentials') return handleCodingCredentialsRoutes(req, url)
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test tests/debug/settings/coding-credentials-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/coding-credentials-routes.ts src/debug/settings-api-router.ts \
  tests/debug/settings/coding-credentials-routes.test.ts tests/debug/settings/byok-test-harness.js
git commit -m "feat(settings): coding-credentials user route"
```

---

## Task A4: Client fetcher + schema

**Files:**

- Modify: `client/settings/fetcher-schemas.ts` (after the BYOK schemas, ~line 72)
- Modify: `client/settings/fetchers.ts` (after the BYOK fetchers, ~line 136)
- Test: `tests/client/settings/coding-credentials-fetchers.test.ts`

- [ ] **Step 1: Write the failing fetcher test** (mirror an existing `tests/client/settings/*fetchers*` test that stubs `settingsFetch`)

```ts
// tests/client/settings/coding-credentials-fetchers.test.ts
import { afterEach, beforeEach, expect, test } from 'bun:test'

import { fetchCodingCredentials, patchCodingCredentials } from '../../../client/settings/fetchers.js'
import { installFetchStub, lastRequest, restoreFetch } from './fetch-stub.js' // reuse the byok fetcher harness

beforeEach(() => installFetchStub())
afterEach(() => restoreFetch())

test('fetchCodingCredentials GETs the namespaced endpoint and parses', async () => {
  installFetchStub({
    namespace: 'agent-provider',
    configured: false,
    complete: false,
    missing: ['provider_api_key'],
    fields: [
      {
        key: 'provider_api_key',
        label: 'Anthropic API Key',
        required: true,
        sensitive: true,
        hasValue: false,
        value: '',
      },
    ],
  })
  const res = await fetchCodingCredentials('pi:telegram:ctx:u1')
  expect(res.configured).toBe(false)
  expect(lastRequest().url).toContain('/settings/api/coding-credentials?contextId=pi%3Atelegram%3Actx%3Au1')
})

test('patchCodingCredentials PATCHes values', async () => {
  installFetchStub({ ok: true })
  await patchCodingCredentials({ contextId: 'pi:telegram:ctx:u1', values: { provider_api_key: 'sk-1' } })
  expect(lastRequest().method).toBe('PATCH')
  expect(JSON.parse(lastRequest().body as string)).toEqual({
    contextId: 'pi:telegram:ctx:u1',
    values: { provider_api_key: 'sk-1' },
  })
})
```

> Reuse the exact fetch-stub harness the byok fetcher tests use; if none exists, copy the pattern from the closest existing `tests/client/settings` fetcher test verbatim.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test:client tests/client/settings/coding-credentials-fetchers.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Add the schema to `client/settings/fetcher-schemas.ts`** (after the BYOK block, reuse `StoredConfigValueSchema`)

```ts
// --- Coding credentials ---

export const CodingCredentialFieldSchema = StoredConfigValueSchema
export const CodingCredentialsResponseSchema = z.object({
  namespace: z.string(),
  configured: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  unreadable: z.literal(true).optional(),
  error: z.string().optional(),
  fields: z.array(CodingCredentialFieldSchema),
})
export type CodingCredentialField = z.infer<typeof CodingCredentialFieldSchema>
export type CodingCredentialsResponse = z.infer<typeof CodingCredentialsResponseSchema>
```

- [ ] **Step 4: Add the fetchers to `client/settings/fetchers.ts`** (after the BYOK block; add the type import to the existing `./fetcher-schemas.js` import group)

```ts
// --- Coding credentials ---

export const fetchCodingCredentials = (contextId: string): Promise<CodingCredentialsResponse> =>
  getJson(`/settings/api/coding-credentials?${ctxQuery(contextId)}`, (b) => CodingCredentialsResponseSchema.parse(b))

export const patchCodingCredentials = (input: {
  contextId: string
  values: Record<string, string>
}): Promise<unknown> => writeJson('/settings/api/coding-credentials', 'PATCH', input, (b) => b)

export const clearCodingCredentials = (input: { contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/coding-credentials', 'PATCH', { contextId: input.contextId, clear: true }, (b) => b)
```

Add `CodingCredentialsResponseSchema` and `type CodingCredentialsResponse` to the existing import from `./fetcher-schemas.js`.

- [ ] **Step 5: Run to verify it passes**

Run: `bun test:client tests/client/settings/coding-credentials-fetchers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/fetchers.ts \
  tests/client/settings/coding-credentials-fetchers.test.ts
git commit -m "feat(settings-ui): coding-credentials fetchers + schema"
```

---

## Task A5: Client section + SettingsApp wiring

**Files:**

- Create: `client/settings/sections/CodingCredentialsSection.svelte`
- Modify: `client/settings/SettingsApp.svelte` (imports ~line 22; Advanced render ~line 213; `ADVANCED_IDS` line 44; sidebar `groups` ~line 100)
- Test: `tests/client/settings/coding-credentials-section.test.ts`

- [ ] **Step 1: Write the failing component test** (mirror `tests/client/settings/byok-section.test.ts`)

```ts
// tests/client/settings/coding-credentials-section.test.ts
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { render, cleanup } from '@testing-library/svelte'

import CodingCredentialsSection from '../../../client/settings/sections/CodingCredentialsSection.svelte'
import { installFetchStub, restoreFetch } from './fetch-stub.js'

beforeEach(() => installFetchStub())
afterEach(() => {
  cleanup()
  restoreFetch()
})

test('renders the Anthropic API key field', async () => {
  installFetchStub({
    namespace: 'agent-provider',
    configured: false,
    complete: false,
    missing: ['provider_api_key'],
    fields: [
      {
        key: 'provider_api_key',
        label: 'Anthropic API Key',
        required: true,
        sensitive: true,
        hasValue: false,
        value: '',
      },
      {
        key: 'provider_base_url',
        label: 'Anthropic Base URL (optional)',
        required: false,
        sensitive: false,
        hasValue: false,
        value: '',
      },
    ],
  })
  const { findByTestId } = render(CodingCredentialsSection, { props: { contextId: 'pi:telegram:ctx:u1' } })
  expect(await findByTestId('coding-input-provider_api_key')).toBeTruthy()
})
```

> Match the byok-section test's render/query helpers exactly (the repo's client tests use happy-dom via `tests/client-setup.ts`).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test:client tests/client/settings/coding-credentials-section.test.ts`
Expected: FAIL — component file not found.

- [ ] **Step 3: Create the section** (adapted from `ByokSection.svelte`: per-field save + Replace for the secret; **no enable toggle**, **no central-credentials placeholder**)

```svelte
<!-- client/settings/sections/CodingCredentialsSection.svelte -->
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Btn from '../../shared/ui/Btn.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import type { CodingCredentialField, CodingCredentialsResponse } from '../fetcher-schemas.js'
  import { fetchCodingCredentials, patchCodingCredentials } from '../fetchers.js'
  import { maskSecret } from '../lib/mask-secret.js'

  interface Props {
    contextId: string
  }
  let { contextId }: Props = $props()

  let data: CodingCredentialsResponse | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let savingKey: string | null = $state(null)
  let drafts: Record<string, string> = $state({})
  let replacing: Record<string, boolean> = $state({})
  let loadedContextId: string | null = $state(null)

  const currentData = $derived(loadedContextId === contextId ? data : null)
  const fields = $derived(currentData?.fields ?? [])
  const missing = $derived(currentData?.missing ?? [])
  const unreadableError = $derived(currentData?.unreadable === true ? currentData.error : null)

  function initialDrafts(nextFields: CodingCredentialField[]): Record<string, string> {
    return Object.fromEntries(nextFields.map((f) => [f.key, f.sensitive && f.hasValue ? '' : f.value]))
  }
  function displaySecret(value: string): string {
    return value.includes('*') ? maskSecret(value) : '••••••••'
  }
  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const next = await fetchCodingCredentials(id)
      if (id !== contextId) return
      data = next
      loadedContextId = id
      drafts = initialDrafts(next.fields)
      replacing = {}
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
    } finally {
      if (id === contextId) loading = false
    }
  }
  function updateDraft(key: string, value: string): void {
    drafts = { ...drafts, [key]: value }
  }
  function replaceSecret(key: string): void {
    replacing = { ...replacing, [key]: true }
    updateDraft(key, '')
  }
  function cancelReplace(key: string): void {
    const { [key]: _, ...rest } = replacing
    replacing = rest
    updateDraft(key, '')
  }
  function editorOpen(field: CodingCredentialField): boolean {
    return !field.sensitive || replacing[field.key] === true || !field.hasValue
  }
  async function save(field: CodingCredentialField): Promise<void> {
    if (loading || loadedContextId !== contextId) return
    error = null
    status = null
    savingKey = field.key
    try {
      await patchCodingCredentials({ contextId, values: { [field.key]: drafts[field.key] ?? '' } })
      await load(contextId)
      status = `${field.label} saved.`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      savingKey = null
    }
  }

  $effect(() => {
    const id = contextId
    untrack(() => {
      void load(id)
    })
  })
</script>

<section id="coding-credentials" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="AI provider">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="coding-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error">Stored credentials are unreadable. Re-enter your key to repair this context.</p>
    {/if}
    {#if !currentData.complete}
      <p class="placeholder">
        Coding sessions need your Anthropic API key. Enter it below — it is encrypted and used only to run your sessions.
      </p>
    {/if}

    <div class="settings-byok-fields">
      {#each fields as field (field.key)}
        <div class="settings-field" data-testid={`coding-row-${field.key}`}>
          <div class="settings-field__head">
            <span class="t-label settings-field__label">{field.label}{field.required ? ' *' : ''}</span>
            {#if field.sensitive && field.hasValue && !editorOpen(field)}
              <Secret value={displaySecret(field.value)} />
              <Btn variant="secondary" size="sm" testid={`coding-replace-${field.key}`} onClick={() => replaceSecret(field.key)}>
                {#snippet children()}Replace{/snippet}
              </Btn>
            {/if}
          </div>
          {#if editorOpen(field)}
            <div class="settings-field__editor">
              <Field label={field.sensitive ? 'New value' : 'Value'}>
                {#snippet children()}
                  <Input
                    type={field.sensitive ? 'password' : 'text'}
                    value={drafts[field.key] ?? ''}
                    placeholder={field.sensitive ? 'enter a new value' : ''}
                    onInput={(value) => updateDraft(field.key, value)}
                    testid={`coding-input-${field.key}`} />
                {/snippet}
              </Field>
              <Btn
                variant="primary"
                size="sm"
                testid={`coding-save-${field.key}`}
                disabled={savingKey === field.key || loading}
                onClick={() => void save(field)}>
                {#snippet children()}{savingKey === field.key ? 'Saving…' : 'Save'}{/snippet}
              </Btn>
              {#if field.sensitive && field.hasValue}
                <Btn variant="ghost" size="sm" testid={`coding-cancel-${field.key}`} onClick={() => cancelReplace(field.key)}>
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

<style>
  .settings-byok-fields {
    display: grid;
    gap: 12px;
  }
  .settings-field {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-field__head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .settings-field__label {
    color: var(--fg2);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .settings-field__editor {
    display: flex;
    align-items: end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .settings-field__editor :global(.ui-field) {
    flex: 1;
    min-width: 200px;
  }
</style>
```

- [ ] **Step 4: Wire it into `client/settings/SettingsApp.svelte`**

Add the import next to `ByokSection`:

```ts
import CodingCredentialsSection from './sections/CodingCredentialsSection.svelte'
```

Render it in the Advanced content, right after `<ByokSection contextId={ctx} />`:

```svelte
                <ByokSection contextId={ctx} />
                <CodingCredentialsSection contextId={ctx} />
```

Add `'coding-credentials'` to `ADVANCED_IDS` (line 44):

```ts
const ADVANCED_IDS: readonly string[] = [
  'memory',
  'ai-output',
  'identity',
  'byok',
  'coding-credentials',
  'mcp',
  'plugins',
]
```

Add the sidebar item in the Advanced group `items` array (after the `byok` item):

```ts
          { id: 'byok', label: 'BYOK LLM' },
          { id: 'coding-credentials', label: 'Coding sessions' },
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test:client tests/client/settings/coding-credentials-section.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodingCredentialsSection.svelte client/settings/SettingsApp.svelte \
  tests/client/settings/coding-credentials-section.test.ts
git commit -m "feat(settings-ui): Coding sessions AI-provider section"
```

---

## Task A6: acp plugin injects the secret + pre-flight refusal

**Files:**

- Modify: `plugins/acp/plugin.json` (add permission)
- Modify: `plugins/acp/tools.ts` (`RuntimeContext` type ~line 33; `startSessionTool` ~line 61; `reviewPrTool` ~line 198)
- Test: `tests/acp/coding-secrets-injection.test.ts` (mirror existing `tests/acp/*` tool tests)

- [ ] **Step 1: Write the failing tool test** (use the existing acp tool test harness: a fake `httpFetch` capturing the request body, and a fake `RuntimeContext`)

```ts
// tests/acp/coding-secrets-injection.test.ts
import { expect, test } from 'bun:test'

import { startSessionTool } from '../../plugins/acp/tools.js'

const ADMIN = {
  get: (k: string) => (k === 'magi_base_url' ? 'http://magi.local' : k === 'magi_token' ? 'tok' : undefined),
}
const KV = { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] }

function ctx(resolve: () => Record<string, string> | null) {
  return { storageContextId: 'pi:telegram:ctx:u1', adminConfig: ADMIN, kv: KV, codingSecrets: { resolve } }
}

test('refuses when no credentials are configured', async () => {
  let called = false
  const httpFetch = async () => {
    called = true
    return new Response('{}', { status: 202 })
  }
  const tool = startSessionTool(httpFetch)
  const res = await tool.execute(
    { project: 'demo', prompt: 'hi' },
    ctx(() => null),
    {},
  )
  expect((res as { error?: string }).error).toBe('not_configured')
  expect(called).toBe(false)
})

test('includes resolved secrets in the POST body', async () => {
  let sentBody: unknown
  const httpFetch = async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ id: 's1', status: 'queued' }), { status: 202 })
  }
  const tool = startSessionTool(httpFetch)
  await tool.execute(
    { project: 'demo', prompt: 'hi' },
    ctx(() => ({ ANTHROPIC_API_KEY: 'sk-1' })),
    {},
  )
  expect((sentBody as { secrets: Record<string, string> }).secrets).toEqual({ ANTHROPIC_API_KEY: 'sk-1' })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/acp/coding-secrets-injection.test.ts`
Expected: FAIL — `codingSecrets`/`secrets` not handled.

- [ ] **Step 3: Declare the permission in `plugins/acp/plugin.json`**

```json
  "permissions": ["http", "storage", "commands", "coding.secrets"],
```

- [ ] **Step 4: Extend `RuntimeContext` in `plugins/acp/tools.ts`**

```ts
export type RuntimeContext = {
  storageContextId: string
  adminConfig: AdminConfigReader
  kv: KvStore
  codingSecrets: { resolve(): Record<string, string> | null }
}
```

- [ ] **Step 5: Add pre-flight + injection to `startSessionTool.execute`**

Replace the body of `startSessionTool.execute` so that, after `cfg`/input validation, it resolves and includes secrets:

```ts
const cfg = readMagiConfig(runtimeContext.adminConfig)
if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
const args = asObject(input)
const project = asString(args, 'project')
const prompt = asString(args, 'prompt')
if (project === null || prompt === null) return { error: 'invalid_input', message: 'project and prompt are required' }
const secrets = runtimeContext.codingSecrets.resolve()
if (secrets === null)
  return {
    error: 'not_configured',
    message: 'Set up your AI provider key in settings → Coding sessions before starting a session.',
  }
const agent = optionalString(args, 'agent') ?? DEFAULT_AGENT
const result = await callMagi(httpFetch, cfg, 'POST', '/sessions', {
  project,
  agent,
  contextId: runtimeContext.storageContextId,
  prompt,
  secrets,
})
const id = sessionIdOf(result)
if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')
return result
```

- [ ] **Step 6: Add the same pre-flight + injection to `reviewPrTool.execute`**

After resolving `project`/`prNumber` and before `callMagi`:

```ts
if (project === null || prNumber === null)
  return { error: 'invalid_input', message: 'project and a positive prNumber are required' }
const secrets = runtimeContext.codingSecrets.resolve()
if (secrets === null)
  return {
    error: 'not_configured',
    message: 'Set up your AI provider key in settings → Coding sessions before starting a review.',
  }
const result = await callMagi(httpFetch, cfg, 'POST', '/reviews', {
  project,
  prNumber,
  contextId: runtimeContext.storageContextId,
  secrets,
})
```

- [ ] **Step 7: Run to verify it passes**

Run: `bun test tests/acp/coding-secrets-injection.test.ts`
Expected: PASS. Then run the existing acp suite to confirm no regression: `bun test tests/acp/`.

- [ ] **Step 8: Update `CLAUDE.md`** — in the ACP plugin paragraph, note that the agent LLM key is supplied per-session from the `coding_session_credentials` vault via the `coding.secrets`-gated `codingSecrets` capability (no host/global agent key).

- [ ] **Step 9: Commit**

```bash
git add plugins/acp/plugin.json plugins/acp/tools.ts tests/acp/coding-secrets-injection.test.ts CLAUDE.md
git commit -m "feat(acp): inject per-context agent key into magi sessions; refuse when unconfigured"
```

---

# Part B — magi (`/Users/ki/Projects/yourpapai/magi`)

## Task B1: Request-sourced provisioning secret + claude preset

**Files:**

- Modify: `src/project/config.ts` (`SecretSource` union)
- Modify: `src/runtime/geofront/provisioning/secret-stager.ts` (`stageOne`, `stageSecrets`)
- Modify: `src/runtime/geofront/provisioning/presets.ts` (`claudePreset`, `getPreset`)
- Test: `tests/runtime/geofront/provisioning/secret-stager.test.ts`, `tests/runtime/geofront/provisioning/presets.test.ts`

- [ ] **Step 1: Update the preset test to expect request-sourced secrets**

In `tests/runtime/geofront/provisioning/presets.test.ts`, replace the claude-preset expectations (currently asserting `hostPath`/`keychain`) with:

```ts
test('claude preset uses request-sourced secrets, not host creds', () => {
  const preset = getPreset('claude', 'linux')
  expect(preset?.secretTargets).toEqual([
    { request: 'ANTHROPIC_API_KEY', targetEnv: 'ANTHROPIC_API_KEY', required: true },
    { request: 'ANTHROPIC_BASE_URL', targetEnv: 'ANTHROPIC_BASE_URL', required: false },
  ])
  expect(preset?.defaultEgress).toContain('api.anthropic.com')
})
```

- [ ] **Step 2: Add a request-secret test to the stager suite**

```ts
// append to tests/runtime/geofront/provisioning/secret-stager.test.ts
test('stages a request-sourced secret as an env entry', async () => {
  const deps = makeDeps() // existing helper in this suite
  const plan = {
    ...basePlan,
    secrets: [{ request: 'ANTHROPIC_API_KEY', targetEnv: 'ANTHROPIC_API_KEY', required: true }],
  }
  await stageSecrets(deps, plan, worktree, { ANTHROPIC_API_KEY: 'sk-1' })
  const manifest = await readFile(join(worktree, '.magi-private', 'manifest'), 'utf8')
  expect(manifest).toContain('env\t')
  expect(manifest).toContain('ANTHROPIC_API_KEY')
})

test('throws when a required request secret is missing', async () => {
  const deps = makeDeps()
  const plan = {
    ...basePlan,
    secrets: [{ request: 'ANTHROPIC_API_KEY', targetEnv: 'ANTHROPIC_API_KEY', required: true }],
  }
  await expect(stageSecrets(deps, plan, worktree, {})).rejects.toThrow(
    'provisioning secret not provided: ANTHROPIC_API_KEY',
  )
})

test('skips an optional request secret that is absent', async () => {
  const deps = makeDeps()
  const plan = {
    ...basePlan,
    secrets: [{ request: 'ANTHROPIC_BASE_URL', targetEnv: 'ANTHROPIC_BASE_URL', required: false }],
  }
  await stageSecrets(deps, plan, worktree, {})
  // no .magi-private dir / empty manifest is acceptable; assert no throw + no base-url entry
})
```

> Use the suite's existing `makeDeps`/`basePlan`/`worktree` helpers; if the names differ, match the file's current conventions.

- [ ] **Step 3: Run to verify both fail**

Run: `bun test tests/runtime/geofront/provisioning/presets.test.ts tests/runtime/geofront/provisioning/secret-stager.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add the `request` variant to `SecretSource`** (`src/project/config.ts`)

```ts
export type SecretSource =
  | { hostPath: string; target: string }
  | { keychain: string; target: string }
  | { env: string; targetEnv: string }
  | { request: string; targetEnv: string; required?: boolean }
```

- [ ] **Step 5: Implement request staging** (`src/runtime/geofront/provisioning/secret-stager.ts`)

Change `stageSecrets` to accept `requestSecrets`, thread it to `stageOne`, and make `stageOne` return `ManifestEntry | null` (null = skipped optional). Add the `request` branch to `stageOne`:

```ts
if ('request' in secret) {
  const value = requestSecrets[secret.request]
  if (value === undefined) {
    if (secret.required === false) return null
    throw new Error(`provisioning secret not provided: ${secret.request}`)
  }
  await writeFile(join(dir, staged), value)
  return { staged, line: `env\t${staged}\t${secret.targetEnv}` }
}
```

Update `stageSecrets`:

```ts
export async function stageSecrets(
  deps: SecretStagerDeps,
  plan: ProvisioningPlan,
  worktreePath: string,
  requestSecrets: Record<string, string>,
): Promise<void> {
  const dir = join(worktreePath, PRIVATE_DIR)
  await rm(dir, { recursive: true, force: true })
  if (plan.secrets.length === 0) return
  await mkdir(dir, { recursive: true })
  const staged = await Promise.all(
    plan.secrets.map((secret, i): Promise<ManifestEntry | null> => stageOne(deps, secret, i, dir, requestSecrets)),
  )
  const entries = staged.filter((e): e is ManifestEntry => e !== null)
  if (entries.length === 0) {
    await rm(dir, { recursive: true, force: true })
    return
  }
  const manifest = entries.map((e): string => e.line).join('\n')
  await writeFile(join(dir, 'manifest'), manifest)
}
```

Update `stageOne`'s signature to `(deps, secret, index, dir, requestSecrets)` and return type to `Promise<ManifestEntry | null>`; the existing hostPath/keychain/env branches return their `ManifestEntry` unchanged.

- [ ] **Step 6: Update the claude preset** (`src/runtime/geofront/provisioning/presets.ts`)

```ts
function claudePreset(): AgentPreset {
  return {
    install: ['RUN npm install -g @zed-industries/claude-code-acp'],
    defaultEntrypoint: ['claude-code-acp'],
    secretTargets: [
      { request: 'ANTHROPIC_API_KEY', targetEnv: 'ANTHROPIC_API_KEY', required: true },
      { request: 'ANTHROPIC_BASE_URL', targetEnv: 'ANTHROPIC_BASE_URL', required: false },
    ],
    defaultEgress: ['api.anthropic.com'],
  }
}
```

In `getPreset`, call `claudePreset()` (no platform arg). If `platform` is now unused by every preset, rename the `getPreset` parameter to `_platform` to satisfy lint.

- [ ] **Step 7: Run to verify they pass**

Run: `bun test tests/runtime/geofront/provisioning/`
Expected: PASS (the dockerfile/plan/build-context tests still pass; the `magi-init` env path already handles `env` manifest lines).

- [ ] **Step 8: Commit**

```bash
git add src/project/config.ts src/runtime/geofront/provisioning/secret-stager.ts \
  src/runtime/geofront/provisioning/presets.ts tests/runtime/geofront/provisioning/
git commit -m "feat(provisioning): request-sourced agent secret; throw on missing required; claude preset"
```

---

## Task B2: Thread `secrets` through the runtime + managers

**Files:**

- Modify: `src/runtime/runtime.ts` (`AgentRuntime.provision`)
- Modify: `src/runtime/geofront/geofront-runtime.ts` (`provision`)
- Modify: `src/runtime/stub/stub-runtime.ts` (`provision`)
- Modify: `src/session/state.ts` (`StartSessionInput`)
- Modify: `src/session/manager.ts` (`runLifecycle` provision call)
- Modify: `src/review/manager.ts` (`StartReviewInput`, `runReview` provision call)
- Test: `tests/session/manager.test.ts`, `tests/review/manager.test.ts`

- [ ] **Step 1: Add a failing manager test asserting secrets reach `provision`** (use a fake runtime capturing the provision args)

```ts
// add to tests/session/manager.test.ts
test('startSession forwards secrets to runtime.provision', async () => {
  const seen: Array<Record<string, string>> = []
  const runtime = makeFakeRuntime({ onProvision: (_w, _p, secrets) => seen.push(secrets) })
  const manager = makeManager({ runtime }) // existing helpers in this suite
  manager.startSession({
    project: 'demo',
    agent: 'claude-code-acp',
    contextId: 'c1',
    prompt: 'hi',
    secrets: { ANTHROPIC_API_KEY: 'sk-1' },
  })
  await waitForIdle() // existing helper that awaits the async lifecycle
  expect(seen[0]).toEqual({ ANTHROPIC_API_KEY: 'sk-1' })
})
```

> Match the suite's existing fake-runtime and lifecycle-await helpers. If `makeFakeRuntime` doesn't take an `onProvision` hook, extend the fake to record `provision` args.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/session/manager.test.ts`
Expected: FAIL — `provision` receives only 2 args / `secrets` not on `StartSessionInput`.

- [ ] **Step 3: Update the `AgentRuntime` interface** (`src/runtime/runtime.ts`)

```ts
export interface AgentRuntime extends AgentLauncher {
  readonly name: string
  provision(worktreePath: string, project: ProjectConfig, secrets: Record<string, string>): Promise<void>
}
```

- [ ] **Step 4: Update `GeofrontRuntime.provision`** (`src/runtime/geofront/geofront-runtime.ts`)

Add the `secrets` param and pass it to `stageSecrets`; the registry (no-provisioning) branch ignores it:

```ts
  async provision(worktreePath: string, project: ProjectConfig, secrets: Record<string, string>): Promise<void> {
    const provisioning = project.provisioning
    if (provisioning === undefined) {
      await writeFile(join(worktreePath, 'geofront.toml'), renderGeofrontToml(project), 'utf8')
      return
    }
    const plan = resolvePlan(provisioning, project, process.platform)
    try {
      await writeBuildContext(worktreePath, plan)
      await stageSecrets(defaultSecretStagerDeps(), plan, worktreePath, secrets)
      try {
        await excludeFromGit(worktreePath, ['.magi-build/', '.magi-private/'])
      } catch {
        // best-effort
      }
      await writeFile(join(worktreePath, 'geofront.toml'), renderGeofrontToml(project, plan), 'utf8')
    } catch (error: unknown) {
      await cleanupProvisioningArtifacts(worktreePath)
      throw error
    }
  }
```

- [ ] **Step 5: Update `StubRuntime.provision`** (`src/runtime/stub/stub-runtime.ts`)

Add the third parameter (ignored). If lint flags it unused, name it `_secrets`:

```ts
  provision(_worktreePath: string, _project: ProjectConfig, _secrets: Record<string, string>): Promise<void> {
    return Promise.resolve()
  }
```

- [ ] **Step 6: Add `secrets` to `StartSessionInput`** (`src/session/state.ts`)

```ts
export interface StartSessionInput {
  project: string
  agent: string
  contextId: string
  prompt: string
  secrets?: Record<string, string>
}
```

- [ ] **Step 7: Pass `secrets` in `runLifecycle`** (`src/session/manager.ts`, the `provision` call)

```ts
await this.runtime.provision(prepared.worktreePath, project, input.secrets ?? {})
```

- [ ] **Step 8: Update review manager** (`src/review/manager.ts`)

Add `secrets` to `StartReviewInput`:

```ts
export interface StartReviewInput {
  project: string
  prNumber: number
  contextId: string
  secrets?: Record<string, string>
}
```

Thread it into `runReview` (carry `input` into `runReview` if it isn't already) and pass to provision:

```ts
await this.runtime.provision(prepared.worktreePath, project, input.secrets ?? {})
```

- [ ] **Step 9: Run to verify it passes**

Run: `bun test tests/session/manager.test.ts tests/review/manager.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/runtime/runtime.ts src/runtime/geofront/geofront-runtime.ts src/runtime/stub/stub-runtime.ts \
  src/session/state.ts src/session/manager.ts src/review/manager.ts tests/session/ tests/review/
git commit -m "feat(runtime): thread per-session secrets into provision (no host fallback)"
```

---

## Task B3: Accept `secrets` in the HTTP layer

**Files:**

- Modify: `src/server/router.ts` (`handleStart`, `handleReview`, add `asStringRecord`)
- Test: `tests/server/router.test.ts`

- [ ] **Step 1: Add a failing router test**

```ts
// add to tests/server/router.test.ts
test('POST /sessions forwards secrets and never persists them', async () => {
  const captured: Array<Record<string, string> | undefined> = []
  const deps = makeDeps({
    manager: {
      startSession: (i) => {
        captured.push(i.secrets)
        return { id: 's1', status: 'queued' }
      },
    },
  })
  const res = await createFetchHandler(deps)(
    authedRequest('POST', '/sessions', {
      project: 'demo',
      agent: 'a',
      contextId: 'c',
      prompt: 'p',
      secrets: { ANTHROPIC_API_KEY: 'sk-1' },
    }),
  )
  expect(res.status).toBe(202)
  expect(captured[0]).toEqual({ ANTHROPIC_API_KEY: 'sk-1' })
})

test('POST /sessions without secrets still works', async () => {
  const deps = makeDeps()
  const res = await createFetchHandler(deps)(
    authedRequest('POST', '/sessions', { project: 'demo', agent: 'a', contextId: 'c', prompt: 'p' }),
  )
  expect(res.status).toBe(202)
})
```

> Use the suite's existing request/deps helpers (`makeDeps`, `authedRequest`); match their current names.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/server/router.test.ts`
Expected: FAIL — `secrets` not forwarded.

- [ ] **Step 3: Implement the parsing** (`src/server/router.ts`)

Add a helper near `asString`:

```ts
function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}
```

Update `handleStart` to forward secrets:

```ts
const session = deps.manager.startSession({
  project,
  agent,
  contextId,
  prompt,
  secrets: asStringRecord(body['secrets']),
})
```

Update `handleReview` to forward secrets:

```ts
const session = deps.reviews.startReview({ project, prNumber, contextId, secrets: asStringRecord(body['secrets']) })
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/server/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Full magi suite + lint**

Run: `bun run test && bun run lint && bun run typecheck`
Expected: all green. (Secrets are not added to `CreateSessionInput`/the SQL INSERT, so they are never persisted; confirm no log line prints the `secrets` map.)

- [ ] **Step 6: Commit**

```bash
git add src/server/router.ts tests/server/router.test.ts
git commit -m "feat(server): accept per-session secrets on /sessions and /reviews"
```

---

## Final verification (both repos)

- [ ] **papai:** `bun build:client && bun run test && bun test:client && bun check:full` — all green.
- [ ] **magi:** `bun run check:full` — all green.
- [ ] **Manual smoke (optional, needs a live magi+geofront):** in a DM, set an Anthropic key in settings → Coding sessions; start a session; confirm the sandbox authenticates with the user's key and that no `ANTHROPIC_API_KEY` is set on the magi host. Clear the key; confirm `start_session` refuses with the `not_configured` message.

---

## Spec-coverage self-check

| Spec item                                                       | Task                |
| --------------------------------------------------------------- | ------------------- |
| Generalized vault, no `enabled`                                 | A1                  |
| Crypto reuse (`secret-payload-crypto`)                          | A1                  |
| `codingSecrets` capability + `coding.secrets` perm              | A2                  |
| Config-context scope (`getConfigContextIdFromStorageContextId`) | A2                  |
| papai-owned `anthropic → ANTHROPIC_API_KEY` mapping             | A2                  |
| User route, scope auth, CSRF, masked GET                        | A3                  |
| Client fetchers + schema                                        | A4                  |
| Settings section (no toggle) + wiring                           | A5                  |
| acp pre-flight refusal + inject (start + review)                | A6                  |
| Request `SecretSource`, throw-on-missing                        | B1                  |
| claude preset request-sourced (no host creds)                   | B1                  |
| `secrets` threaded to `provision`, not persisted                | B2, B3              |
| `/sessions` + `/reviews` accept `secrets`                       | B3                  |
| Redaction (no secret in store/logs)                             | B2 final, B3 Step 5 |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-25-phase-1-agent-credential-vault.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration (REQUIRED SUB-SKILL: superpowers:subagent-driven-development).

**2. Inline Execution** — execute tasks in this session with checkpoints (REQUIRED SUB-SKILL: superpowers:executing-plans).

Suggested order: A1 → A2 → A3 → A4 → A5 → A6, then B1 → B2 → B3. papai Part A is independently testable before magi Part B lands; the end-to-end smoke needs both.

**Which approach?**
