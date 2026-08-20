<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Trusted-module hermetic qualification (residual)

## Decisions

### D1: Drift-check results (what is already true)

Verified against the current tree: the runtime-extension seam
(`tests/stories/harness/runtime-extension.ts` + `world.ts` lifecycle),
`given.runtimeExtension()` in `scenario.ts`, the frozen contribution
stories (`tool-eligibility`, `command-prompt`), and the qualification
suites (`module-qualification.story.test.ts`,
`module-settings-qualification.story.test.ts`) are committed and
catalog-registered under `SCN-coding-acp-*` ids in
`tests/stories/catalog/coverage.ts`. The plan's manifest-registration
concern is therefore settled — entries exist under the `coding-acp`
prefix rather than the literal `SCN-module-*` the plan expected; no
renaming (the catalog is a frozen ledger).

### D2: Two missing frozen stories — write them, don't amend

The plan's file structure names
`integrations/runtime-extensions/lifecycle.story.test.ts` and
`settings/runtime-extension-settings.story.test.ts`; neither exists and no
removal decision is recorded. They assert real contracts (extension
start/stop isolation; settings authorization + next-turn behavior), so the
residual includes writing them rather than amending the plan away. They
follow the shipped sibling stories' patterns and register in the catalog
under the existing `SCN-coding-acp-*` convention.

### D3: Task 5 sequencing relative to the sibling change

`hermetic-e2e-core-separation-proof` owns the baseline mechanics
(`BASELINE_SHA`, rebase, RED capture). This change's Task 5 runs after:
verify `git diff --exit-code $BASELINE_SHA -- tests/stories`
(byte-identical frozen tree), then iterate `bun test:stories:compat`
until green with fixes confined to `src/` composition/plugins. Touching
frozen inputs voids the proof (same invariant as the sibling).

### D4: Hooks/TDD

Story files under `tests/` are test code: write each story failing (or
red-for-missing-contract) before any harness/extension adjustment it
reveals. Full-suite verification per tasks.md; mutation ratchet is not
affected (test-only additions on master).
