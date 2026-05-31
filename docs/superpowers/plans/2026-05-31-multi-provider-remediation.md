<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified multi-provider review findings — restore the dead onboarding guard, make migrations and instance reads resilient to one undecryptable row, finish the descriptor-driven config-key migration, and clear dead code / leaked abstractions / stale docs.

**Architecture:** Four independently-mergeable tracks ordered by risk: (1) release blockers, (2) stale-key root-cause completion, (3) instance resilience & lifecycle, (4) abstractions/dead-code/docs. The unifying fixes are _descriptor-driven config keys_ (no hardcoded provider key literals) and _isolate + preserve_ for undecryptable rows (never crash, never tear down a running instance).

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Drizzle + `bun:sqlite`, Vercel AI SDK, `bun:test`. TDD per finding (Red → Green → Commit). Run targeted tests with `bun test <path>`.

**Source spec:** `docs/superpowers/specs/2026-05-31-multi-provider-remediation-design.md`

---

## Conventions for every task

- All new files start with the BUSL license header (HTML-comment form for `.md`, `//` form for `.ts`). The pre-commit hook blocks commits without it.
- Never add `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-nocheck` — hook policy blocks them.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- After each task: `bun typecheck` and the targeted test must pass before committing.
- Commit messages use Conventional Commits (`fix:`, `refactor:`, `docs:`, `test:`).

---

# Track 1 — Release blockers (HIGH)

## Task 1.1: Descriptor-driven required-config helper (#1, part A)

Add a helper that returns the required provider/plugin context config storage keys for a context, derived from the live descriptor — no hardcoded key literals.

**Files:**

- Modify: `src/config-keys.ts` (add exported function after `getConfigKeysForContext`, line ~106)
- Test: `tests/config-keys.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/config-keys.test.ts`:

```typescript
import { getRequiredProviderConfigKeysForContext } from '../src/config-keys.js'

describe('getRequiredProviderConfigKeysForContext', () => {
  test('returns the namespaced required provider context keys, excluding preferences and workspace', () => {
    // Arrange: a context assigned to an active Kaneo task instance with the
    // kaneo plugin active. (Reuse the harness this suite already uses to make
    // getConfigFieldsForContext return provider-context fields — see existing
    // getConfigKeysForContext tests in this file for the exact setup helpers.)
    const contextId = setupKaneoAssignedContext() // existing local helper pattern

    // Act
    const keys = getRequiredProviderConfigKeysForContext(contextId)

    // Assert: only the required, non-preference provider key(s); the
    // auto-provisioned workspaceId is excluded by getConfigFieldsForContext.
    expect(keys).toContain('plugin:task-provider-kaneo:provider:credential')
    expect(keys).not.toContain('timezone')
    expect(keys).not.toContain('plugin:task-provider-kaneo:provider:workspaceId')
  })

  test('returns no provider keys when the context has no active task assignment', () => {
    const keys = getRequiredProviderConfigKeysForContext('unassigned-context')
    expect(keys.filter((k) => k.startsWith('plugin:'))).toHaveLength(0)
  })
})
```

> If `tests/config-keys.test.ts` has no existing Kaneo-assigned-context helper, mirror the arrange block already used by the `getConfigFieldsForContext` / `getConfigKeysForContext` describe blocks in the same file (they register the plugin descriptor and call `setContextSettings`). Do not invent a new mocking style.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config-keys.test.ts`
Expected: FAIL with `getRequiredProviderConfigKeysForContext is not a function` (or import error).

- [ ] **Step 3: Implement the helper**

In `src/config-keys.ts`, add after `getConfigKeysForContext` (line ~106):

```typescript
export function getRequiredProviderConfigKeysForContext(contextId: string): string[] {
  return getConfigFieldsForContext(contextId)
    .filter((field) => field.required && field.kind !== 'preference')
    .map((field) => field.storageKey)
}
```

(`getConfigFieldsForContext` already drops the auto-provisioned Kaneo workspace key and only includes provider/plugin-context fields from the active descriptor, so this returns exactly the required, user-supplied provider keys.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/config-keys.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config-keys.ts tests/config-keys.test.ts
git commit -m "feat(config-keys): add descriptor-driven required provider key resolver"
```

---

## Task 1.2: Rewire the onboarding guard onto the descriptor helper (#1, part B)

Replace the dead literal filter in `checkRequiredProviderConfig` so unconfigured users are once again prompted to `/setup`.

**Files:**

- Modify: `src/llm-orchestrator-config.ts:17-28`
- Test: `tests/llm-orchestrator-config.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/llm-orchestrator-config.test.ts`:

```typescript
import { checkRequiredProviderConfig } from '../src/llm-orchestrator-config.js'

describe('checkRequiredProviderConfig (descriptor-driven)', () => {
  test('reports the namespaced credential key as missing when unconfigured', () => {
    const contextId = setupKaneoAssignedContextWithoutCredential() // arrange per existing suite helpers
    const missing = checkRequiredProviderConfig(contextId)
    expect(missing).toContain('plugin:task-provider-kaneo:provider:credential')
  })

  test('reports nothing missing once the credential is set', () => {
    const contextId = setupKaneoAssignedContextWithoutCredential()
    setConfigValue(contextId, 'plugin:task-provider-kaneo:provider:credential', 'secret-key')
    setConfigValue(contextId, 'plugin:task-provider-kaneo:provider:workspaceId', 'ws-1')
    expect(checkRequiredProviderConfig(contextId)).toEqual([])
  })
})
```

> Use the same arrange helpers/import style the existing `checkRequiredProviderConfig` tests in this file already use; `setConfigValue` comes from `../src/config.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator-config.test.ts`
Expected: FAIL — the first test currently gets `[]` because the literal filter matches nothing.

- [ ] **Step 3: Implement the rewrite**

In `src/llm-orchestrator-config.ts`, replace lines 17-28. Change the imports at the top:

```typescript
import { getCachedConfig } from './cache.js'
import { getRequiredProviderConfigKeysForContext } from './config-keys.js'
import { getConfig, getConfigValue } from './config.js'
import { getSystemConfig } from './system-config.js'
```

Replace `readConfig` and `checkRequiredProviderConfig` with:

```typescript
const readConfig = (contextId: string, key: 'timezone'): string | null => {
  const value = getConfig(contextId, key)
  if (value !== null) return value
  return getCachedConfig(contextId, key)
}

export const checkRequiredProviderConfig = (contextId: string): string[] => {
  const requiredKeys = getRequiredProviderConfigKeysForContext(contextId)
  return requiredKeys.filter((key) => getConfigValue(contextId, key) === null)
}
```

