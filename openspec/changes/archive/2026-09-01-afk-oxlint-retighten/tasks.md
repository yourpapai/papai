<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Establish the red state

- [x] 1.1 Re-measure the diagnostic set: copy `.oxlintrc.json` to a probe config at the repo root with the two afk-scoped `overrides` blocks removed (keep the `tests/**/*.ts` block), run `bunx oxlint --config <probe> --ignore-path .oxlintignore .`, confirm the output matches design.md's expected 19 diagnostics (2 × `machine.ts` `no-unsafe-type-assertion`; 17 × `no-unsafe-*` across the 7 listed test files), delete the probe config. Anything beyond the 19 gets triaged before proceeding. Verification: the probe run's error list matches design.md Context.
- [x] 1.2 Delete the two afk-scoped blocks from `.oxlintrc.json` (`tests/afk-runner/**` `no-unsafe-*` and `afk-runner/src/kernel/machine.ts` `no-unsafe-type-assertion`) and observe `bun run lint` fail with exactly those 19 — this red lint is the failing test for the whole change. Verification: `bun run lint` (red, 19 errors, all in afk scope).

## 2. Kernel machine re-spelling (design D2)

- [x] 2.1 Re-spell `afk-runner/src/kernel/machine.ts` `setup({ types: { context: {} as KernelContext, events: {} as KernelEvent }, guards, actions })` as `setup<KernelContext, KernelEvent>({ guards, actions })` — explicit type parameters, no `types` key, no assertions. Resolve any typecheck fallout types-only (guards/actions bodies, downstream `createStateConfig` uses in kernel tests). Verification: `bun run typecheck` and `bun test tests/afk-runner/kernel tests/afk-runner/memo-parity.test.ts` (fold parity = behavioral oracle).
- [x] 2.2 Confirm the machine.ts lint pair is gone and nothing else appeared. Verification: `bun run lint` (red, 17 remaining errors, all under `tests/afk-runner/`).

## 3. Test parse-site conversion (design D3)

- [x] 3.1 Convert the six `state.json` reads to `PersistedRunStateSchema.parse(JSON.parse(...))` (import from `afk-runner/src/run-state.js`): `tests/afk-runner/cli-stop.test.ts:113`, `tests/afk-runner/memo-failed.test.ts:85,111`, `tests/afk-runner/run-final.test.ts:17` (`memoOf`), `tests/afk-runner/drive/memo.test.ts:23,61,69,79`, `tests/afk-runner/drive/resume-escalation.test.ts:102`, `tests/afk-runner/memo-parity.test.ts:110` (adapt the local `PersistedMemo` to the schema-inferred type if needed — parity semantics unchanged). Assertions unchanged. Verification: `bun test tests/afk-runner/cli-stop.test.ts tests/afk-runner/memo-failed.test.ts tests/afk-runner/run-final.test.ts tests/afk-runner/drive tests/afk-runner/memo-parity.test.ts` and `bun run lint` (red, only `work/veto-revision.test.ts` left).
- [x] 3.2 Convert `tests/afk-runner/work/veto-revision.test.ts:61` to `ResolverOutputSchema.parse(JSON.parse(...))` (import from `afk-runner/src/work/review-loop.js`). Assertions unchanged. Verification: `bun test tests/afk-runner/work/veto-revision.test.ts` and `bun run lint` (green).

## 4. Docs and full verification

- [x] 4.1 Update `docs/architecture/afk-runner.md` §"Prototype relaxation window (C1–C7) — closed": the `kernel/machine.ts` documented exception and the tests-side `no-unsafe-*` re-timing are closed early by this change (ahead of U9); U9's remaining re-tighten surface is the jscpd oracle ignores alone. Verification: the section names no surviving oxlint exception.
- [x] 4.2 Full gate sweep: `bun run test` (17630 pass / 0 fail), `bun run typecheck`, `bun run lint`, `bun run format:check`; all green. Mutation check ran as a focused paired comparison (the changed-files gate measures the whole 133-file branch diff vs origin/master, not attributable to this change): `machine.ts` scores 0.8417 edited (202 killed / 31 survived) vs 0.8382 control (202 / 32) — the types-only re-spelling kills one more mutant, no regression; `machine.ts` has no baseline entry yet (whole afk-runner is new vs master). Verification: all commands green; mutation baseline not regressed.
