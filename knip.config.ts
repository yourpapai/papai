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
  for (const m of source.matchAll(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script>/gmu)) {
    if (m[1] !== undefined && m[1] !== '') scripts.push(m[1])
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
