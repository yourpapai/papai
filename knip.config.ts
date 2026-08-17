// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// GUARDRAIL: keep the ignore surface minimal. New ignores require an inline
// justification comment naming the dynamic mechanism knip cannot trace, and a
// linked task when the gap is temporary. Prefer code fixes (moving dead code,
// *.testing.ts shims, entry declarations) over new ignore lines.
//
// Standing rule for facade re-exports: when knip flags a facade binding,
// fix the import structure (repoint production imports through the facade,
// repoint test imports to the concrete module, or prune the dead binding)
// instead of adding an ignore. See
// docs/superpowers/specs/2026-08-04-knip-facade-import-triage-design.md.

// knip's built-in Svelte plugin enables but never registers its compiler:
// its hasDependency('svelte') probe fails under bun's node_modules-less
// install layout. Register an equivalent script-body extractor here.
const svelteCompiler = (source: string): string => {
  const scripts: string[] = []
  for (const m of source.matchAll(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script>/gmu)) {
    if (m[1] !== undefined && m[1] !== '') scripts.push(m[1])
  }
  return scripts.join(';\n')
}

export default {
  // The review-loop, mutation-improve and opencode-agent workspaces are
  // standalone developer tools with their own check suites
  // (<workspace>:lint/typecheck/format:check/test) run separately in
  // check:full. knip-bun cannot resolve their .js-extension imports.
  ignoreWorkspaces: ['review-loop', 'mutation-improve', 'opencode-agent', 'sdd-runner'],

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
    // Tier 1 orchestration scripts (nightly CI helpers — not in package.json).
    'scripts/behavior-audit/preflight.ts!',
    'scripts/behavior-audit/publish-snapshot.ts!',
    // Stable production/public compatibility boundaries consumed by the
    // plugin-core-separation refactor.
    'src/coding-sessions/configure.ts!',
    'src/coding-sessions/session-record.ts!',
    'src/coding-sessions/store.ts!',
    'playwright.config.ts!',
    'strybk.config.ts!',
    // Analytics modules are the canonical seam surface for the Stage A metrics
    // build; later tasks consume their exports, so unused-export/type findings are
    // expected until those tasks land.
    'src/analytics/*.ts!',
    // Analytics storage modules implement the Stage A write path; later pipeline
    // tasks import them explicitly.
    'src/analytics/storage/*.ts!',
    // Analytics identity modules (keyring, install-id, pseudonym, scope) are the
    // Stage A public seam consumed by later normalization tasks.
    'src/analytics/identity/*.ts!',
    // Analytics governance modules (policy/preference/collection/grant/generation
    // stores and the pure eligibility matrix) are the Stage A governance seam
    // consumed by later runtime/delivery tasks.
    'src/analytics/governance/*.ts!',
    // Analytics delivery modules (delivery ledger store, sink capability gate,
    // sink lifecycle service) are the Stage A egress seam consumed by the
    // upcoming transport/egress tasks.
    'src/analytics/delivery/*.ts!',
    // Analytics intent modules (frozen taxonomy, deterministic classifier,
    // rephrase lexical features) are the Stage A intent seam consumed by the
    // derivation job and rephrase handoff.
    'src/analytics/intent/*.ts!',
    // Analytics rephrase modules (lifecycle handoff, store, matching, outcome)
    // are the Stage A transient rephrase seam consumed by runtime wiring.
    'src/analytics/rephrase/*.ts!',
    // Analytics job modules (idempotent derivations over canonical events) are
    // the Stage A offline-derivation seam consumed by scheduled runners.
    'src/analytics/jobs/*.ts!',
    // Analytics derive modules (sessionization, outcomes, features, friction
    // materialization) are the Stage A derived-row seam consumed by the
    // derive job.
    'src/analytics/derive/*.ts!',
    // Analytics retention modules (expiry guard, deadline computation) are the
    // Stage A lifecycle seam consumed by the retention job and read adapters.
    'src/analytics/retention/*.ts!',
    // Analytics rekey modules (run/mapping stores, dual-write seam, FK-ordered
    // copy, cutover fence, verification, snapshot transition, remote transition,
    // retirement) are the Stage A rekey seam consumed by the rekey orchestrator
    // job and the analytics-rekey CLI (Task 13B, in flight).
    'src/analytics/rekey/*.ts!',
    // Rollout stage-gate module is the executable Stage A–E operator seam; its
    // only consumers today are the rollout-gate/privacy-contract tests outside
    // knip's production project scope (operator wiring lands with Stage B).
    'src/analytics/rollout/*.ts!',
    // Context vault modules are the seam surface for the context-vault-plugin
    // change (openspec/changes/context-vault-plugin); later tasks (settings
    // routes, push route, summarizer, plugin facade) consume their exports.
    'src/context-vault/*.ts!',
    // Suggest-next-task modules are the seam surface for the suggest-next-task
    // change (openspec/changes/suggest-next-task); the production consumer
    // (core-tools registration) lands with its task 5.1 — until then only the
    // tests import them.
    'src/tools/suggest-next-task.ts!',
    'src/tools/suggest-next-task-ranking.ts!',
    // First-party plugin entry points are loaded dynamically by the plugin
    // loader, so they have no static importer.
    'plugins/*/index.ts!',
    // Plugin runtime bridges loaded via import.meta.require(); declaring them
    // entries lets knip trace their static imports (provider clients, config).
    'plugins/audio-transcribe/runtime.ts!',
    'plugins/context-vault/runtime.ts!',
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

  // msw is the dev-only mock layer consumed exclusively by the
  // Storybook story harness under client/stories/** (ignored below).
  // @crvy/strybk is imported by strybk.config.ts but knip-bun cannot resolve
  // the package (runtime CLI config consumer).
  ignoreDependencies: ['msw', '@crvy/strybk'],

  ignoreIssues: {
    // Test-seam shims: exports exist only for tests; production modules keep
    // the symbols (most mutate module-private state and cannot move).
    'src/**/*.testing.ts': ['exports', 'types'],
    'client/**/*.testing.ts': ['exports', 'types'],
    // Plugin entry-point default exports, provider classes, and validateConfig
    // are resolved dynamically by the plugin loader (path-based import +
    // manifest `providerConfigValidator`); bridge modules (runtime,
    // auto-provision, provision) are consumed through import.meta.require()
    // chains knip cannot trace. No static consumer exists.
    'plugins/*/{index,validate-config,provider,runtime,auto-provision,provision}.ts': ['exports'],
    // Task-provider plugin clients are reached only via those same dynamic
    // bridges. Scoped to task-provider-* so other plugins' clients stay checked.
    'plugins/task-provider-*/client.ts': ['exports'],
    // acp bridge modules are consumed by plugins/acp/index.ts through
    // import.meta.require() (entry-graph containment for their src/analytics
    // imports, same pattern as the kaneo bridges above); knip cannot trace
    // require boundaries.
    'plugins/acp/{tools,session-tools,continue-tool}.ts': ['exports'],
    // strybk.config.ts default export is consumed by the crvy-strybk CLI at
    // runtime via --config; no static importer exists.
    'strybk.config.ts': ['exports'],
    // publish-snapshot helpers (buildCommitMessage, formatDateStamp, etc.) are
    // consumed by runPublish + tests; knip's production-only project scope
    // doesn't see test importers.
    'scripts/behavior-audit/publish-snapshot.ts': ['exports'],
    // resetGrepCache and makeAuditToolsForRoot are test-only seams (clear the
    // grep cache between tests; target a fixture root for hermetic testing).
    'scripts/behavior-audit/tools.ts': ['exports'],
    // parseConsolidationResult is consumed by the schema unit test only.
    'scripts/behavior-audit/consolidate-agent.ts': ['exports'],
    // listToolNames is consumed by the behavior-audit closure verifier via
    // dynamic import from scripts/behavior-audit/entry-point-maps.ts.
    'src/tools/index.ts': ['exports'],
    // listRoutes is consumed by the behavior-audit closure verifier via
    // dynamic import; re-exported from src/debug/server-route-options.ts.
    'src/debug/server-route-options.ts': ['exports'],
    // Analytics modules are the Stage A public seam; their exports are consumed
    // by later tasks and by the analytics tests that knip's production graph does
    // not count.
    'src/analytics/*.ts': ['exports', 'types'],
    // Analytics storage modules implement the Stage A write path; their exports
    // are consumed by the upcoming pipeline/backfill tasks.
    'src/analytics/storage/*.ts': ['exports', 'types'],
    // Analytics identity modules are the Stage A public seam; their exports are
    // consumed by upcoming normalization/pipeline tasks and by analytics tests
    // outside knip's production project scope.
    'src/analytics/identity/*.ts': ['exports', 'types'],
    // Analytics governance modules are the Stage A governance seam; their exports
    // are consumed by upcoming runtime/delivery tasks and by analytics tests
    // outside knip's production project scope.
    'src/analytics/governance/*.ts': ['exports', 'types'],
    // Analytics delivery modules are the Stage A egress seam; their exports are
    // consumed by upcoming transport/egress tasks and by analytics tests outside
    // knip's production project scope.
    'src/analytics/delivery/*.ts': ['exports', 'types'],
    // The rollout stage-gate module is the executable Stage A–E operator seam;
    // its exports are consumed by the rollout-gate/privacy-contract tests
    // outside knip's production project scope (operator wiring lands with
    // Stage B).
    'src/analytics/rollout/*.ts': ['exports', 'types'],
    // Generated analytics modules are checked-in generator output; their exports
    // are consumed by sibling analytics modules and by tests outside knip's
    // production project scope.
    'src/analytics/generated/*.ts': ['exports', 'types'],
    // Analytics intent modules are the Stage A taxonomy/classifier seam; their
    // exports are consumed by the derivation job, the rephrase handoff, and by
    // analytics tests outside knip's production project scope.
    'src/analytics/intent/*.ts': ['exports', 'types'],
    // Analytics rephrase modules are the Stage A transient rephrase seam; their
    // exports are consumed by runtime wiring and by analytics tests outside
    // knip's production project scope.
    'src/analytics/rephrase/*.ts': ['exports', 'types'],
    // Analytics job modules are the Stage A offline-derivation seam; their
    // exports are consumed by the upcoming scheduled-runner registration task
    // and by analytics tests outside knip's production project scope.
    'src/analytics/jobs/*.ts': ['exports', 'types'],
    // Analytics derive modules are the Stage A derived-row seam; their
    // exports are consumed by the derive job and by analytics tests outside
    // knip's production project scope.
    'src/analytics/derive/*.ts': ['exports', 'types'],
    // Analytics retention modules are the Stage A lifecycle seam; their
    // exports are consumed by the retention job, read adapters, and by
    // analytics tests outside knip's production project scope.
    'src/analytics/retention/*.ts': ['exports', 'types'],
    // Analytics rekey modules are the Stage A rekey seam; their exports are
    // consumed by the rekey orchestrator job and analytics-rekey CLI (Task
    // 13B, in flight) and by analytics tests outside knip's production
    // project scope.
    'src/analytics/rekey/*.ts': ['exports', 'types'],

    // Context vault modules are the seam surface for the in-flight
    // context-vault-plugin change (openspec/changes/context-vault-plugin);
    // their exports are consumed by later tasks (settings routes, push route,
    // summarizer, plugin facade) and by tests outside knip's production
    // project scope.
    'src/context-vault/*.ts': ['exports', 'types'],
    // Suggest-next-task exports are consumed by the in-flight
    // suggest-next-task change (openspec/changes/suggest-next-task):
    // core-tools.ts imports makeSuggestNextTaskTool with its task 5.1; the
    // ranking module's exports stay consumed by tests outside knip's
    // production project scope. Remove these entries and the matching entry
    // declarations above when that lands.
    'src/tools/suggest-next-task.ts': ['exports', 'types'],
    'src/tools/suggest-next-task-ranking.ts': ['exports', 'types'],
    'src/db/context-vault-schema.ts': ['exports', 'types'],
    // Re-export facades whose remaining flagged bindings knip cannot trace:
    // the published plugin-types package export, declared plugin-core-separation
    // compatibility boundaries, and bindings consumed by byte-frozen 0Q
    // qualification files (tests/stories/**, tests/utils/test-helpers.ts). Six
    // justified entries in this block.
    // session-record.ts and store.ts are declared stable compatibility
    // boundaries for the plugin-core-separation refactor (see entry list);
    // store.ts is also consumed by the frozen story harness.
    'src/coding-sessions/session-record.ts': ['exports'],
    'src/coding-sessions/store.ts': ['types'],
    // state-collector re-exports recentLlm/pendingTraces for the frozen
    // tests/utils/test-helpers.ts.
    'src/debug/state-collector.ts': ['exports', 'types'],
    // pollAlertsOnce is consumed by frozen tests/stories/harness/scenario.ts.
    'src/deferred-prompts/poller.ts': ['exports'],
    // public-types.ts is published as the `papai/plugin-types` package export
    // (package.json `exports`) and consumed by external plugin authors knip
    // cannot trace, plus tests/providers/public-types.test.ts.
    'src/providers/public-types.ts': ['exports', 'types'],
    // AdminLlmSnapshot/AdminLlmKeyState model the BYOK system-key admin surface;
    // consumed by the BYOK-key contract tests (tests/client/**) and the dev-only
    // Storybook fixture harness (client/stories/**, knip-ignored by config).
    // Zero production consumers today; the types pin the 5 live BYOK keys.
    'client/shared/api-types.ts': ['types'],
  },

  includeEntryExports: true,
  treatConfigHintsAsErrors: true,
  ignoreExportsUsedInFile: true,

  // Migrations are runtime-only SQL; client/stories/** is the dev-only
  // Storybook harness; tests/visual/** is the Playwright screenshot suite.
  ignore: ['src/db/migrations/**', 'client/stories/**', 'tests/visual/**'],
}
