<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 2c-3c — acp Plugin → Coding Trusted-Module Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the sandboxed `plugins/acp/` plugin and re-home its 9 coding-session tools, `/acp` command, `acp-hint` prompt fragment, and magi settings section into the in-repo `coding` Trusted Module, binding directly to the coding resolvers/repos store and a module-owned magi `httpFetch` — with zero behavior change except the intended per-context enable gate and the tool-name migration.

**Architecture:** The lowest-risk path preserves the plugin's internal `RuntimeContext` facade shape verbatim. We copy `client.ts`/`history.ts`/`session-records.ts`/`tools.ts`/`session-tools.ts`/`continue-tool.ts` into `src/modules/coding/acp/` **unchanged**, rewrite only `schemas.ts` from raw JSON-Schema to Zod (required by `ModuleTool.inputSchema`), and add three new module-owned files: `runtime-context.ts` (builds a `RuntimeContext` from `(storageContextId, chatUserId)` using the coding resolvers + `kv*` + `getPluginAdminConfig`, applying the group-scope `configContextOf` remap for kv/repos), `http-fetch.ts` (a magi `httpFetch` via `buildProviderRuntime` with a live dynamic-hosts thunk), and `contributions.ts` (wraps each `Tool` into a `ModuleTool`, and declares the command/fragment/settings-section/eligibility predicate). A coding-module DB migration rewrites orphaned `plugin_acp__*` tool_prefs keys to `module_coding__*`. The plugin directory and its tests are deleted in the same commit that wires the module, so there is never a duplicate-tool window.

**Tech Stack:** Bun; strict TypeScript (`.js` import extensions); Zod v4; Vercel AI SDK (`ai`); `bun:sqlite`; `bun:test`.

---

## Context for the implementer (read before starting)

You are migrating a feature out of the Tier-2 plugin sandbox into a Tier-1 trusted module. The module contribution system already exists and works (built in phases 2c-1…2c-3b). Your job is to move the acp feature onto it. Key facts you must not violate:

- **kv/repos use the group config-context; secrets use the raw storage context.** The plugin loader silently remapped `kv` and `codingRepos` to `configContextOf(storageContextId)` (the group-shared config context) while the credential resolvers received the raw thread-scoped `storageContextId` + `chatUserId`. You must reproduce this exactly (`buildRuntimeContext`), or existing session rows become unreadable and credentials resolve under the wrong identity.
- **The kv/admin-config namespace stays the literal string `'acp'`.** `plugin_kv` and `plugin_admin_config` rows are keyed by `(pluginId, …)`. Existing rows were written with `pluginId = 'acp'`. Use `'acp'` (NOT `'coding'`) as the namespace for `kvGet/kvSet/kvDelete/kvList` and `getPluginAdminConfig` so historical session records and the operator's magi config survive the migration.
- **The module id is `'coding'`.** Tool names therefore become `module_coding__<tool>` and the command becomes `module_coding_acp`. This is a deliberate breaking rename from `plugin_acp__*`; Task 7 migrates saved tool_prefs to compensate.
- **`src/debug/transcript-viewer.ts` keeps hardcoding `getPluginAdminConfig('acp', …)`.** Do not touch it. It reads the same `plg:acp:*` config rows the module now owns.
- **The architecture guard (`tests/architecture-guard.test.ts`) scans `src/ports/**`and`src/llm-orchestrator-tools.ts`** for feature names (`kaneo|youtrack|magi|coding`and`plugin_acp\_\_`). None of the files you create live under `src/ports/`, so you are free to use `coding`/`magi`/`acp`inside`src/modules/coding/**`, `src/tools/tool-metadata.ts`, `src/debug/settings/tool-grouping.ts`, and `src/db/migrations/**`. Still, **run the guard after Task 6 and Task 8** to be certain nothing leaked into a scanned path.

### Verified reference signatures (do not re-derive)

```ts
// src/ports/module-tools.ts
export type ModuleToolRuntimeContext = { storageContextId: string; chatUserId: string }
export type ModuleTool = {
  name: string; description: string; inputSchema: z.ZodType; gate?: 'operator'
  execute: (input: unknown, runtimeContext: ModuleToolRuntimeContext, options: ToolExecutionOptions) => Promise<unknown>
}
// src/ports/module-contributions.ts
export type ModuleCommand = { name: string; description: string; execute: (message: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void> | void }
export type ModulePromptFragment = { name: string; content: string | (() => string) }
// src/ports/settings-sections.ts
export type SettingsField = { key: string; label: string; required?: boolean; sensitive?: boolean }
export type SettingsSection = { id: string; label: string; fields: readonly SettingsField[] }
// src/ports/module-eligibility.ts
export type ModuleEligibilityPredicate = (storageContextId: string) => boolean

// src/plugins/store.ts
export function kvGet(pluginId: string, contextId: string, key: string): string | undefined
export function kvSet(pluginId: string, contextId: string, key: string, value: string): void
export function kvDelete(pluginId: string, contextId: string, key: string): void
export function kvList(pluginId: string, contextId: string, ...rest: [] | [prefix: string]): PluginKvRow[] // rows have .key/.value
export function getPluginAdminConfig(pluginId: string, key: string): string | undefined

// src/chat/scoped-context.ts (re-exported as configContextOf from resolve-agent-secrets.ts:21)
export const getConfigContextIdFromStorageContextId = (contextId: string): string => …

// src/modules/coding/credentials/resolve-agent-secrets.ts  — all take (storageContextId, chatUserId) except configContextOf
export function configContextOf(storageContextId: string): string
export function resolveAgentSecrets(storageContextId, chatUserId): Record<string, string> | null
export function resolveAgent(storageContextId, chatUserId): string | null
export function resolveModel(storageContextId, chatUserId): string | null
export function resolveForgeToken(storageContextId, chatUserId): string | null
export function resolveProviderHost(storageContextId, chatUserId): string | null
export function resolveForge(storageContextId, chatUserId): { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null
export function resolveMcp(storageContextId, chatUserId): ResolvedMcp | null  // ResolvedMcp = { url, host, header, allowedHosts, toolPolicy? }
export function resolveMcpToken(storageContextId, chatUserId): string | undefined

// src/modules/coding/repos/store.ts  — RepoRecord = { name, repoUrl, baseBranch, permissionPreset: RepoPreset, repoId, additionalEgressDomains: string[] }
export function listRepos(contextId: string): RepoRecord[]
export function getRepoByName(contextId: string, name: string): RepoRecord | null

// src/plugins/provider-runtime.ts
export type DynamicHostsFn = () => ReadonlySet<string>
export function buildProviderRuntime(allowedHosts: readonly string[], logger: PluginLogger, deps?: ProviderRuntimeDeps, dynamicHosts?: DynamicHostsFn, contextHosts?: DynamicHostsFn): PluginProviderRuntime // .httpFetch
// src/plugins/context-facade-builders.ts
export function buildPluginLogger(pluginId: string): PluginLogger  // { debug|info|warn|error(data, msg) }
// src/plugins/context.ts
export type PluginLogger = { debug(d,m):void; info(d,m):void; warn(d,m):void; error(d,m):void }
```

`RepoRecord` and `ResolvedMcp` are structurally assignable to the `RuntimeContext.codingRepos`/`resolveMcp()` facade shapes (they carry the same field names, `permissionPreset: RepoPreset ⊂ string`), so `buildRuntimeContext` returns them directly with no field remapping.

---

## File Structure

**New — `src/modules/coding/acp/` (module-owned):**

