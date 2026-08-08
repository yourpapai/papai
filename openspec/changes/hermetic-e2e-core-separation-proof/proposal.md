<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Hermetic E2E core-separation proof (residual)

## Why

The `plugin-core-separation` branch (new `src/modules/`, `src/ports/`,
`src/composition/`) refactors trusted-module loading without behavior
change, and master's frozen story harness (`test:stories:compat`) exists to
prove it. The proof is incomplete: the branch is not rebased onto a
recorded baseline, the module lifecycle contract is asymmetric (no
cleanup/stop), the runtime does not own module activation, coding-module
tools lack capability ids, and CI does not run the compat suite. Until
these land, the separation cannot merge.

## What Changes

On the `plugin-core-separation` branch (execution path, design.md D1):

- Record `BASELINE_SHA`, rebase onto the hermetic master baseline, and
  capture the RED baseline (`test:stories:compat --manifest-only` + frozen
  `tests/stories` diff).
- Symmetric lifecycle contract: `ModuleCleanup`, `stop()` in reverse
  activation order, registry clearing, partial-activation rollback,
  `reset()` on the operator-allowlist and membership-store ports.
- `PapaiRuntime` owns modules: `loadTrustedModules()` moves out of
  `src/index.ts` into `src/runtime/production-deps.ts` extensions
  (modules before plugins, stop in reverse);
  `src/coding-sessions/configure.ts` configures the trusted coding module.
- `capabilityId` on `ModuleTool`; `buildModuleToolSet` receives the
  `ToolCapabilityCatalog` and registers `coding-session.*` ids; session
  history routes through `src/coding-sessions/store.ts` keeping the
  legacy `acp` KV namespace.
- Full proof: compat suite (default, `--seed 41021`, `--rerun-each 10`),
  `build:client`, `bun test`, `test:client`, `check:full`; CI job running
  `test:stories:compat` with `BASE_REF` artifacts; proof documentation
  (SHAs, manifest hash, seed) in `docs/architecture/commands.md` and
  `tests/CLAUDE.md`.

## Capabilities

### New Capabilities

- `hermetic-e2e-core-separation-proof` — frozen-harness E2E proof that the
  core-separation refactor preserves behavior, plus the lifecycle contract
  the proof requires.

### Modified Capabilities

None. `openspec/specs/` has no entries for the module/ports surfaces.

## Non-goals

- No new module functionality — this is a refactor proof, not feature work.
- No changes to master's plugin system beyond what the branch merge itself
  brings.
- No hermetic qualification of additional trusted modules (that is the
  sibling `hermetic-qualification` residual change).
- No rewrite of the story harness on master (it is the frozen baseline).

## Impact

- **Code:** all on `plugin-core-separation`: `src/ports/module.ts`,
  `src/composition/load-trusted-modules.ts`, ports reset()s,
  `src/runtime/production-deps.ts`, `src/index.ts`,
  `src/coding-sessions/configure.ts`, `src/tools/module-tool-set.ts`;
  tests under `tests/composition`, `tests/runtime`, `tests/tools`.
- **CI:** new/extended job invoking `test:stories:compat` with `BASE_REF`.
- **Scope model / DB / deps:** none (refactor proof).
- **Docs:** `docs/architecture/commands.md`, `tests/CLAUDE.md` proof
  records.
- **Legacy:** adopts `docs/superpowers/plans/2026-07-12-hermetic-e2e-core-separation-proof.md`
  and its `remaining/` brief (delete-on-adopt, same commit).
