<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Knip Ignore-List Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `ignoreIssues` in knip config from ~80 entries to ≤6 lines (4 glob lines + ≤2 justified), `ignoreDependencies` from 4 to 3, by tracing Svelte components, introducing a `*.testing.ts` seam convention, and deleting real dead code.

**Architecture:** Convert `knip.jsonc` → `knip.config.ts` with a custom `.svelte` compiler (knip's built-in svelte plugin cannot self-register because bun's global-cache install layout defeats its dependency probe) and `client/**/*.svelte!` in `project` (the `!` production marker is load-bearing — without it the production graph ignores components). Then iterate the remaining report category-by-category.

**Tech Stack:** knip 6.14.1 via `knip-bun --strict --no-gitignore`, Bun, Svelte 5, TypeScript.

**Spec deviations (research findings, approved design otherwise unchanged):**

1. An empirical audit (knip run with emptied `ignoreIssues`) showed many current entries are **stale**: `src/types/config.ts`, `src/chat/mattermost/action-{signing,callbacks}.ts`, `src/providers/registry.ts`, `src/debug/state-collector.ts`, all 4 `tests/scripts/*` helpers, `client/admin/index.ts`. They delete with zero code changes.
2. Phase 1 requires `knip.config.ts` (JSONC can't hold compiler functions) — knip's Svelte plugin enables but never registers its compiler (`hasDependency('svelte')` fails under bun's node_modules-less layout; verified in `dist/WorkspaceWorker.js:165`).
3. Test seams use **re-export shims**, not code moves: seams like `resetNotifyTokenCacheForTesting` mutate module-private state and cannot move without exporting that state. The shim is `export { seam } from './module.js'` in `module.testing.ts`; one `ignoreIssues` glob covers all shims.
4. Phase 3 mostly evaporated: svelte tracing resolved `byok-provider-fetchers.ts` and `fetcher-schemas-llm-providers.ts`; mattermost/providers-registry entries were stale. Remaining deletes: `PROVIDER_TYPE_BASE_URLS`, `LlmRole`, and genuinely dead client symbols the audit surfaced.
5. New finding: 4 UI components (`PanelShell`, `StatusDot`, `FormRow`, `Tag`) are consumed only by stories/visual tests — move under the already-ignored `client/stories/` dev harness.
6. Task-1 implementation finding: under `--strict`, production-graph imports of `svelte` (26 sites) report `unlisted` because `svelte` sat in `devDependencies`. Root-cause fix: move `svelte` to `dependencies` (the client production graph genuinely imports it; it is bundled into production client assets). Also the kaneo bridge root is `auto-provision.ts` (the plugin index does `import.meta.require('./auto-provision.js')`), so the bridge entry is `plugins/task-provider-kaneo/auto-provision.ts!`, not `provision.ts!`.

---

### Task 0: Baseline capture

**Files:**

- None (read-only)

- [ ] **Step 1: Capture current knip output**

Run: `bun run knip`
Expected: exit 0, no output issues (current config passes). This confirms the baseline is green before changes.

- [ ] **Step 2: No commit**

Nothing to commit; proceed to Task 1.

---

### Task 1: Convert to `knip.config.ts` with Svelte tracing

**Files:**

- Create: `knip.config.ts`
- Delete: `knip.jsonc`

- [ ] **Step 1: Write `knip.config.ts`**

Exact content (comments are the guardrail policy — keep them):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// GUARDRAIL: keep the ignore surface minimal. New ignores require an inline
// justification comment naming the dynamic mechanism knip cannot trace, and a
// linked task when the gap is temporary. Prefer code fixes (moving dead code,
// *.testing.ts shims, entry declarations) over new ignore lines.

// knip's built-in Svelte plugin enables but never registers its compiler:
// its hasDependency('svelte') probe fails under bun's node_modules-less
// install layout. Register an equivalent script-body extractor here.
const svelteCompiler = (source: string): string => {
  const scripts: string[] = []
  for (const m of source.matchAll(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script>/gm)) {
    if (m[1]) scripts.push(m[1])
  }
  return scripts.join(';\n')
}

export default {
  // The review-loop workspace is a standalone developer tool with its own
  // check suite (review-loop:lint/typecheck/format:check/test) run separately
  // in check:full. knip-bun cannot resolve its .js-extension imports.
  ignoreWorkspaces: ['review-loop'],

  compilers: { '.svelte': svelteCompiler },

  // Entry points not auto-detected from package.json scripts.
  entry: [
    'client/admin/index.ts!',
    'client/debug/index.ts!',
    'client/settings/index.ts!',
    'client/transcript/index.ts!',
    'scripts/behavior-audit/index.ts!',
    'scripts/behavior-audit/profile-clustering.ts!',
    'scripts/behavior-audit/tune-embedding.ts!',
    'scripts/behavior-audit/reset.ts!',
    'scripts/behavior-audit/migrate-trust.ts!',
    // Stable production/public compatibility boundaries consumed by the
    // plugin-core-separation refactor.
    'src/coding-sessions/configure.ts!',
    'src/coding-sessions/session-record.ts!',
    'src/coding-sessions/store.ts!',
    'playwright.config.ts!',
    'strybk.config.ts!',
    // First-party plugin entry points are loaded dynamically by the plugin
    // loader, so they have no static importer.
    'plugins/*/index.ts!',
    // Plugin runtime bridges loaded via import.meta.require(); declaring them
    // entries lets knip trace their static imports (provider clients, config).
    'plugins/audio-transcribe/runtime.ts!',
    'plugins/task-provider-kaneo/auto-provision.ts!',
    // Test-seam shims: re-export test-only symbols so tests have an explicit
    // import site; see the *.testing.ts ignoreIssues glob below.
    'src/**/*.testing.ts!',
    'client/**/*.testing.ts!',
  ],

  // All source files (production only). The `!` production marker on the
  // .svelte glob is load-bearing: without it the production graph skips
  // components and every client export looks orphaned.
  project: [
    'src/**/*.ts!',
    'client/**/*.ts!',
    'client/**/*.svelte!',
    'scripts/behavior-audit/**/*.ts!',
    'plugins/**/*.ts!',
  ],

  rules: {
    files: 'error',
    dependencies: 'error',
    devDependencies: 'error',
    optionalPeerDependencies: 'error',
    unlisted: 'error',
    binaries: 'error',
    unresolved: 'error',
    exports: 'error',
    types: 'error',
    nsExports: 'error',
    nsTypes: 'error',
    duplicates: 'error',
    enumMembers: 'error',
    catalog: 'error',
  },

  // @stryker-mutator/typescript-checker is loaded at runtime by Stryker, not
  // imported. msw is the dev-only mock layer consumed exclusively by the
  // Storybook story harness under client/stories/** (ignored below).
  // @crvy/strybk is imported by strybk.config.ts but knip-bun cannot resolve
  // the package (runtime CLI config consumer).
  ignoreDependencies: ['@stryker-mutator/typescript-checker', 'msw', '@crvy/strybk'],

  ignoreIssues: {
    // Test-seam shims: exports exist only for tests; production modules keep
    // the symbols (they mutate module-private state and cannot move).
    'src/**/*.testing.ts': ['exports', 'types'],
    'client/**/*.testing.ts': ['exports', 'types'],
    // Plugin entry-point default exports, provider classes, and validateConfig
    // are resolved dynamically by the plugin loader (path-based import +
    // manifest `providerConfigValidator`); bridge modules (runtime,
    // auto-provision, provision, client) are consumed through
    // import.meta.require() chains knip cannot trace. No static consumer exists.
    'plugins/*/{index,validate-config,provider,runtime,auto-provision,provision,client}.ts': ['exports'],
    // strybk.config.ts default export is consumed by the crvy-strybk CLI at
    // runtime via --config; no static importer exists.
    'strybk.config.ts': ['exports'],
  },

  includeEntryExports: true,
  treatConfigHintsAsErrors: true,
  ignoreExportsUsedInFile: true,

  // Migrations are runtime-only SQL; client/stories/** is the dev-only
  // Storybook harness; tests/visual/** is the Playwright screenshot suite.
  ignore: ['src/db/migrations/**', 'client/stories/**', 'tests/visual/**'],
}
```

- [ ] **Step 2: Move `svelte` to `dependencies`, delete `knip.jsonc`, verify the expected report**

In `package.json`, move the `"svelte": "^5"` line from `devDependencies` to `dependencies` (alphabetical position), then run `bun install` to update `bun.lock`. Rationale: the client production graph imports `svelte` in 26 places and it is bundled into production client assets; under `--strict` a devDependency placement makes every such import `unlisted`.

Run: `rm knip.jsonc && bun run knip`
Expected: exit 1 with ONLY this residual issue set (from the pre-verified audit; counts may shift by ±1 if master moved):

- Unused files (≤6): `client/debug/types.ts`, `client/shared/PanelShell.svelte`, `client/shared/StatusDot.svelte`, `client/shared/ui/FormRow.svelte`, `client/shared/ui/Tag.svelte`, and possibly `plugins/task-provider-kaneo/auto-provision.ts` if the bridge entry does not cascade. The bridge entries (`runtime.ts!`, `auto-provision.ts!`) should cascade-resolve `transcription.ts`, `provision.ts`, `provision-messages.ts`
- Unused exports (~46): 8 client symbols (sectionLabel, syncSectionFromLocation, fetchAdminIdentity, LOG_CAP, emptyFilter, patchByok, getKaneoCredentials, escapeHtml); all src test seams; bridge-module exports the widened plugin glob does not cover (registerAudioTranscribe, maybeProvisionKaneo, isKaneoSessionCookie SHOULD be covered by the glob — if they still appear, verify the glob matches and fix it)
- Unused types (11): AdminSection, SubjectGrowthPoint, ByokField, PluginEligibility, AuthorizedGroupEntry, TaskInstanceView, PlatformProviderTypeView, TaskProviderTypeView, AdminInstanceView, ApplyInstancesResult, LlmRole
- NO `Unlisted dependencies` section (the svelte move must eliminate it)

If anything ELSE appears, stop and reconcile before continuing.

- [ ] **Step 3: Commit**

```bash
git add knip.config.ts knip.jsonc
git commit -m "refactor(knip): convert to TS config with svelte component tracing"
```

---

### Task 2: Move story-only UI components under `client/stories/`

**Files:**

- Move: `client/shared/PanelShell.svelte` + `client/shared/PanelShell.stories.svelte` → `client/stories/components/PanelShell.svelte` + `client/stories/components/PanelShell.stories.svelte`
- Move: `client/shared/StatusDot.svelte` + `client/shared/StatusDot.stories.svelte` → `client/stories/components/`
- Move: `client/shared/ui/FormRow.svelte` + `client/shared/ui/FormRow.stories.svelte` → `client/stories/components/ui/`
- Move: `client/shared/ui/Tag.svelte` + `client/shared/ui/Tag.stories.svelte` → `client/stories/components/ui/`
- Modify: `tests/client/shared/ui/FormRow.test.ts` (import path)
- Modify: `tests/client/shared/ui/Tag.test.ts` (import path)
- Modify: `tests/visual/shared/PanelShell.spec.ts`, `tests/visual/shared/StatusDot.spec.ts`, `tests/visual/shared/ui/FormRow.spec.ts`, `tests/visual/shared/ui/Tag.spec.ts` (story lookup paths if referenced)

- [ ] **Step 1: Verify no production consumer exists**

Run: `grep -rl "PanelShell\|StatusDot\|FormRow\|Tag\.svelte" client/ --include="*.svelte" --include="*.ts" | grep -v stories | grep -v "\.stories\."`
Expected: only the component files themselves and their stories (no section/component consumers). If a production consumer appears, keep that component in place and skip it.

- [ ] **Step 2: Move files with git**

```bash
mkdir -p client/stories/components/ui
git mv client/shared/PanelShell.svelte client/shared/PanelShell.stories.svelte client/stories/components/
git mv client/shared/StatusDot.svelte client/shared/StatusDot.stories.svelte client/stories/components/
git mv client/shared/ui/FormRow.svelte client/shared/ui/FormRow.stories.svelte client/stories/components/ui/
git mv client/shared/ui/Tag.svelte client/shared/ui/Tag.stories.svelte client/stories/components/ui/
```

- [ ] **Step 3: Fix story-internal imports**

Each moved `.stories.svelte` imports its component via `./Name.svelte` — the relative path is unchanged by the move, so no edit needed. Verify:

Run: `grep -n "from '\./" client/stories/components/*.stories.svelte client/stories/components/ui/*.stories.svelte`
Expected: each story imports `./PanelShell.svelte` / `./StatusDot.svelte` / `./FormRow.svelte` / `./Tag.svelte` respectively; all resolve within the destination directory.

If a story imports shared fixtures from `client/stories/` (e.g. `../mock-...`), fix the relative depth (`../` instead of `./` or `../../` as needed).

- [ ] **Step 4: Fix test imports**

In `tests/client/shared/ui/FormRow.test.ts` and `tests/client/shared/ui/Tag.test.ts`, rewrite the component import from `../../../client/shared/ui/FormRow.svelte` (resp. `Tag.svelte`) to `../../../client/stories/components/ui/FormRow.svelte` (resp. `Tag.svelte`).

Run: `grep -rn "client/shared/ui/\(FormRow\|Tag\)\|client/shared/\(PanelShell\|StatusDot\)" tests/`
Expected: no matches after the rewrite.

- [ ] **Step 5: Verify**

Run: `bun run knip`
Expected: the 4 components no longer listed under unused files.

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/`
Expected: PASS (FormRow/Tag tests green against new paths).

- [ ] **Step 6: Commit**

```bash
git add client/ tests/
git commit -m "refactor(client): move story-only UI components into stories harness"
```

---

### Task 3: Delete genuinely dead client symbols

**Files:**

- Modify: `client/admin/admin.svelte.ts` (delete `sectionLabel`, `AdminSection`)
- Modify: `client/settings/fetchers.ts` (delete `getKaneoCredentials`)
- Modify: `client/admin/global-stats.svelte.ts` (delete `SubjectGrowthPoint`)
- Modify: `client/settings/fetcher-schemas.ts` (delete `ByokField`, `PluginEligibility`)
- Modify: `client/shared/api-types.ts` (delete `TaskInstanceView`, `PlatformProviderTypeView`, `TaskProviderTypeView`, `AdminInstanceView`, and resolve `ApplyInstancesResult`, `AuthorizedGroupEntry`)

- [ ] **Step 1: Confirm each symbol has zero non-test consumers**

Run this exact loop; every line must print only the defining file (and optionally a test file):

```bash
for s in sectionLabel AdminSection getKaneoCredentials SubjectGrowthPoint ByokField PluginEligibility TaskInstanceView PlatformProviderTypeView TaskProviderTypeView AdminInstanceView; do echo "== $s"; grep -rln "\b$s\b" client/ src/ tests/ --include="*.ts" --include="*.svelte"; done
```

Known-audit expectation: each symbol appears only in its defining file. If any symbol shows a production consumer, drop it from the delete list.

- [ ] **Step 2: Resolve `ApplyInstancesResult` and `AuthorizedGroupEntry`**

`ApplyInstancesResult` is imported by `client/settings/fetcher-schemas-instances.ts` and `client/settings/admin-fetchers.ts` yet still flagged — inspect both import sites:

Run: `grep -n "ApplyInstancesResult" client/settings/fetcher-schemas-instances.ts client/settings/admin-fetchers.ts client/shared/api-types.ts`

If the importers reference it only in dead code paths (unused functions), delete the symbol; if they genuinely use it, the flag means the usage is type-position in an unused export — trace and delete the dead chain. `AuthorizedGroupEntry` is imported only by `tests/client/shared/api-types.test.ts` — delete the type and its test block (it mirrors a server payload shape; if the server still emits it, keep and instead move it next to the server route schema — decide by grepping `grep -rn "AuthorizedGroupEntry\|authorized_groups" src/ | head`).

- [ ] **Step 3: Delete the symbols**

Remove each confirmed-dead export (and its now-unused imports, if any) from the defining files listed above. Do not touch anything else in those files.

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun run knip`
Expected: typecheck clean; knip no longer lists any symbol from this task.

Run: `bun run test:client`
Expected: PASS (adjust `tests/client/shared/api-types.test.ts` only if Step 2 deleted a type it covered).

- [ ] **Step 5: Commit**

```bash
git add client/ tests/
git commit -m "chore(client): delete dead exports and types surfaced by svelte tracing"
```

---

### Task 4: `*.testing.ts` seam convention — debug/dashboard seams

**Files:**

- Create: `src/dashboard-auth/store.testing.ts`, `src/debug/server.testing.ts`, `src/debug/event-bus.testing.ts`, `src/debug/turn-assembly.testing.ts`
- Modify: test files importing the seams (see Step 2)

- [ ] **Step 1: Create the four shims**

`src/dashboard-auth/store.testing.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { setStoreDb } from './store.js'
```

`src/debug/server.testing.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { routeRequestForTest } from './server.js'
```

`src/debug/event-bus.testing.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { subscribeCountForTest } from './event-bus.js'
```

`src/debug/turn-assembly.testing.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export { resetTurnBuffers } from './turn-assembly.js'
```

- [ ] **Step 2: Rewrite test imports**

For each seam, find importers and change the module specifier from the production module to the `.testing.js` shim. Exact commands:

```bash
grep -rln "setStoreDb" tests/ | xargs sed -i '' "s|from '\(.*\)dashboard-auth/store\.js'|from '\1dashboard-auth/store.testing.js'|"
grep -rln "routeRequestForTest" tests/ | xargs sed -i '' "s|from '\(.*\)debug/server\.js'|from '\1debug/server.testing.js'|"
grep -rln "subscribeCountForTest" tests/ | xargs sed -i '' "s|from '\(.*\)debug/event-bus\.js'|from '\1debug/event-bus.testing.js'|"
grep -rln "resetTurnBuffers" tests/ | xargs sed -i '' "s|from '\(.*\)debug/turn-assembly\.js'|from '\1debug/turn-assembly.testing.js'|"
```

Known importers (verify with the greps): `setStoreDb` — tests/debug/{auth-routes,logs-route-content,server,debug-smoke,server-stats,server-auth,admin-identity-mappings-route}.test.ts; `routeRequestForTest` — tests/debug/{settings-clock-routing,server-settings-static,admin-identity-mappings-route,server-auth,notify-route-server}.test.ts; `subscribeCountForTest` — tests/debug/state-collector-lifecycle.test.ts.

Note: files importing BOTH the seam and production symbols from the same module (e.g. `server-settings-static.test.ts` imports `routeRequestForTest, routeSettingsStatic`) need a manual split into two import lines — sed handles only the single-symbol case. Check each touched file.

- [ ] **Step 3: Verify**

Run: `bun run knip`
Expected: the four seam symbols no longer listed; no new issues (shims are entries, their exports covered by the glob).

Run: `bun test tests/debug/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ tests/
git commit -m "refactor(tests): route debug/dashboard test seams through *.testing.ts shims"
```

---

### Task 5: `*.testing.ts` seams — chat/tools/instances

**Files:**

- Create: `src/chat/group-admin-live.testing.ts`, `src/chat/permission-prompt.testing.ts`, `src/tools/compaction/result-store.testing.ts`, `src/tools/disclosure/embedding-tool-retriever.testing.ts`, `src/tools/tool-preferences.testing.ts`, `src/instances/admin-store.testing.ts`, `src/instances/context-store.testing.ts`
- Modify: importing test files

- [ ] **Step 1: Create the seven shims** (same header as Task 4)

```ts
// src/chat/group-admin-live.testing.ts
export { clearGroupAdminLiveCache } from './group-admin-live.js'

// src/chat/permission-prompt.testing.ts
export { resetPermissionPromptForTesting } from './permission-prompt.js'

// src/tools/compaction/result-store.testing.ts
export { setResultStoreClockForTesting, clearResultStoreForTesting } from './result-store.js'

// src/tools/disclosure/embedding-tool-retriever.testing.ts
export { clearBriefEmbeddingCachesForTesting } from './embedding-tool-retriever.js'

// src/tools/tool-preferences.testing.ts
export { partitionToolNames, cycleDomain, cycleTool } from './tool-preferences.js'

// src/instances/admin-store.testing.ts
export { listAdminsForPlatform } from './admin-store.js'

// src/instances/context-store.testing.ts
export { listContextsByTaskInstance, listContextsByPlatformInstance } from './context-store.js'
```

(Each in its own file with the license header; shown compactly here.)

- [ ] **Step 2: Rewrite test imports** (same sed pattern as Task 4, per symbol)

```bash
grep -rln "clearGroupAdminLiveCache" tests/ | xargs sed -i '' "s|from '\(.*\)chat/group-admin-live\.js'|from '\1chat/group-admin-live.testing.js'|"
grep -rln "resetPermissionPromptForTesting" tests/ | xargs sed -i '' "s|from '\(.*\)chat/permission-prompt\.js'|from '\1chat/permission-prompt.testing.js'|"
grep -rln "ResultStoreClockForTesting\|clearResultStoreForTesting" tests/ | xargs sed -i '' "s|from '\(.*\)compaction/result-store\.js'|from '\1compaction/result-store.testing.js'|"
grep -rln "clearBriefEmbeddingCachesForTesting" tests/ | xargs sed -i '' "s|from '\(.*\)disclosure/embedding-tool-retriever\.js'|from '\1disclosure/embedding-tool-retriever.testing.js'|"
grep -rln "partitionToolNames\|cycleDomain\|cycleTool" tests/ | xargs sed -i '' "s|from '\(.*\)tools/tool-preferences\.js'|from '\1tools/tool-preferences.testing.js'|"
grep -rln "listAdminsForPlatform" tests/ | xargs sed -i '' "s|from '\(.*\)instances/admin-store\.js'|from '\1instances/admin-store.testing.js'|"
grep -rln "listContextsByTaskInstance\|listContextsByPlatformInstance" tests/ | xargs sed -i '' "s|from '\(.*\)instances/context-store\.js'|from '\1instances/context-store.testing.js'|"
```

Manually split any mixed imports (e.g. `tests/instances/context-store.test.ts` imports both production and seam symbols).

- [ ] **Step 3: Verify**

Run: `bun run knip && bun test tests/chat/ tests/tools/ tests/instances/ tests/bot.test.ts`
Expected: knip no longer lists these symbols; tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ tests/
git commit -m "refactor(tests): route chat/tools/instances test seams through *.testing.ts shims"
```

---

### Task 6: `*.testing.ts` seams — remaining src + client

**Files:**

- Create: `src/announcements/broadcast.testing.ts`, `src/llm-model-builder.testing.ts`, `src/llm-providers/store.testing.ts`, `src/notify-token.testing.ts`, `src/plugins/contributions.testing.ts`, `src/plugins/registry.testing.ts`, `src/stats/hashing.testing.ts`, `src/stats/index.testing.ts`, `src/usage/index.testing.ts`, `src/cache.testing.ts`, `client/admin/admin.testing.ts`, `client/admin/fetchers.testing.ts`, `client/debug/log-filter-url.testing.ts`, `client/debug/handlers.testing.ts`, `client/settings/fetchers.testing.ts`, `client/shared/helpers.testing.ts`
- Modify: importing test files

- [ ] **Step 1: Audit `src/cache.ts` and `src/config.ts` first**

`clearCachedTools` had zero consumers in research — verify and delete instead of shimming:

Run: `grep -rn "clearCachedTools\b" src/ tests/ plugins/ --include="*.ts" | grep -v "clearCachedToolsByPrefix"`
Expected: only `src/cache.ts` definition lines. If so, delete `clearCachedTools` (checking first it is not used inside `cache.ts` itself: `grep -n "clearCachedTools" src/cache.ts`). `getLatestCachedToolsForContext` is test-only → shim it.

`src/config.ts` flagged exports (`isSensitiveKey`, `setConfig`, `isConfigKey`, `getAllConfig`, `maskValue`) had no static consumers:

Run: `for s in isSensitiveKey setConfig isConfigKey getAllConfig maskValue; do echo "== $s"; grep -rln "\b$s\b" src/ tests/ plugins/ client/ --include="*.ts"; done`

For each: consumer-less → delete; test-only → shim in `src/config.testing.ts`. (If all five are consumer-less, no `src/config.testing.ts` is created.)

- [ ] **Step 2: Create the remaining shims** (same header; one symbol-set per line)

```ts
// src/announcements/broadcast.testing.ts
export { defaultBroadcastDepsForTest } from './broadcast.js'

// src/llm-model-builder.testing.ts
export { clearModelBuilderCacheForTesting } from './llm-model-builder.js'

// src/llm-providers/store.testing.ts
export { clearLlmAdminCacheForTesting } from './store.js'

// src/notify-token.testing.ts
export { resetNotifyTokenCacheForTesting } from './notify-token.js'

// src/plugins/contributions.testing.ts
export { resetContributionCollisionStateForTesting } from './contributions.js'

// src/plugins/registry.testing.ts
export { resetPluginRegistryForTesting } from './registry.js'

// src/stats/hashing.testing.ts
export { resetStatsSaltCacheForTesting } from './hashing.js'

// src/stats/index.testing.ts
export { clearStatsCacheForTesting } from './index.js'

// src/usage/index.testing.ts
export { resetUsageRecorderForTesting } from './index.js'

// src/cache.testing.ts (only if Step 1 kept the symbol)
export { getLatestCachedToolsForContext } from './cache.js'

// client/admin/admin.testing.ts
export { syncSectionFromLocation } from './admin.svelte.js'

// client/admin/fetchers.testing.ts
export { fetchAdminIdentity } from './fetchers.js'

// client/debug/log-filter-url.testing.ts
export { emptyFilter } from './log-filter-url.js'

// client/debug/handlers.testing.ts
export { LOG_CAP } from './handlers.js'

// client/settings/fetchers.testing.ts
export { patchByok } from './fetchers.js'

// client/shared/helpers.testing.ts
export { escapeHtml } from './helpers.js'
```

- [ ] **Step 3: Rewrite test imports** (same sed pattern; known importers from research)

- `resetNotifyTokenCacheForTesting`: tests/debug/{notify-route,notify-route-server}.test.ts
- `resetPermissionPromptForTesting`: already done in Task 5
- `clearStatsCacheForTesting`: tests/debug/server-stats.test.ts
- `subscribeCountForTest` siblings: `pingClientsForTest`/`resetClientsForTest` in tests/debug/state-collector-lifecycle.test.ts were NOT flagged (production-consumed) — leave them
- `fetchAdminIdentity`: tests/client/admin/fetchers.test.ts
- `LOG_CAP`: tests/client/debug/handlers.test.ts
- `emptyFilter`: tests/client/debug/log-filter-url.test.ts
- `patchByok`: tests/client/settings/byok-fetchers.test.ts
- `escapeHtml`: tests/client/debug/helpers.test.ts
- `syncSectionFromLocation`: tests/client/admin/admin.svelte.test.ts
- everything else: `grep -rln "<symbol>" tests/` then rewrite with the sed pattern

- [ ] **Step 4: Verify**

Run: `bun run knip && bun run typecheck && bun run test && bun run test:client`
Expected: knip lists zero seam symbols; all suites PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ client/ tests/
git commit -m "refactor(tests): route remaining test seams through *.testing.ts shims; drop dead cache/config exports"
```

---

### Task 7: Delete forward-compat leftovers and resolve `client/debug/types.ts`

**Files:**

- Modify: `src/llm-providers/types.ts` (delete `PROVIDER_TYPE_BASE_URLS`, `LlmRole`)
- Inspect & resolve: `client/debug/types.ts`

- [ ] **Step 1: Confirm zero consumers, then delete**

Run: `grep -rn "PROVIDER_TYPE_BASE_URLS\|LlmRole" src/ client/ tests/ --include="*.ts" --include="*.svelte" | grep -v "src/llm-providers/types.ts"`
Expected: no production consumers (the client mirror in `client/settings/fetcher-schemas-llm-providers.ts` has its own copies — do not touch that file, it is consumed by `.svelte` sections).

Delete `PROVIDER_TYPE_BASE_URLS` and `LlmRole` from `src/llm-providers/types.ts`. If `LlmRole` is referenced inside that same file, remove only the `export` keyword.

- [ ] **Step 2: Resolve `client/debug/types.ts`**

The only importer is `tests/client/debug/types.test.ts` (`import type { SessionDetail }`).

Run: `cat client/debug/types.ts && head -40 tests/client/debug/types.test.ts`

If the file exports only types consumed by that test (and `.svelte` components now trace-clean without it), move the type(s) into the consuming test-side module or delete the file + fold the test into the consumer's test. If the test validates runtime schema code, move that code to where the `.svelte` consumers can reach it and re-run knip. End state: `client/debug/types.ts` no longer listed as an unused file, with no new ignore line.

- [ ] **Step 3: Verify**

Run: `bun run knip && bun run typecheck && bun run test:client`
Expected: knip clean of these items; typecheck PASS; client tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/llm-providers/types.ts client/debug/ tests/
git commit -m "chore: delete forward-compat llm-provider leftovers; resolve orphan debug types module"
```

---

### Task 8: Coding-sessions public seam via `@public` tags (attempt, fallback documented)

**Files:**

- Modify: `src/coding-sessions/configure.ts`, `src/coding-sessions/store.ts`

- [ ] **Step 1: Tag the three exports**

In `src/coding-sessions/configure.ts` above `configureCodingSessionCapability` (line ~55) and in `src/coding-sessions/store.ts` above `getCodingSessionRecord` (line ~23) and `setCodingSessionRecord` (line ~27), add a JSDoc tag:

```ts
/** @public Intentional public seam for the plugin-core-separation refactor. */
```

- [ ] **Step 2: Check whether knip accepts the tags**

Run: `bun run knip`
Expected A: the three exports disappear from the report (knip's default tag handling treats `@public` exports as public API).
Expected B: they are still listed — then add the fallback to `ignoreIssues` in `knip.config.ts`:

```ts
// Intentional public seam for plugin-core-separation; consumed by the
// refactor branch while master keeps the frozen API surface.
'src/coding-sessions/{configure,store}.ts': ['exports'],
```

Keep whichever outcome works; do not keep both.

- [ ] **Step 3: Commit**

```bash
git add src/coding-sessions/ knip.config.ts
git commit -m "chore(coding-sessions): mark public seam exports for knip"
```

---

### Task 9: Final verification and guardrail check

**Files:**

- Modify: `knip.config.ts` (only if stragglers need one-line justifications)

- [ ] **Step 1: Full knip run**

Run: `bun run knip`
Expected: exit 0, no issues. The entire ignore surface is now:

- `ignoreDependencies` (3): `@stryker-mutator/typescript-checker`, `msw`, `@crvy/strybk`
- `ignoreIssues` (4–5 glob lines): 2 testing-shim globs, plugin dynamic-loading glob, `strybk.config.ts`, optionally the coding-sessions seam
- `ignore` (3 globs, unchanged): migrations, stories, visual tests

- [ ] **Step 2: Full check suite**

Run: `bun run check:verbose`
Expected: all green (lint, typecheck, format:check, knip, test, duplicates, review-loop suite).

- [ ] **Step 3: Reconcile vs. spec target**

Confirm the end state matches the design doc (`docs/superpowers/specs/2026-07-17-knip-ignore-cleanup-design.md`): `ignoreIssues` ≤ ~15 — actual target after research is 4–5 lines, better than spec. If any task had to keep an extra ignore, it must carry an inline justification comment per the guardrail header.

- [ ] **Step 4: Commit (only if config changed)**

```bash
git add knip.config.ts
git commit -m "chore(knip): finalize minimal justified ignore surface"
```

---

## Self-Review Notes

- Spec coverage: Phase 1 → Tasks 1–2; Phase 2 → Tasks 4–6; Phase 3 → Tasks 3, 7; Phase 4 → Tasks 1 (plugin bridge entries), 8, and the plugin glob in Task 1; guardrail → knip.config.ts header + Task 9.
- All symbol names, file paths, and expected outputs were verified against an actual knip run on this worktree (audit captured 2026-07-17); counts may drift ±1 if master moves — Task 1 Step 2 describes the reconciliation procedure.
- `syncSectionFromLocation`/`fetchAdminIdentity`/`LOG_CAP`/`emptyFilter`/`patchByok`/`escapeHtml` are client test-consumed symbols; they get shims (Task 6), not deletion, because their tests exercise real behavior worth keeping.