- `client.ts` — magi HTTP client + input-parsing helpers. **Verbatim copy** of `plugins/acp/client.ts`.
- `schemas.ts` — Zod input schemas. **Rewritten** (JSON-Schema → Zod), same export names.
- `history.ts` — kv session-record codec (title/PR parsing, `'1'`-marker tolerance). **Verbatim copy**.
- `session-records.ts` — session record write/enrich. **Verbatim copy**.
- `tools.ts` — `RuntimeContext` type, helpers, `getTool`, `listProjectsTool`. **Verbatim copy**.
- `session-tools.ts` — 6 lifecycle tool factories. **Verbatim copy**.
- `continue-tool.ts` — `continueSessionTool`. **Verbatim copy**.
- `runtime-context.ts` — **New.** `buildRuntimeContext(storageContextId, chatUserId): RuntimeContext`.
- `http-fetch.ts` — **New.** `magiHttpFetch` + `magiDynamicHosts`.
- `contributions.ts` — **New.** `codingAcpTools`, `codingAcpCommand`, `codingAcpPromptFragment`, `codingAcpSettingsSection`, `isCodingContextEligible`, and the two verbatim text consts.

**New — `src/db/migrations/`:**

- `067_acp_tool_prefs_rename.ts` — rewrites `plugin_acp__*` → `module_coding__*` in every context's `tool_prefs.toolOverrides`.

**Modified:**

- `src/modules/coding/module.ts` — add `tools`/`commands`/`promptFragments`/`settingsSections`/`isEligibleForContext` + register migration 067.
- `src/tools/tool-metadata.ts` — add `module_` case to `getToolMetadata`.
- `src/debug/settings/tool-grouping.ts` — add `module` to `NAMESPACED_TOOL_RE` + `deriveToolGroup`.

**Deleted (Task 8, same commit as module wiring):**

- `plugins/acp/` (8 `.ts` files + `plugin.json`).
- `tests/plugins/acp/` (11 test files).

**New tests — `tests/modules/coding/acp/`:**

- `support.ts`, `client.test.ts`, `schemas.test.ts`, `history.test.ts`, `tools.test.ts`, `session-records.test.ts`, `session-tools.test.ts`, `continue-tool.test.ts`, `runtime-context.test.ts`, `http-fetch.test.ts`, `contributions.test.ts`.

---

## Task 1: Pure collaborators — client, history, Zod schemas

**Files:**

- Create: `src/modules/coding/acp/client.ts` (verbatim copy of `plugins/acp/client.ts`)
- Create: `src/modules/coding/acp/history.ts` (verbatim copy of `plugins/acp/history.ts`)
- Create: `src/modules/coding/acp/schemas.ts` (Zod rewrite)
- Test: `tests/modules/coding/acp/client.test.ts`
- Test: `tests/modules/coding/acp/history.test.ts` (port of `tests/plugins/acp/history.test.ts`)
- Test: `tests/modules/coding/acp/schemas.test.ts`

- [ ] **Step 1: Write `tests/modules/coding/acp/history.test.ts`**

Copy `tests/plugins/acp/history.test.ts` verbatim, changing only the import path from the plugin location to `../../../../src/modules/coding/acp/history.js`. It covers write/read round-trip, legacy `'1'` marker tolerance, `parsePrNumber` (GitHub `/pull/`, GitLab `/merge_requests/`), `deriveTitle`, and shareToken/transcriptUrl round-trips.

- [ ] **Step 2: Write `tests/modules/coding/acp/client.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  asPositiveInt,
  asString,
  callMagi,
  NOT_CONFIGURED,
  readMagiConfig,
} from '../../../../src/modules/coding/acp/client.js'

const reader = (values: Record<string, string | undefined>): { get(key: string): string | undefined } => ({
  get: (key) => values[key],
})

describe('acp client', () => {
  it('readMagiConfig trims and strips trailing slashes', () => {
    expect(readMagiConfig(reader({ magi_base_url: 'https://magi.test/ ', magi_token: ' tok ' }))).toEqual({
      baseUrl: 'https://magi.test',
      token: 'tok',
    })
  })

  it('readMagiConfig returns null when base url or token is missing/blank', () => {
    expect(readMagiConfig(reader({ magi_base_url: '', magi_token: 'tok' }))).toBeNull()
    expect(readMagiConfig(reader({ magi_base_url: 'https://magi.test', magi_token: '  ' }))).toBeNull()
  })

  it('callMagi sends bearer auth and parses JSON', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const httpFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      seenUrl = url
      seenAuth = String((init?.headers as Record<string, string>)['Authorization'])
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const result = await callMagi(httpFetch, { baseUrl: 'https://magi.test', token: 'tok' }, 'GET', '/agents')
    expect(seenUrl).toBe('https://magi.test/agents')
    expect(seenAuth).toBe('Bearer tok')
    expect(result).toEqual({ ok: true })
  })

  it('callMagi wraps non-2xx into a magi_error envelope', async () => {
    const httpFetch = async (): Promise<Response> => new Response('nope', { status: 503 })
    const result = await callMagi(httpFetch, { baseUrl: 'https://magi.test', token: 'tok' }, 'GET', '/agents')
    expect(result).toEqual({ error: 'magi_error', status: 503, body: 'nope' })
  })

  it('parsing helpers behave', () => {
    expect(asString({ a: 'x' }, 'a')).toBe('x')
    expect(asString({ a: '' }, 'a')).toBeNull()
    expect(asPositiveInt({ n: 3 }, 'n')).toBe(3)
    expect(asPositiveInt({ n: -1 }, 'n')).toBeNull()
    expect(NOT_CONFIGURED.error).toBe('not_configured')
  })
})
```

