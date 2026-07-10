<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3d — Relocate `apply_youtrack_command` into the YouTrack Plugin (Pragmatic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the YouTrack-specific `apply_youtrack_command` tool (and the `command-language:youtrack` trait) from core, re-homing the tool as a `contributes.tools` PluginTool inside `plugins/task-provider-youtrack/`, so core names no provider-specific tool.

**Architecture (pragmatic, decided):** The plugin-tool runtime facade (`PluginTaskProviderFacade`) is extended with `applyCommand` (mirroring the existing forwarded methods, gated by `tasks.write`) so a contributed youtrack tool can invoke the bound provider's command support. The tool is gated for a context by `requiredTaskCapabilities: ['tasks.commands']` instead of the `command-language:youtrack` trait — **behavior-equivalent today** (only YouTrack declares `tasks.commands`), which lets us delete the youtrack-specific trait from core entirely (avoiding the core-owned-enum coupling). The tool becomes LLM-visible as `plugin_task_provider_youtrack__apply_youtrack_command`; a DB migration rewrites any saved `tool_prefs` for the old bare name. The tool is classified by the generic `plugin_` metadata fallback (`open-world`), consistent with every other plugin tool — its real safety mechanism is the (in-plugin) confirmation gate, not the risk tier.

**Tech Stack:** Bun; strict TypeScript (`.js` import extensions in core; structural types at the plugin boundary); Zod v4 (usable in this plugin); `bun:test`.

---

## Context for the implementer (read before starting)

- **Plugins cannot static-import `src/`** (the loader rejects it) — but this plugin CAN use `zod` (its `operations/*` already do) and its own files. At the plugin↔host boundary use STRUCTURAL types (see the existing `PluginContextLike` in `plugins/task-provider-youtrack/index.ts`). So the ported tool: builds its Zod schema locally, uses a structural runtime-context type, and INLINES the tiny confidence helper (it can't import `src/tools/confirmation-gate.js`).
- **Behavior-equivalence:** the confirmation gate, bulk-rejection, safe-command allowlist, and single-issue semantics must be preserved. The only intended changes are (a) the tool name (namespaced), (b) risk classification (now the generic plugin `open-world`), (c) internal error/logging plumbing simplifying (no core `ProviderClassifiedError`/`logger` in the plugin — return a structured failure / drop internal debug logs; the orchestrator still logs tool execution).
- **The eligibility subtlety:** `requiredTaskCapabilities: ['tasks.commands']` gates the plugin's _contributions_ (the tool) to contexts where a `tasks.commands`-capable provider is bound. Provider-type registration (`registerTaskProviderType`) is at plugin ACTIVATION (global), NOT eligibility-gated — so adding `requiredTaskCapabilities` does NOT break YouTrack being bindable. Verify this with a test (YouTrack CRUD still works; the tool appears only when YouTrack is bound).
- **The `tasks.write` requirement:** the facade's `applyCommand` is gated by `canWrite` (`permissions.has('tasks.write')`). The youtrack plugin currently has NO `tasks.write` permission, so it must ADD it, or the facade call `deny()`s. This is an accurate declaration ("this plugin writes tasks" — it applies commands).
- **Guard:** `tests/architecture-guard.test.ts` scans only `src/ports/**` — none of the touched core files (`task-capability.ts`, `tools-builder.ts`, `tool-metadata.ts`, `apply-youtrack-command.ts`) are scanned, so removing the youtrack trait won't trip it. A follow-up guard-tightening (scan `src/providers/**` for provider names) is noted but OUT of scope here.

### Verified snippets

`buildPluginTaskProviderFacade` (`src/plugins/tool-runtime.ts:91-124`) forwards each method preserving `this`, gated by `canRead`/`canWrite`, calling `deny(pluginId, 'tasks.write')` when ungated. `PluginTaskProviderFacade = Pick<TaskProvider, 'getTask'|'listTasks'|'searchTasks'|'createTask'|'updateTask'>` (`runtime-types.ts:22-25`). `TaskProvider.applyCommand?(params: {query; taskIds; comment?; silent?}): Promise<TaskCommandResult>` (optional).

The confidence gate (to inline) — `src/tools/confirmation-gate.ts`: `CONFIDENCE_THRESHOLD = 0.85`; `checkConfidence(confidence, actionDescription)` returns `{status:'confirmation_required', message: \`${actionDescription}? This action is irreversible — please confirm.\`}`when`confidence < 0.85`, else `null`; `confidenceField = z.number().min(0).max(1).describe(...)`.

The full core tool to port: `src/tools/apply-youtrack-command.ts` (schema, `SAFE_COMMANDS`, `SINGLE_ASSIGNEE_COMMAND`, `requiresConfirmation`, `describeAction`, bulk rejection, `executeApplyYouTrackCommand`).

Highest migration = `068_task_provider_members` → new migration `069`.

---

## File Structure

- Modify (core facade): `src/plugins/runtime-types.ts`, `src/plugins/tool-runtime.ts`
- Create (plugin tool): `plugins/task-provider-youtrack/tool-apply-command.ts`
- Modify (plugin wiring): `plugins/task-provider-youtrack/index.ts`, `plugins/task-provider-youtrack/plugin.json`, `plugins/task-provider-youtrack/prompt-addendum.ts`
- Delete (core): `src/tools/apply-youtrack-command.ts`, its test `tests/tools/apply-youtrack-command.test.ts`
- Modify (core deletion sites): `src/tools/tools-builder.ts`, `src/tools/tool-metadata.ts`, `src/providers/task-capability.ts`, `src/plugins/manifest-validation.ts` (trait enum), `tests/tools/mock-provider.ts`, `tests/tools/tools-builder.test.ts`, `tests/plugins/task-provider-youtrack/tools-integration.test.ts`
- Create (migration): `src/db/migrations/069_youtrack_command_tool_prefs_rename.ts` + test
- Create (plugin test): `tests/plugins/task-provider-youtrack/apply-command-tool.test.ts`

---

## Task 1: Extend `PluginTaskProviderFacade` with `applyCommand`

Prerequisite: gives a contributed plugin tool a way to invoke the bound provider's command support. No behavior change (nothing calls it yet).

**Files:**

- Modify: `src/plugins/runtime-types.ts`, `src/plugins/tool-runtime.ts`
- Test: the existing facade test (find it: `rg -l "buildPluginTaskProviderFacade" tests`) — likely `tests/plugins/tool-runtime.test.ts` or similar

- [ ] **Step 1: Write the failing test**

In the facade's test suite (locate via `rg -l "buildPluginTaskProviderFacade" tests`; if none tests it directly, add to `tests/plugins/tool-runtime.test.ts` or create it), add:

```ts
test('facade.applyCommand forwards to the provider when the plugin has tasks.write', async () => {
  const calls: unknown[] = []
  const provider = {
    applyCommand: (p: unknown) => {
      calls.push(p)
      return Promise.resolve({ ok: true })
    },
  } as unknown as TaskProvider
  const facade = buildPluginTaskProviderFacade('p', provider, false, true)
  await facade.applyCommand?.({ query: 'for me', taskIds: ['T-1'] })
  expect(calls).toEqual([{ query: 'for me', taskIds: ['T-1'] }])
})

test('facade.applyCommand denies without tasks.write', () => {
  const provider = { applyCommand: () => Promise.resolve({}) } as unknown as TaskProvider
  const facade = buildPluginTaskProviderFacade('p', provider, false, false)
  expect(() => facade.applyCommand?.({ query: 'for me', taskIds: ['T-1'] })).toThrow(/tasks\.write|permission/i)
})
```

(Match the existing test file's import style + `deny`'s actual thrown message — read `src/plugins/deny.ts`.) Run → FAIL (no `applyCommand` on the facade).

- [ ] **Step 2: Add `applyCommand` to the facade type**

`src/plugins/runtime-types.ts`:

```ts
export type PluginTaskProviderFacade = Pick<
  TaskProvider,
  'getTask' | 'listTasks' | 'searchTasks' | 'createTask' | 'updateTask' | 'applyCommand'
>
```

(`applyCommand` is optional on `TaskProvider`, so it stays optional on the facade.)

- [ ] **Step 3: Forward `applyCommand` in the builder**

`src/plugins/tool-runtime.ts`, inside `buildPluginTaskProviderFacade`'s returned object (after `updateTask`):

```ts
    applyCommand(params) {
      if (!canWrite) deny(pluginId, 'tasks.write')
      if (provider === undefined) throw new Error(`Plugin ${pluginId} task provider unavailable`)
      if (provider.applyCommand === undefined) throw new Error(`Plugin ${pluginId} provider has no command support`)
      return provider.applyCommand(params)
    },
```

Keep the `satisfies PluginTaskProviderFacade`. `params`'s type is inferred from `TaskProvider.applyCommand`.

- [ ] **Step 4: Verify**

Run the facade test → PASS. `bun run typecheck` → clean. `bun test tests/plugins/ tests/architecture-guard.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/runtime-types.ts src/plugins/tool-runtime.ts <the facade test file>
git commit -m "feat(plugins): expose applyCommand on the task-provider facade (tasks.write-gated)"
```

---

## Task 2: Relocate the tool into the youtrack plugin (atomic: add plugin tool + delete core)

Add the contributed tool AND delete the core tool in one commit — the plugin tool (`plugin_task_provider_youtrack__apply_youtrack_command`) and the core tool (`apply_youtrack_command`) must not both be live, or a youtrack context surfaces two command tools.

**Files:**

- Create: `plugins/task-provider-youtrack/tool-apply-command.ts`, `tests/plugins/task-provider-youtrack/apply-command-tool.test.ts`
- Modify: `plugins/task-provider-youtrack/index.ts`, `plugins/task-provider-youtrack/plugin.json`, `plugins/task-provider-youtrack/prompt-addendum.ts`
- Delete: `src/tools/apply-youtrack-command.ts`, `tests/tools/apply-youtrack-command.test.ts`
- Modify: `src/tools/tools-builder.ts`, `src/tools/tool-metadata.ts`, `src/providers/task-capability.ts`, `src/plugins/manifest-validation.ts`, `tests/tools/mock-provider.ts`, `tests/tools/tools-builder.test.ts`, `tests/plugins/task-provider-youtrack/tools-integration.test.ts`

- [ ] **Step 1: Create the plugin tool `plugins/task-provider-youtrack/tool-apply-command.ts`**

Port `src/tools/apply-youtrack-command.ts`'s logic, replacing core imports with plugin-local equivalents. Structural runtime-context type; inlined confidence gate; bulk-rejection returns a structured failure (no core `ProviderClassifiedError`); no core `logger`:

```ts
// SPDX headers auto-stamped.
import { z } from 'zod'

const CONFIDENCE_THRESHOLD = 0.85
const NON_EMPTY_STRING = z.string().trim().min(1)
const SAFE_COMMANDS = new Set<string>(['for me', 'vote', 'unvote', 'star', 'unstar'])
const SINGLE_ASSIGNEE_COMMAND = /^for\s+\S+$/iu
const BULK_COMMAND_DISABLED_REASON =
  'Bulk YouTrack commands are disabled for safety. Use structured tools when possible, or run the command one issue at a time. In other words, bulk commands are disabled for safety.'

const normalizeCommand = (query: string): string => query.trim().replace(/\s+/gu, ' ').toLowerCase()
const requiresConfirmation = (query: string, comment: string | undefined, silent: boolean | undefined): boolean => {
  if (comment !== undefined || silent === true) return true
  const n = normalizeCommand(query)
  return !SAFE_COMMANDS.has(n) && !SINGLE_ASSIGNEE_COMMAND.test(n)
}
const describeAction = (
  query: string,
  taskCount: number,
  comment: string | undefined,
  silent: boolean | undefined,
): string => {
  const details = [
    comment === undefined ? null : 'with a comment',
    silent === true ? 'without notifications' : null,
  ].filter((d): d is string => d !== null)
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : ''
  return `Apply YouTrack command "${query.trim()}" to ${taskCount} issue(s)${suffix}`
}

export const applyYouTrackCommandInputSchema = z.object({
  query: NON_EMPTY_STRING.describe('The YouTrack command string to apply, for example "for me" or "State In Progress"'),
  taskIds: z
    .array(NON_EMPTY_STRING)
    .min(1)
    .describe(
      'Provide issue IDs as an array, for example ["TEST-1"]. Multi-issue requests are rejected for safety, so this tool is intended for single-issue use.',
    ),
  comment: z.string().optional().describe('Optional comment to add while applying the command'),
  silent: z.boolean().optional().describe('Whether to suppress notifications for this command when supported'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Your confidence (0–1) that the user explicitly wants this action. Set 1.0 when already confirmed, 0.9 for a direct command, ≤0.7 when indirect. Blocked and confirmation requested if below 0.85.',
    ),
})

// Structural type for the host-provided runtime context (plugins cannot import src/).
type RuntimeContextLike = {
  taskProvider?: {
    applyCommand?(params: { query: string; taskIds: string[]; comment?: string; silent?: boolean }): Promise<unknown>
  }
}

export async function executeApplyYouTrackCommand(
  input: unknown,
  runtimeContext: RuntimeContextLike,
): Promise<unknown> {
  const parsed = applyYouTrackCommandInputSchema.safeParse(input)
  if (!parsed.success) return { status: 'failed', error: 'invalid input for apply_youtrack_command' }
  const { query, taskIds, comment, silent, confidence } = parsed.data
  if (taskIds.length > 1) return { status: 'failed', error: BULK_COMMAND_DISABLED_REASON }
  if (requiresConfirmation(query, comment, silent) && (confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    return {
      status: 'confirmation_required',
      message: `${describeAction(query, taskIds.length, comment, silent)}? This action is irreversible — please confirm.`,
    }
  }
  const applyCommand = runtimeContext.taskProvider?.applyCommand
  if (applyCommand === undefined) return { status: 'failed', error: 'YouTrack command support is unavailable' }
  return applyCommand({ query, taskIds, comment, silent })
}
```

> This preserves the exact confirmation semantics (safe-command allowlist, single-assignee regex, comment/silent forcing confirmation, 0.85 threshold, single-issue-only) and the same reason/message strings. The bulk case + not-configured now RETURN a `{status:'failed'}` shape instead of throwing a classified error — behavior-equivalent for the LLM (same message), simpler internally.

- [ ] **Step 2: Register the tool in `plugins/task-provider-youtrack/index.ts`**

Extend the structural `PluginContextLike` to include `registerTool`, and register the tool in `activate`:

```ts
import { applyYouTrackCommandInputSchema, executeApplyYouTrackCommand } from './tool-apply-command.js'
// ...
type PluginToolLike = {
  name: string
  description: string
  inputSchema?: unknown
  execute: (input: unknown, runtimeContext: unknown, options: unknown) => Promise<unknown>
}
type PluginContextLike = {
  registration: {
    registerTaskProviderType(type: string, factory: (config: Record<string, string>) => TaskProviderLike): void
    registerTool(tool: PluginToolLike): void
  }
}
// ...in activate():
ctx.registration.registerTool({
  name: 'apply_youtrack_command',
  description:
    'Apply a YouTrack command to a single YouTrack issue. Use this only for YouTrack-native command workflows that do not fit the structured tools.',
  inputSchema: applyYouTrackCommandInputSchema,
  execute: (input, runtimeContext) => executeApplyYouTrackCommand(input, runtimeContext as never),
})
```

Match the existing structural-typing style. (`registerTool`'s real signature is `PluginTool` — the structural `PluginToolLike` must be assignable; `inputSchema` is a `z.ZodType`, `execute` takes `(input, runtimeContext, options)`. Verify against how `synthetic-web-search/index.ts` registers its tool and mirror it.)

- [ ] **Step 3: Update `plugins/task-provider-youtrack/plugin.json`**

- `permissions`: add `"tasks.write"` → `["provider.task", "identity", "tasks.write"]`.
- `contributes`: add `"tools": ["apply_youtrack_command"]` alongside `taskProviderTypes`.
- add `"requiredTaskCapabilities": ["tasks.commands"]` (gates the tool to youtrack-bound contexts).
- `providerTraits`: REMOVE `"command-language:youtrack"` (core deletes that trait in Step 6). Keep `"supports-command-language"` (generic, stays in the core enum) and `"custom-fields"`.

- [ ] **Step 4: Update `plugins/task-provider-youtrack/prompt-addendum.ts`**

The prompt text hardcodes the bare tool name (`\`apply*youtrack_command\``). Update it to the namespaced name the LLM will actually see: `` `plugin_task_provider_youtrack\_\_apply_youtrack_command` ``. (Verify the exact namespaced form: `plugin*${sanitizePluginId('task-provider-youtrack')}**apply_youtrack_command`=`plugin_task_provider_youtrack**apply_youtrack_command`.)

- [ ] **Step 5: Write the plugin tool test `tests/plugins/task-provider-youtrack/apply-command-tool.test.ts`**

Port the meaningful cases from `tests/tools/apply-youtrack-command.test.ts`, testing `executeApplyYouTrackCommand(input, fakeRuntimeContext)` directly: schema-invalid → failed; bulk (taskIds>1) → failed with the bulk reason; unsafe command + low confidence → `confirmation_required`; safe command (`for me`) → forwards to `taskProvider.applyCommand` and returns its result; comment/silent forcing confirmation; not-configured (`taskProvider.applyCommand` undefined) → failed. Use a fake `runtimeContext = { taskProvider: { applyCommand: (p) => { calls.push(p); return Promise.resolve(result) } } }`. Assert `applyCommand` receives `{query, taskIds, comment, silent}` (binding-preserving is now the facade's job, tested in Task 1).

- [ ] **Step 6: Delete the core tool + its wiring + the youtrack trait**

- `git rm src/tools/apply-youtrack-command.ts tests/tools/apply-youtrack-command.test.ts`.
- `src/tools/tools-builder.ts`: delete the `apply_youtrack_command` branch in `maybeAddPhaseFiveQueryTools` (the `mode==='normal' && provider.traits.has('command-language:youtrack') && ...` block) and the now-unused `makeApplyYouTrackCommandTool` import.
- `src/tools/tool-metadata.ts`: delete the `apply_youtrack_command: write('task', 'update'),` entry. (Do NOT add a namespaced entry — the tool now uses the generic `plugin_` classification, consistent with all plugin tools.)
- `src/providers/task-capability.ts`: remove `'command-language:youtrack'` from the `TaskProviderTrait` union. Keep `'supports-command-language'` (generic).
- `src/plugins/manifest-validation.ts`: remove `'command-language:youtrack'` from the provider-traits enum (`PLUGIN_MANIFEST_PROVIDER_TRAITS` or equivalent — `rg -n "command-language:youtrack" src/plugins/manifest-validation.ts`). Keep `supports-command-language`.

- [ ] **Step 7: Update the core tests**

- `tests/tools/mock-provider.ts`: `createMockYouTrackProvider()` sets `traits: [..., 'command-language:youtrack', ...]` — remove `'command-language:youtrack'` (keep `'supports-command-language'`). If any mock/test still needs to simulate command support, it now relies on the `tasks.commands` capability + `applyCommand` method presence, not the removed trait.
- `tests/tools/tools-builder.test.ts` (~lines 451-496): the four `apply_youtrack_command` gating tests reference the deleted core branch — DELETE them (the tool is no longer a core builtin; its gating is now plugin eligibility, tested via the plugin path). If removing them leaves an empty describe, tidy it.
- `tests/plugins/task-provider-youtrack/tools-integration.test.ts`: `EXPECTED_TOOLS` includes `'apply_youtrack_command'` as a core builtin from `makeTools(provider, ...)`. Since it's no longer a core builtin, REMOVE it from `EXPECTED_TOOLS` (the `makeTools(provider)` surface no longer includes it — plugin tools come through the plugin path, not the raw-provider `makeTools`). If this integration test is meant to also cover the plugin-contributed tool, that requires the plugin-tool assembly path (`buildPluginToolSet` with the youtrack plugin active + a bound instance) — if the test doesn't already exercise that path, do NOT force it here; the new `apply-command-tool.test.ts` covers the tool's behavior. Note in your report whether integration coverage of the contributed tool exists or is a gap for a follow-up.

- [ ] **Step 8: Verify**

- `rg -n "command-language:youtrack" src plugins tests` → ZERO hits (removed from core union, manifest enum, youtrack.json, mocks, tests).
- `rg -n "apply_youtrack_command" src` → ZERO hits (gone from core; lives only in the plugin + its tests now).
- `rg -n "makeApplyYouTrackCommandTool|apply-youtrack-command" src tests` → ZERO.
- `bun run typecheck` → clean. `bun run lint` → clean. `bun run knip` → clean (the deleted tool's exports are gone; no orphans).
- `bun test` → full suite green (report counts). `bun test tests/architecture-guard.test.ts` → PASS.
- Behavioral check: confirm a test proves the youtrack plugin still registers its provider type + the contributed tool assembles when youtrack is the bound provider (via `buildPluginToolSet` or an existing plugin-activation test). If no such test exists, note it.

- [ ] **Step 9: Commit (atomic relocation)**

```bash
git add -A
git commit -m "refactor(youtrack): relocate apply_youtrack_command into the plugin; remove youtrack trait from core"
```

`git status` should show: the deleted core tool + test, the modified core deletion sites, the new plugin tool + test, the plugin wiring (index.ts/plugin.json/prompt-addendum), and the updated core tests. Nothing unexpected.

---

## Task 3: Migrate `tool_prefs` for the renamed tool

**Files:**

- Create: `src/db/migrations/069_youtrack_command_tool_prefs_rename.ts`, `tests/db/migrations/069_youtrack_command_tool_prefs_rename.test.ts`
- Modify: `src/db/index.ts` (register in core `MIGRATIONS`)

- [ ] **Step 1: Write the test**

Mirror `tests/db/migrations/067_acp_tool_prefs_rename.test.ts` (the direct precedent). Seed a `user_config` `tool_prefs` row whose `toolOverrides` has `apply_youtrack_command: 'allow'` (+ an unrelated key); run the migration; assert the key is rewritten to `plugin_task_provider_youtrack__apply_youtrack_command` with the permission + other keys preserved; plus the no-op (no matching key), malformed-JSON, and missing-table cases. Run → FAIL (migration missing).

- [ ] **Step 2: Create `src/db/migrations/069_youtrack_command_tool_prefs_rename.ts`**

Copy the structure of `067_acp_tool_prefs_rename.ts` exactly, but this is an EXACT-key rename (not a prefix): rewrite `toolOverrides` key `'apply_youtrack_command'` → `'plugin_task_provider_youtrack__apply_youtrack_command'` (only that key; leave all others), guarded by `tableExists(db, 'user_config')`, idempotent (only rewrites when the old key is present), tolerant of malformed JSON. `id: '069_youtrack_command_tool_prefs_rename'`.

- [ ] **Step 3: Register in `src/db/index.ts`**

Add the import + append `migration069YoutrackCommandToolPrefsRename` to the core `MIGRATIONS` array (this is a core `user_config` data fix — like `067` was owned by a module, but there's no youtrack _module_, so it lives in core `MIGRATIONS`). Update `tests/db/migration-registration.test.ts`'s "last core migration" assertion if it pins one.

- [ ] **Step 4: Verify + commit**

`bun test tests/db/migrations/069_youtrack_command_tool_prefs_rename.test.ts tests/db/migration-registration.test.ts` → PASS. `bun run typecheck` → clean.

```bash
git add src/db/migrations/069_youtrack_command_tool_prefs_rename.ts tests/db/migrations/069_youtrack_command_tool_prefs_rename.test.ts src/db/index.ts tests/db/migration-registration.test.ts
git commit -m "feat(db): migrate tool_prefs apply_youtrack_command -> plugin_task_provider_youtrack__ namespaced name"
```

---

## Task 4: Final verification + docs + release note

**Files:**

- Modify: `docs/youtrack-tools.md`, `plugins/task-provider-youtrack/README.md`, changelog/release note (locate)

- [ ] **Step 1: Full gate** — `bun check:full` → 12/12 green. `bun test:client` if not covered. If a substantive failure appears, STOP and report BLOCKED.

- [ ] **Step 2: Docs** — update the LLM-facing/reference docs that name the tool: `docs/youtrack-tools.md` (×3 mentions of `apply_youtrack_command`) and `plugins/task-provider-youtrack/README.md:63` — reflect that it's now a plugin-contributed tool named `plugin_task_provider_youtrack__apply_youtrack_command` (and gated by the plugin being enabled in a youtrack-bound context). Leave historical `docs/archive/*` untouched.

- [ ] **Step 3: Release note** — via conventional commits (git-cliff generates the changelog; do NOT hand-edit `CHANGELOG.md`). The operator-facing change (the tool rename + its automatic `tool_prefs` migration) is captured by Task 2's + Task 3's commit messages; add a durable note to `docs/youtrack-tools.md` if operators need the "tool renamed, permissions auto-migrated" guidance.

- [ ] **Step 4: Commit** — `git add <docs>` + `git commit -m "docs(youtrack): apply_youtrack_command is now a plugin-contributed tool"`.

---

## Self-Review notes (author)

- **Spec coverage (§9.4 "move `apply_youtrack_command` into the youtrack plugin"):** the tool + the youtrack-specific trait are gone from core; the tool lives in the plugin as a contributed tool. Per the chosen PRAGMATIC path, gating is by the `tasks.commands` capability (behavior-equivalent today) rather than a new trait-eligibility mechanism — this is why "no new port" holds and the youtrack trait can be deleted from core.
- **The facade extension (Task 1)** is the one real core-infra change — a small, well-precedented addition (mirrors the existing forwarded methods, `tasks.write`-gated).
- **Atomic relocation (Task 2)** avoids a double-registered command tool; behavior (confirmation gate, bulk rejection, safe commands, single-issue) is preserved, with only the intended changes (namespaced name, generic `open-world` classification, simplified internal error/logging).
- **Known residual/caveats (flagged, accepted per the decision):** (a) gating by capability is theoretically imprecise for a hypothetical future non-youtrack `tasks.commands` provider; (b) the tool's risk classification is now the generic plugin `open-world` (its real gate is the in-plugin confirmation flow); (c) a follow-up could tighten the architecture guard to scan `src/providers/**` now that the youtrack trait is gone.
- **tool_prefs continuity (Task 3):** the bare→namespaced rename is migrated (precedent `067`).
- **Scope discipline:** does NOT build a general trait-eligibility mechanism, does NOT touch other providers, does NOT relocate other core provider plumbing.
