<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remaining Work: 2026 07 12 hermetic e2e core separation proof

**Status:** partially_implemented
**Generated:** 2026-08-07
**Plan:** `docs/superpowers/plans/2026-07-12-hermetic-e2e-core-separation-proof.md`

## Completed

- Baseline prerequisite (master-baseline plan): tests/stories/** harness including tests/stories/harness/world.ts, src/runtime/create-runtime.ts, and test:stories:compat script (package.json:70) exist on master/current worktree
- Task 1 partially: plugin-core-separation branch exists with the module separation commits (src/modules/coding/*, src/modules/task-tracker, src/composition/load-trusted-modules.ts, src/composition/trusted-modules.ts)
- TrustedModule contract baseline: src/ports/module.ts on plugin-core-separation declares migrations and onActivate hooks
- Task 5 Step 1: tests/utils/test-helpers.ts applies core migrations followed by per-module migration passes via TRUSTED_MODULES.map((m) => m.migrations) (test-helpers.ts:126), and tests/db/module-migrations.test.ts exists
- Focused lifecycle test files exist on the branch: tests/composition/load-trusted-modules.test.ts, tests/db/module-migrations.test.ts

## Remaining

- Task 1 Steps 1-4: explicit BASELINE_SHA recording, rebase onto the hermetic master baseline, and frozen-harness verification (test:stories:compat --manifest-only + git diff --exit-code -- tests/stories) are not evidenced; the branch is not rebased onto a recorded baseline
- Task 2: symmetric lifecycle contract missing - no ModuleCleanup type, TrustedModule.onActivate still returns void | Promise<void> (src/ports/module.ts:40), load-trusted-modules.ts has no LoadedTrustedModules/stop() result, no reverse-order cleanup, no registry clearing, no partial-activation rollback
- Task 2 Step 4: reset() missing on both ports - src/ports/operator-allowlist.ts and src/ports/membership-store.ts have no reset(); coding/task-tracker modules return no cleanup
- Task 3: modules not owned by PapaiRuntime - src/index.ts:66 still calls loadTrustedModules() directly; src/runtime/production-deps.ts extensions.start/stop do not compose module activation/teardown; runtime-order tests (tests/runtime/production-deps.test.ts, tests/index-startup.test.ts) not added
- Task 3 Step 3: src/coding-sessions/configure.ts not adapted to configure the trusted coding module instead of plugin discovery
- Task 4: capabilityId?: string missing from ModuleTool (src/ports/module-tools.ts); buildModuleToolSet (src/tools/module-tool-set.ts) does not receive the ToolCapabilityCatalog or register coding-session.* ids; module_coding__start_session mapping and duplicate-id failure tests absent
- Task 4 Step 3: coding-module session history routing through src/coding-sessions/session-record.ts / store.ts with retained legacy acp KV namespace not verified
- Task 5 Step 2-3: full compat suite runs (seed 41021, --rerun-each 10) and full branch verification (build:client, test, test:client, check:full) not evidenced
- Task 5 Step 4: CI workflow has no test:stories:compat invocation with BASE_REF artifacts upload (.github/workflows/ci.yml only uses BASE_REF for mutation testing)
- Task 5 Step 5: proof documentation (baseline/candidate SHAs, manifest hash, seed) missing from docs/architecture/commands.md and tests/CLAUDE.md
- All 27 plan checkboxes remain unchecked

## Suggested Next Steps

1. Record the explicit BASELINE_SHA from the merged master-baseline plan and rebase plugin-core-separation onto it (git rebase --onto $BASELINE_SHA $OLD_BASE), then run BASE_REF=$BASELINE_SHA bun test:stories:compat --manifest-only and git diff --exit-code $BASELINE_SHA -- tests/stories to capture the RED baseline (Task 1)
2. Write failing lifecycle tests first (cleanup runs once in reverse order, registries clear, allowlist resets to 'members', membership store/resolver reset, failed activation rolls back), then extend src/ports/module.ts with ModuleCleanup and make load-trusted-modules.ts return LoadedTrustedModules with stop() plus partial-activation rollback (Task 2 Steps 1-3)
3. Add reset() to src/ports/operator-allowlist.ts and src/ports/membership-store.ts; return cleanups from coding module (allowlist reset) and task-tracker module (unsubscribe + store reset) (Task 2 Step 4)
4. Move loadTrustedModules() out of src/index.ts:66 into src/runtime/production-deps.ts extensions.start (modules before plugins, stop in reverse), add runtime-order tests, and adapt src/coding-sessions/configure.ts internals to the trusted coding module (Task 3)
5. Add capabilityId to ModuleTool, thread ToolCapabilityCatalog into buildModuleToolSet, assign coding-session.* ids to coding-module tools, and route session history through src/coding-sessions/store.ts keeping the legacy acp KV namespace (Task 4)
6. Run the full proof suite: test:stories:compat (default, --seed 41021, --rerun-each 10), bun build:client, bun run test, bun test:client, bun check:full (Task 5 Steps 2-3)
7. Add the refactor-compat CI job passing the PR base SHA as BASE_REF with artifact upload on always(), and document baseline/candidate SHAs + manifest hash + seed in docs/architecture/commands.md and tests/CLAUDE.md (Task 5 Steps 4-5)
