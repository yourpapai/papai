<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: 2026 07 13 trusted module hermetic qualification

**Status:** partially_implemented
**Generated:** 2026-08-07
**Plan:** `docs/superpowers/plans/2026-07-13-trusted-module-hermetic-qualification.md`

## Completed

- Task 1: Neutral runtime-extension seam — tests/stories/harness/runtime-extension.ts (+ .test.ts) created; ScenarioWorldOptions.runtimeExtensions added (world.ts:97); start/stop lifecycle with reverse-order cleanup wired (world.ts:336-426)
- Task 2: Public setup API — given.runtimeExtension() exposed in scenario.ts:174/657 with prerequisite guard; harness tests in scenario.test.ts and runtime-extension.test.ts
- Task 3 (partial): Frozen contribution stories — tool-eligibility.story.test.ts and command-prompt.story.test.ts exist under tests/stories/integrations/runtime-extensions/ and use the seam (commits 1a99d750a, f9b3704fd et al.)
- Task 4: Qualification stories — tests/stories/integrations/coding-sessions/module-qualification.story.test.ts (5 scenarios) and tests/stories/settings/module-settings-qualification.story.test.ts committed (69af1581e, d491d6b09, 3df1ffec1) with CSRF/cross-context/denied-actor hardening

## Remaining

- File-structure gap: tests/stories/integrations/runtime-extensions/lifecycle.story.test.ts (frozen lifecycle isolation story) is missing
- File-structure gap: tests/stories/settings/runtime-extension-settings.story.test.ts (authorization/persistence/next-turn contract) is missing
- Manifest/ledger gap: no literal SCN-module-* / SCN-coding-module scenario IDs found in tests/stories or tests/stories/catalog/coverage.ts, so Task 3/4 Step 4 manifest-registration verification cannot be confirmed
- Task 5 (entire): Rebase plugin-core-separation onto the baseline and qualify without touching frozen inputs — refactor-side files src/composition/load-trusted-modules.ts, src/modules/coding/*, src/modules/task-tracker/* are absent on this branch; compat proof (bun test:stories:compat, byte-identical frozen tree) unverified
- Plan bookkeeping: all 20 checkboxes remain '- [ ]' despite committed baseline work — plan checkboxes are stale

## Suggested Next Steps

1. Update the plan checkboxes for Tasks 1–2 and the completed parts of 3–4 to '- [x]' so the plan reflects committed reality
2. Either add the two missing frozen stories (lifecycle.story.test.ts, runtime-extension-settings.story.test.ts) per the file structure, or amend the plan/design to record their intentional removal or rename
3. Verify scenario manifest registration: run bun test:stories:manifest and confirm the runtime-extension and module-qualification scenarios resolve to literal manifest IDs in tests/stories/catalog/coverage.ts; add ledger entries if absent
4. Run the baseline verification suite (bun test:stories:contracts, bun test:stories -- tests/stories/integrations/runtime-extensions, bun typecheck) to confirm green before refactor integration
5. Execute Task 5 on the plugin-core-separation branch: rebase onto the baseline commit, prove the frozen tree is byte-identical (git diff --exit-code), then iterate bun test:stories:compat until green, repairing only src//plugins composition
6. After Task 5 passes, commit refactor-side fixes and run the full qualification suite (test:stories, test:stories:stress, architecture-guard, typecheck) as the plan specifies