(`getConfigValue` reads namespaced plugin keys through the cache and is the same accessor the resolver uses. `readConfig` is now only used by `resolveTimezone`, so its key type narrows to `'timezone'`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/llm-orchestrator-config.test.ts`
Expected: PASS

- [ ] **Step 5: Verify no other caller relied on the old `readConfig` signature**

Run: `bun typecheck`
Expected: PASS. (`readConfig` was module-private; `resolveTimezone` already passes `'timezone'`.)

- [ ] **Step 6: Commit**

```bash
git add src/llm-orchestrator-config.ts tests/llm-orchestrator-config.test.ts
git commit -m "fix(orchestrator): restore required-config guard via descriptor keys"
```

---

## Task 1.3: Migration 045 — per-row decrypt isolation (#2)

Stop one undecryptable row from aborting `initDb()`.

**Files:**

- Modify: `src/db/migrations/045_provider_base_url.ts:21-29`
- Create: `tests/db/migrations/045_provider_base_url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/migrations/045_provider_base_url.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration045ProviderBaseUrl } from '../../../src/db/migrations/045_provider_base_url.js'
import { decryptInstanceConfig, encryptInstanceConfig } from '../../../src/instances/encryption.js'

describe('migration045ProviderBaseUrl', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    for (const table of ['platform_instances', 'task_instances']) {
      db.run(
        `CREATE TABLE ${table} (id TEXT PRIMARY KEY, type TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT '')`,
      )
    }
  })

  afterEach(() => {
    db.close()
  })

  test('backfills readable rows and skips an undecryptable row without throwing', () => {
    const good = encryptInstanceConfig({ url: 'https://kaneo.example' })
    db.run(`INSERT INTO platform_instances (id, type, config) VALUES ('good', 'telegram', ?)`, [good])
    db.run(`INSERT INTO platform_instances (id, type, config) VALUES ('bad', 'telegram', 'not-an-encrypted-blob')`)

    expect(() => migration045ProviderBaseUrl.up(db)).not.toThrow()

    const goodRow = db.query<{ config: string }, []>(`SELECT config FROM platform_instances WHERE id='good'`).get()
    expect(decryptInstanceConfig(goodRow!.config)['baseUrl']).toBe('https://kaneo.example')

    const badRow = db.query<{ config: string }, []>(`SELECT config FROM platform_instances WHERE id='bad'`).get()
    expect(badRow!.config).toBe('not-an-encrypted-blob') // left untouched
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/db/migrations/045_provider_base_url.test.ts`
Expected: FAIL — `migration045ProviderBaseUrl.up(db)` throws on the `'bad'` row.

- [ ] **Step 3: Implement per-row isolation**

In `src/db/migrations/045_provider_base_url.ts`, replace `backfillBaseUrl` (lines 21-29) with:

```typescript
const backfillRow = (db: Database, table: 'platform_instances' | 'task_instances', row: InstanceConfigRow): void => {
  try {
    const config = decryptInstanceConfig(row.config)
    const nextConfig = withBaseUrlBackfill(config)
    if (nextConfig === config) return
    db.query(`UPDATE ${table} SET config = ? WHERE id = ?`).run(encryptInstanceConfig(nextConfig), row.id)
  } catch (error) {
    log.warn(
      { table, id: row.id, error: error instanceof Error ? error.message : String(error) },
      'migration 045: skipping undecryptable instance row',
    )
  }
}

const backfillBaseUrl = (db: Database, table: 'platform_instances' | 'task_instances'): void => {
  const rows = db.query<InstanceConfigRow, []>(`SELECT id, config FROM ${table}`).all()
  rows.forEach((row) => backfillRow(db, table, row))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/db/migrations/045_provider_base_url.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/045_provider_base_url.ts tests/db/migrations/045_provider_base_url.test.ts
git commit -m "fix(migration): isolate undecryptable rows in 045 baseUrl backfill"
```

---

# Track 2 — Stale-key cluster (descriptor-driven completion)

## Task 2.1: Descriptor-driven sensitivity (#3)

Replace the hardcoded `SENSITIVE_KEYS` literal set with sensitivity derived from active provider descriptors.

**Files:**

- Modify: `src/config-keys.ts` (export a sensitivity predicate; reuse `storageKeyForProviderField` + `listTaskProviderTypes`)
- Modify: `src/config.ts:14,49-51,111-116`
- Test: `tests/config.test.ts`, `tests/config-keys.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/config-keys.test.ts`:

```typescript
import { isSensitiveProviderStorageKey } from '../src/config-keys.js'

describe('isSensitiveProviderStorageKey', () => {
  test('true for the namespaced Kaneo credential key', () => {
    setupKaneoAssignedContext() // ensures the kaneo descriptor is registered/active
    expect(isSensitiveProviderStorageKey('plugin:task-provider-kaneo:provider:credential')).toBe(true)
  })
  test('false for a non-sensitive provider field and for unknown keys', () => {
    setupKaneoAssignedContext()
    expect(isSensitiveProviderStorageKey('plugin:task-provider-kaneo:provider:workspaceId')).toBe(false)
    expect(isSensitiveProviderStorageKey('timezone')).toBe(false)
  })
})
```

Add to `tests/config.test.ts`:

```typescript
test('maskValue masks the namespaced credential key', () => {
  setupKaneoActiveDescriptor() // per existing suite helpers
  expect(maskValue('plugin:task-provider-kaneo:provider:credential', 'abcd1234')).toBe('****1234')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/config-keys.test.ts tests/config.test.ts`
Expected: FAIL — `isSensitiveProviderStorageKey` undefined; `maskValue` returns the raw value for the namespaced key.

- [ ] **Step 3: Implement the predicate in `config-keys.ts`**

Add `listTaskProviderTypes` to the existing `providers/registry.js` import, then add:

```typescript
export function isSensitiveProviderStorageKey(key: string): boolean {
  return listTaskProviderTypes().some((descriptor) =>
    [...descriptor.contextConfigSchema, ...descriptor.instanceConfigSchema].some(
      (field) => storageKeyForProviderField(descriptor, field) === key && field.sensitive,
    ),
  )
}
```

- [ ] **Step 4: Rewire `config.ts`**

In `src/config.ts`: remove the `SENSITIVE_KEYS` constant (line 14), import the predicate, and update `isSensitiveKey` + `maskValue`:

```typescript
import { getConfigKeysForContext, isSensitiveProviderStorageKey } from './config-keys.js'
```

```typescript
export function isSensitiveKey(key: string): boolean {
  return isSensitiveProviderStorageKey(key)
}
```

```typescript
export function maskValue(key: string, value: string): string {
  if (isSensitiveProviderStorageKey(key)) {
    return maskSensitiveValue(value)
  }
  return value
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/config-keys.test.ts tests/config.test.ts && bun typecheck`
Expected: PASS. (`maskSensitiveValue` and `isSensitiveKey` keep the same signatures; wizard masking already prefers `field.sensitive` and is unaffected.)

- [ ] **Step 6: Commit**

```bash
git add src/config-keys.ts src/config.ts tests/config-keys.test.ts tests/config.test.ts
git commit -m "refactor(config): derive sensitivity from provider descriptors"
```

---

## Task 2.2: Drive wizard prompts/validation/labels off descriptor metadata (#4)

Remove the dead `kaneo_apikey`/`youtrack_token` literal branches in the wizard.

**Files:**

- Modify: `src/wizard/steps.ts:21-35,57,81-100`
- Test: `tests/wizard/steps.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/wizard/steps.test.ts`:

```typescript
test('provider step prompt and label come from descriptor field metadata', () => {
  const steps = getWizardSteps('kaneo')
  const credentialStep = steps.find((s) => s.key === 'plugin:task-provider-kaneo:provider:credential')
  expect(credentialStep).toBeDefined()
  expect(credentialStep!.prompt).toContain('Kaneo API Key') // field.label, not a hardcoded literal
})

test('empty required provider value is rejected with a label-based message', async () => {
  const steps = getWizardSteps('kaneo')
  const credentialStep = steps.find((s) => s.key === 'plugin:task-provider-kaneo:provider:credential')!
  expect(await credentialStep.validate('')).toBe('Kaneo API Key cannot be empty')
})
```

> Mirror the existing `getWizardSteps('kaneo')` arrange used elsewhere in this suite (it registers the kaneo descriptor).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/wizard/steps.test.ts`
Expected: FAIL — prompt currently falls through to a generic string and the validation message text differs.

- [ ] **Step 3: Implement**

In `src/wizard/steps.ts`:

Trim `BUILTIN_PROMPTS` to timezone only (lines 21-26):

```typescript
const BUILTIN_PROMPTS: Record<string, string> = {
  timezone:
    '🌍 Enter your timezone (e.g., America/New_York, UTC, UTC+5). UTC offsets are accepted and saved as a standard timezone:',
}
```

Delete `displayLabelForKey` (lines 32-35). In `providerFields` (line 57), use the descriptor label directly:

```typescript
        label: field.label,
```

Replace `validateField` and delete the now-unused `validateApiKey`/`validateToken` (lines 81-100):

```typescript
function validateTimezone(value: string): string | null {
  return normalizeTimezone(value.trim()) === null
    ? 'Invalid timezone. Enter a valid IANA timezone like America/New_York or UTC. UTC offsets like UTC+5 are also accepted and will be saved as a standard timezone.'
    : null
}

function validateField(field: ConfigField, value: string): string | null {
  if (field.storageKey === 'timezone') return validateTimezone(value)
  return field.required && value.trim().length === 0 ? `${field.label} cannot be empty` : null
}
```

- [ ] **Step 4: Run tests + knip (unused-export check)**

Run: `bun test tests/wizard/steps.test.ts && bun typecheck && bun knip`
Expected: PASS — `validateApiKey`/`validateToken` are deleted so knip stays clean.

- [ ] **Step 5: Commit**

```bash
git add src/wizard/steps.ts tests/wizard/steps.test.ts
git commit -m "refactor(wizard): drive prompts and validation from descriptor metadata"
```

---

## Task 2.3: Remove the dead label literal in `config-keys.ts` (#5)

**Files:**

- Modify: `src/config-keys.ts:47-50,90`
- Test: `tests/config-keys.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/config-keys.test.ts`:

```typescript
test('provider context field label comes from the descriptor, not a hardcoded map', () => {
  setupYouTrackAssignedContext() // active youtrack descriptor, token field label "YouTrack Permanent Token"
  const fields = getConfigFieldsForContext('youtrack-context')
  const tokenField = fields.find((f) => f.storageKey === 'plugin:task-provider-youtrack:provider:token')
  expect(tokenField?.label).toBe('YouTrack Permanent Token')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config-keys.test.ts`
Expected: FAIL — `labelForStorageKey` forces `'YouTrack Token'` only for the (now-dead) flat key, so the label is currently the descriptor fallback already; if the assertion matches by accident, change the expected to confirm it is `field.label` after the edit. (The real goal: delete the dead branch.)

- [ ] **Step 3: Implement**

In `src/config-keys.ts`, delete `labelForStorageKey` (lines 47-50) and change line 90 from:

```typescript
        label: labelForStorageKey(storageKeyForProviderField(descriptor, field), field.label),
```

to:

```typescript
        label: field.label,
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/config-keys.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config-keys.ts tests/config-keys.test.ts
git commit -m "refactor(config-keys): use descriptor label, drop dead youtrack_token branch"
```

---

## Task 2.4: Stop enumerating provider literals as canonical config keys (#6)

**Files:**

- Modify: `src/types/config.ts:10-48`
- Test: `tests/types/config.test.ts`
- Discovery: repo-wide grep for fallout

- [ ] **Step 1: Discover all consumers before editing**

Run:

```bash
grep -rn "TaskProviderConfigKey\|KANEO_WORKSPACE_CONFIG_KEY\|'kaneo_apikey'\|'youtrack_token'\|'kaneo_workspace_id'" src tests plugins
```

Record every hit. Any production code that still _reads/writes_ the flat keys through `setConfig`/`getConfig` (the `ConfigKey`-typed accessors) must move to `setConfigValue`/`getConfigValue` (dynamic) or be confirmed dead. Migration `048`/test fixtures that reference the flat string literals are fine (they operate on historical data) — leave those.

- [ ] **Step 2: Write the failing test**

Update `tests/types/config.test.ts`:

```typescript
test('ALL_CONFIG_KEYS contains only static (non-provider) keys', () => {
  expect(ALL_CONFIG_KEYS).toEqual(['timezone', 'mcp_endpoints'])
})

test('isConfigKey rejects the legacy flat provider keys', () => {
  expect(isConfigKey('kaneo_apikey')).toBe(false)
  expect(isConfigKey('youtrack_token')).toBe(false)
})

test('isAllowedDynamicConfigKey still accepts namespaced provider keys', () => {
  expect(isAllowedDynamicConfigKey('plugin:task-provider-kaneo:provider:credential')).toBe(true)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/types/config.test.ts`
Expected: FAIL — `ALL_CONFIG_KEYS` still includes the three flat keys.

- [ ] **Step 4: Implement**

In `src/types/config.ts`, replace lines 10-48:

```typescript
// Plugin-namespaced config keys for the task-provider-kaneo plugin.
// These are plain string constants (not ConfigKey union members) used after
// migration 048 renames the flat keys in user_config.
export const KANEO_PLUGIN_CREDENTIAL_KEY = 'plugin:task-provider-kaneo:provider:credential'
export const KANEO_PLUGIN_WORKSPACE_KEY = 'plugin:task-provider-kaneo:provider:workspaceId'

// User preference config keys (always available)
export type PreferenceConfigKey = 'timezone'

// MCP endpoint config keys
export type McpConfigKey = 'mcp_endpoints'

// All per-user *static* config keys. Provider credential keys are
// descriptor-derived plugin-namespaced strings (see KANEO_PLUGIN_* above) and
// are NOT members of this union. LLM credentials live in `system_config`.
export type ConfigKey = PreferenceConfigKey | McpConfigKey

export type ConfigField = {
  readonly key: string
  readonly storageKey: string
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
  readonly kind: 'preference' | 'provider-context' | 'plugin-context'
}

export const ALL_CONFIG_KEYS: readonly ConfigKey[] = ['timezone', 'mcp_endpoints']
```

Then fix every fallout site found in Step 1. Expected sites and their fixes:

- `src/config-keys.ts:12` imports `KANEO_PLUGIN_WORKSPACE_KEY` — unchanged (still exported).
- Any remaining `TaskProviderConfigKey` / `KANEO_WORKSPACE_CONFIG_KEY` import: replace usages or remove the import. If a consumer genuinely needs the legacy workspace string, inline the literal `'kaneo_workspace_id'` at that historical site with a comment, rather than re-exporting it as canonical.

- [ ] **Step 5: Run the full impacted suites + typecheck**

Run: `bun test tests/types/config.test.ts tests/config.test.ts tests/config-keys.test.ts && bun typecheck`
Expected: PASS. If `bun typecheck` surfaces a consumer not caught in Step 1, fix it the same way (move to dynamic accessor or inline historical literal), then re-run.

- [ ] **Step 6: Commit**

```bash
git add src/types/config.ts src/config-keys.ts tests/types/config.test.ts
# plus any fallout files touched
git commit -m "refactor(types): drop legacy provider keys from canonical ConfigKey union"
```

---

# Track 3 — Instance resilience & lifecycle (isolate + preserve)

## Task 3.1: Switch the three list callsites to the safe decode variants (#12)

**Files:**

- Modify: `src/debug/admin-system.ts:6-7,25-38`
- Modify: `src/setup/task-instance-selection.ts:7,30`
- Modify: `src/plugins/task-provider-lifecycle.ts:6,22-27`
- Test: `tests/debug/admin-system.test.ts`, `tests/setup/task-instance-selection.test.ts`

- [ ] **Step 1: Write the failing test (admin-system)**

Add to `tests/debug/admin-system.test.ts` a case where one task row is undecryptable and assert `handleAdminSystem()` still returns 200 with the readable providers. Use the suite's existing DB/mocking setup; insert one good active task instance and one row whose decrypt throws, then:

```typescript
test('handleAdminSystem degrades gracefully when a row is undecryptable', async () => {
  seedOneGoodKaneoTaskInstanceAndOneUndecryptableRow() // per existing suite helpers
  const res = handleAdminSystem()
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.taskProvider).toBe('kaneo')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/admin-system.test.ts`
Expected: FAIL — `listTaskInstances()` throws on the undecryptable row.

- [ ] **Step 3: Implement (admin-system)**

In `src/debug/admin-system.ts`:

```typescript
import { listActivePlatformInstancesSafe } from '../instances/platform-store.js'
import { listTaskInstancesSafe } from '../instances/task-store.js'
```

```typescript
const safeChatProvider = (): AdminChatProvider =>
  singleKnownProvider(listActivePlatformInstancesSafe().instances.map((instance) => instance.type))

const safeTaskProvider = (): AdminTaskProvider => {
  const activeTypes = listTaskInstancesSafe()
    .instances.filter((instance) => instance.status === 'active')
    .map((instance) => instance.type)
  if (!activeTypes.every((type) => isTaskProvider(type))) return 'unknown'
  return singleKnownProvider(activeTypes)
}
```

- [ ] **Step 4: Implement (task-instance-selection)**

In `src/setup/task-instance-selection.ts`:

```typescript
import { listTaskInstancesSafe } from '../instances/task-store.js'
```

```typescript
const activeTaskInstances = (): TaskInstance[] =>
  listTaskInstancesSafe().instances.filter((instance) => instance.status === 'active')
```

- [ ] **Step 5: Implement (task-provider-lifecycle defaultDeps)**

In `src/plugins/task-provider-lifecycle.ts`:

```typescript
import { listTaskInstances, listTaskInstancesSafe, updateTaskInstance } from '../instances/task-store.js'
```

```typescript
const defaultDeps: DeactivateContributedTaskProviderTypesDeps = {
  listTypesForPlugin: listContributedTaskProviderTypesForPlugin,
  unregisterTypesForPlugin: unregisterContributedTaskProviderType,
  listTaskInstances: () => listTaskInstancesSafe().instances,
  updateTaskInstance,
}
```

(Keep the `listTaskInstances` import only if still referenced by the `typeof` in the deps type; the type uses `typeof listTaskInstances`, so the import must remain.)

- [ ] **Step 6: Run impacted tests + typecheck + knip**

Run: `bun test tests/debug/admin-system.test.ts tests/setup/task-instance-selection.test.ts && bun typecheck && bun knip`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/debug/admin-system.ts src/setup/task-instance-selection.ts src/plugins/task-provider-lifecycle.ts tests/debug/admin-system.test.ts tests/setup/task-instance-selection.test.ts
git commit -m "fix(instances): use safe decode on admin/setup/lifecycle list paths"
```

---

## Task 3.2: `/apply` must never tear down a running instance on an unreadable row (#7)

**Files:**

- Modify: `src/debug/instance-route-support.ts:240-243`
- Test: `tests/debug/instance-route-support.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/debug/instance-route-support.test.ts`:

```typescript
test('apply leaves a running instance untouched when its DB row is unreadable', async () => {
  const stop = mock(() => Promise.resolve())
  const router = makeFakeRouterWithRunningInstance('inst-1', stop) // running/active in the router map
  const deps: InstanceApiDeps = {
    getRuntimeChatRouter: () => router,
    listPlatformInstances: () => [],
    listPlatformInstancesSafe: () => ({
      instances: [],
      failures: [{ table: 'platform_instances', id: 'inst-1', type: 'telegram', error: 'decrypt failed' }],
    }),
  }

  const res = await applyPlatformInstances(deps)
  const body = await res.json()

  expect(stop).not.toHaveBeenCalled()
  expect(body.removed).not.toContain('inst-1')
  expect(body.unreadable.map((f: { id: string }) => f.id)).toContain('inst-1')
})
```

> Reuse this suite's existing fake-router builder; if none exposes a "running instance", extend the local helper minimally to seed one active instance whose `provider.stop` is the injected mock.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/instance-route-support.test.ts`
Expected: FAIL — `inst-1` is absent from `activeIds`, lands in `runtimeIdsToRemove`, and `removeInstanceStrict` calls `stop`.

- [ ] **Step 3: Implement the preserve guard**

In `src/debug/instance-route-support.ts`, inside `reconcilePlatformInstances`, after computing `activeIds` (line ~239) and before `runtimeIdsToRemove` (line ~240):

```typescript
const unreadableIds = new Set(desiredResult.failures.map((failure) => failure.id))
const runtimeIdsToRemove = router
  .listInstances()
  .map((instance) => instance.id)
  .filter((id) => !activeIds.has(id) && !unreadableIds.has(id))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/instance-route-support.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/debug/instance-route-support.ts tests/debug/instance-route-support.test.ts
git commit -m "fix(apply): preserve running instances whose DB row is unreadable"
```

---

## Task 3.3: `removeInstanceStrict` must clear the map even when `stop()` throws (#8)

**Files:**

- Modify: `src/chat/router.ts:90-96`
- Test: `tests/chat/router.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/chat/router.test.ts`:

```typescript
test('removeInstanceStrict deletes the instance even when provider.stop throws', async () => {
  const router = new ChatRouter(makeFactoryWhoseStopRejects()) // provider.stop -> Promise.reject(new Error('boom'))
  router.addInstance('inst-1', 'telegram', { token: 't' })

  await expect(router.removeInstanceStrict('inst-1')).rejects.toThrow('boom')
  expect(router.getInstance('inst-1')).toBeNull() // removed from the map despite the throw
})
```

> Build `makeFactoryWhoseStopRejects` from this suite's existing fake-provider factory, overriding only `stop`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/chat/router.test.ts`
Expected: FAIL — after the throw, `getInstance('inst-1')` is still non-null.

- [ ] **Step 3: Implement try/finally**

In `src/chat/router.ts`, replace `removeInstanceStrict` (lines 90-96):

```typescript
  async removeInstanceStrict(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (instance === undefined) return
    try {
      await instance.provider.stop()
    } finally {
      instance.status = 'stopped'
      this.instances.delete(id)
    }
  }
```

The error still propagates (so `/apply` records a `failedPatch`), but the entry is gone, so a later `/apply` re-adds and retries via `startMissingInstance`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/chat/router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/router.ts tests/chat/router.test.ts
git commit -m "fix(router): always remove instance on stop failure to allow retry"
```

---

## Task 3.4: Remove the env read and dead `adminUserId` threading in the Discord adapter (#10)

**Files:**

- Modify: `src/chat/discord/index.ts:138-157,182-194,243-244` (remove env read + `adminUserId` params)
- Modify: `src/chat/discord/map-message.ts:32-37` (drop `_adminUserId` param)
- Modify: `src/chat/discord/button-dispatch.ts:21-30,46-55,166-168` (drop `_adminUserId` from `buildInteraction` + `RouteButtonFallbackArgs`)
- Test: `tests/chat/discord/map-message.test.ts`, `tests/chat/discord/button-dispatch.test.ts`

- [ ] **Step 1: Read the exact current bodies before editing**

Run:

```bash
sed -n '180,260p' src/chat/discord/index.ts
```

Confirm the signatures of `dispatchMessage`, `dispatchButtonInteraction`, `testDispatchMessage`, and the public button test method, and every internal call passing `adminUserId`.

- [ ] **Step 2: Write/adjust the failing tests**

In `tests/chat/discord/map-message.test.ts`, change `mapDiscordMessage(message, botId, adminUserId, platformInstanceId)` calls to the new 3-arg form `mapDiscordMessage(message, botId, platformInstanceId)`. Add/keep an assertion that `result.user.isAdmin === false` (admin is interaction-sourced, not env-sourced).

In `tests/chat/discord/button-dispatch.test.ts`, change `buildInteraction(interaction, adminUserId, platformInstanceId)` calls to `buildInteraction(interaction, platformInstanceId)`, and update any `RouteButtonFallbackArgs` tuples to drop the `_adminUserId` slot.

- [ ] **Step 3: Run tests to verify they fail (arity mismatch)**

Run: `bun test tests/chat/discord/map-message.test.ts tests/chat/discord/button-dispatch.test.ts`
Expected: FAIL to compile / wrong arity until the implementation is updated.

- [ ] **Step 4: Implement — `map-message.ts`**

Change the signature (lines 32-37):

```typescript
export function mapDiscordMessage(
  message: DiscordMessageLike,
  botId: string,
  platformInstanceId: string,
): IncomingMessage | null {
```

(`_adminUserId` was unused; nothing in the body references it.)

- [ ] **Step 5: Implement — `button-dispatch.ts`**

In `RouteButtonFallbackArgs` (lines 21-30) remove the `_adminUserId` element. In `buildInteraction` (lines 46-55) drop the `_adminUserId` param:

```typescript
export function buildInteraction(
  interaction: ButtonInteractionLike,
  platformInstanceId: string,
): {
```

In `routeButtonFallback` (line 167), update the destructure to match the shortened tuple (remove the empty `,` slot that skipped `_adminUserId`).

- [ ] **Step 6: Implement — `index.ts`**

- Delete line 139 (`const adminUserId = ...process.env['ADMIN_USER_ID']...`).
- In `start()` update the two dispatch calls to drop the `adminUserId` argument:
  - `this.dispatchMessage(rawMsg, client.user === null ? '' : client.user.id)`
  - `this.dispatchButtonInteraction(rawInteraction)`
- Update the private `dispatchMessage(message, botId)` / `dispatchButtonInteraction(interaction)` signatures and their internal calls to `mapDiscordMessage(message, botId, this.platformInstanceId)` and `buildInteraction(interaction, this.platformInstanceId)`.
- Update the test helpers `testDispatchMessage` / the public button test method to drop their `adminUserId` params, OR keep them and pass through nothing. Match whatever the tests in Step 2 now call.

- [ ] **Step 7: Run tests + typecheck across the discord adapter**

Run: `bun test tests/chat/discord/ && bun typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/chat/discord/index.ts src/chat/discord/map-message.ts src/chat/discord/button-dispatch.ts tests/chat/discord/
git commit -m "refactor(discord): remove env read and dead adminUserId threading"
```

---

## Task 3.5: Remove the dead narrowing branch in bootstrap (#11)

**Files:**

- Modify: `src/instances/bootstrap.ts:75-85,131-136`
- Test: `tests/instances/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

Confirm the existing suite already covers the partial-env and success paths; add a guard test that the success path is reached without the dead branch by asserting a fully-configured env bootstraps. Add (if not present):

```typescript
test('bootstraps when all required env vars are present (no dead narrowing branch)', () => {
  setEnv({ CHAT_PROVIDER: 'telegram', ADMIN_USER_ID: 'admin-1', TELEGRAM_BOT_TOKEN: 'tok' })
  emptyInstanceTables()
  const result = bootstrapInstancesFromEnv()
  expect(result).toEqual({ bootstrapped: true, platformInstanceId: 'telegram-default' })
})
```

- [ ] **Step 2: Run test to verify current behavior (should already pass)**

Run: `bun test tests/instances/bootstrap.test.ts`
Expected: PASS (this is a characterization test; it guards against regressions from the refactor).

- [ ] **Step 3: Implement — make `collectMissing` return narrowed values, delete the dead branch**

Change `collectMissing` to also surface the validated values so the success path needs no second null-check. Replace lines 75-85:

```typescript
type CollectMissingResult =
  | { ok: true; chatType: PlatformInstanceType; adminUserId: string }
  | { ok: false; missing: string[] }

const collectMissing = (parsed: ParsedEnv): CollectMissingResult => {
  const missing: string[] = []
  if (parsed.chatType === null) missing.push('CHAT_PROVIDER')
  if (parsed.adminUserId === undefined) missing.push('ADMIN_USER_ID')
  if (parsed.chatType !== null) {
    for (const v of CHAT_ENV_REQUIREMENTS[parsed.chatType]) {
      if (getTrimmedEnv(v) === undefined) missing.push(v)
    }
  }
  if (missing.length > 0 || parsed.chatType === null || parsed.adminUserId === undefined) {
    return { ok: false, missing }
  }
  return { ok: true, chatType: parsed.chatType, adminUserId: parsed.adminUserId }
}
```

Then replace lines 125-136 in `bootstrapInstancesFromEnv`:

```typescript
const collected = collectMissing(parsed)
if (!collected.ok) {
  log.warn({ missing: collected.missing }, 'Bootstrap aborted: partial environment')
  return { bootstrapped: false, reason: 'partial-env', missing: collected.missing }
}

const { platformInstanceId } = seedInstances(collected.chatType, collected.adminUserId)

log.info(
  { platformInstanceId, adminUserId: collected.adminUserId },
  'Bootstrapped from environment variables. DB is now the source of truth.',
)
return { bootstrapped: true, platformInstanceId }
```

The previously-dead `if (parsed.chatType === null || parsed.adminUserId === undefined)` branch is gone; narrowing now flows from `collected.ok`.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test tests/instances/bootstrap.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/instances/bootstrap.ts tests/instances/bootstrap.test.ts
git commit -m "refactor(bootstrap): remove dead narrowing branch via typed collectMissing"
```

---

## Task 3.6 (optional): Stabilize flaky `bot.test.ts` "Access revoked" hook timeouts

Only do this if the team wants it in this track. The three failures are `beforeEach/afterEach hook timed out` under full-suite load; the file passes 72/0 in isolation.

**Files:**

- Modify: `tests/bot.test.ts` (the "Access revoked during session" describe block setup/teardown)

- [ ] **Step 1: Reproduce under load**

Run: `bun run test` (full curated suite) a few times; confirm the three "Access revoked during session" hook timeouts appear intermittently.

- [ ] **Step 2: Identify the slow hook**

Inspect the `beforeEach`/`afterEach` for that describe block. Look for unbounded awaits (DB open, queue drain, real timers) that compound under parallel load.

- [ ] **Step 3: Fix the root cause, not the symptom**

Prefer reducing per-test setup cost (share an in-memory DB across the block, fake timers, or `await` the queue deterministically). Only as a last resort raise the per-hook timeout via the block's options. Document the choice in a comment.

- [ ] **Step 4: Verify**

Run: `bun run test` several times; expect 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tests/bot.test.ts
git commit -m "test(bot): stabilize access-revoked hook timeouts under load"
```

---

# Track 4 — Abstractions, dead code & docs

## Task 4.1: Rename `removeInstanceStrict` → `removeInstance` (#13)

The non-strict twin was deleted; the `Strict` qualifier is dead-naming.

**Files:**

- Modify: `src/chat/router.ts:90` (method name)
- Modify: `src/debug/instance-route-support.ts:160` (call site)
- Modify: `tests/chat/router.test.ts`, any other callers found by grep

- [ ] **Step 1: Find all callers**

Run: `grep -rn "removeInstanceStrict" src tests`

- [ ] **Step 2: Rename in `router.ts`**

Rename the method `removeInstanceStrict` to `removeInstance` (keep the Task 3.3 try/finally body).

- [ ] **Step 3: Update all callers**

Update `src/debug/instance-route-support.ts:160` (`await router.removeInstanceStrict(id)` → `await router.removeInstance(id)`) and every grep hit in tests.

- [ ] **Step 4: Verify**

Run: `bun test tests/chat/router.test.ts tests/debug/instance-route-support.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/router.ts src/debug/instance-route-support.ts tests/
git commit -m "refactor(router): rename removeInstanceStrict to removeInstance"
```

---

## Task 4.2: Remove the never-emitted `'stop'` from `ApplyFailureAction` (#14)

**Files:**

- Modify: `src/debug/instance-route-support.ts:28`
- Test: `tests/debug/instance-route-support.test.ts`

- [ ] **Step 1: Confirm `'stop'` is never emitted**

Run: `grep -n "'stop'" src/debug/instance-route-support.ts`
Expected: only the type union on line 28 (no `failedPatch(..., 'stop', ...)` / `startedPatch(..., 'stop')`).

- [ ] **Step 2: Edit the union**

Change line 28 to:

```typescript
type ApplyFailureAction = 'remove' | 'recreate' | 'start'
```

- [ ] **Step 3: Verify**

Run: `bun test tests/debug/instance-route-support.test.ts && bun typecheck`
Expected: PASS (no code constructs `'stop'`).

- [ ] **Step 4: Commit**

```bash
git add src/debug/instance-route-support.ts
git commit -m "refactor(apply): drop never-emitted 'stop' from ApplyFailureAction"
```

---

## Task 4.3: Simplify the guaranteed-null resolver branch (#18)

**Files:**

- Modify: `src/providers/resolver.ts:149-154`
- Test: `tests/providers/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/providers/resolver.test.ts`:

```typescript
test('resolve returns null (and warns) when the descriptor is unknown', async () => {
  const resolver = new TaskProviderResolver({
    getContextSettings: () => ({ contextId: 'c', taskInstanceId: 't', platformInstanceId: 'p' }),
    getTaskInstance: () => ({ id: 't', type: 'ghost', config: {}, status: 'active', createdAt: '' }),
    getTaskProviderDescriptor: () => undefined,
    getTaskProviderConfigValidator: () => undefined,
    getConfig: () => null,
    createProvider: () => {
      throw new Error('createProvider should not be called for an unknown descriptor')
    },
  })
  expect(await resolver.resolve('c')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `bun test tests/providers/resolver.test.ts`
Expected: Currently PASS-by-accident (the validator rejects), but `createProvider` must never be reached. If the current code path reaches `createValidatedProvider` it returns null before `createProvider`, so this characterizes the intended post-refactor behavior. Keep it as a regression guard.

- [ ] **Step 3: Implement the early return**

In `src/providers/resolver.ts`, replace lines 149-154 inside `resolve`:

```typescript
const descriptor = this.deps.getTaskProviderDescriptor(instance.type)
if (descriptor === undefined) {
  log.warn(
    { contextId, taskInstanceId: instance.id, taskProvider: instance.type },
    'Cannot resolve task provider: unknown provider type (plugin inactive?)',
  )
  return null
}
const config = buildConfigFromDescriptor(contextId, instance, descriptor, this.deps)
if (config === null) return null
```

This removes the unused `{ ...instance.config }` build and the round-trip through the validator for an unknown type.

- [ ] **Step 4: Verify**

Run: `bun test tests/providers/resolver.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/resolver.ts tests/providers/resolver.test.ts
git commit -m "refactor(resolver): early-return null on unknown provider descriptor"
```

---

## Task 4.4: Correct the misleading validator comments (#17)

Comment-only; no behavior change. Both validators do run only instance-scoped checks, but at resolver time `validateEffectiveTaskProviderConfigResult` passes the merged config (including context fields) — the comments must not claim those fields are categorically unavailable.

**Files:**

- Modify: `plugins/task-provider-kaneo/validate-config.ts:6-10`
- Modify: `plugins/task-provider-youtrack/validate-config.ts:6-7`

- [ ] **Step 1: Edit the Kaneo comment**

Replace lines 6-10 with:

```typescript
// NOTE: this validator only inspects instance-scoped fields (baseUrl/internalUrl).
// It is reached from two call paths: (1) task-instance config validation, where
// only instance-scoped fields exist; and (2) resolver-time
// validateEffectiveTaskProviderConfigResult, which passes the merged config
// (instance + context-scoped credential/workspaceId). This validator ignores the
// context-scoped fields by design — an authenticated healthcheck is not done here;
// credential validation happens during /setup.
```

- [ ] **Step 2: Edit the YouTrack comment**

Replace lines 6-7 with:

```typescript
// NOTE: this validator only inspects the instance-scoped baseUrl. It is reached
// both from task-instance config validation and from resolver-time
// validateEffectiveTaskProviderConfigResult (which passes the merged config
// including the context-scoped token). The token is intentionally ignored here;
// token validation happens during /setup.
```

- [ ] **Step 3: Verify formatting**

Run: `bun format:check && bun typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add plugins/task-provider-kaneo/validate-config.ts plugins/task-provider-youtrack/validate-config.ts
git commit -m "docs(plugins): correct validator comments about merged config at resolver time"
```

---

## Task 4.5: Update ADR-0009 to the plugin-contributed architecture (#20)

**Files:**

- Modify: `docs/adr/0009-multi-provider-task-tracker-support.md` (Implementation Status section, ~lines 105-115)

- [ ] **Step 1: Read the current Implementation Status section**

Run: `sed -n '95,130p' docs/adr/0009-multi-provider-task-tracker-support.md`

- [ ] **Step 2: Rewrite the stale lines**

Replace the line describing `src/providers/kaneo/` with a statement that both providers are now plugin-contributed under `plugins/task-provider-kaneo/` and `plugins/task-provider-youtrack/`, registered via `ctx.registration.registerTaskProviderType()`. Replace the line claiming `src/llm-orchestrator.ts` reads `TASK_PROVIDER` with: the orchestrator resolves the active provider per context through `TaskProviderResolver.resolve(contextId)` against the DB-backed task instance + descriptor registry; there is no `TASK_PROVIDER` env var. Keep the rest of the ADR intact.

- [ ] **Step 3: Verify the claims against code**

Run:

```bash
ls src/providers/kaneo 2>/dev/null; grep -rn "TASK_PROVIDER" src/llm-orchestrator.ts
```

Expected: no `src/providers/kaneo` directory; no `TASK_PROVIDER` hits. The ADR text must match this reality.

- [ ] **Step 4: Format + commit**

Run: `bun format:check`

```bash
git add docs/adr/0009-multi-provider-task-tracker-support.md
git commit -m "docs(adr): update ADR-0009 to plugin-contributed provider architecture"
```

---

## Task 4.6 (INVESTIGATION-FIRST): Route provider HTTP through `providerRuntime` + populate allowed hosts (#15)

> **Open question from the spec.** Before writing code, confirm whether `ctx.providerRuntime` supports every request shape the two clients need (`kaneoFetch` and the YouTrack client: arbitrary method, headers incl. `Authorization`/`Cookie`, JSON body, query string, and reading JSON/text responses). If it does not, the correct move is to _extend `providerRuntime`_ rather than retain global `fetch`. Do not force a lossy migration.

**Files (read first):**

- `src/plugins/context.ts` (the `providerRuntime` construction, ~lines 220-230) and its type in the plugin context facade
- `plugins/task-provider-kaneo/client.ts:69-101`
- `plugins/task-provider-youtrack/client.ts` (its `fetch` callsites)
- `plugins/task-provider-kaneo/plugin.json:43`, `plugins/task-provider-youtrack/plugin.json:63`

- [ ] **Step 1: Capture the `providerRuntime` contract**

Run:

```bash
grep -n "providerRuntime" src/plugins/context.ts src/plugins/types.ts
sed -n '200,240p' src/plugins/context.ts
```

Write down the exact method signature(s) `providerRuntime` exposes and what host-allowlist enforcement it applies.

- [ ] **Step 2: Decide host values**

`providerAllowedHosts` cannot be `[]` if enforcement is on. Determine the hosts: the instance `baseUrl` host is dynamic (operator-configured), so a static `[]` manifest list cannot enumerate it. Confirm how `providerAllowedHosts` is meant to interact with a dynamic `baseUrl` (likely the allowlist must permit the configured instance host). **This is the crux of the open question** — resolve it from `context.ts` before proceeding. Record the decision in the task notes.

- [ ] **Step 3: Write the failing test (host enforcement)**

Once the contract is known, add a test (in `tests/plugins/task-provider-kaneo/` and the YouTrack equivalent) asserting that a request to a non-allowlisted host is rejected and an allowlisted host is permitted. Use the suite's existing fetch-mock helpers (`setMockFetch`/`restoreFetch`).

- [ ] **Step 4: Implement**

Route `kaneoFetch` and the YouTrack client through the `providerRuntime` HTTP helper, and set `providerAllowedHosts` per the Step 2 decision in both `plugin.json` files. If `providerRuntime` lacks a needed capability, extend it in `src/plugins/context.ts` (and its type) with a focused addition + its own unit test.

- [ ] **Step 5: Verify the full provider suites**

Run: `bun test tests/plugins/ && bun typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/task-provider-kaneo plugins/task-provider-youtrack src/plugins/context.ts src/plugins/types.ts tests/plugins/
git commit -m "fix(plugins): enforce provider host allowlist via providerRuntime"
```

---

## Task 4.7 (INVESTIGATION-FIRST): Unify the `internalUrl` config path (#16)

> **Discrepancy surfaced during planning.** The brainstorming decision was "factory consumes it," but the code shows `internalUrl` is **provisioning-only**: it is read via `taskInstance.config['internalUrl']` in `provision.ts:270` and `src/commands/setup.ts:86`, flows into `provisionAndConfigure`'s `ProvisionConfig`, and is **never** part of the runtime `KaneoConfig` (the runtime provider talks to the public `baseUrl`). Forcing `internalUrl` into `KaneoConfig`/the factory would add an unused field. Resolve the direction with the reviewer before coding (see "Open Questions" below).

**Files (read first):**

- `plugins/task-provider-kaneo/provision.ts:256-273`
- `src/commands/setup.ts:80-86`
- `plugins/task-provider-kaneo/index.ts:15-30`
- `plugins/task-provider-kaneo/plugin.json:36`

- [ ] **Step 1: Confirm the two read sites and the absence of a runtime consumer**

Run:

```bash
grep -rn "internalUrl" plugins/task-provider-kaneo src/commands/setup.ts
```

Confirm only provisioning + setup read it, and `buildKaneoConfig` (index.ts:15) does not.

- [ ] **Step 2: Choose the unification direction (reviewer decision)**

Option A (typed provisioning accessor — recommended given the evidence): add a small typed reader (e.g. `readInstanceInternalUrl(config: Record<string,string>): string | undefined`) used by both `provision.ts` and `setup.ts`, replacing the two raw `config['internalUrl']` index accesses. Keep `internalUrl` in `providerConfigSchema` (it is a real, validated instance field). This unifies the _read_ path without inventing an unused runtime field.

Option B (factory consumes it): add `internalUrl` to `KaneoConfig` and have the runtime client prefer it — only valid if the runtime provider is _intended_ to call the internal URL. The current client uses `baseUrl` exclusively, so this changes runtime behavior and needs explicit product confirmation.

- [ ] **Step 3: Write the failing test for the chosen option**

For Option A: a test asserting `readInstanceInternalUrl({ internalUrl: 'https://internal' })` returns `'https://internal'` and `readInstanceInternalUrl({})` returns `undefined`, plus that `maybeProvisionKaneo` passes the value through (extend the existing provision tests).

- [ ] **Step 4: Implement the chosen option**

For Option A: create the typed reader (co-located with provisioning), and replace the raw accesses in `provision.ts:270` and `setup.ts:86`.

- [ ] **Step 5: Verify**

Run: `bun test tests/plugins/task-provider-kaneo/ && bun typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/task-provider-kaneo src/commands/setup.ts tests/plugins/task-provider-kaneo/
git commit -m "refactor(kaneo): unify internalUrl read path through a typed accessor"
```

---

## Task 4.8 (INVESTIGATION-FIRST): Resolve the two-phase `validateConfig` mutation (#19)

> **Open question from the spec.** `loader.ts:150` mutates `taskProviderRegistration.validateConfig` after `activate()` has built the registration. Decide whether `registerTaskProviderType` (the plugin-facing registration API) can accept the validator at registration time; if not, document the activation-ordering constraint inline rather than refactoring.

**Files (read first):**

- `src/plugins/loader.ts:139-151`
- The `registerTaskProviderType` facade in `src/plugins/context.ts` and its collected-registration type

- [ ] **Step 1: Trace why the validator is resolved separately**

Run:

```bash
grep -n "registerTaskProviderType\|validateConfig\|resolveProviderConfigValidator" src/plugins/context.ts src/plugins/contributions.ts src/plugins/module-import.ts src/plugins/loader.ts
```

Determine whether `validateConfig` is known _before_ `activate()` runs. `resolveProviderConfigValidator(manifest, moduleRecord)` (loader.ts:139) resolves it from the imported module — which is available before activation. If so, it can be passed into the registration instead of mutated afterward.

- [ ] **Step 2: Choose**

- If the validator is resolvable before activation **and** the registration API can carry it: refactor so `registerTaskProviderType` receives `validateConfig` directly, removing the post-hoc mutation.
- If activation ordering genuinely requires post-hoc assignment: keep the mutation and add an inline comment explaining the constraint (no code change beyond the comment).

- [ ] **Step 3: Write the failing test (only if refactoring)**

Add/extend a loader test asserting an activated provider plugin exposes its `validateConfig` through the registry without relying on a post-activation mutation. Reuse `tests/plugins/task-provider-kaneo/activation.test.ts` patterns.

- [ ] **Step 4: Implement the chosen path**

- [ ] **Step 5: Verify**

Run: `bun test tests/plugins/ && bun typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/loader.ts src/plugins/context.ts tests/plugins/
git commit -m "refactor(plugins): pass validateConfig at registration time"
# or, if documenting only:
# git commit -m "docs(plugins): document validateConfig two-phase activation constraint"
```

---

# Final verification (run after each track and at the end)

- [ ] `bun typecheck`
- [ ] `bun lint`
- [ ] `bun knip` (catches any now-unused exports from deleted literal helpers)
- [ ] `bun test` (curated suite)
- [ ] `bun format:check`

---

# Open Questions (carry to implementation)

1. **#15 host allowlist vs dynamic `baseUrl`:** how is a static `providerAllowedHosts` manifest list meant to authorize an operator-configured instance host? Resolve from `src/plugins/context.ts` before Task 4.6.
2. **#16 `internalUrl` direction:** code shows it is provisioning-only; the spec's "factory consumes it" decision does not fit. Recommended: Option A (typed provisioning accessor), pending reviewer confirmation in Task 4.7.
3. **#19 validator registration timing:** whether `registerTaskProviderType` can carry `validateConfig` at registration time, or activation ordering forces the documented post-hoc mutation (Task 4.8).
