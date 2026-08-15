<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Stop the mutation runner mandating two documents nothing reads

## 0. Answer the open question first

- [x] 0.1 Determine why no `mutation-coverage-*` change folder appears in this
      repository's history — no merged run, or folders that do not survive the flow
      (`design.md`, Open Questions). Record the answer in the change; it does not alter
      the tasks below, but it changes how much weight later work should put on the
      artifacts' absence.
      Verify: `git log --all --diff-filter=A --name-only -- 'openspec/changes/mutation-coverage-*'`

## 1. The result contract accepts a document-free result

- [x] 1.1 Write failing cases in `tests/mutation-improve/result-schema.test.ts` that a
      result omitting `specPath` and `planPath` validates, and that a result carrying both
      still validates. Then make the two fields optional in
      `mutation-improve/src/result-schema.ts`.
      Verify: `bun test tests/mutation-improve/result-schema.test.ts`
- [x] 1.2 Write a failing case that a run resumed from state whose stored results carry
      both paths loads without error, then confirm `run-state.ts` and `pipeline.ts` need no
      change (both already treat them as optional).
      Verify: `bun test tests/mutation-improve/run-state.test.ts`

## 2. The procedure

- [x] 2.1 Write failing cases in `tests/mutation-improve/prompt-templates.test.ts` that
      `buildImprovePrompt` requires MEASURE, TESTS and RESIDUALS and requires neither a
      design document nor a task list; and that it still requires the residual `mutantIds`
      set-match, the one-test-per-mutant-class rule, exact-equality assertions, and the
      hard constraints. Assert the obligations, not the wording. Then rewrite the procedure.
      Verify: `bun test tests/mutation-improve/prompt-templates.test.ts`
- [x] 2.2 Write a failing case that the residual reasoning requirement is stated on the
      result rather than on a document, then implement.
      Verify: `bun test tests/mutation-improve/prompt-templates.test.ts`
- [x] 2.3 Delete `improveChangePaths`, now unused (`design.md` D4). Confirm the SPDX
      licence-header lines stay in the prompt — new test files still need them.
      Verify: `bun run knip && bun test tests/mutation-improve/prompt-templates.test.ts`

## 3. Reporting

- [x] 3.1 Write failing cases in `tests/mutation-improve/finalize.test.ts` that the
      pull-request table reports accepted residuals and their reasoning per file instead of
      two document paths, and that a file with no residuals renders without an empty cell.
      Then implement in `mutation-improve/src/finalize.ts`.
      Verify: `bun test tests/mutation-improve/finalize.test.ts`
- [x] 3.2 Write a failing case that a result carrying document paths (a resumed older run)
      renders the same way as one without — the report reads residuals, not paths. Then
      confirm.
      Verify: `bun test tests/mutation-improve/finalize.test.ts`

## 4. Documentation and full gate

- [ ] 4.1 Update `mutation-improve/CLAUDE.md`: the IMPROVE phase's procedure is three steps,
      the agent writes only under `tests/`, and residual reasoning lives in the result. Keep
      the diff-guard description accurate — `openspec/changes/` stays whitelisted.
      Verify: `bun run format:check`
- [ ] 4.2 Run the full gate and fix anything it surfaces.
      Verify: `bun run test && bun run typecheck && bun run lint && bun run mutation-improve:test`