- [ ] **Step 3: Write `tests/modules/coding/acp/schemas.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  answerPermissionSchema,
  continueSessionSchema,
  emptySchema,
  finishSessionSchema,
  listSessionsSchema,
  sessionIdSchema,
  startSessionSchema,
} from '../../../../src/modules/coding/acp/schemas.js'

describe('acp zod schemas', () => {
  it('startSessionSchema requires project + prompt, allows optional agent/prNumber', () => {
    expect(startSessionSchema.safeParse({ project: 'demo', prompt: 'go' }).success).toBe(true)
    expect(startSessionSchema.safeParse({ project: 'demo', prompt: 'go', agent: 'x', prNumber: 5 }).success).toBe(true)
    expect(startSessionSchema.safeParse({ project: 'demo' }).success).toBe(false)
  })

  it('listSessionsSchema constrains filter to the enum', () => {
    expect(listSessionsSchema.safeParse({}).success).toBe(true)
    expect(listSessionsSchema.safeParse({ filter: 'active' }).success).toBe(true)
    expect(listSessionsSchema.safeParse({ filter: 'bogus' }).success).toBe(false)
  })

  it('sessionIdSchema requires sessionId', () => {
    expect(sessionIdSchema.safeParse({ sessionId: 's1' }).success).toBe(true)
    expect(sessionIdSchema.safeParse({}).success).toBe(false)
  })

  it('finishSessionSchema requires sessionId + action enum', () => {
    expect(finishSessionSchema.safeParse({ sessionId: 's1', action: 'pr' }).success).toBe(true)
    expect(finishSessionSchema.safeParse({ sessionId: 's1', action: 'nope' }).success).toBe(false)
  })

  it('answerPermissionSchema requires sessionId + decision enum', () => {
    expect(answerPermissionSchema.safeParse({ sessionId: 's1', decision: 'allow' }).success).toBe(true)
    expect(answerPermissionSchema.safeParse({ sessionId: 's1', decision: 'maybe' }).success).toBe(false)
  })

  it('continueSessionSchema requires only prompt', () => {
    expect(continueSessionSchema.safeParse({ prompt: 'next' }).success).toBe(true)
    expect(continueSessionSchema.safeParse({ prNumber: 7, project: 'demo', prompt: 'next' }).success).toBe(true)
    expect(continueSessionSchema.safeParse({}).success).toBe(false)
  })

  it('emptySchema accepts an empty object', () => {
    expect(emptySchema.safeParse({}).success).toBe(true)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `bun test tests/modules/coding/acp/history.test.ts tests/modules/coding/acp/client.test.ts tests/modules/coding/acp/schemas.test.ts`
Expected: FAIL — the `src/modules/coding/acp/*.js` modules do not exist yet.

- [ ] **Step 5: Create `src/modules/coding/acp/client.ts` — verbatim copy**

Copy the entire contents of `plugins/acp/client.ts` (57 lines, including the SPDX header) into `src/modules/coding/acp/client.ts` with **no changes**. It has no imports from `plugins/` — only local structural types — so it moves unchanged.

- [ ] **Step 6: Create `src/modules/coding/acp/history.ts` — verbatim copy**

Copy the entire contents of `plugins/acp/history.ts` (77 lines) into `src/modules/coding/acp/history.ts` with **no changes**. It has no cross-file imports.

- [ ] **Step 7: Create `src/modules/coding/acp/schemas.ts` — Zod rewrite**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const emptySchema = z.object({})

export const startSessionSchema = z.object({
  project: z.string().describe('Project name to run the session against.'),
  prompt: z.string().describe('Task prompt for the coding agent.'),
  agent: z.string().describe('Agent identifier to use (defaults to claude-code-acp).').optional(),
  prNumber: z
    .number()
    .int()
    .describe('Optional existing PR/MR number to start the session on (review or edit its branch).')
    .optional(),
})

export const listSessionsSchema = z.object({
  filter: z
    .enum(['new', 'active', 'waiting', 'done'])
    .describe('Which sessions to list; defaults to active')
    .optional(),
})

export const sessionIdSchema = z.object({
  sessionId: z.string().describe('magi session id'),
})

export const finishSessionSchema = z.object({
  sessionId: z.string(),
  action: z.enum(['push', 'pr']).describe('push the branch, or open a PR'),
  message: z.string().describe('Commit message; defaults to a generic message').optional(),
  title: z.string().describe('PR title (action=pr)').optional(),
  body: z.string().describe('PR body (action=pr)').optional(),
})

export const answerPermissionSchema = z.object({
  sessionId: z.string(),
  decision: z.enum(['allow', 'deny']),
})

export const continueSessionSchema = z.object({
  sessionId: z.string().describe('A prior session id to continue.').optional(),
  prNumber: z.number().int().describe('A prior PR/MR number to continue (with project).').optional(),
  project: z.string().describe('Project name (required when using prNumber).').optional(),
  prompt: z.string().describe('What to do next on the existing branch/PR.'),
})
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test tests/modules/coding/acp/history.test.ts tests/modules/coding/acp/client.test.ts tests/modules/coding/acp/schemas.test.ts`
Expected: PASS (all three suites green).

- [ ] **Step 9: Commit**

```bash
git add src/modules/coding/acp/client.ts src/modules/coding/acp/history.ts src/modules/coding/acp/schemas.ts \
  tests/modules/coding/acp/history.test.ts tests/modules/coding/acp/client.test.ts tests/modules/coding/acp/schemas.test.ts
git commit -m "feat(coding): port acp client/history verbatim + zod schemas into module"
```

---

## Task 2: RuntimeContext helpers — tools, session-tools, continue-tool, session-records

These four files are copied **verbatim** (they reference the `RuntimeContext` facade type, which is preserved). Their tests port from the plugin suites with only import-path and harness changes. Because the TDD hook mirrors each `src/` file to a `<name>.test.ts`, every copied file gets a companion suite.

**Files:**

- Create: `src/modules/coding/acp/tools.ts` (verbatim copy of `plugins/acp/tools.ts`)
- Create: `src/modules/coding/acp/session-records.ts` (verbatim copy)
- Create: `src/modules/coding/acp/session-tools.ts` (verbatim copy)
- Create: `src/modules/coding/acp/continue-tool.ts` (verbatim copy)
- Create: `tests/modules/coding/acp/support.ts` (fake-`RuntimeContext` helper)
- Test: `tests/modules/coding/acp/tools.test.ts`, `session-records.test.ts`, `session-tools.test.ts`, `continue-tool.test.ts`

- [ ] **Step 1: Write `tests/modules/coding/acp/support.ts`**

This is the module test harness. Copy the `runtimeCtx`/`runtimeCtxWithKv` builders from `tests/plugins/acp/support.ts` (the parts that build a fake `RuntimeContext` — an in-memory `kv` Map, a stub `adminConfig`, and stub `codingSecrets`/`codingRepos`). **Drop** the plugin-only pieces (`activate()`, the fake `PluginContext`, `registerTool` capture) — they no longer apply. Change the `RuntimeContext`/`Tool` type imports to `../../../../src/modules/coding/acp/tools.js`. Keep the same builder API (`runtimeCtx(overrides)`, `runtimeCtxWithKv(...)`) so the ported behavior suites need only their import paths updated.

Reference the current `tests/plugins/acp/support.ts:1-165` for the exact fake shapes; reproduce the `RuntimeContext` fakes 1:1 (same default `codingSecrets.resolve()` returning a credentials map, `codingRepos.get/list`, in-memory kv with `get/set/delete/list(prefix)`).

- [ ] **Step 2: Write the four test suites by porting the plugin suites**

For each, copy the corresponding plugin suite and change (a) the imports of the tool factories to `../../../../src/modules/coding/acp/<file>.js`, and (b) the `support.ts` import to the new module harness. The test **bodies stay unchanged** — they exercise the `Tool.execute(input, runtimeContext)` contract, which is identical.

- `tests/modules/coding/acp/tools.test.ts` ← merge `tests/plugins/acp/tools.test.ts` (buildSessionProjectSpec/buildProjectSpec/canDeriveForge) **and** the `list_projects`/`list_agents` cases from `tests/plugins/acp/read-tools.test.ts`.
- `tests/modules/coding/acp/session-records.test.ts` ← extract the `enrichSession`/`recordStartedSession` assertions currently embedded in `tests/plugins/acp/list-status.test.ts` (title/prNumber/transcriptUrl merge), or write focused tests against `recordStartedSession`/`enrichSession` using `runtimeCtxWithKv`.
- `tests/modules/coding/acp/session-tools.test.ts` ← merge `tests/plugins/acp/start-session.test.ts`, `tests/plugins/acp/list-status.test.ts`, `tests/plugins/acp/lifecycle.test.ts`, and `tests/plugins/acp/coding-secrets-injection.test.ts`.
- `tests/modules/coding/acp/continue-tool.test.ts` ← `tests/plugins/acp/continue-session.test.ts`.

> Note: these suites import from `tests/plugins/acp/support.ts` today. After Task 8 deletes `tests/plugins/acp/`, only the new copies remain. Do not delete the plugin suites in this task — they still guard the live plugin until Task 8.

- [ ] **Step 3: Run the new suites to verify they fail**

Run: `bun test tests/modules/coding/acp/tools.test.ts tests/modules/coding/acp/session-tools.test.ts tests/modules/coding/acp/continue-tool.test.ts tests/modules/coding/acp/session-records.test.ts`
Expected: FAIL — `src/modules/coding/acp/tools.js` etc. do not exist yet.

- [ ] **Step 4: Create the four src files — verbatim copies**

Copy each of `plugins/acp/tools.ts`, `plugins/acp/session-records.ts`, `plugins/acp/session-tools.ts`, `plugins/acp/continue-tool.ts` into `src/modules/coding/acp/` with **no code changes**. Their relative imports (`./client.js`, `./schemas.js`, `./history.js`, `./tools.js`) resolve identically in the new directory because Task 1 placed the same-named files alongside them.

> The `Tool.inputSchema` field is typed `unknown`, so it happily holds the new Zod schemas; the execute bodies parse runtime input via `asObject`/`asString` and are agnostic to whether the declared schema was JSON-Schema or Zod.

- [ ] **Step 5: Run the suites to verify they pass**

Run: `bun test tests/modules/coding/acp/`
Expected: PASS (all module acp suites so far green).

- [ ] **Step 6: Commit**

```bash
git add src/modules/coding/acp/tools.ts src/modules/coding/acp/session-records.ts \
  src/modules/coding/acp/session-tools.ts src/modules/coding/acp/continue-tool.ts \
  tests/modules/coding/acp/support.ts tests/modules/coding/acp/tools.test.ts \
  tests/modules/coding/acp/session-records.test.ts tests/modules/coding/acp/session-tools.test.ts \
  tests/modules/coding/acp/continue-tool.test.ts
git commit -m "feat(coding): port acp tool factories verbatim into module with ported suites"
```

---

## Task 3: `runtime-context.ts` — bind the RuntimeContext facade to real coding infra

This is the critical new integration piece: it reproduces the plugin loader's context wiring, applying `configContextOf` to kv/repos and passing the raw storage context + chat user to the credential resolvers.

**Files:**

- Create: `src/modules/coding/acp/runtime-context.ts`
- Test: `tests/modules/coding/acp/runtime-context.test.ts`

- [ ] **Step 1: Write `tests/modules/coding/acp/runtime-context.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { getConfigContextIdFromStorageContextId } from '../../../../src/chat/scoped-context.js'
import { buildRuntimeContext } from '../../../../src/modules/coding/acp/runtime-context.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { upsertRepo } from '../../../../src/modules/coding/repos/store.js'
import { setupTestDb } from '../../../utils/test-helpers.js'

// A stable group storage context. buildRuntimeContext must remap kv/repos to its config context.
const STORAGE_CTX = 'tg:group:42:thread:99'
const CHAT_USER = 'u-1'

describe('buildRuntimeContext', () => {
  beforeEach(() => {
    setupTestDb()
  })

  it('reads admin config from the plg:acp namespace', () => {
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.test', 'admin')
    const rt = buildRuntimeContext(STORAGE_CTX, CHAT_USER)
    expect(rt.adminConfig.get('magi_base_url')).toBe('https://magi.test')
  })

  it('scopes kv to the config context under the literal acp namespace', () => {
    const rt = buildRuntimeContext(STORAGE_CTX, CHAT_USER)
    rt.kv.set('session:s1', 'v1')
    // A sibling thread in the same group shares the config context → sees the same row.
    const sibling = buildRuntimeContext('tg:group:42:thread:100', CHAT_USER)
    expect(sibling.kv.get('session:s1')).toBe('v1')
    expect(rt.kv.list('session:').map((r) => r.key)).toEqual(['session:s1'])
  })

  it('exposes the group config-context repo catalogue via codingRepos', () => {
    const cfgCtx = getConfigContextIdFromStorageContextId(STORAGE_CTX)
    upsertRepo(
      cfgCtx,
      { name: 'demo', repoUrl: 'https://github.com/x/y', baseBranch: 'main', permissionPreset: 'cautious' },
      'admin',
    )
    const rt = buildRuntimeContext(STORAGE_CTX, CHAT_USER)
    expect(rt.codingRepos.list().map((r) => r.name)).toEqual(['demo'])
    expect(rt.codingRepos.get('demo')?.repoUrl).toBe('https://github.com/x/y')
    expect(rt.codingRepos.get('missing')).toBeNull()
  })

  it('preserves storageContextId (raw thread scope) for magi contextId', () => {
    const rt = buildRuntimeContext(STORAGE_CTX, CHAT_USER)
    expect(rt.storageContextId).toBe(STORAGE_CTX)
  })
})
```

> Verify the exact `setupTestDb`/`upsertRepo` import paths against `tests/utils/test-helpers.ts` and `src/modules/coding/repos/store.ts`; `upsertRepo(contextId, input, updatedBy)` and `RepoPreset` (`'autonomous'|'cautious'|'readonly'`) are confirmed in the store. If `setupTestDb()` needs the trusted-module migration passes to create the repos table, use the project's standard test-db bootstrap (the coding repos table is owned by module migration 064).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/modules/coding/acp/runtime-context.test.ts`
Expected: FAIL — `runtime-context.js` not found.

- [ ] **Step 3: Create `src/modules/coding/acp/runtime-context.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  configContextOf,
  resolveAgent,
  resolveAgentSecrets,
  resolveForge,
  resolveForgeToken,
  resolveMcp,
  resolveMcpToken,
  resolveModel,
  resolveProviderHost,
} from '../credentials/resolve-agent-secrets.js'
import { getRepoByName, listRepos } from '../repos/store.js'
import { getPluginAdminConfig, kvDelete, kvGet, kvList, kvSet } from '../../../plugins/store.js'
import type { RuntimeContext } from './tools.js'

/**
 * kv/admin-config namespace. Deliberately the legacy `'acp'` string (NOT the module id `'coding'`):
 * plugin_kv/plugin_admin_config rows are keyed by this id, and existing session records + the
 * operator's magi config were written under `'acp'`. Keeping it preserves those rows across the
 * plugin→module migration.
 */
