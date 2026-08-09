<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Hermetic E2E core-separation proof (residual)

## Decisions

### D1: Execution path — work happens on the branch

All code tasks target the long-lived `plugin-core-separation` branch; this
change folder rides master's planning tree. At implementation time the
change folder is cherry-picked/merged onto the branch (or the branch
rebases onto a master containing it) before the final proof run — the
proof's whole point is that branch behavior equals master behavior, so
planning artifacts must not alter runtime code paths on either side.

### D2: Baseline pinning (Task 1 residual)

Record the merged master-baseline SHA explicitly as `BASELINE_SHA`;
`git rebase --onto $BASELINE_SHA $OLD_BASE`; capture RED via
`BASE_REF=$BASELINE_SHA bun test:stories:compat --manifest-only` and
`git diff --exit-code $BASELINE_SHA -- tests/stories` (the harness is
frozen — any harness edit on the branch invalidates the proof).

### D3: Symmetric lifecycle contract (Task 2 residual)

`ModuleCleanup` type; `onActivate` may return a cleanup; activation
collects cleanups and `stop()` runs them in reverse order, clears
registries, and rolls back on partial activation failure. `reset()` added
to `src/ports/operator-allowlist.ts` (back to `members`) and
`src/ports/membership-store.ts`; coding module cleanup = allowlist reset,
task-tracker cleanup = unsubscribe + store reset.

### D4: Runtime ownership (Task 3 residual)

`PapaiRuntime` (via `src/runtime/production-deps.ts` extensions) owns
module start/stop: modules start before plugins and stop in reverse.
`src/index.ts` no longer calls `loadTrustedModules()` directly.
`src/coding-sessions/configure.ts` configures the trusted coding module
instead of running plugin discovery.

### D5: Capability ids (Task 4 residual)

`ModuleTool` gains `capabilityId?: string`; `buildModuleToolSet` takes the
`ToolCapabilityCatalog`, registers `coding-session.*` ids, and fails on
duplicate ids; `module_coding__start_session` mapping covered by tests.
Session history routing goes through `src/coding-sessions/store.ts` and
keeps the legacy `acp` KV namespace for continuity.

### D6: Proof gate (Task 5 residual)

Full matrix: `test:stories:compat` default + `--seed 41021` +
`--rerun-each 10`; `bun run build:client`, `bun test`,
`bun run test:client`, `bun run check:full`. CI: job invoking
`test:stories:compat` with the PR base SHA as `BASE_REF`, artifacts
uploaded `always()`. Proof record (baseline/candidate SHAs, manifest
hash, seed) documented in `docs/architecture/commands.md` and
`tests/CLAUDE.md`. Hooks/TDD: lifecycle tests (cleanup once, reverse
order, rollback, resets) are written failing-first per plan order.
