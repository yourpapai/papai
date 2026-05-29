<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Task-Provider-as-Plugin Phases 3–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Kaneo (Phase 3) and YouTrack (Phase 4) from `src/providers/` into `plugins/`, then retire both vestigial back-compat fields (Phase 5), completing the task-provider-as-plugin migration.

**Architecture:** Each phase ships as a self-contained PR; the plan is ordered 3 → 4 → 5 because Phase 5 deletes back-compat surfaces both prior phases still rely on. Phase 3 carries the load-bearing core rewrites (bootstrap simplification, resolver special-case removal, startup-warn for unapproved providers); Phase 4 mirrors Phase 3 mechanically; Phase 5 is purely cleanup.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Zod v4, Drizzle/SQLite, `bun:test`, Svelte 5 runes, oxlint, oxfmt.

**Spec:** `docs/superpowers/specs/2026-05-28-task-provider-plugin-phases-3-to-5-design.md`

---

## Context for the implementer (read once)

**Decisions that govern every task:**

1. **No env-driven task-instance bootstrap.** `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL`, `YOUTRACK_URL` are removed from bootstrap. `BootstrapResult` loses `taskInstanceId`. Operators create task instances in `/admin#instances`.
2. **No auto-approval seed.** Operators run `/plugin approve task-provider-kaneo` (and `/plugin approve task-provider-youtrack`) once after upgrade. A startup `WARN` lists pending approvals so the requirement is visible.
3. **Phase 5 retires both vestigial fields.** `TaskProvider.configRequirements` (interface) and `TaskProviderTypeDescriptor.configSchema` + `legacyConfigSchema` (descriptor compat) — in one cleanup pass after Phases 3 + 4 land.
4. **Kaneo workspaceId — consolidated to `user_config[kaneo_workspace_id]` in Task 3.1, then renamed to the namespaced plugin key (see decision 6).** Task 3.1 (DONE) collapsed the `users.kaneo_workspace_id` dual-store into the single flat key. That flat key is an **intermediate**: the Phase 3 data migration (Task 3.6a) renames it to `plugin:task-provider-kaneo:provider:workspaceId`. The `users.kaneo_workspace_id` DB column survives this plan (drop is a follow-on migration).
5. **First-party trust.** Migrated providers do **not** request the `http` permission, declare `providerAllowedHosts: []`, and keep their existing `client.ts` fetch path. `ctx.providerRuntime.httpFetch` is for a future third-party trust tier.
6. **Provider config keys are plugin-namespaced; existing credentials are migrated (architecture decision, 2026-05-29 resync).** The shipped Phase 1/2 resolver (`src/providers/resolver.ts:37-40`) and setup wizard (`src/wizard/steps.ts:37-44`) already store **plugin-contributed** provider config under `plugin:<pluginId>:provider:<fieldKey>`, ignoring any `storageKey`. Migrated providers keep that namespacing — **no `storageKey` aliasing is added**. A one-time SQLite migration per phase renames existing flat credentials to the namespaced keys and lands in the **same phase as that provider's builtin→plugin cutover**: Kaneo keys (`kaneo_apikey`, `kaneo_workspace_id`) in Phase 3 **after** the builtin descriptor is removed; `youtrack_token` in Phase 4 — **never earlier**, or the still-builtin YouTrack (which reads the flat key via its descriptor `storageKey`) breaks. The plugin manifest schema is extended (Task 3.1a) only to accept **camelCase provider field keys** (`baseUrl`, `internalUrl`, `workspaceId`) so existing instance config (persisted under `baseUrl`) and the moved factory code keep resolving; `storageKey` is **not** added to the manifest schema. Namespaced storage keys, by `field.key`:
   - Kaneo: `plugin:task-provider-kaneo:provider:credential`, `plugin:task-provider-kaneo:provider:workspaceId`
   - YouTrack: `plugin:task-provider-youtrack:provider:token`
   - Instance fields (`baseUrl`, `internalUrl`) are read directly from `task_instances.config[field.key]` and are **not** namespaced or migrated.

**Repo conventions:**

- Bun runtime, strict TypeScript, `.js` import extensions throughout (`import { foo } from './bar.js'`).
- Hook policy blocks `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-nocheck`, `git stash`, `git checkout --`. Fix the underlying issue.
- Every `Write`/`Edit` on `src/`/`client/` triggers TDD hooks (write-policy gate → test-first gate → targeted test run). Tests must exist before non-test edits.
- Plugin tests live under `tests/plugins/<plugin-id>/`. Non-plugin tests under `tests/`.
- `papai/plugin-types` alias resolves to `src/providers/public-types.ts` — use it from any new `plugins/` code.
- `oxfmt` treats `_text_` italics ambiguously next to `snake_case` identifiers in markdown; use `**text**` bold in doc edits.

**Gate before any commit:** `bun lint`, `bun typecheck`, `bun format:check` (pre-commit hook runs these). Final gate per phase: `bun check:verbose`.

**Subskill:** before each task, run `superpowers:test-driven-development` for steps that touch test code, and `superpowers:systematic-debugging` if a step fails unexpectedly.

---

## File Structure

### Phase 3 creates

```
plugins/task-provider-kaneo/
  plugin.json                          (manifest)
  index.ts                             (default factory + activate)
  validate-config.ts                   (manifest.providerConfigValidator target)
  provider.ts                          (moved from src/providers/kaneo/index.ts)
  constants.ts                         (moved)
  client.ts                            (moved)
  kaneo-client.ts                      (moved)
  classify-error.ts                    (moved)
  identity-resolver.ts                 (moved)
  provision.ts                         (moved; rewired to user_config)
  url-builder.ts                       (moved)
  errors.ts                            (moved)
  api-error.ts                         (moved)
  validation-error.ts                  (moved)
  mappers.ts                           (moved)
  task-resource.ts                     (moved)
  task-status.ts                       (moved)
  task-relations.ts                    (moved)
  task-update-helpers.ts               (moved)
  column-resource.ts                   (moved)
  comment-resource.ts                  (moved)
  label-resource.ts                    (moved)
  project-resource.ts                  (moved)
  list-tasks.ts                        (moved)
  list-tasks-query.ts                  (moved)
  list-columns.ts                      (moved)
  list-labels.ts                       (moved)
  list-projects.ts                     (moved)
  list-task-labels.ts                  (moved)
  search-tasks.ts                      (moved)
  get-task.ts                          (moved)
  get-comments.ts                      (moved)
  create-task.ts                       (moved)
  create-column.ts                     (moved)
  create-label.ts                      (moved)
  create-project.ts                    (moved)
  update-task.ts                       (moved)
  update-column.ts                     (moved)
  update-label.ts                      (moved)
  update-project.ts                    (moved)
  update-comment.ts                    (moved)
  update-task-relation.ts              (moved)
  delete-task.ts                       (moved)
  delete-column.ts                     (moved)
  delete-project.ts                    (moved)
  remove-comment.ts                    (moved)
  remove-label.ts                      (moved)
  remove-task-label.ts                 (moved)
  remove-task-relation.ts              (moved)
  reorder-columns.ts                   (moved)
  add-comment.ts                       (moved)
  add-task-label.ts                    (moved)
  add-task-relation.ts                 (moved)
  operations/                          (moved as a directory)
  schemas/                             (moved as a directory)
tests/plugins/task-provider-kaneo/     (moved from tests/providers/kaneo/)
```

### Phase 3 modifies

- `src/providers/registry.ts` — delete `createKaneoProvider`, kaneo entry in `providers` map, Kaneo imports.
- `src/providers/builtin-descriptors.ts` — delete kaneo seed.
- `src/providers/resolver.ts` — delete `if (descriptor.type === 'kaneo' && field.key === 'workspaceId')` branch + `getKaneoWorkspace` dep.
- `src/providers/resolver.ts:21-22` `TaskProviderResolverDeps` — delete `getKaneoWorkspace` field.
- `src/users.ts` — delete `getKaneoWorkspace`, `setKaneoWorkspace`.
- `src/cache.ts` — delete `getCachedWorkspace`, `setCachedWorkspace` (after audit confirms no other consumers).
- `src/llm-orchestrator.ts`, `src/llm-orchestrator-types.ts`, `src/commands/setup.ts` — readers retargeted to `getConfigValue(contextId, 'kaneo_workspace_id')`.
- `src/wizard/steps.ts` — writer retargeted to `setConfigValue(contextId, 'kaneo_workspace_id', value)`.
- `src/instances/bootstrap.ts` — delete task-instance seeding (`BuiltinTaskType`, `TASK_ENV_REQUIREMENTS`, `buildTaskConfig`, `parseTaskType`, `'TASK_PROVIDER'`).
- `src/instances/types.ts` — `BootstrapResult` loses `taskInstanceId` field; `BuiltinTaskType` deleted.
- `src/index.ts` — invoke new `warnUnresolvedTaskInstances()` after plugin loader runs.
- `src/instances/health.ts` — **new** — `warnUnresolvedTaskInstances()`.
- `src/debug/instance-routes.ts` — add `unresolvedReason` field to `maskedTaskInstance`.
- `client/shared/api-types.ts` — `TaskInstanceView` gains `unresolvedReason: string | null`.
- `client/admin/instance-fetcher-schemas.ts` — `TaskInstanceViewSchema` adds `unresolvedReason`.
- `client/admin/sections/InstancesSection.svelte` — render the label when present.
- `tests/e2e/bun-test-setup.ts` — approve `task-provider-kaneo` (and Phase 4: `task-provider-youtrack`).
- `CLAUDE.md`, `src/providers/CLAUDE.md`, `docs/plugins/developer-guide.md` — text updates.

**Resync additions (decision 6 — namespaced keys + camelCase manifest support):**

- `src/plugins/types.ts` — **new** `providerFieldKeySchema` (camelCase); provider instance/context requirement schemas override `key` (Task 3.1a).
- `src/db/migrations/048_namespace_kaneo_config.ts` — **new**; renames `kaneo_apikey`/`kaneo_workspace_id` → `plugin:task-provider-kaneo:provider:credential`/`…:workspaceId` (Task 3.6a).
- `src/db/index.ts` — register migration 048.
- `src/types/config.ts` — **new** namespaced-key constants for Kaneo (Task 3.6a).
- `src/wizard/steps.ts`, `src/commands/setup.ts`, `plugins/task-provider-kaneo/provision.ts` — re-point Kaneo flat-key readers/writers to the namespaced keys (Task 3.6a).

### Phase 4 creates / modifies

Same shape as Phase 3 applied to YouTrack. No workspace dual-store concern; no bootstrap rewrite (Phase 3 already removed all task-instance bootstrap paths).

### Phase 5 modifies

- `src/providers/types.ts:86` — drop `configRequirements` field on `TaskProvider`.
- `plugins/task-provider-kaneo/provider.ts`, `plugins/task-provider-youtrack/provider.ts` — drop the implementations.
- `src/providers/registry.ts` — drop `TaskProviderTypeDescriptor.configSchema`, `legacyConfigSchema`, `ContributedTaskProviderEntry.configSchema` fallback, fallback branches in `contributedInstanceFields`/`contributedContextFields`.
- `src/debug/task-provider-type-routes.ts` — drop `configSchema` from serialized view.
- `client/shared/api-types.ts`, `client/admin/instance-fetcher-schemas.ts` — drop `configSchema` from `TaskProviderTypeView`.
- `client/admin/sections/InstancesSection.svelte` — source form fields from `instanceConfigSchema` only.
- `src/providers/public-types.ts` — drop `ProviderConfigRequirement` re-export if no remaining consumer.

---

# Phase 3 — Kaneo Migration

## Task 3.1: Audit and migrate Kaneo workspaceId storage to `user_config`