const ACP_NAMESPACE = 'acp'

/**
 * Build the RuntimeContext facade the acp tool factories expect, from the per-call identity.
 * Mirrors the old plugin loader's wiring exactly:
 *  - kv + repos are scoped to the GROUP config context (`configContextOf`), so a group's session
 *    records and repo catalogue are shared across its threads;
 *  - the credential resolvers receive the RAW `storageContextId` + `chatUserId` and derive their
 *    own identity context internally;
 *  - `storageContextId` handed to tool bodies (and used as magi's `contextId`) stays the raw
 *    thread-scoped id, so async milestone notifications target the originating thread.
 */
export function buildRuntimeContext(storageContextId: string, chatUserId: string): RuntimeContext {
  const cfgCtx = configContextOf(storageContextId)
  return {
    storageContextId,
    adminConfig: { get: (key: string): string | undefined => getPluginAdminConfig(ACP_NAMESPACE, key) },
    kv: {
      get: (key: string): string | undefined => kvGet(ACP_NAMESPACE, cfgCtx, key),
      set: (key: string, value: string): void => kvSet(ACP_NAMESPACE, cfgCtx, key, value),
      delete: (key: string): void => kvDelete(ACP_NAMESPACE, cfgCtx, key),
      list: (prefix?: string): Array<{ key: string; value: string }> =>
        (prefix === undefined ? kvList(ACP_NAMESPACE, cfgCtx) : kvList(ACP_NAMESPACE, cfgCtx, prefix)).map(
          (row): { key: string; value: string } => ({ key: row.key, value: row.value }),
        ),
    },
    codingSecrets: {
      resolve: (): Record<string, string> | null => resolveAgentSecrets(storageContextId, chatUserId),
      resolveForgeToken: (): string | null => resolveForgeToken(storageContextId, chatUserId),
      resolveAgent: (): string | null => resolveAgent(storageContextId, chatUserId),
      resolveForge: () => resolveForge(storageContextId, chatUserId),
      resolveProviderHost: (): string | null => resolveProviderHost(storageContextId, chatUserId),
      resolveModel: (): string | null => resolveModel(storageContextId, chatUserId),
      resolveMcp: () => resolveMcp(storageContextId, chatUserId),
      resolveMcpToken: (): string | undefined => resolveMcpToken(storageContextId, chatUserId),
    },
    codingRepos: {
      list: () => listRepos(cfgCtx),
      get: (name: string) => getRepoByName(cfgCtx, name),
    },
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/modules/coding/acp/runtime-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/coding/acp/runtime-context.ts tests/modules/coding/acp/runtime-context.test.ts
git commit -m "feat(coding): build acp RuntimeContext from coding resolvers + config-scoped kv"
```

---

## Task 4: `http-fetch.ts` — module-owned magi HTTP client

**Files:**

- Create: `src/modules/coding/acp/http-fetch.ts`
- Test: `tests/modules/coding/acp/http-fetch.test.ts`

- [ ] **Step 1: Write `tests/modules/coding/acp/http-fetch.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { magiDynamicHosts, magiHttpFetch } from '../../../../src/modules/coding/acp/http-fetch.js'
import { deletePluginAdminConfig, setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { setupTestDb } from '../../../utils/test-helpers.js'

describe('acp http-fetch dynamic hosts', () => {
  beforeEach(() => {
    setupTestDb()
    deletePluginAdminConfig('acp', 'magi_base_url')
  })

  it('is a callable fetch', () => {
    expect(typeof magiHttpFetch).toBe('function')
  })

  it('derives the magi hostname (port-agnostic) from admin config', () => {
    setPluginAdminConfig('acp', 'magi_base_url', 'https://magi.example.com:8080/', 'admin')
    expect([...magiDynamicHosts()]).toEqual(['magi.example.com'])
  })

  it('returns an empty set when unset or invalid', () => {
    expect([...magiDynamicHosts()]).toEqual([])
    setPluginAdminConfig('acp', 'magi_base_url', 'not a url', 'admin')
    expect([...magiDynamicHosts()]).toEqual([])
  })
})
```

> Confirm `deletePluginAdminConfig` is exported (`src/plugins/store.ts:247`). If `setupTestDb` already yields a clean DB per test, the explicit delete is belt-and-suspenders.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/modules/coding/acp/http-fetch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/modules/coding/acp/http-fetch.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../logger.js'
import { buildPluginLogger } from '../../../plugins/context-facade-builders.js'
import { buildProviderRuntime, type DynamicHostsFn } from '../../../plugins/provider-runtime.js'
import { getPluginAdminConfig } from '../../../plugins/store.js'

const log = logger.child({ scope: 'modules:coding:acp:http' })

/**
 * Hosts contributed by the operator-configured magi base URL. Host-only and port-agnostic
 * (matching the plugin loader's `buildDynamicHosts`). Evaluated lazily per request so an admin
 * changing `magi_base_url` applies without a restart. Admin config is operator-trusted, so these
 * hosts intentionally bypass the https + public-IP checks in the provider runtime.
 */
export const magiDynamicHosts: DynamicHostsFn = (): ReadonlySet<string> => {
  const hosts = new Set<string>()
  const value = getPluginAdminConfig('acp', 'magi_base_url')
  if (value !== undefined && value.trim() !== '') {
    try {
      hosts.add(new URL(value).hostname.toLowerCase())
    } catch {
      log.warn({ key: 'magi_base_url' }, 'magi_base_url is not a valid URL; skipping allowlist entry')
    }
  }
  return hosts
}

/** The magi HTTP client used by every acp tool. Built once; the dynamic-hosts thunk is live. */
export const magiHttpFetch = buildProviderRuntime(
  [],
  buildPluginLogger('coding'),
  undefined,
  magiDynamicHosts,
).httpFetch
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/modules/coding/acp/http-fetch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/coding/acp/http-fetch.ts tests/modules/coding/acp/http-fetch.test.ts
git commit -m "feat(coding): module-owned magi httpFetch with live dynamic-hosts thunk"
```

---

## Task 5: `contributions.ts` — assemble the module contributions

**Files:**

- Create: `src/modules/coding/acp/contributions.ts`
- Test: `tests/modules/coding/acp/contributions.test.ts`

- [ ] **Step 1: Write `tests/modules/coding/acp/contributions.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { getConfigContextIdFromStorageContextId } from '../../../../src/chat/scoped-context.js'
import {
  ACP_COMMAND_TEXT,
  ACP_PROMPT_FRAGMENT,
  codingAcpCommand,
  codingAcpPromptFragment,
  codingAcpSettingsSection,
  codingAcpTools,
  isCodingContextEligible,
} from '../../../../src/modules/coding/acp/contributions.js'
import { upsertRepo } from '../../../../src/modules/coding/repos/store.js'
import { setupTestDb } from '../../../utils/test-helpers.js'

const EXPECTED_TOOLS = [
  'list_projects',
  'list_agents',
  'start_session',
  'list_sessions',
  'session_status',
  'finish_session',
  'cancel_session',
  'answer_permission',
  'continue_session',
]
const OPERATOR_GATED = new Set([
  'start_session',
  'finish_session',
  'cancel_session',
  'answer_permission',
  'continue_session',
])

describe('coding acp contributions', () => {
  it('contributes all nine tools with a zod inputSchema', () => {
    expect(codingAcpTools.map((t) => t.name)).toEqual(EXPECTED_TOOLS)
    for (const t of codingAcpTools) expect(typeof t.inputSchema.safeParse).toBe('function')
  })

  it('marks exactly the lifecycle-mutating tools as operator-gated', () => {
    for (const t of codingAcpTools) {
      expect(t.gate === 'operator').toBe(OPERATOR_GATED.has(t.name))
    }
  })

  it('declares the acp command + hint fragment with the verbatim text', () => {
    expect(codingAcpCommand.name).toBe('acp')
    expect(codingAcpPromptFragment.name).toBe('acp-hint')
    expect(codingAcpPromptFragment.content).toBe(ACP_PROMPT_FRAGMENT)
    expect(ACP_PROMPT_FRAGMENT.length).toBeGreaterThan(0)
    expect(ACP_PROMPT_FRAGMENT.length).toBeLessThanOrEqual(2000)
    expect(ACP_COMMAND_TEXT.length).toBeGreaterThan(0)
  })

  it('declares the acp magi settings section (token sensitive)', () => {
    expect(codingAcpSettingsSection.id).toBe('acp')
    const keys = codingAcpSettingsSection.fields.map((f) => f.key)
    expect(keys).toEqual(['magi_base_url', 'magi_token'])
    const token = codingAcpSettingsSection.fields.find((f) => f.key === 'magi_token')
    expect(token?.sensitive).toBe(true)
  })

  it('is eligible only where the config-context repo catalogue is non-empty', () => {
    setupTestDb()
    const ctx = 'tg:group:7:thread:1'
    expect(isCodingContextEligible(ctx)).toBe(false)
    upsertRepo(
      getConfigContextIdFromStorageContextId(ctx),
      {
        name: 'demo',
        repoUrl: 'https://github.com/x/y',
        baseBranch: 'main',
        permissionPreset: 'cautious',
      },
      'admin',
    )
    expect(isCodingContextEligible(ctx)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/modules/coding/acp/contributions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/modules/coding/acp/contributions.ts`**

Copy the two text consts verbatim from `plugins/acp/index.ts:92-107`.

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'
import type { z } from 'zod'

import type { ModuleCommand, ModulePromptFragment } from '../../../ports/module-contributions.js'
import type { ModuleEligibilityPredicate } from '../../../ports/module-eligibility.js'
import type { ModuleTool, ModuleToolRuntimeContext } from '../../../ports/module-tools.js'
import type { SettingsSection } from '../../../ports/settings-sections.js'
import { configContextOf } from '../credentials/resolve-agent-secrets.js'
import { listRepos } from '../repos/store.js'
import { continueSessionTool } from './continue-tool.js'
import { magiHttpFetch } from './http-fetch.js'
import { buildRuntimeContext } from './runtime-context.js'
import {
  answerPermissionTool,
  cancelSessionTool,
  finishSessionTool,
  listSessionsTool,
  sessionStatusTool,
  startSessionTool,
} from './session-tools.js'
import { getTool, listProjectsTool } from './tools.js'
import type { Tool } from './tools.js'

/** Wrap an acp `Tool` (RuntimeContext-based) into a `ModuleTool` (identity-based), building the
 * RuntimeContext per call from the acting `(storageContextId, chatUserId)`. */
function toModuleTool(t: Tool): ModuleTool {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as z.ZodType,
    ...(t.gate === undefined ? {} : { gate: t.gate }),
    execute: (input: unknown, rt: ModuleToolRuntimeContext, options: ToolExecutionOptions): Promise<unknown> =>
      t.execute(input, buildRuntimeContext(rt.storageContextId, rt.chatUserId), options),
  }
}

export const codingAcpTools: readonly ModuleTool[] = [
  listProjectsTool(),
  getTool('list_agents', 'List coding agents available in magi.', '/agents', magiHttpFetch),
  startSessionTool(magiHttpFetch),
  listSessionsTool(magiHttpFetch),
  sessionStatusTool(magiHttpFetch),
  finishSessionTool(magiHttpFetch),
  cancelSessionTool(magiHttpFetch),
  answerPermissionTool(magiHttpFetch),
  continueSessionTool(magiHttpFetch),
].map(toModuleTool)

export const ACP_PROMPT_FRAGMENT =
  'Coding sessions: use start_session(project, prompt) to run a sandboxed AI coding agent on a ' +
  'configured project, list_sessions/session_status to check progress, answer_permission(sessionId, ' +
  'decision) when the agent needs approval, finish_session(sessionId, action) to commit/push or open a ' +
  'PR, cancel_session to stop one. ' +
  "Use continue_session(sessionId or prNumber, prompt) to keep working on a prior session's " +
  'branch/PR — it updates the existing PR. ' +
  'Use list_projects/list_agents to discover what is configured. The user is notified when a session ' +
  'finishes or needs input. ' +
  'When start_session/continue_session returns a transcriptUrl, include that link in your reply ' +
  'so the user can watch the session live in the browser and share it.'

export const ACP_COMMAND_TEXT =
  'ACP coding sessions are available. Ask me in natural language, e.g. "start a session on demo to add a ' +
  'health check", "what sessions are running?", "review PR 42 on demo", or "continue PR 42 on demo and fix ' +
  'the failing tests".'

export const codingAcpPromptFragment: ModulePromptFragment = { name: 'acp-hint', content: ACP_PROMPT_FRAGMENT }

export const codingAcpCommand: ModuleCommand = {
  name: 'acp',
  description: 'About ACP coding sessions',
  execute: (_message, reply): Promise<void> => reply.text(ACP_COMMAND_TEXT),
}

/** Operator-configured magi endpoint. Stored under the legacy `plg:acp:*` namespace (see
 * runtime-context.ts) so the transcript viewer and existing config rows keep working. */
export const codingAcpSettingsSection: SettingsSection = {
  id: 'acp',
  label: 'Coding sessions (magi)',
  fields: [
    { key: 'magi_base_url', label: 'Magi base URL', required: true },
    { key: 'magi_token', label: 'Magi token', required: true, sensitive: true },
  ],
}

/** Per-context eligibility: coding contributions surface only where the group's repo catalogue is
 * non-empty (the same "is anything configured to run against" signal `list_projects` returns). */
export const isCodingContextEligible: ModuleEligibilityPredicate = (storageContextId: string): boolean =>
  listRepos(configContextOf(storageContextId)).length > 0
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/modules/coding/acp/contributions.test.ts`
Expected: PASS.

> `knip` will now flag `contributions.ts` exports as unused (nothing imports them until Task 8). This is the expected dormant-infrastructure state; do not "fix" it by pruning. It resolves when Task 8 wires the module.

- [ ] **Step 5: Commit**

```bash
git add src/modules/coding/acp/contributions.ts tests/modules/coding/acp/contributions.test.ts
git commit -m "feat(coding): assemble acp module contributions (tools, command, fragment, section, eligibility)"
```

---

## Task 6: Classify + group `module_` tools

Without a `module_` case, `getToolMetadata` returns `undefined` for module tools, and `deriveToolGroup` leaves them ungrouped in the settings UI. Add both.

**Files:**

- Modify: `src/tools/tool-metadata.ts:186-189`
- Modify: `src/debug/settings/tool-grouping.ts:11,40-48`
- Test: `tests/tools/tool-metadata.test.ts` (add cases; verify the file/path via the existing suite), `tests/debug/settings/tool-grouping.test.ts` (add cases)

- [ ] **Step 1: Add failing tests**

Locate the existing suites for these modules (`rg -l "getToolMetadata" tests`, `rg -l "deriveToolGroup" tests`). Add to the metadata suite:

```ts
it('classifies module tools as open-world plugin-domain', () => {
  expect(getToolMetadata('module_coding__start_session')).toEqual({
    domain: 'plugin',
    operation: 'read',
    risk: 'open-world',
  })
})
```

Add to the tool-grouping suite:

```ts
it('groups module tools by their sanitized module segment', () => {
  const segmentMap = new Map<string, string>()
  expect(deriveToolGroup('module_coding__start_session', segmentMap)).toBe('coding')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/tools/tool-metadata.test.ts tests/debug/settings/tool-grouping.test.ts`
Expected: FAIL — `getToolMetadata` returns `undefined`; `deriveToolGroup` returns `undefined`.

- [ ] **Step 3: Add the `module_` case to `getToolMetadata`**

In `src/tools/tool-metadata.ts`, immediately after the `plugin_` block (after line 189):

```ts
// Module tools: module_<module-id>__<tool_name> (trusted modules, reuse the plugin domain)
if (toolName.startsWith('module_')) {
  return { domain: 'plugin', operation: 'read', risk: 'open-world' }
}
```

- [ ] **Step 4: Extend `tool-grouping.ts`**

Change line 11:

```ts
const NAMESPACED_TOOL_RE = /^(plugin|mcp|module)_(.+?)__/u
```

The existing `deriveToolGroup` fallthrough (`return segment`, line 47) already handles the `module` prefix correctly — the module segment (`coding`) is returned as the group label, exactly like MCP server ids. No further change to `deriveToolGroup` is required. (Modules are not in `pluginRegistry`, so there is no segment-map lookup to add; module ids do not contain dashes in practice, so the sanitized segment equals the id.)

- [ ] **Step 5: Run to verify they pass**

Run: `bun test tests/tools/tool-metadata.test.ts tests/debug/settings/tool-grouping.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the architecture guard**

Run: `bun test tests/architecture-guard.test.ts`
Expected: PASS (6/6). `tool-metadata.ts`/`tool-grouping.ts` are not under `src/ports/**`, so the `module`/`coding` strings there are allowed; this confirms nothing leaked into a scanned path.

- [ ] **Step 7: Commit**

```bash
git add src/tools/tool-metadata.ts src/debug/settings/tool-grouping.ts tests/tools/tool-metadata.test.ts tests/debug/settings/tool-grouping.test.ts
git commit -m "feat(tools): classify + group module_ namespaced tools"
```

---

## Task 7: Migration 067 — rename orphaned `plugin_acp__` tool_prefs

The rename `plugin_acp__*` → `module_coding__*` would otherwise orphan users' saved per-tool permissions. This coding-module migration rewrites `toolOverrides` keys in every context's `tool_prefs` row.

**Files:**

- Create: `src/db/migrations/067_acp_tool_prefs_rename.ts`
- Test: `tests/db/migrations/067_acp_tool_prefs_rename.test.ts`

- [ ] **Step 1: Write `tests/db/migrations/067_acp_tool_prefs_rename.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'

import { migration067AcpToolPrefsRename } from '../../../src/db/migrations/067_acp_tool_prefs_rename.js'

function dbWithToolPrefs(rows: Array<{ userId: string; value: string }>): Database {
  const db = new Database(':memory:')
  db.run(
    `CREATE TABLE user_config (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))`,
  )
  for (const r of rows)
    db.run(`INSERT INTO user_config (user_id, key, value) VALUES (?, 'tool_prefs', ?)`, [r.userId, r.value])
  return db
}

const readValue = (db: Database, userId: string): string =>
  (
    db
      .query<{ value: string }, [string]>(`SELECT value FROM user_config WHERE user_id = ? AND key = 'tool_prefs'`)
      .get(userId) as { value: string }
  ).value

describe('migration 067 acp tool_prefs rename', () => {
  it('rewrites plugin_acp__ override keys to module_coding__, preserving permissions and other keys', () => {
    const db = dbWithToolPrefs([
      {
        userId: 'ctx-1',
        value: JSON.stringify({
          riskDefaults: {},
          domainDefaults: { plugin: 'ask' },
          toolOverrides: { plugin_acp__start_session: 'allow', plugin_acp__cancel_session: 'deny', web_fetch: 'ask' },
        }),
      },
    ])
    migration067AcpToolPrefsRename.up(db)
    const parsed = JSON.parse(readValue(db, 'ctx-1'))
    expect(parsed.toolOverrides).toEqual({
      module_coding__start_session: 'allow',
      module_coding__cancel_session: 'deny',
      web_fetch: 'ask',
    })
    expect(parsed.domainDefaults).toEqual({ plugin: 'ask' })
  })

  it('leaves rows without acp overrides untouched', () => {
    const original = JSON.stringify({ domainDefaults: {}, toolOverrides: { web_fetch: 'deny' } })
    const db = dbWithToolPrefs([{ userId: 'ctx-2', value: original }])
    migration067AcpToolPrefsRename.up(db)
    expect(readValue(db, 'ctx-2')).toBe(original)
  })

  it('tolerates non-JSON / malformed values without throwing', () => {
    const db = dbWithToolPrefs([{ userId: 'ctx-3', value: 'not json' }])
    expect(() => migration067AcpToolPrefsRename.up(db)).not.toThrow()
    expect(readValue(db, 'ctx-3')).toBe('not json')
  })

  it('is a no-op when user_config does not exist', () => {
    const db = new Database(':memory:')
    expect(() => migration067AcpToolPrefsRename.up(db)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/db/migrations/067_acp_tool_prefs_rename.test.ts`
Expected: FAIL — migration module not found.

- [ ] **Step 3: Create `src/db/migrations/067_acp_tool_prefs_rename.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:067' })

const RENAME_FROM = 'plugin_acp__'
const RENAME_TO = 'module_coding__'

type ToolPrefsRow = Readonly<{ rowid: number; value: string }>

function tableExists(db: Database, table: string): boolean {
  return (
    db
      .query<{ one: number }, [string]>(`SELECT 1 AS one FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table) !== null
  )
}

