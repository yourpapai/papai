<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Hermetic E2E core-separation proof (residual)

All code tasks run on the `plugin-core-separation` branch (design.md D1).

## 1. Baseline

- [ ] 1.1 Record `BASELINE_SHA`, rebase the branch onto it, capture RED:
      `BASE_REF=$BASELINE_SHA bun test:stories:compat --manifest-only` and
      `git diff --exit-code $BASELINE_SHA -- tests/stories`.
      Verify: both commands' outputs recorded in the proof notes

## 2. Lifecycle contract

- [ ] 2.1 Failing tests: cleanup runs once in reverse order, registries
      clear, allowlist resets to `members`, membership store resets,
      failed activation rolls back. Then extend `src/ports/module.ts`
      (`ModuleCleanup`) and `src/composition/load-trusted-modules.ts`
      (`LoadedTrustedModules` + `stop()` + rollback).
      Verify: `bun test tests/composition*`
- [ ] 2.2 Failing tests then `reset()` on `src/ports/operator-allowlist.ts`
      and `src/ports/membership-store.ts`; cleanups returned from coding
      and task-tracker modules.
      Verify: `bun test tests/composition* tests/ports*`

## 3. Runtime ownership

- [ ] 3.1 Move `loadTrustedModules()` into
      `src/runtime/production-deps.ts` extensions.start (modules before
      plugins, stop in reverse); remove the direct `src/index.ts` call;
      add runtime-order tests; adapt `src/coding-sessions/configure.ts`.
      Verify: `bun test tests/runtime* tests/index-startup*`

## 4. Capability ids + session history

- [ ] 4.1 Failing tests then implement: `capabilityId` on `ModuleTool`,
      `ToolCapabilityCatalog` threaded into `buildModuleToolSet`,
      `coding-session.*` registration, duplicate-id failure; session
      history via `src/coding-sessions/store.ts` with legacy `acp` KV
      namespace retained.
      Verify: `bun test tests/tools* tests/coding-sessions*`

## 5. Proof + CI + docs

- [ ] 5.1 Full proof matrix: `test:stories:compat` (default,
      `--seed 41021`, `--rerun-each 10`), `bun run build:client`,
      `bun test`, `bun run test:client`, `bun run check:full`.
      Verify: all pass on the rebased branch
- [ ] 5.2 CI job: `test:stories:compat` with PR base SHA as `BASE_REF`,
      artifact upload on `always()`; document SHAs/manifest hash/seed in
      `docs/architecture/commands.md` and `tests/CLAUDE.md`.
      Verify: CI green on the branch PR