> ✅ **DONE** (commit `35a8ece5`, verified 2026-05-29 resync). All steps below are complete: readers in `llm-orchestrator(-types).ts`/`setup.ts` and the `provision.ts` writer+reader were retargeted to `user_config[kaneo_workspace_id]`; `getKaneoWorkspace`/`setKaneoWorkspace`/cache helpers retained for later deletion (Task 3.10); resolver untouched (Task 3.7). **Note:** under the resync's decision 6, this flat key is an intermediate — Task 3.6a renames it to the namespaced `plugin:task-provider-kaneo:provider:workspaceId`. The regression test added here documents the still-live special-case path; Task 3.7 inverts it.

**Decision (spec §3.6):** `user_config[kaneo_workspace_id]` becomes the single source of truth. All readers/writers move off `getKaneoWorkspace`/`setKaneoWorkspace`/`getCachedWorkspace`/`setCachedWorkspace` and off `users.kaneo_workspace_id`.

**Files (writers):**

- Modify: `src/providers/kaneo/provision.ts:233` (will move to plugin in Task 3.3 — fix it here first so Task 3.7 can delete the resolver special-case).
- Modify: `src/wizard/steps.ts` (any `setKaneoWorkspace` call).

**Files (readers):**

- Modify: `src/llm-orchestrator.ts`, `src/llm-orchestrator-types.ts`, `src/commands/setup.ts` — replace `getKaneoWorkspace(contextId)` with `getConfigValue(contextId, KANEO_WORKSPACE_CONFIG_KEY)`.

**Files (deletions):**

- `src/users.ts` — delete `getKaneoWorkspace`, `setKaneoWorkspace`.
- `src/cache.ts` — delete `getCachedWorkspace`, `setCachedWorkspace`.

**Test files to update:**

- `tests/users.test.ts`, `tests/cache-db.test.ts`, `tests/scheduler.test.ts`, `tests/llm-orchestrator.test.ts`, `tests/chat/discord/index.test.ts`, `tests/chat/interaction-router.test.ts`, `tests/plugins/integration.test.ts`, `tests/providers/resolver.test.ts`, `tests/commands/setup.test.ts`, `tests/providers/kaneo/provision.test.ts`.

- [ ] **Step 1: Capture the audit (grep snapshot for review)**

Run and save the output for the PR description:

```bash
{
  echo "=== src/ readers/writers ==="
  grep -rn "getKaneoWorkspace\|setKaneoWorkspace\|getCachedWorkspace\|setCachedWorkspace" src/
  echo "=== test/ ==="
  grep -rn "getKaneoWorkspace\|setKaneoWorkspace\|getCachedWorkspace\|setCachedWorkspace" tests/
} > /tmp/kaneo-workspace-audit.txt
cat /tmp/kaneo-workspace-audit.txt
```

Expected: lists from spec §3.6 — every entry must be retargeted or deleted in this task. If a new caller appears that isn't covered below, stop and update the plan.

- [ ] **Step 2: Add a regression test asserting workspaceId is read from `user_config`**

Create or extend `tests/providers/resolver.test.ts`:

```typescript
test('resolves kaneo workspaceId from user_config (not the users-table cache)', () => {
  const calls: Array<{ contextId: string; key: string }> = []
  const resolver = new TaskProviderResolver({
    getContextSettings: () => ({ contextId: 'ctx-1', taskInstanceId: 'kaneo-1', platformInstanceId: 'p-1' }),
    getTaskInstance: () => ({
      id: 'kaneo-1',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
      createdAt: '2026-05-28T00:00:00.000Z',
    }),
    getConfig: (contextId, key) => {
      calls.push({ contextId, key })
      if (key === 'kaneo_apikey') return 'k-abc'
      if (key === 'kaneo_workspace_id') return 'ws-from-config'
      return null
    },
    createProvider: (type, config) => {
      expect(type).toBe('kaneo')
      expect(config.workspaceId).toBe('ws-from-config')
      return createMockProvider()
    },
  })

  expect(resolver.resolve('ctx-1')).not.toBeNull()
  expect(calls.some((call) => call.key === 'kaneo_workspace_id')).toBe(true)
})
```

- [ ] **Step 3: Run the failing test**

Run: `bun test tests/providers/resolver.test.ts`
Expected: FAIL — the resolver still routes `(kaneo, workspaceId)` through `getKaneoWorkspace`, never asks `getConfig('kaneo_workspace_id')`.

- [ ] **Step 4: Retarget readers**

In `src/llm-orchestrator-types.ts`, replace the `getKaneoWorkspace` dep field with a generic config getter (or remove it if a sibling getter already exists). Match the existing DI conventions of the file.

In `src/llm-orchestrator.ts`, replace each call site:

```typescript
// before
const workspace = getKaneoWorkspace(contextId)
// after
import { KANEO_WORKSPACE_CONFIG_KEY } from './types/config.js'
const workspace = getConfigValue(contextId, KANEO_WORKSPACE_CONFIG_KEY)
```

In `src/commands/setup.ts`, apply the same replacement.

- [ ] **Step 5: Retarget writers**

In `src/providers/kaneo/provision.ts:233`, replace:

```typescript
setKaneoWorkspace(userId, result.workspaceId)
```

with:

```typescript
import { setConfigValue } from '../../config.js'
import { KANEO_WORKSPACE_CONFIG_KEY } from '../../types/config.js'
setConfigValue(userId, KANEO_WORKSPACE_CONFIG_KEY, result.workspaceId)
```

In `src/wizard/steps.ts`, apply the equivalent change if a writer is present.

- [ ] **Step 6: Remove the resolver special-case dep field locally (test setup will follow)**

Open `src/providers/resolver.ts`. Locate `TaskProviderResolverDeps`. **Do not delete the field yet** — the special-case branch is removed in Task 3.7 after the entire plugin migration lands. For now, ensure `getConfig` is wired and the test from Step 2 will resolve through it after Task 3.7. Skip if the dep is already in shape.

> Why split: removing the special-case + dep field before Phase 3's other tasks ship would temporarily break resolver lookups for in-flight `users.kaneo_workspace_id` rows. The audit retargets writers/readers first; the special-case dies in Task 3.7 once everything reads from `user_config`.

- [ ] **Step 7: Update tests for retargeted code**

For each test in the Step 1 list, replace `setKaneoWorkspace`/`getKaneoWorkspace` mocks with `setConfigValue`/`getConfigValue` for the `kaneo_workspace_id` key. Use the helpers in `tests/utils/test-helpers.ts`. Keep mocks tight — no production behavior changes besides storage.

- [ ] **Step 8: Run the full audit-touched test set**

Run: `bun test tests/users.test.ts tests/cache-db.test.ts tests/scheduler.test.ts tests/llm-orchestrator.test.ts tests/chat/discord/index.test.ts tests/chat/interaction-router.test.ts tests/plugins/integration.test.ts tests/providers/resolver.test.ts tests/commands/setup.test.ts tests/providers/kaneo/provision.test.ts`
Expected: PASS. The Step 2 regression test still asserts `getConfig('kaneo_workspace_id')` was called.

- [ ] **Step 9: Commit**

```bash
git add src/llm-orchestrator.ts src/llm-orchestrator-types.ts src/commands/setup.ts src/wizard/steps.ts src/providers/kaneo/provision.ts tests/
git commit -m "refactor(kaneo): single-source workspaceId in user_config"
```

> Deletions of `getKaneoWorkspace`/`setKaneoWorkspace` and the `users.kaneo_workspace_id` cache layer happen in Task 3.10 after the resolver special-case is gone. Leaving them here means in-flight reads still work.

---

## Task 3.1a: Extend the plugin manifest schema to accept camelCase provider field keys

**Why (resync decision 6):** `configRequirementBaseSchema.key` uses `configKeySchema` = `/^[a-z][a-z0-9_]*$/` (snake_case only). The migrated providers need field keys `baseUrl`, `internalUrl`, `workspaceId` (camelCase) so the resolver reads existing instance config (persisted under `baseUrl`) and the moved factory keeps reading `config.baseUrl`/`config.workspaceId`. This task relaxes **only** the provider field-key schemas, leaving `configKeys`/`pluginConfigRequirementSchema` snake_case.

**Files:**

- Modify: `src/plugins/types.ts`
- Test: `tests/plugins/types.test.ts` (extend if present; otherwise create `tests/plugins/provider-manifest-schema.test.ts`)

- [ ] **Step 1: Write the failing test**

Assert that a manifest declaring camelCase provider field keys parses:

```typescript
import { pluginManifestSchema } from '../../src/plugins/types.js'

test('provider config field keys accept camelCase', () => {
  const result = pluginManifestSchema.safeParse({
    id: 'task-provider-kaneo',
    name: 'Kaneo',
    version: '1.0.0',
    description: 'x',
    apiVersion: 1,
    permissions: ['provider.task'],
    contributes: { taskProviderTypes: ['kaneo'] },
    providerConfigSchema: [{ key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' }],
    providerContextConfigSchema: [
      { key: 'workspaceId', label: 'Workspace', required: true, sensitive: false, scope: 'context' },
    ],
  })
  expect(result.success).toBe(true)
})

test('plugin configKeys still reject camelCase', () => {
  const result = pluginManifestSchema.safeParse({
    id: 'x',
    name: 'x',
    version: '1.0.0',
    description: 'x',
    apiVersion: 1,
    contributes: { configKeys: ['camelCase'] },
  })
  expect(result.success).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/types.test.ts` (or the new file). Expected: FAIL — `baseUrl`/`workspaceId` rejected by the snake_case regex.

- [ ] **Step 3: Implement**

In `src/plugins/types.ts`, add next to `configKeySchema` (~line 129):

```typescript
const providerFieldKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/u, 'Provider field key must be alphanumeric starting with a letter')
```

Change the two provider requirement schemas (currently `configRequirementBaseSchema.extend({ scope: ... })` at ~lines 170-176) to also override the key:

```typescript
const providerInstanceConfigRequirementSchema = configRequirementBaseSchema.extend({
  key: providerFieldKeySchema,
  scope: z.literal('instance').optional().default('instance'),
})
const providerContextConfigRequirementSchema = configRequirementBaseSchema.extend({
  key: providerFieldKeySchema,
  scope: z.literal('context').optional().default('context'),
})
```

Leave `configKeySchema`, `pluginConfigRequirementSchema`, and `pluginContributesSchema.configKeys` unchanged.

- [ ] **Step 4: Run tests**

Run: `bun test tests/plugins/`. Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run `bun lint`, `bun typecheck`, `bun format:check`, then:

```bash
git add src/plugins/types.ts tests/plugins/
git commit -m "feat(plugins): accept camelCase provider field keys in manifest schema"
```

---

## Task 3.2: Scaffold `plugins/task-provider-kaneo/` skeleton

**Files:**

- Create: `plugins/task-provider-kaneo/plugin.json`
- Create: `plugins/task-provider-kaneo/index.ts`
- Create: `plugins/task-provider-kaneo/validate-config.ts`
- Test: `tests/plugins/task-provider-kaneo/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-kaneo/manifest.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { pluginManifestSchema } from '../../../src/plugins/types.js'

describe('task-provider-kaneo manifest', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../../../plugins/task-provider-kaneo/plugin.json'), 'utf8'))

  test('parses against pluginManifestSchema', () => {
    const result = pluginManifestSchema.safeParse(manifest)
    expect(result.success).toBe(true)
  })

  test('declares the kaneo task provider type with provider.task permission', () => {
    expect(manifest.contributes.taskProviderTypes).toEqual(['kaneo'])
    expect(manifest.permissions).toContain('provider.task')
    expect(manifest.permissions).toContain('identity')
  })

  test('declares instance-scoped baseUrl and internalUrl', () => {
    const keys = manifest.providerConfigSchema.map((field: { key: string }) => field.key)
    expect(keys).toContain('baseUrl')
    expect(keys).toContain('internalUrl')
  })

  test('declares context-scoped credential and workspaceId (no storageKey — keys are namespaced)', () => {
    const credential = manifest.providerContextConfigSchema.find((field: { key: string }) => field.key === 'credential')
    expect(credential).toMatchObject({ scope: 'context', sensitive: true })
    expect(credential).not.toHaveProperty('storageKey')
    const workspace = manifest.providerContextConfigSchema.find((field: { key: string }) => field.key === 'workspaceId')
    expect(workspace).toMatchObject({ scope: 'context' })
  })
})
```

