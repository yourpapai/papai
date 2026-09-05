// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Entry points not auto-detected from package.json scripts, extracted from
// knip.config.ts for the same reason as the compiler hook: oxlint's pedantic
// max-lines rule caps that file at 300 lines and this table is its fastest grower.

export const KNIP_ENTRY_POINTS: readonly string[] = [
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
  // The usage-failure query is the seam surface for the
  // usage-failure-queries change (openspec/changes/usage-failure-queries);
  // the follow-up dashboard/settings wiring consumes its exports.
  'src/usage/failures.ts!',
  // Model-metadata catalogue foundation (openspec/changes/chat-model-metadata-models-dev):
  // resolve/provider-id/client are seam modules whose runtime consumers (role
  // resolver, preview endpoint, model builder) land in later tasks of the same
  // change; until then only tests read them.
  'src/models-dev/*.ts!',
  // First-party plugin entry points are loaded dynamically by the plugin
  // loader, so they have no static importer.
  'plugins/*/index.ts!',
  // Plugin runtime bridges loaded via import.meta.require(); declaring them
  // entries lets knip trace their static imports (provider clients, config).
  'plugins/audio-transcribe/runtime.ts!',
  'plugins/context-vault/runtime.ts!',
  'plugins/task-provider-kaneo/auto-provision.ts!',
  // Test-seam shims: re-export test-only symbols so tests have an explicit
  // import site; see the *.testing.ts ignoreIssues glob in knip.config.ts.
  'src/**/*.testing.ts!',
  'client/**/*.testing.ts!',
]