/** Rewrite plugin_acp__ override keys to module_coding__. Returns the new JSON string, or null if
 * nothing changed / the value is not parseable tool_prefs. */
function rewriteToolOverrides(value: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const overrides = record['toolOverrides']
  if (typeof overrides !== 'object' || overrides === null) return null

  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, perm] of Object.entries(overrides as Record<string, unknown>)) {
    if (key.startsWith(RENAME_FROM)) {
      next[`${RENAME_TO}${key.slice(RENAME_FROM.length)}`] = perm
      changed = true
    } else {
      next[key] = perm
    }
  }
  if (!changed) return null
  return JSON.stringify({ ...record, toolOverrides: next })
}

export const migration067AcpToolPrefsRename: Migration = {
  id: '067_acp_tool_prefs_rename',
  up(db) {
    if (!tableExists(db, 'user_config')) return
    const rows = db.query<ToolPrefsRow, []>(`SELECT rowid, value FROM user_config WHERE key = 'tool_prefs'`).all()
    let updated = 0
    for (const row of rows) {
      const next = rewriteToolOverrides(row.value)
      if (next === null) continue
      db.run(`UPDATE user_config SET value = ? WHERE rowid = ?`, [next, row.rowid])
      updated += 1
    }
    log.info({ scanned: rows.length, updated }, 'migration 067: renamed plugin_acp__ tool_prefs to module_coding__')
  },
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/db/migrations/067_acp_tool_prefs_rename.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/067_acp_tool_prefs_rename.ts tests/db/migrations/067_acp_tool_prefs_rename.test.ts
git commit -m "feat(coding): migration renaming plugin_acp__ tool_prefs to module_coding__"
```

> Migration 067 is registered into `codingModule.migrations` in Task 8 (not the core `MIGRATIONS` array), keeping core feature-agnostic. It runs after core `initDb` via `applyModuleMigrations`, by which point the core-owned `user_config` table exists.

---

## Task 8: Wire the module + retire the plugin (atomic cutover)

This is the cutover. Wiring the module's contributions and deleting `plugins/acp/` happen in **one commit** so the coding tools never appear twice.

**Files:**

- Modify: `src/modules/coding/module.ts`
- Delete: `plugins/acp/` (all `.ts` + `plugin.json`), `tests/plugins/acp/` (all files)
- Test: `tests/modules/coding/module.test.ts` (add contribution assertions; verify path via existing coding-module suite)

- [ ] **Step 1: Add failing assertions to the coding-module test**

Find the existing coding-module suite (`rg -l "codingModule" tests`). Add:

```ts
it('contributes the acp tools, command, fragment, settings section, migration, and eligibility', () => {
  expect(codingModule.tools?.map((t) => t.name)).toContain('start_session')
  expect(codingModule.tools?.length).toBe(9)
  expect(codingModule.commands?.map((c) => c.name)).toEqual(['acp'])
  expect(codingModule.promptFragments?.map((f) => f.name)).toEqual(['acp-hint'])
  expect(codingModule.settingsSections?.map((s) => s.id)).toEqual(['acp'])
  expect(codingModule.migrations?.map((m) => m.id)).toContain('067_acp_tool_prefs_rename')
  expect(typeof codingModule.isEligibleForContext).toBe('function')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/modules/coding/module.test.ts`
Expected: FAIL — `codingModule.tools` is undefined.

- [ ] **Step 3: Update `src/modules/coding/module.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { migration061CodingSessionCredentials } from '../../db/migrations/061_coding_session_credentials.js'
import { migration064CodingSessionRepos } from '../../db/migrations/064_coding_session_repos.js'
import { migration066CodingReposEgress } from '../../db/migrations/066_coding_repos_egress.js'
import { migration067AcpToolPrefsRename } from '../../db/migrations/067_acp_tool_prefs_rename.js'
import type { TrustedModule } from '../../ports/module.js'
import { operatorAllowlistPort, type WhoMayUse } from '../../ports/operator-allowlist.js'
import {
  codingAcpCommand,
  codingAcpPromptFragment,
  codingAcpSettingsSection,
  codingAcpTools,
  isCodingContextEligible,
} from './acp/contributions.js'
import { resolveCodingGuardrails } from './credentials/guardrails.js'

/** Who-may-use resolver for coding sessions: the platform-instance guardrail policy's allowlist. */
export const codingWhoMayUseResolver = (platformInstanceId: string): WhoMayUse =>
  resolveCodingGuardrails(platformInstanceId).whoMayUse

/**
 * The coding trusted module. Owns the coding-session DB tables via `migrations`, contributes the
 * acp coding-session tools/command/prompt fragment/settings section, gates them per-context via
 * `isEligibleForContext`, and on activation registers the operator allowlist resolver so the
 * orchestrator can gate coding-session tools without importing the coding feature.
 */
export const codingModule: TrustedModule = {
  id: 'coding',
  migrations: [
    migration061CodingSessionCredentials,
    migration064CodingSessionRepos,
    migration066CodingReposEgress,
    migration067AcpToolPrefsRename,
  ],
  tools: codingAcpTools,
  commands: [codingAcpCommand],
  promptFragments: [codingAcpPromptFragment],
  settingsSections: [codingAcpSettingsSection],
  isEligibleForContext: isCodingContextEligible,
  onActivate(): void {
    operatorAllowlistPort.register(codingWhoMayUseResolver)
  },
}
```

- [ ] **Step 4: Delete the plugin and its tests**

```bash
git rm -r plugins/acp tests/plugins/acp
```

- [ ] **Step 5: Check for dangling references to the deleted plugin**

Run: `rg -n "plugins/acp|plugin_acp__|'acp'|\"acp\"" src tests client --glob '!src/modules/coding/**' --glob '!src/debug/transcript-viewer.ts'`

Expected surviving references (leave them):

- `src/debug/transcript-viewer.ts` — `getPluginAdminConfig('acp', …)` (intentional; same config rows).
- Generic gate/registration test literals that use `'acp'`/`plugin_acp__` as illustrative strings for the _plugin_ mechanism (`tests/ports/tool-gate.test.ts`, `tests/plugins/tool-gate-registration.test.ts`, `tests/llm-orchestrator-who-may-use.test.ts`, `tests/client/settings/fetcher-schemas-tools.test.ts`) — these test the still-existing plugin machinery and do not reference the deleted acp plugin's code. Update the representative string in `tests/client/settings/fetcher-schemas-tools.test.ts` to a `module_coding__…` example if you want it to reflect reality, but it is not required for correctness.
- `tests/architecture-guard.test.ts` — asserts `plugin_acp__` is absent from core; still valid.

Any import of a deleted `plugins/acp/*` path from surviving code is a real breakage — fix it (there should be none; the plugin was self-contained and loaded by directory discovery).

- [ ] **Step 6: Run the coding-module suite + the full acp module suite + guard**

Run: `bun test tests/modules/coding/ tests/architecture-guard.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full test suite**

Run: `bun test`
Expected: PASS — no duplicate-tool assertions fail; the deleted plugin suites are gone; the module suites cover the behavior.

- [ ] **Step 8: Commit (atomic cutover)**

```bash
git add src/modules/coding/module.ts tests/modules/coding/module.test.ts
git commit -m "feat(coding): wire acp contributions into coding module; retire acp plugin"
```

---

## Task 9: Full verification + release note

**Files:**

- Modify: release notes / changelog (locate via `rg -l "release" docs` or the repo's changelog convention)

- [ ] **Step 1: Run the full verification suite**

Run: `bun check:full`
Expected: all 12 checks PASS (lint, typecheck, format:check, license-headers, knip, test, test:client, duplicates, review-loop:{lint,typecheck,format:check,test}).

If `knip` flags anything: it should now be clean (Task 5's dormant exports are consumed by Task 8). If a `knip.jsonc` entry is needed for a type-only import that knip cannot follow, mirror the existing sibling entries (as done for `fetcher-schemas-*` in prior phases) and include it in this commit.

- [ ] **Step 2: Run the client + visual checks not covered by `bun test`**

Run: `bun test:client`
Expected: PASS. (The settings UI already renders module sections via the generic `AdminModuleSectionsSection` built in phase 2c-3a-2; the acp magi section now appears there instead of under plugin config.)

- [ ] **Step 3: Add a release note**

Document two operator-facing changes:

1. **Tool rename:** `plugin_acp__*` coding-session tools are now `module_coding__*`; saved per-tool permissions are migrated automatically (migration 067). The `/acp` help command is now `module_coding_acp`.
2. **Per-context gating:** coding-session tools/command/hint now surface only in contexts whose group has at least one configured repository (previously always present). Magi endpoint configuration moves from the plugin-config admin section to **Module settings → Coding sessions (magi)** (same underlying config; no re-entry needed).

- [ ] **Step 4: Commit**

```bash
git add <release-note-file>
git commit -m "docs(release): note acp plugin→coding module migration (tool rename + per-context gate)"
```

- [ ] **Step 5: Final development-branch completion**

Announce and run superpowers:finishing-a-development-branch to verify tests and present completion options.

---

## Self-Review notes (author)

- **Spec coverage:** All 9 tools, `/acp` command, `acp-hint` fragment, magi settings section, and eligibility predicate are re-homed (Tasks 1-5, 8). Tool classification/grouping (Task 6), tool_prefs continuity (Task 7), and plugin retirement (Task 8) are covered. The `coding.secrets` facade removal is explicitly out of scope (deferred to Phase 2c-4).
- **kv/secrets scope split:** `buildRuntimeContext` applies `configContextOf` to kv + repos and passes raw `(storageContextId, chatUserId)` to resolvers — matching the plugin loader exactly. Guarded by `runtime-context.test.ts` (sibling-thread kv sharing).
- **Namespace continuity:** `'acp'` literal preserved for kv + admin config; `transcript-viewer.ts` untouched. Session records and magi config survive.
- **Type consistency:** `toModuleTool` reads `Tool.gate` (`'operator' | undefined`) and `Tool.inputSchema` (holds the Zod schema); `ModuleTool.execute` signature `(input, {storageContextId, chatUserId}, options)` matches `buildModuleToolSet`'s call. `RepoRecord`/`ResolvedMcp` are structurally assignable to the facade shapes.
- **No duplicate-tool window:** module wiring + plugin deletion are one commit (Task 8).
- **Guard safety:** no new file lives under `src/ports/**`; guard is run explicitly in Tasks 6 and 8.