> **Resync note (decision 6):** context fields live in `providerContextConfigSchema`, **not** `providerConfigSchema` (which is instance-only). There is **no** `storageKey` — the resolver/wizard derive the storage key as `plugin:task-provider-kaneo:provider:<key>` from `field.key`. The runtime storage keys are therefore `plugin:task-provider-kaneo:provider:credential` and `plugin:task-provider-kaneo:provider:workspaceId`; existing flat `kaneo_apikey`/`kaneo_workspace_id` rows are renamed by the Task 3.6a migration.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-kaneo/manifest.test.ts`
Expected: FAIL — `plugin.json` does not exist.

- [ ] **Step 3: Create the manifest**

Create `plugins/task-provider-kaneo/plugin.json`:

```json
{
  "id": "task-provider-kaneo",
  "name": "Kaneo",
  "version": "1.0.0",
  "description": "Kaneo task-tracker integration.",
  "apiVersion": 1,
  "permissions": ["provider.task", "identity"],
  "contributes": {
    "taskProviderTypes": ["kaneo"]
  },
  "providerCapabilities": [],
  "providerConfigSchema": [
    { "key": "baseUrl", "label": "Kaneo URL", "required": true, "sensitive": false, "scope": "instance" },
    { "key": "internalUrl", "label": "Kaneo Internal URL", "required": false, "sensitive": false, "scope": "instance" }
  ],
  "providerContextConfigSchema": [
    { "key": "credential", "label": "Kaneo API Key", "required": true, "sensitive": true, "scope": "context" },
    { "key": "workspaceId", "label": "Workspace ID", "required": true, "sensitive": false, "scope": "context" }
  ],
  "providerAllowedHosts": [],
  "providerConfigValidator": "validateConfig",
  "defaultEnabled": false
}
```

> **Resync note (decision 6):** instance fields go in `providerConfigSchema`, context fields in `providerContextConfigSchema` (matching the shipped Zod schema). camelCase keys (`baseUrl`, `internalUrl`, `workspaceId`) require Task 3.1a. **No `storageKey`** — the resolver/wizard namespace context keys as `plugin:task-provider-kaneo:provider:<key>`.
>
> `providerCapabilities` is `[]` here because the canonical capability set (`ALL_CAPABILITIES`) lives in TS constants and must match `builtinDescriptorSeeds[kaneo].capabilities` exactly. Task 3.5 populates this array from the same source-of-truth list to avoid drift.

- [ ] **Step 4: Create the entry-point shell**

Create `plugins/task-provider-kaneo/index.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginContext } from 'papai/plugin-types'
import { validateConfig } from './validate-config.js'

export default () => ({
  activate(ctx: PluginContext) {
    ctx.registration.registerTaskProviderType('kaneo', {
      // Task 3.5 swaps this stub for the real factory once provider sources are moved in.
      factory: () => {
        throw new Error('task-provider-kaneo factory not yet wired')
      },
      validateConfig,
    })
  },
})
```

- [ ] **Step 5: Create the validator placeholder**

Create `plugins/task-provider-kaneo/validate-config.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export async function validateConfig(
  _config: Record<string, string>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Task 3.5 replaces this stub with a real healthcheck against the entered baseUrl/credential.
  return { ok: true }
}
```

- [ ] **Step 6: Run the manifest test to verify it passes**

Run: `bun test tests/plugins/task-provider-kaneo/manifest.test.ts`
Expected: PASS — manifest parses and asserts hold.

- [ ] **Step 7: Verify plugin discovery picks up the package**

Run: `bun test tests/plugins/loader.test.ts -t "discover"`
Expected: PASS — the plugin loader scans `plugins/`, discovers `task-provider-kaneo`, registers it in `plugin_admin_state` as `discovered`.

If the loader test suite needs a fixture-list update, add `task-provider-kaneo` to the discovery expectations.

- [ ] **Step 8: Commit**

```bash
git add plugins/task-provider-kaneo/ tests/plugins/task-provider-kaneo/
git commit -m "feat(plugins): scaffold task-provider-kaneo manifest and entry shell"
```

---

## Task 3.3: Move Kaneo source modules into the plugin

This is a bulk `git mv` of every file under `src/providers/kaneo/` to `plugins/task-provider-kaneo/`, plus blanket import-path retargeting so the moved files compile in their new home.

**Files:**

- Move: `src/providers/kaneo/*` → `plugins/task-provider-kaneo/*` (preserving the `operations/` and `schemas/` subdirectory structure).
- Modify: every moved `.ts` file's imports of `../config.js`, `../web/safe-fetch.js`, `../errors.js`, `../users.js`, etc. — adjust depth (`../config.js` is two levels up from the plugin, was one level up from `src/providers/`).

- [ ] **Step 1: Inventory the moves**

Run: `find src/providers/kaneo -type f | sort > /tmp/kaneo-files.txt && cat /tmp/kaneo-files.txt`
Expected: 65 file paths (per the file-structure snapshot). Save the list for cross-reference during retargeting.

- [ ] **Step 2: Move files with `git mv` so history is preserved**

```bash
# Top-level files
git ls-files src/providers/kaneo/*.ts | while read -r f; do
  target="plugins/task-provider-kaneo/$(basename "$f")"
  git mv "$f" "$target"
done

# Subdirectories
git mv src/providers/kaneo/operations plugins/task-provider-kaneo/operations
git mv src/providers/kaneo/schemas plugins/task-provider-kaneo/schemas

# index.ts becomes provider.ts (avoid collision with plugin's index.ts entry point)
git mv plugins/task-provider-kaneo/index.ts plugins/task-provider-kaneo/provider.ts
```

> The plugin's own `index.ts` was created in Task 3.2. The Kaneo `index.ts` exports `KaneoProvider` and `KaneoConfig` — renamed to `provider.ts` here, which the entry-point factory imports as `./provider.js`.

- [ ] **Step 3: Retarget imports inside the moved files**

For every `.ts` file now under `plugins/task-provider-kaneo/`, adjust relative imports of `src/` modules. The depth changed from `src/providers/kaneo/<file>` (`../../foo.js` reaches `src/foo.js`) to `plugins/task-provider-kaneo/<file>` (`../../src/foo.js` reaches `src/foo.js`). Files under `operations/` and `schemas/` go one deeper.

Run:

```bash
# Two-level-up imports: src/providers/* → ../../src/providers/* etc.
# (Files at plugins/task-provider-kaneo/* root)
find plugins/task-provider-kaneo -maxdepth 1 -type f -name "*.ts" -exec \
  sed -i '' \
    -e "s|from '\.\./\.\./|from '../../src/|g" \
    -e "s|from '\.\./|from '../../src/|g" {} \;

# Three-level-up imports inside operations/ and schemas/
find plugins/task-provider-kaneo/operations plugins/task-provider-kaneo/schemas -type f -name "*.ts" -exec \
  sed -i '' \
    -e "s|from '\.\./\.\./\.\./|from '../../../src/|g" \
    -e "s|from '\.\./\.\./|from '../../../src/|g" {} \;
```

> The `sed` is a first sweep; manual review may catch edge cases. Step 4 is the verification.

- [ ] **Step 4: Replace deep imports with `papai/plugin-types` where available**

For each moved file, replace imports of `TaskProvider`, `TaskCapability`, `ProviderConfigRequirement`, `ProviderConfigField`, `AppError`, `providerError`, `systemError`, `webFetchError`, `isAppError`, `extractAppError` with the public alias:

```typescript
// before
import type { TaskProvider } from '../../src/providers/types.js'
import { providerError } from '../../src/errors.js'
// after
import type { TaskProvider } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'
```

Grep guard:

```bash
grep -rn "from '\.\./\.\./src/providers/types\|from '\.\./\.\./src/errors\|from '\.\./\.\./src/providers/task-capability" plugins/task-provider-kaneo/
```

Expected: zero matches after retarget. Imports of `safe-fetch`, `logger`, `config`, `users` (post-Task-3.10), domain helpers stay as `../../src/<path>` for now.

- [ ] **Step 5: Verify the package typechecks in isolation**

Run: `bun typecheck`
Expected: PASS for all moved files. If a circular import or missing identifier surfaces, fix the specific import; do not paper over with `as never` or suppress comments.

- [ ] **Step 6: Update tests' imports for the moved source**

Run:

```bash
# Tests still under tests/providers/kaneo/ — Task 3.4 moves them.
# For now, retarget tests' imports to point at the new plugin source so they compile.
grep -rln "from '\.\./\.\./src/providers/kaneo" tests/providers/kaneo/ | while read -r f; do
  sed -i '' "s|from '\.\./\.\./src/providers/kaneo|from '../../../plugins/task-provider-kaneo|g" "$f"
done
grep -rln "from '\.\./\.\./\.\./src/providers/kaneo" tests/providers/kaneo/ | while read -r f; do
  sed -i '' "s|from '\.\./\.\./\.\./src/providers/kaneo|from '../../../../plugins/task-provider-kaneo|g" "$f"
done
```

Adjust `provider.ts`-vs-`index.ts` references inside tests:

```bash
sed -i '' "s|kaneo/index\.js|kaneo/provider.js|g" tests/providers/kaneo/*.ts tests/providers/kaneo/**/*.ts
```

- [ ] **Step 7: Run the Kaneo test suite (still in old location)**

Run: `bun test tests/providers/kaneo/`
Expected: PASS. If failing imports remain, retarget them by hand.

- [ ] **Step 8: Commit**

```bash
git add -A plugins/task-provider-kaneo/ src/providers/kaneo/ tests/providers/kaneo/
git commit -m "refactor(kaneo): move provider source into plugins/task-provider-kaneo"
```

---

## Task 3.4: Move Kaneo tests into `tests/plugins/task-provider-kaneo/`

**Files:**

- Move: `tests/providers/kaneo/*` → `tests/plugins/task-provider-kaneo/*`.

- [ ] **Step 1: Verify Task 3.3 tests are green at the source location**

Run: `bun test tests/providers/kaneo/`
Expected: PASS. If not, finish Task 3.3 retarget before proceeding.

- [ ] **Step 2: `git mv` the directory**

```bash
mkdir -p tests/plugins
git mv tests/providers/kaneo tests/plugins/task-provider-kaneo
```

- [ ] **Step 3: Retarget moved tests' relative imports**

Tests moved from `tests/providers/kaneo/*` (depth 2 from repo root) to `tests/plugins/task-provider-kaneo/*` (depth 2 from root). The path to `plugins/task-provider-kaneo/` from the new test location is `../../../plugins/task-provider-kaneo/`.

```bash
sed -i '' "s|from '\.\./\.\./\.\./plugins/task-provider-kaneo|from '../../../plugins/task-provider-kaneo|g" tests/plugins/task-provider-kaneo/*.ts tests/plugins/task-provider-kaneo/**/*.ts
# Test helpers also need depth adjustment.
sed -i '' "s|from '\.\./\.\./utils/|from '../../utils/|g" tests/plugins/task-provider-kaneo/*.ts
sed -i '' "s|from '\.\./\.\./\.\./utils/|from '../../utils/|g" tests/plugins/task-provider-kaneo/**/*.ts
```

- [ ] **Step 4: Run the moved tests**

Run: `bun test tests/plugins/task-provider-kaneo/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A tests/providers/kaneo/ tests/plugins/task-provider-kaneo/
git commit -m "refactor(kaneo): move tests under tests/plugins/task-provider-kaneo"
```

---

## Task 3.5: Wire the Kaneo factory and validator; verify activation

**Files:**

- Modify: `plugins/task-provider-kaneo/index.ts`
- Modify: `plugins/task-provider-kaneo/validate-config.ts`
- Modify: `plugins/task-provider-kaneo/plugin.json` (populate `providerCapabilities`)
- Test: `tests/plugins/task-provider-kaneo/activation.test.ts`

- [ ] **Step 1: Write the failing activation test**

Create `tests/plugins/task-provider-kaneo/activation.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  getContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../../src/providers/registry.js'
import { buildPluginContext } from '../../../src/plugins/context.js'
import { mockLogger } from '../../utils/test-helpers.js'
import factory from '../../../plugins/task-provider-kaneo/index.js'

import manifestJson from '../../../plugins/task-provider-kaneo/plugin.json' with { type: 'json' }
import { pluginManifestSchema } from '../../../src/plugins/types.js'

describe('task-provider-kaneo activation', () => {
  test('activate() registers kaneo in the contributed registry', () => {
    mockLogger()
    const manifest = pluginManifestSchema.parse(manifestJson)
    const { ctx } = buildPluginContext(manifest, '__system__')
    try {
      factory().activate(ctx)
      const entry = getContributedTaskProviderType('kaneo')
      expect(entry?.pluginId).toBe('task-provider-kaneo')
      const provider = entry?.factory({
        baseUrl: 'https://kaneo.invalid',
        credential: 'test-api-key',
        workspaceId: 'ws-1',
      })
      expect(provider?.name).toBe('kaneo')
    } finally {
      unregisterContributedTaskProviderType('task-provider-kaneo')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/task-provider-kaneo/activation.test.ts`
Expected: FAIL — factory throws `'task-provider-kaneo factory not yet wired'`.

- [ ] **Step 3: Replace the factory stub with the real factory**

Edit `plugins/task-provider-kaneo/index.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginContext, TaskProvider } from 'papai/plugin-types'
import { isKaneoSessionCookie } from './client.js'
import { KaneoProvider, type KaneoConfig } from './provider.js'
import { validateConfig } from './validate-config.js'

const buildKaneoConfig = (config: Record<string, string>): KaneoConfig => {
  const baseUrl = config.baseUrl
  const internalUrl = config.internalUrl === '' || config.internalUrl === undefined ? undefined : config.internalUrl
  const credential = config.credential
  return isKaneoSessionCookie(credential)
    ? { baseUrl, internalUrl, sessionCookie: credential }
    : { baseUrl, internalUrl, apiKey: credential }
}

export default () => ({
  activate(ctx: PluginContext) {
    ctx.registration.registerTaskProviderType('kaneo', {
      factory: (config): TaskProvider => new KaneoProvider(buildKaneoConfig(config), config.workspaceId),
      validateConfig,
    })
  },
})
```

> `buildKaneoConfig` here replicates the logic currently inline in `src/providers/registry.ts:41-45`; Task 3.6 deletes the inline copy from core.

- [ ] **Step 4: Populate `providerCapabilities` in the manifest**

The canonical capability list is `ALL_CAPABILITIES` in `plugins/task-provider-kaneo/constants.ts` (moved from Kaneo's old constants). Mirror it as a JSON array in `plugins/task-provider-kaneo/plugin.json`:

```bash
bun -e "import('./plugins/task-provider-kaneo/constants.js').then((m) => console.log(JSON.stringify([...m.ALL_CAPABILITIES])))"
```

Paste the output into `providerCapabilities` in `plugin.json`. Sort alphabetically for deterministic diffs.

> A future task could move this to a build step that asserts equality with `ALL_CAPABILITIES` at startup; out of scope here.

- [ ] **Step 5: Wire a real `validateConfig`**

Edit `plugins/task-provider-kaneo/validate-config.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { KaneoClient } from './client.js'

export async function validateConfig(
  config: Record<string, string>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const baseUrl = config.baseUrl?.trim()
  if (!baseUrl) return { ok: false, reason: 'baseUrl is required' }
  if (!config.credential?.trim()) return { ok: false, reason: 'credential is required' }
  try {
    const client = new KaneoClient({ baseUrl, apiKey: config.credential })
    await client.ping()
    return { ok: true }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `Kaneo healthcheck failed: ${reason}` }
  }
}
```

> If `KaneoClient` does not yet expose a `ping()` method, add one that hits a cheap authenticated endpoint (e.g. `/api/me`) or replace this body with the smallest authenticated call available. Update tests accordingly.

- [ ] **Step 6: Run activation test to verify it passes**

Run: `bun test tests/plugins/task-provider-kaneo/activation.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the plugin loader integration test**

Run: `bun test tests/plugins/loader.test.ts tests/plugins/integration.test.ts`
Expected: PASS — discovery, approval, activation all green for `task-provider-kaneo`.

- [ ] **Step 8: Commit**

```bash
git add plugins/task-provider-kaneo/ tests/plugins/task-provider-kaneo/
git commit -m "feat(plugins): wire task-provider-kaneo factory and validateConfig"
```

---

## Task 3.6: Remove inline `createKaneoProvider` and kaneo built-in descriptor

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `src/providers/builtin-descriptors.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Update the registry test to assert kaneo is _not_ a built-in**

In `tests/providers/registry.test.ts`, replace the test that asserts `'kaneo'` appears in the built-in `providers` map. Add:

```typescript
test('kaneo is no longer a built-in; it must be plugin-contributed', () => {
  // Before any plugin activates, kaneo does not resolve.
  expect(() => createProvider('kaneo', { baseUrl: 'x' })).toThrow(/Unknown provider/)
})

test('listTaskProviderTypes does not include kaneo when no plugin is registered', () => {
  const types = listTaskProviderTypes().map((descriptor) => descriptor.type)
  expect(types).not.toContain('kaneo')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/registry.test.ts`
Expected: FAIL — kaneo is still in the built-in map / descriptor seeds.

- [ ] **Step 3: Delete the inline factory and built-in map entry**

In `src/providers/registry.ts`, delete:

- `import { isKaneoSessionCookie, KaneoProvider, type KaneoConfig } from './kaneo/index.js'`
- The `createKaneoProvider` function (the credential/sessionCookie branch).
- The `['kaneo', createKaneoProvider]` entry in the `providers` map.

In `src/providers/builtin-descriptors.ts`, delete the kaneo entry from `builtinDescriptorSeeds` and its imports (`ALL_CAPABILITIES`, `KANEO_TRAITS`). After Phase 3 lands, the seeds array contains only `youtrack`.

- [ ] **Step 4: Run tests**

Run: `bun test tests/providers/registry.test.ts tests/providers/resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts src/providers/builtin-descriptors.ts tests/providers/registry.test.ts
git commit -m "refactor(providers): drop inline kaneo factory and built-in descriptor"
```

---

## Task 3.6a: Migrate Kaneo credentials to namespaced keys; re-point provision/wizard/setup readers

**Why (resync decision 6):** once Kaneo is plugin-contributed, the resolver and wizard read/write its context config under `plugin:task-provider-kaneo:provider:<key>`. Existing rows use the flat `kaneo_apikey`/`kaneo_workspace_id` keys (consolidated in Task 3.1), and `provision.ts`/`wizard`/`setup` still read/write those flats. This task renames the data and retargets every remaining flat-key reader/writer **for Kaneo only** (YouTrack's `youtrack_token` stays flat until Phase 4, because its builtin descriptor still reads it).

**Ordering:** lands in Phase 3 **after** Task 3.6 (builtin descriptor removed) and pairs with Task 3.7 (resolver special-case removal). Both must ship in the same PR/deploy.

**Namespaced keys (single source — define as shared constants, do not scatter string literals):**

- `plugin:task-provider-kaneo:provider:credential` (was `kaneo_apikey`)
- `plugin:task-provider-kaneo:provider:workspaceId` (was `kaneo_workspace_id`)

**Files:**

- Create: `src/db/migrations/048_namespace_kaneo_config.ts`
- Modify: `src/db/index.ts` (register migration 048)
- Create or modify: a small shared constants module for the two namespaced keys (e.g. add `KANEO_PLUGIN_CREDENTIAL_KEY`, `KANEO_PLUGIN_WORKSPACE_KEY` to `src/types/config.ts`, or co-locate in the plugin and import).
- Modify: `plugins/task-provider-kaneo/provision.ts` (moved in Task 3.3) — writes + reads use the namespaced keys.
- Modify: `src/wizard/steps.ts:61` — the auto-provisioned-workspace exclusion compares `field.storageKey` to `KANEO_WORKSPACE_CONFIG_KEY`; retarget to the namespaced workspace key (or exclude by `field.key === 'workspaceId'` for the kaneo descriptor).
- Modify: `src/commands/setup.ts` — `isFirstTimeKaneoGroupSetup` reads the workspace key via `deps.getConfig(...)`; retarget to the namespaced workspace key.
- Test: `tests/db/migrations/048_namespace_kaneo_config.test.ts` (create), plus updates to `tests/commands/setup.test.ts`, `tests/wizard/*` and `tests/plugins/task-provider-kaneo/provision.test.ts`.

- [ ] **Step 1: Audit every flat-key reader/writer (Kaneo)**

```bash
grep -rn "kaneo_apikey\|kaneo_workspace_id\|KANEO_WORKSPACE_CONFIG_KEY" src/ plugins/ | grep -v "048_namespace_kaneo_config"
```

Expected non-test sites to retarget: `plugins/task-provider-kaneo/provision.ts` (apikey + workspaceId read/write), `src/wizard/steps.ts:61`, `src/commands/setup.ts`. The migration file itself and YouTrack code are out of scope. If a site appears that isn't listed here, stop and update this task.

- [ ] **Step 2: Write the failing migration test**

Create `tests/db/migrations/048_namespace_kaneo_config.test.ts` asserting that pre-seeded `user_config` rows with `key='kaneo_apikey'` / `key='kaneo_workspace_id'` are renamed to the namespaced keys (value preserved, primary key `(user_id, key)` respected, idempotent re-run safe). Use the migration-test idiom from existing `tests/db/migrations/*` (or `tests/` DB helpers).

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/db/migrations/048_namespace_kaneo_config.test.ts`. Expected: FAIL — migration does not exist.

- [ ] **Step 4: Implement the migration**

Create `src/db/migrations/048_namespace_kaneo_config.ts` (template: `042_user_workspace_config_backfill.ts`). `user_config` columns are `(user_id, key, value)`; PK is `(user_id, key)`:

```typescript
import type { Migration } from '../migrate.js'

export const migration048NamespaceKaneoConfig: Migration = {
  id: '048_namespace_kaneo_config',
  up(db) {
    db.run(
      `UPDATE OR IGNORE user_config SET key = 'plugin:task-provider-kaneo:provider:credential' WHERE key = 'kaneo_apikey'`,
    )
    db.run(
      `UPDATE OR IGNORE user_config SET key = 'plugin:task-provider-kaneo:provider:workspaceId' WHERE key = 'kaneo_workspace_id'`,
    )
  },
}
```

Register it in `src/db/index.ts` (import + add to the migrations array, in ascending order after 047). Confirm `validateOrder` passes.

- [ ] **Step 5: Retarget the flat-key readers/writers**

Define the two namespaced-key constants once and import them. Then:

- `plugins/task-provider-kaneo/provision.ts`: change every `kaneo_apikey`/`kaneo_workspace_id` read/write (incl. the Task 3.1 `setConfig(userId, KANEO_WORKSPACE_CONFIG_KEY, …)` write and the `getConfigValue(contextId, KANEO_WORKSPACE_CONFIG_KEY)` read) to the namespaced keys via `setConfigValue`/`getConfigValue` (namespaced keys are arbitrary strings, not typed `ConfigKey`).
- `src/wizard/steps.ts:61`: retarget the exclusion filter. **This is functional** — it excludes the auto-provisioned workspace field from wizard prompts; if not retargeted, the wizard would start prompting users for the workspaceId.
- `src/commands/setup.ts`: retarget the `isFirstTimeKaneoGroupSetup` read. **Functional** — drives the first-time-setup branch.

> The other flat-key lookups in `src/wizard/steps.ts` (`validateField` line 94, `BUILTIN_PROMPTS`, `displayLabelForKey`) are **cosmetic/validation** keyed by `field.storageKey`; under namespacing they fall back gracefully (generic prompt, generic non-empty validation, default label). Masking still works via `field.sensitive`. Retargeting them is optional polish, not required for correctness — do not let them block this task.

- [ ] **Step 6: Update affected tests** to seed/assert the namespaced keys.

- [ ] **Step 7: Run tests**

Run: `bun test tests/db/migrations/048_namespace_kaneo_config.test.ts tests/commands/setup.test.ts tests/plugins/task-provider-kaneo/ tests/wizard/`. Expected: PASS.

- [ ] **Step 8: Gate + commit**

Run `bun lint`, `bun typecheck`, `bun format:check`, then:

```bash
git add src/db/migrations/048_namespace_kaneo_config.ts src/db/index.ts src/types/config.ts src/wizard/steps.ts src/commands/setup.ts plugins/task-provider-kaneo/provision.ts tests/
git commit -m "feat(kaneo): migrate context credentials to plugin-namespaced config keys"
```

---

## Task 3.7: Remove the resolver's kaneo-`workspaceId` special-case

**Files:**

- Modify: `src/providers/resolver.ts`
- Modify: `tests/providers/resolver.test.ts`

- [ ] **Step 1: Invert the Task 3.1 regression test (now the generic namespaced path)**

The regression test added in Task 3.1 documents the still-live special-case (`getKaneoWorkspace` dep). After this task the special-case is gone and the workspaceId flows through `storageKeyForField`, which for a **plugin-contributed** kaneo descriptor (`source !== 'builtin'`) returns `plugin:task-provider-kaneo:provider:workspaceId` (resync decision 6 — the migration in Task 3.6a renamed the data accordingly).

Rewrite the test in `tests/providers/resolver.test.ts` to:

- construct/register a plugin-contributed kaneo descriptor (`source: { plugin: 'task-provider-kaneo' }`) — mock `getTaskProviderDescriptor` in deps or register via `registerContributedTaskProviderType` and unregister in `finally`;
- assert `resolve(...)` calls `getConfig(contextId, 'plugin:task-provider-kaneo:provider:workspaceId')` and `getConfig(contextId, 'plugin:task-provider-kaneo:provider:credential')`;
- assert the provider receives `config.workspaceId === '<value from that namespaced key>'`;
- remove the obsolete `getKaneoWorkspace`-dep assertions.

Run: `bun test tests/providers/resolver.test.ts`
Expected: FAIL until Step 2 deletes the special-case and the `getKaneoWorkspace` dep.

- [ ] **Step 2: Delete the special-case branch**

In `src/providers/resolver.ts`:

```typescript
// before
const readContextScopedField = (
  descriptor: TaskProviderTypeDescriptor,
  field: ProviderConfigField,
  contextId: string,
  deps: TaskProviderResolverDeps,
): string | null => {
  if (descriptor.type === 'kaneo' && field.key === 'workspaceId') return deps.getKaneoWorkspace(contextId)
  return deps.getConfig(contextId, storageKeyForField(descriptor, field))
}
// after
const readContextScopedField = (
  descriptor: TaskProviderTypeDescriptor,
  field: ProviderConfigField,
  contextId: string,
  deps: TaskProviderResolverDeps,
): string | null => deps.getConfig(contextId, storageKeyForField(descriptor, field))
```

Drop the `getKaneoWorkspace` field from `TaskProviderResolverDeps` and the import of `getKaneoWorkspace` from `../users.js`.

- [ ] **Step 3: Update construction sites of `TaskProviderResolver`**

`src/index.ts` (and any other production caller) constructs `TaskProviderResolver` with `getKaneoWorkspace: getKaneoWorkspace`. Delete that field. The default deps object inside `resolver.ts` (if present) drops it too.

- [ ] **Step 4: Run the resolver tests**

Run: `bun test tests/providers/resolver.test.ts`
Expected: PASS — the workspaceId regression test still passes, all other resolver tests untouched.

- [ ] **Step 5: Commit**

```bash
git add src/providers/resolver.ts src/index.ts tests/providers/resolver.test.ts
git commit -m "refactor(providers): drop resolver kaneo-workspaceId special case"
```

---

## Task 3.8: Rewrite `src/instances/bootstrap.ts` to drop task-instance seeding

**Files:**

- Modify: `src/instances/bootstrap.ts`
- Modify: `src/instances/types.ts`
- Modify: `src/index.ts`
- Modify: `tests/instances/bootstrap.test.ts`

- [ ] **Step 1: Update the test to assert task-instance seeding no longer occurs**

In `tests/instances/bootstrap.test.ts`, replace tests that assert a task instance is seeded with these:

```typescript
test('bootstrap does not read TASK_PROVIDER or task env vars', () => {
  // Pre-condition: empty DB; set chat + admin env only.
  setEnv({ CHAT_PROVIDER: 'telegram', TELEGRAM_BOT_TOKEN: 'tg', ADMIN_USER_ID: '1' })
  setEnv({ TASK_PROVIDER: 'kaneo', KANEO_CLIENT_URL: 'https://kaneo.invalid' })

  const result = bootstrapInstancesFromEnv()
  expect(result).toMatchObject({ bootstrapped: true, platformInstanceId: 'telegram-default' })
  expect(result).not.toHaveProperty('taskInstanceId')
  expect(getDrizzleDb().select().from(taskInstances).all()).toHaveLength(0)
})

test('bootstrap accepts a deployment with no task env vars set', () => {
  setEnv({ CHAT_PROVIDER: 'telegram', TELEGRAM_BOT_TOKEN: 'tg', ADMIN_USER_ID: '1' })
  const result = bootstrapInstancesFromEnv()
  expect(result.bootstrapped).toBe(true)
})
```

Delete tests that asserted `TASK_PROVIDER` was a required env var.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/instances/bootstrap.test.ts`
Expected: FAIL — bootstrap still seeds task instances and rejects when `TASK_PROVIDER` is missing.

- [ ] **Step 3: Rewrite `bootstrap.ts`**

In `src/instances/bootstrap.ts`:

- Delete `TASK_ENV_REQUIREMENTS`, `parseTaskType`, `buildTaskConfig`.
- Delete the `TaskInstance` insert from `seedInstances` and remove `taskInstanceId` from its return type.
- Delete `taskType` from `ParsedEnv` and `collectMissing`.
- Remove `'TASK_PROVIDER'` from required-env logging.

Result skeleton (verify against the existing file):

```typescript
const seedInstances = (chatType: PlatformInstanceType, adminUserId: string): { platformInstanceId: string } => {
  const platformInstanceId = `${chatType}-default`
  const sqlite = getDrizzleDb().$client
  const tx = sqlite.transaction(() => {
    insertPlatformInstance({
      id: platformInstanceId,
      type: chatType,
      config: buildPlatformConfig(chatType),
      status: 'active',
    })
    addAdmin(adminUserId, SUPER_ADMIN_PLATFORM_ID)
    addAdmin(adminUserId, platformInstanceId)
  })
  tx()
  return { platformInstanceId }
}
```

In `src/instances/types.ts`:

- Delete `BuiltinTaskType` and any references to it.
- `BootstrapResult` (success variant): drop the `taskInstanceId` field.

- [ ] **Step 4: Update `src/index.ts` startup log**

The startup log line that announces seeded task instance ID is updated to mention only the platform instance (or removed if redundant with the `bootstrapInstancesFromEnv` internal log).

- [ ] **Step 5: Run tests**

Run: `bun test tests/instances/bootstrap.test.ts tests/instances/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/instances/bootstrap.ts src/instances/types.ts src/index.ts tests/instances/bootstrap.test.ts
git commit -m "refactor(instances): drop task-instance env bootstrap"
```

---

## Task 3.9: Startup `WARN` for unapproved providers referenced by `task_instances`

**Files:**

- Create: `src/instances/health.ts`
- Modify: `src/index.ts`
- Test: `tests/instances/health.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/instances/health.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { warnUnresolvedTaskInstances } from '../../src/instances/health.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'

describe('warnUnresolvedTaskInstances', () => {
  test('logs a WARN with /plugin approve commands for unregistered types', async () => {
    await setupTestDb()
    insertTaskInstance({ id: 'k-1', type: 'kaneo', config: { baseUrl: 'x' }, status: 'active' })
    const { warns } = mockLogger()
    warnUnresolvedTaskInstances()
    const message = warns.map((entry) => entry.msg).join('\n')
    expect(message).toContain('task-provider-kaneo')
    expect(message).toContain('/plugin approve')
  })

  test('emits nothing when every type has an active provider', async () => {
    await setupTestDb()
    insertTaskInstance({ id: 'k-1', type: 'kaneo', config: { baseUrl: 'x' }, status: 'active' })
    // Register a stub so the registry resolves kaneo.
    registerContributedTaskProviderType('kaneo', {
      pluginId: 'task-provider-kaneo',
      factory: () => createMockProvider(),
      capabilities: new Set(),
      displayName: 'Kaneo',
      instanceConfigSchema: [],
      contextConfigSchema: [],
    })
    const { warns } = mockLogger()
    warnUnresolvedTaskInstances()
    expect(warns).toHaveLength(0)
    unregisterContributedTaskProviderType('task-provider-kaneo')
  })
})
```

> Replace `createMockProvider` and registry helper imports with the matching helpers from `tests/utils/test-helpers.ts` / `src/providers/registry.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/instances/health.test.ts`
Expected: FAIL — `src/instances/health.ts` does not exist.

- [ ] **Step 3: Implement `warnUnresolvedTaskInstances`**

Create `src/instances/health.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getAllTaskInstances } from './task-store.js'
import { getTaskProviderDescriptor } from '../providers/registry.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'instances:health' })

/** Map of task-instance type → expected plugin id (kept tiny for the two migrated providers). */
const KNOWN_PLUGIN_FOR_TYPE: Readonly<Record<string, string>> = {
  kaneo: 'task-provider-kaneo',
  youtrack: 'task-provider-youtrack',
}

const pluginIdFor = (type: string): string =>
  KNOWN_PLUGIN_FOR_TYPE[type] ?? `(provider plugin contributing type '${type}')`

export function warnUnresolvedTaskInstances(): void {
  const instances = getAllTaskInstances()
  const offenders = instances.filter((instance) => getTaskProviderDescriptor(instance.type) === undefined)
  if (offenders.length === 0) return

  const types = [...new Set(offenders.map((instance) => instance.type))]
  const commands = types.map((type) => `/plugin approve ${pluginIdFor(type)}`)
  log.warn(
    { unresolvedTypes: types, instanceIds: offenders.map((instance) => instance.id) },
    `Found ${offenders.length} task_instances row(s) whose provider plugin is not active. Run: ${commands.join('; ')}`,
  )
}
```

> `KNOWN_PLUGIN_FOR_TYPE` is a small static table because contributed-plugin discovery happens before this call; it's used only for nicer messaging when a type lacks any descriptor. If a type isn't in the table, the message degrades gracefully.

- [ ] **Step 4: Invoke from `src/index.ts`**

After plugin activation completes (search for the existing `pluginRegistry.load()` or `activatePlugins()` call), add:

```typescript
import { warnUnresolvedTaskInstances } from './instances/health.js'
// ...after plugin activation...
warnUnresolvedTaskInstances()
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/instances/health.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/instances/health.ts src/index.ts tests/instances/health.test.ts
git commit -m "feat(instances): warn at startup about unresolvable task provider plugins"
```

---

## Task 3.10: Delete `getKaneoWorkspace` / `setKaneoWorkspace` / workspace cache

**Files:**

- Modify: `src/users.ts`
- Modify: `src/cache.ts`
- Modify: tests that mocked the deleted helpers (residue from Task 3.1's audit).

- [ ] **Step 1: Confirm no remaining callers**

Run: `grep -rn "getKaneoWorkspace\|setKaneoWorkspace" src/ tests/ plugins/`
Expected: zero matches. If any remain, retarget them now (Task 3.1's audit should have caught all of them — investigate before deleting).

- [ ] **Step 2: Delete the helpers**

In `src/users.ts`, delete `getKaneoWorkspace`, `setKaneoWorkspace`, and the `getCachedWorkspace`/`setCachedWorkspace` imports.

In `src/cache.ts`, delete `getCachedWorkspace`, `setCachedWorkspace`, and the workspace cache table reference if it's a cache-only table. Leave the `users.kaneo_workspace_id` DB column alone — its drop is a follow-on migration outside this plan.

- [ ] **Step 3: Run the full suite to confirm nothing else broke**

Run: `bun test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/users.ts src/cache.ts tests/
git commit -m "refactor(kaneo): delete dead getKaneoWorkspace/setKaneoWorkspace helpers"
```

---

## Task 3.11: Unresolvable-instance label on `/admin#instances`

**Files:**

- Modify: `src/debug/instance-routes.ts` — extend `maskedTaskInstance` with `unresolvedReason`.
- Modify: `client/shared/api-types.ts` — `TaskInstanceView` gains `unresolvedReason: string | null`.
- Modify: `client/admin/instance-fetcher-schemas.ts` — schema mirrors the field.
- Modify: `client/admin/sections/InstancesSection.svelte` — render the label when non-null.
- Test: `tests/debug/instance-routes.test.ts` and `tests/client/admin/sections/InstancesSection.test.ts`.

- [ ] **Step 1: Write the failing server test**

Add to `tests/debug/instance-routes.test.ts`:

```typescript
test('GET /api/task-instances marks rows whose provider plugin is not active', async () => {
  insertTaskInstance({ id: 'k-1', type: 'kaneo', config: { baseUrl: 'x' }, status: 'active' })
  const res = expectResponse(await route('/api/task-instances'))
  const body = (await res.json()) as Array<{ id: string; unresolvedReason: string | null }>
  const row = body.find((entry) => entry.id === 'k-1')
  expect(row?.unresolvedReason).toMatch(/plugin not active/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/instance-routes.test.ts`
Expected: FAIL — `unresolvedReason` is not in the response.

- [ ] **Step 3: Implement on the server**

In `src/debug/instance-routes.ts`, change `maskedTaskInstance` (or its caller) to compute `unresolvedReason`:

```typescript
import { getTaskProviderDescriptor } from '../providers/registry.js'

const unresolvedReasonFor = (instance: TaskInstance): string | null => {
  if (getTaskProviderDescriptor(instance.type) !== undefined) return null
  return `Provider plugin for type '${instance.type}' is not active. Run /plugin approve.`
}

const maskedTaskInstance = (instance: TaskInstance) => ({
  // ...existing fields...
  unresolvedReason: unresolvedReasonFor(instance),
})
```

- [ ] **Step 4: Update client schema and view type**

In `client/shared/api-types.ts` add to `TaskInstanceView`:

```typescript
readonly unresolvedReason: string | null
```

In `client/admin/instance-fetcher-schemas.ts`, extend `TaskInstanceViewSchema` with `unresolvedReason: z.string().nullable()`.

- [ ] **Step 5: Render the label in the Svelte section**

In `client/admin/sections/InstancesSection.svelte`, in the task-instance row render, add:

```svelte
{#if instance.unresolvedReason}
  <span data-testid={`task-instance-unresolved-${instance.id}`} class="unresolved-label">
    {instance.unresolvedReason}
  </span>
{/if}
```

Add scoped CSS for `.unresolved-label` (matching existing instance-section styling).

- [ ] **Step 6: Write the failing client test**

Add to `tests/client/admin/sections/InstancesSection.test.ts`:

```typescript
test('shows unresolved label when a task instance has no active provider plugin', async () => {
  // Extend the existing mock router responseFor so /api/task-instances returns an instance with unresolvedReason.
  // Then assert the data-testid `task-instance-unresolved-kaneo-main` element exists.
})
```

Fill in the test body matching the file's mock-router idiom.

- [ ] **Step 7: Run tests**

Run: `bun test tests/debug/instance-routes.test.ts && bun test:client tests/client/admin/sections/InstancesSection.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/debug/instance-routes.ts client/shared/api-types.ts client/admin/instance-fetcher-schemas.ts client/admin/sections/InstancesSection.svelte tests/debug/instance-routes.test.ts tests/client/admin/sections/InstancesSection.test.ts
git commit -m "feat(admin): label task instances whose provider plugin is not active"
```

---

## Task 3.12: E2E harness — approve the Kaneo plugin in setup

**Files:**

- Modify: `tests/e2e/bun-test-setup.ts`

- [ ] **Step 1: Locate the existing E2E bootstrap path**

In `tests/e2e/bun-test-setup.ts`, find where the Kaneo Docker harness wires `task_instances` (likely in a `beforeAll` or fixture helper). Before the bot starts, the plugin must be approved or the resolver returns null.

- [ ] **Step 2: Add the approval call**

```typescript
import { pluginRegistry } from '../../src/plugins/registry.js'
// ...inside the existing setup, after migrations run and before the bot starts:
await pluginRegistry.discoverAll()
const kaneoEntry = pluginRegistry.get('task-provider-kaneo')
if (kaneoEntry !== undefined) {
  pluginRegistry.approve('task-provider-kaneo', 'e2e-setup', kaneoEntry.discoveredPlugin.manifestHash)
  await pluginRegistry.activateApproved()
}
```

> Use the exact `pluginRegistry` API surface that the production startup uses. If it differs, mirror the production sequence rather than constructing a parallel path.

- [ ] **Step 3: Run E2E**

Run: `bun test:e2e`
Expected: PASS. (Slow; allow up to 10 minutes.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/bun-test-setup.ts
git commit -m "test(e2e): approve task-provider-kaneo plugin in setup"
```

---

## Task 3.13: Documentation updates for Phase 3

**Files:**

- Modify: `CLAUDE.md`
- Modify: `src/providers/CLAUDE.md`
- Modify: `docs/plugins/developer-guide.md`

- [ ] **Step 1: `CLAUDE.md`**

Remove `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL` from the "Required Environment Variables" section. Add a short paragraph:

> **Removed env vars (Phase 3 of task-provider migration):** `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL` are no longer read at first-run bootstrap. Create task instances via `/admin#instances` and run `/plugin approve task-provider-kaneo` after deploying.

- [ ] **Step 2: `src/providers/CLAUDE.md`**

Update to reflect plugin-only registration: `createProvider` only delegates to contributed factories; no more built-in factory map for Kaneo. Reference `plugins/task-provider-kaneo/` as the canonical example. (YouTrack still appears as a built-in until Phase 4; flag this with a note.)

- [ ] **Step 3: `docs/plugins/developer-guide.md`**

Add a "Provider plugins (worked example: Kaneo)" section. Show the manifest snippet, the entry-point factory, the `validateConfig` shape, and the `papai/plugin-types` import alias. Keep it tight — link to `plugins/task-provider-kaneo/` for the full source.

- [ ] **Step 4: Verify docs format checks pass**

Run: `bun format:check`
Expected: PASS (no italic-vs-snake_case mangling — use bold for emphasis next to identifiers).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md src/providers/CLAUDE.md docs/plugins/developer-guide.md
git commit -m "docs(plugins): document Phase 3 Kaneo migration"
```

---

## Phase 3 final verification

- [ ] **Run the full check suite**

Run: `bun check:verbose`
Expected: lint, typecheck, format, knip, tests, duplicates — all PASS.

- [ ] **Confirm Phase 3 invariants**

```bash
# No remaining Kaneo source in src/.
test -d src/providers/kaneo && echo "FAIL: src/providers/kaneo still exists" || echo "OK"
# Kaneo lives in plugins/.
test -f plugins/task-provider-kaneo/plugin.json && echo "OK" || echo "FAIL: plugin not present"
# Resolver has no kaneo-specific branch.
grep -n "descriptor.type === 'kaneo'" src/providers/resolver.ts && echo "FAIL: special case still present" || echo "OK"
# Bootstrap drops task vars.
grep -nE "TASK_PROVIDER|KANEO_CLIENT_URL|YOUTRACK_URL" src/instances/bootstrap.ts && echo "FAIL" || echo "OK"
# Workspace dual-store is single-sourced.
grep -rn "getKaneoWorkspace\|setKaneoWorkspace" src/ tests/ plugins/ && echo "FAIL: residual workspace helpers" || echo "OK"
# Kaneo credentials are namespaced (resync decision 6): no flat kaneo key reads/writes outside the migration.
grep -rn "kaneo_apikey\|kaneo_workspace_id" src/ plugins/ | grep -v "048_namespace_kaneo_config" | grep -v "types/config.ts" && echo "FAIL: residual flat kaneo keys" || echo "OK"
# The namespaced migration is registered.
grep -n "048_namespace_kaneo_config" src/db/index.ts && echo "OK" || echo "FAIL: migration not registered"
```

All checks should print `OK`.

- [ ] **PR description**

Reference: spec `docs/superpowers/specs/2026-05-28-task-provider-plugin-phases-3-to-5-design.md` §Phase 3. Call out the §3.6 audit explicitly: link the `/tmp/kaneo-workspace-audit.txt` content from Task 3.1 Step 1 in the PR body so reviewers can verify the audit was exhaustive.

---

# Phase 4 — YouTrack Migration

Phase 4 mirrors Phase 3 with three simplifications: no workspaceId dual-store, no bootstrap rewrite (Phase 3 already did it for both providers), no resolver special-case to delete.

## Task 4.1: Scaffold `plugins/task-provider-youtrack/`

**Files:**

- Create: `plugins/task-provider-youtrack/plugin.json`
- Create: `plugins/task-provider-youtrack/index.ts`
- Create: `plugins/task-provider-youtrack/validate-config.ts`
- Test: `tests/plugins/task-provider-youtrack/manifest.test.ts`

- [ ] **Step 1: Write the failing manifest test**

Mirror Task 3.2 Step 1, adjusting expectations for YouTrack: `taskProviderTypes: ['youtrack']`, instance-scoped `baseUrl` only in `providerConfigSchema`, context-scoped `token` in `providerContextConfigSchema` (no `storageKey` — the runtime key is `plugin:task-provider-youtrack:provider:token`).

- [ ] **Step 2: Create the manifest**

```json
{
  "id": "task-provider-youtrack",
  "name": "YouTrack",
  "version": "1.0.0",
  "description": "YouTrack task-tracker integration.",
  "apiVersion": 1,
  "permissions": ["provider.task", "identity"],
  "contributes": {
    "taskProviderTypes": ["youtrack"]
  },
  "providerCapabilities": [],
  "providerConfigSchema": [
    { "key": "baseUrl", "label": "YouTrack URL", "required": true, "sensitive": false, "scope": "instance" }
  ],
  "providerContextConfigSchema": [
    { "key": "token", "label": "YouTrack Permanent Token", "required": true, "sensitive": true, "scope": "context" }
  ],
  "providerAllowedHosts": [],
  "providerConfigValidator": "validateConfig",
  "defaultEnabled": false
}
```

> **Resync note (decision 6):** instance field in `providerConfigSchema`, context field in `providerContextConfigSchema`, **no `storageKey`**. camelCase `baseUrl` requires Task 3.1a (landed in Phase 3). The runtime storage key is `plugin:task-provider-youtrack:provider:token`; the flat `youtrack_token` rows are renamed by the Phase 4 migration (Task 4.5a).

- [ ] **Step 3: Create the entry-point and validator shells**

Same shape as Task 3.2 Steps 4–5, substituting `task-provider-youtrack`.

- [ ] **Step 4: Run the manifest test**

Run: `bun test tests/plugins/task-provider-youtrack/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/task-provider-youtrack/ tests/plugins/task-provider-youtrack/
git commit -m "feat(plugins): scaffold task-provider-youtrack manifest and entry shell"
```

---

## Task 4.2: Move YouTrack source modules into the plugin

Mirror Task 3.3 for `src/providers/youtrack/*` → `plugins/task-provider-youtrack/*`.

- [ ] **Step 1: `git mv` source files**

```bash
git ls-files src/providers/youtrack/*.ts | while read -r f; do
  target="plugins/task-provider-youtrack/$(basename "$f")"
  git mv "$f" "$target"
done
git mv src/providers/youtrack/operations plugins/task-provider-youtrack/operations
git mv src/providers/youtrack/schemas plugins/task-provider-youtrack/schemas
git mv plugins/task-provider-youtrack/index.ts plugins/task-provider-youtrack/provider.ts
```

- [ ] **Step 2: Retarget imports** — same `sed` sweep as Task 3.3 Step 3, scoped to `plugins/task-provider-youtrack/`.

- [ ] **Step 3: Replace deep imports with `papai/plugin-types`** — same as Task 3.3 Step 4.

- [ ] **Step 4: Typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A plugins/task-provider-youtrack/ src/providers/youtrack/
git commit -m "refactor(youtrack): move provider source into plugins/task-provider-youtrack"
```

---

## Task 4.3: Move YouTrack tests

Mirror Task 3.4 for `tests/providers/youtrack/*` → `tests/plugins/task-provider-youtrack/*`. Retarget relative imports as in Task 3.4 Step 3. Run the moved suite. Commit:

```bash
git add -A tests/providers/youtrack/ tests/plugins/task-provider-youtrack/
git commit -m "refactor(youtrack): move tests under tests/plugins/task-provider-youtrack"
```

---

## Task 4.4: Wire YouTrack factory and validator

**Files:**

- Modify: `plugins/task-provider-youtrack/index.ts`
- Modify: `plugins/task-provider-youtrack/validate-config.ts`
- Modify: `plugins/task-provider-youtrack/plugin.json` (populate `providerCapabilities`)
- Test: `tests/plugins/task-provider-youtrack/activation.test.ts`

- [ ] **Step 1: Write the activation test** mirroring Task 3.5 Step 1, asserting `task-provider-youtrack` registers `youtrack` and the factory produces a provider with `name === 'youtrack'`.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Replace the factory stub:**

```typescript
import type { PluginContext, TaskProvider } from 'papai/plugin-types'
import { YouTrackProvider } from './provider.js'
import { validateConfig } from './validate-config.js'

export default () => ({
  activate(ctx: PluginContext) {
    ctx.registration.registerTaskProviderType('youtrack', {
      factory: (config): TaskProvider => new YouTrackProvider({ baseUrl: config.baseUrl, token: config.token }),
      validateConfig,
    })
  },
})
```

- [ ] **Step 4: Populate `providerCapabilities`** from `plugins/task-provider-youtrack/constants.ts` (`YOUTRACK_CAPABILITIES`), as in Task 3.5 Step 4.

- [ ] **Step 5: Wire `validateConfig`** with a YouTrack healthcheck (smallest authenticated call available, e.g. `/api/admin/users/me`).

- [ ] **Step 6: Run tests, commit:**

```bash
git add plugins/task-provider-youtrack/ tests/plugins/task-provider-youtrack/
git commit -m "feat(plugins): wire task-provider-youtrack factory and validateConfig"
```

---

## Task 4.5: Remove inline `createYouTrackProvider` and youtrack built-in descriptor

Mirror Task 3.6 for YouTrack:

- Update `tests/providers/registry.test.ts` to assert `youtrack` is not a built-in.
- Delete the `'youtrack'` entry from the `providers` map and the YouTrack imports in `src/providers/registry.ts`.
- Delete the youtrack entry from `builtinDescriptorSeeds` in `src/providers/builtin-descriptors.ts`. The seeds array is now empty; either delete it entirely or keep as a documented empty placeholder.
- Run tests, commit:

```bash
git add src/providers/registry.ts src/providers/builtin-descriptors.ts tests/providers/registry.test.ts
git commit -m "refactor(providers): drop inline youtrack factory and built-in descriptor"
```

---

## Task 4.5a: Migrate YouTrack credentials to namespaced keys

**Why (resync decision 6):** mirrors Task 3.6a for YouTrack. This migration **must not** land before Task 4.5 removes the YouTrack builtin descriptor — while YouTrack is still a builtin, its descriptor reads the flat `youtrack_token` via `storageKey`, so renaming the key early would break it.

**Runtime key:** `plugin:task-provider-youtrack:provider:token` (was `youtrack_token`).

YouTrack has no auto-provisioning writer (the token is user-entered through the wizard, which namespaces it automatically once YouTrack is plugin-contributed), so this task is mostly the data rename plus an audit for any hardcoded flat-key reader.

**Files:**

- Create: `src/db/migrations/049_namespace_youtrack_config.ts`
- Modify: `src/db/index.ts` (register migration 049, ascending after 048)
- Test: `tests/db/migrations/049_namespace_youtrack_config.test.ts`

- [ ] **Step 1: Audit hardcoded `youtrack_token` readers/writers**

```bash
grep -rn "youtrack_token" src/ plugins/ | grep -v "049_namespace_youtrack_config"
```

Expected: only graceful-degradation wizard lookups (`src/wizard/steps.ts` `validateField`/`BUILTIN_PROMPTS`/`displayLabelForKey`, which fall back harmlessly when the storage key is namespaced) and `src/types/config.ts` (`TaskProviderConfigKey`). If a **functional** reader appears (one whose miss would break resolution or setup), retarget it and note it here.

- [ ] **Step 2: Write the failing migration test** — mirror Task 3.6a Step 2 for `youtrack_token` → `plugin:task-provider-youtrack:provider:token`.

- [ ] **Step 3: Run test, verify it fails.**

- [ ] **Step 4: Implement the migration**

```typescript
import type { Migration } from '../migrate.js'

export const migration049NamespaceYoutrackConfig: Migration = {
  id: '049_namespace_youtrack_config',
  up(db) {
    db.run(
      `UPDATE OR IGNORE user_config SET key = 'plugin:task-provider-youtrack:provider:token' WHERE key = 'youtrack_token'`,
    )
  },
}
```

Register in `src/db/index.ts`.

- [ ] **Step 5: Run tests, gate, commit**

```bash
git add src/db/migrations/049_namespace_youtrack_config.ts src/db/index.ts tests/
git commit -m "feat(youtrack): migrate context token to plugin-namespaced config key"
```

---

## Task 4.6: E2E + docs for YouTrack

- [ ] **Step 1: E2E setup** — extend `tests/e2e/bun-test-setup.ts` (or its YouTrack equivalent if separate) to approve `task-provider-youtrack`, following Task 3.12.

- [ ] **Step 2: `CLAUDE.md`** — remove `YOUTRACK_URL` from required env vars; update the "removed env vars" paragraph from Task 3.13 Step 1 to include it.

- [ ] **Step 3: `src/providers/CLAUDE.md`** — drop the YouTrack-as-built-in note; both providers are now plugin-contributed.

- [ ] **Step 4: `docs/plugins/developer-guide.md`** — optional: add a comparison snippet showing YouTrack's smaller config schema next to Kaneo's. Only if it improves the guide.

- [ ] **Step 5: Commit:**

```bash
git add CLAUDE.md src/providers/CLAUDE.md docs/plugins/developer-guide.md tests/e2e/
git commit -m "docs(plugins): document Phase 4 YouTrack migration"
```

---

## Phase 4 final verification

- [ ] **`bun check:verbose`** — all green.
- [ ] **Invariant checks:**

```bash
test -d src/providers/youtrack && echo "FAIL" || echo "OK"
test -f plugins/task-provider-youtrack/plugin.json && echo "OK" || echo "FAIL"
grep -n "createYouTrackProvider" src/providers/registry.ts && echo "FAIL" || echo "OK"
grep -nE "YOUTRACK_URL" src/ && echo "FAIL" || echo "OK"
```

All should print `OK`.

---

# Phase 5 — Retire Vestigial Back-Compat Fields

Phase 5 lands strictly after both Phase 3 and Phase 4. It is mechanical removal — every step is "delete an unused surface, audit callers, fix any straggler".

## Task 5.1: Drop `configSchema` from server serialization

**Files:**

- Modify: `src/debug/task-provider-type-routes.ts` (or wherever `taskProviderTypeView` lives).
- Modify: `tests/debug/instance-routes.test.ts`.

- [ ] **Step 1: Update the test**

In `tests/debug/instance-routes.test.ts`, change the catalog GET test to assert the response **does not** include a `configSchema` field — only `instanceConfigSchema` and `contextConfigSchema`.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Remove the `configSchema` field**

In `taskProviderTypeView` (Phase 2's view mapper), delete the `configSchema` field from the returned object.

- [ ] **Step 4: Run tests, commit:**

```bash
git add src/debug/task-provider-type-routes.ts tests/debug/instance-routes.test.ts
git commit -m "refactor(admin): drop legacy configSchema from task-provider-type view"
```

---

## Task 5.2: Drop `configSchema` from client view + schema

**Files:**

- Modify: `client/shared/api-types.ts`
- Modify: `client/admin/instance-fetcher-schemas.ts`
- Modify: `tests/client/admin/fetchers.test.ts`

- [ ] **Step 1: Update fetcher tests** to drop `configSchema` from the mocked response object.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Remove the field**

In `client/shared/api-types.ts`, remove `configSchema` from `TaskProviderTypeView`. In `client/admin/instance-fetcher-schemas.ts`, remove it from `TaskProviderTypeViewSchema`.

- [ ] **Step 4: Run tests, commit:**

```bash
git add client/shared/api-types.ts client/admin/instance-fetcher-schemas.ts tests/client/admin/fetchers.test.ts
git commit -m "refactor(admin-client): drop legacy configSchema from TaskProviderTypeView"
```

---

## Task 5.3: `InstancesSection.svelte` sources from `instanceConfigSchema` only

**Files:**

- Modify: `client/admin/sections/InstancesSection.svelte`
- Modify: `tests/client/admin/sections/InstancesSection.test.ts`

- [ ] **Step 1: Verify the component already uses `instanceConfigSchema`**

The Phase 2 plan (Task 6) already wired `selectedTaskType?.configSchema`. After Task 5.2 deletes that field, the component must read `selectedTaskType?.instanceConfigSchema` instead.

- [ ] **Step 2: Update the component**

Replace every `selectedTaskType?.configSchema ?? []` with `selectedTaskType?.instanceConfigSchema ?? []`.

- [ ] **Step 3: Update tests**

Mock responses should already carry `instanceConfigSchema`/`contextConfigSchema`. If a test fixture still uses `configSchema`, update it.

- [ ] **Step 4: Run client tests:**

Run: `bun test:client tests/client/admin/sections/InstancesSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit:**

```bash
git add client/admin/sections/InstancesSection.svelte tests/client/admin/sections/InstancesSection.test.ts
git commit -m "refactor(admin-client): source instance form from instanceConfigSchema"
```

---

## Task 5.4: Delete `TaskProviderTypeDescriptor.configSchema` + `legacyConfigSchema`

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `tests/providers/registry.test.ts`

- [ ] **Step 1: Update tests** — drop any assertion against `descriptor.configSchema`. Tests should already assert `instanceConfigSchema`/`contextConfigSchema` post-prerequisites; tighten any leftover.

- [ ] **Step 2: Remove the field and helper**

In `src/providers/registry.ts`:

- Delete the `configSchema` field from `TaskProviderTypeDescriptor`.
- Delete the `legacyConfigSchema` helper.
- In `listTaskProviderTypes()`, drop the `configSchema: legacyConfigSchema(descriptor)` write and the spread that adds it back. The descriptor builds purely from `instanceConfigSchema`/`contextConfigSchema`.

- [ ] **Step 3: Verify typecheck:**

Run: `bun typecheck`
Expected: PASS. Any caller still touching `descriptor.configSchema` errors loudly — fix at that callsite.

- [ ] **Step 4: Run tests, commit:**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "refactor(providers): drop legacy descriptor.configSchema and helper"
```

---

## Task 5.5: Drop `ContributedTaskProviderEntry.configSchema` fallback

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `src/plugins/context.ts` (the registration call must pass `instanceConfigSchema`/`contextConfigSchema` explicitly).
- Modify: `tests/providers/registry.test.ts`, `tests/plugins/context.test.ts`.

- [ ] **Step 1: Update tests** to register contributed entries with `instanceConfigSchema`/`contextConfigSchema` only.

- [ ] **Step 2: Tighten the type**

In `ContributedTaskProviderEntry`, replace the optional `configSchema?` with required `instanceConfigSchema` and `contextConfigSchema`. Delete the fallback branches in `contributedInstanceFields`/`contributedContextFields`.

- [ ] **Step 3: Update `src/plugins/context.ts`**

In `buildRegisterTaskProviderType`, split the manifest's `providerConfigSchema` by `scope` and pass `instanceConfigSchema` + `contextConfigSchema` to `registerContributedTaskProviderType`. Remove the `configSchema` field.

```typescript
const instanceConfigSchema = manifest.providerConfigSchema.filter((field) => field.scope === 'instance')
const contextConfigSchema = manifest.providerConfigSchema.filter((field) => field.scope === 'context')
registerContributedTaskProviderType(type, {
  pluginId: manifest.id,
  factory: descriptor.factory,
  capabilities: new Set(manifest.providerCapabilities),
  displayName: manifest.name,
  instanceConfigSchema,
  contextConfigSchema,
  validateConfig: descriptor.validateConfig,
})
```

- [ ] **Step 4: Run tests, commit:**

```bash
git add src/providers/registry.ts src/plugins/context.ts tests/
git commit -m "refactor(providers): require scope-split schemas on contributed entries"
```

---

## Task 5.6: Remove `TaskProvider.configRequirements` interface field

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `plugins/task-provider-kaneo/provider.ts`
- Modify: `plugins/task-provider-youtrack/provider.ts`
- Modify: any test mocks (`tests/utils/mock-provider.ts` and friends).

- [ ] **Step 1: Update mock providers**

In `tests/utils/mock-provider.ts` (the `createMockProvider` helper), delete the `configRequirements` property.

- [ ] **Step 2: Remove the field from the interface**

In `src/providers/types.ts`, delete `readonly configRequirements: readonly ProviderConfigRequirement[]` from `TaskProvider`.

- [ ] **Step 3: Remove the implementation in plugin classes**

In `plugins/task-provider-kaneo/provider.ts` (the moved `KaneoProvider` class), delete the `readonly configRequirements = CONFIG_REQUIREMENTS` property and its `CONFIG_REQUIREMENTS` constant if unused elsewhere.

Same for `plugins/task-provider-youtrack/provider.ts`.

- [ ] **Step 4: Typecheck**

Run: `bun typecheck`
Expected: PASS. Any straggler caller is a real bug — fix at the callsite.

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 6: Commit:**

```bash
git add src/providers/types.ts plugins/task-provider-kaneo/provider.ts plugins/task-provider-youtrack/provider.ts tests/utils/mock-provider.ts tests/
git commit -m "refactor(providers): drop legacy TaskProvider.configRequirements"
```

---

## Task 5.7: Drop dead re-exports from `papai/plugin-types`

**Files:**

- Modify: `src/providers/public-types.ts`

- [ ] **Step 1: Audit consumers of `ProviderConfigRequirement` and `ProviderConfigField`**

```bash
grep -rn "ProviderConfigRequirement" src/ plugins/ tests/
grep -rn "ProviderConfigField" src/ plugins/ tests/
```

- [ ] **Step 2: Drop unused re-exports**

If `ProviderConfigRequirement` has zero consumers post-Task-5.6, remove it from the `src/providers/public-types.ts` re-export list. Leave `ProviderConfigField` (still used by descriptors).

- [ ] **Step 3: Run knip + typecheck:**

Run: `bun knip && bun typecheck`
Expected: PASS, no unused-export warnings.

- [ ] **Step 4: Commit:**

```bash
git add src/providers/public-types.ts
git commit -m "refactor(public-types): drop unused ProviderConfigRequirement re-export"
```

---

## Phase 5 final verification

- [ ] **Full gate:**

Run: `bun check:verbose`
Expected: lint, typecheck, format, knip, tests, duplicates — all PASS.

- [ ] **Invariant checks:**

```bash
grep -n "configRequirements" src/providers/types.ts && echo "FAIL" || echo "OK"
grep -nE "configSchema:" src/providers/registry.ts && echo "FAIL" || echo "OK"
grep -nE "legacyConfigSchema" src/providers/registry.ts && echo "FAIL" || echo "OK"
grep -n "configSchema" client/shared/api-types.ts && echo "FAIL" || echo "OK"
```

All should print `OK`.

- [ ] **Confirm one-and-only-one registration path**

```bash
# providers map should be empty (or removed entirely).
grep -nE "^const providers" src/providers/registry.ts
```

Expected: either the constant is gone, or it's an empty `Map` initialized purely for the contributed-only API surface. `createProvider` resolves only through `pluginContributedTaskProviderFactories`.

---

# Final Verification (all phases)

- [ ] **Cross-phase smoke**

Run: `bun check:verbose && bun test:e2e`
Expected: all green.

- [ ] **Confirm public surface**

```bash
# Plugin sources exist and tests live alongside.
ls plugins/task-provider-kaneo plugins/task-provider-youtrack
ls tests/plugins/task-provider-kaneo tests/plugins/task-provider-youtrack

# src/providers/ has no provider-specific source.
ls src/providers/  # expected: CLAUDE.md, builtin-descriptors.ts (empty seeds — or removed), domain-types.ts, errors.ts, public-types.ts, registry.ts, resolver.ts, task-capability.ts, types.ts
```

- [ ] **PR & release notes checklist**

The release notes for the version that ships these phases must include:

```
## Action required after upgrade

- Run `/plugin approve task-provider-kaneo` (DM, super admin) if your deployment uses Kaneo.
- Run `/plugin approve task-provider-youtrack` if your deployment uses YouTrack.
- Until approved, affected contexts reply "needs /setup".

## Removed environment variables

- `TASK_PROVIDER`, `KANEO_CLIENT_URL`, `KANEO_INTERNAL_URL`, `YOUTRACK_URL` are no longer read at first-run bootstrap. Task instances are created exclusively via `/admin#instances`.
```

---

## Self-Review Notes (author)

- **Spec coverage:** Phase 3 §3.1 (layout), §3.2 (manifest), §3.3 (factory), §3.4 (core deletions), §3.5 (bootstrap), §3.6 (workspaceId), §3.7 (trust note → documented in Task 3.5 manifest defaults), §3.8 (startup WARN + label), §3.9 (docs), §3.10 (tests) — all mapped to tasks. Phase 4 §4 delta — Tasks 4.1–4.6 cover. Phase 5 §5.1 (removals), §5.2 (audit), §5.3 (ordering) — Tasks 5.1–5.7 cover in the spec's ordering.
- **No placeholders:** every step shows code or exact commands. The `sed` sweeps in Tasks 3.3 and 4.2 are the largest risk for missed edges; both tasks include a grep-guard step.
- **Type consistency:** `ContributedTaskProviderEntry` field names (`instanceConfigSchema`, `contextConfigSchema`) match the prerequisites code; `getTaskProviderDescriptor` / `getContributedTaskProviderType` / `unregisterContributedTaskProviderType` are spelled as in `src/providers/registry.ts`.
- **TDD throughout:** every task starts with a failing test and ends with a verifying run. The bulk-move tasks (3.3, 3.4, 4.2, 4.3) lean on the existing Kaneo/YouTrack test suites as the verification harness rather than authoring new tests for the moves themselves — appropriate for mechanical refactors.
- **Open audit (spec §3.6):** captured as Task 3.1 with a documented grep-snapshot step (`/tmp/kaneo-workspace-audit.txt`) that surfaces every caller before retargeting begins; finishes with a grep-guard in Task 3.10.

---

## Drift Log

| Date       | Category                  | Item                                                                                                                                                                                                                             | Decision                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-05-29 | In-plan, accurate         | Task 3.1 — all 9 files, commit `35a8ece5`                                                                                                                                                                                        | Marked ✅ DONE (status banner). Verified against diff `64db128b..35a8ece5`. Resolver untouched; helpers retained for Task 3.10.                                                                                                                                                                        |
| 2026-05-29 | Out-of-plan, on-goal      | Plugin manifest schema rejects camelCase provider field keys (`configKeySchema` snake_case); blocks Task 3.2 manifest                                                                                                            | User approved (re-sync). Added **Task 3.1a** to relax provider field-key schema only.                                                                                                                                                                                                                  |
| 2026-05-29 | In-plan, stale approach   | Task 3.2 / 4.1 manifests used a unified `providerConfigSchema` with `storageKey`; shipped schema is split (`providerConfigSchema` instance + `providerContextConfigSchema` context) and ignores `storageKey`                     | Rewrote both manifests + manifest tests to split shape, camelCase keys, **no `storageKey`**.                                                                                                                                                                                                           |
| 2026-05-29 | In-plan, divergent (arch) | Resolver (`resolver.ts:37-40`) & wizard (`steps.ts:37-44`) namespace plugin provider config keys as `plugin:<id>:provider:<key>`, breaking reads of existing flat keys; spec §3.6 assumed flat `getConfig('kaneo_workspace_id')` | **User decision (AskUserQuestion, 2026-05-29): namespaced keys + data migration** (chose this over storageKey-aliasing). Added decision 6; added migration **Task 3.6a** (Kaneo, mig `048`) and **Task 4.5a** (YouTrack, mig `049`); rewrote Task 3.7's regression test to assert the namespaced path. |
| 2026-05-29 | In-plan, partial          | Task 3.7 Step 1 referenced a test name (`workspaceId from user_config`) that the Task 3.1 implementer named differently, and assumed flat-key assertion                                                                          | Rewrote Task 3.7 Step 1 to invert the Task 3.1 regression test toward the namespaced generic path.                                                                                                                                                                                                     |

**Consequences of the namespaced-keys + migration decision (vs the storageKey-aliasing alternative):** more files touched (two new migrations, provision/wizard/setup re-points), the rename runs against **live `user_config` data**, and the rename **must be sequenced per phase** (Kaneo in Phase 3 after its builtin is removed; YouTrack in Phase 4 — never earlier). The Task 3.1 flat key is now an intermediate that Task 3.6a renames. These are encoded in decision 6 and Tasks 3.1a / 3.6a / 4.5a.
