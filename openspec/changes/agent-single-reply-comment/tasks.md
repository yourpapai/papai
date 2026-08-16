<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: One command, one reply

Ordered so the two pure-renderer groups land before anything is rewired, and so
no intermediate commit blinds the model to its own reports: D4 (§3) precedes the
channel switch (§4), because a thread whose reports have moved into a comment
`isStatusComment` still drops is strictly worse than one where the model reads a
progress table it does not need. Each group is independently verifiable and
commits on its own.

## 1. The comment renders a header and sections (D2)

- [ ] 1.1 Failing test: `renderStatus` with no sections is byte-identical to
      today's live status comment; with sections it renders the header once,
      each section in order, every section but the newest inside `<details>`
      named for its phase, and the run detail collapsed **immediately above**
      the `AGENT_STATUS` block. Asserted on ordering, not on prose, so a
      reworded heading cannot fail it and a reordered body cannot pass.
      `bun test tests/opencode-agent/status.test.ts`
- [ ] 1.2 Add `sections: readonly ReportSection[]` to `StatusView` and render
      them in `status-comment.ts`. `renderStatus` stays pure; the progress
      table, job/branch and budget lines move inside the collapsed run detail
      unchanged. Keep the `AGENT_STATUS` block last.
      `bun test tests/opencode-agent/status.test.ts && bun run typecheck`
- [ ] 1.3 Failing test: the terminal render drops `— run in progress` from the
      header and the whole body is a function of `StatusView` alone — no
      `Date.now()`, no second heading. Extends the existing pure-render suite.
      `bun test tests/opencode-agent/status.test.ts`

## 2. The overflow budget sheds sections, never blocks (D7)

- [ ] 2.1 Failing test: a view whose sections exceed `BODY_BUDGET` renders under
      the budget; hidden blocks survive verbatim and parse through `readBlock`;
      the newest section survives; the oldest are replaced by the trimmed note
      with the correct count. A newest section that alone exceeds the budget is
      truncated from the top, keeping its tail.
      `bun test tests/opencode-agent/status.test.ts`
- [ ] 2.2 Implement the budget in `status-comment.ts`: measure the block region
      first, spend what is left on visible sections newest-first. `BODY_BUDGET`
      is a named constant below GitHub's 65,536-character cap, with the margin
      stated in its doc comment.
      `bun test tests/opencode-agent/status.test.ts && bun run lint`

## 3. The prompt truncates at the run detail (D4)

- [ ] 3.1 Failing test: `renderThread` keeps a comment carrying an
      `AGENT_STATUS` block, renders everything above the marker, and renders
      nothing from the marker down — including the progress table. A comment
      with no marker is unchanged. Asserted against a body built by
      `renderStatus`, so the two cannot drift apart.
      `bun test tests/opencode-agent/adapters.test.ts`
- [ ] 3.2 Replace `isStatusComment` with a truncate-at-marker step that runs
      **before** `stripBlocks` in `prompt-budget.ts`, and rewrite the doc
      comment: the marker no longer means "drop this comment", it means "the
      bookkeeping starts here".
      `bun test tests/opencode-agent/ && bun run typecheck`

## 4. The reply channel is the only writer (D1, D3, D6)

- [ ] 4.1 Failing test: one `/ask` on an issue produces exactly **one**
      `createComment` for the whole run, and the answer is in the body of the
      comment the run opened. Driven end to end through `runPipeline`.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [ ] 4.2 Failing test: a job crossing two phases still makes one
      `createComment`; both reports appear as sections, oldest first; both
      phases' blocks are present in that one body; `readBlock` returns the
      newer `AGENT_STATE` and `locateLatestBlock` selects the comment.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [ ] 4.3 Add `section(body, blocks)` to `StatusReporter` and
      `noopStatusReporter`, appending to the run's comment and forcing an edit
      past `MIN_EDIT_INTERVAL_MS`. Route `postAndAppend` and `postAnswer`
      through it; both keep mirroring the rendered body into the in-memory
      thread, now under the reply comment's id.
      `bun test tests/opencode-agent/ && bun run typecheck`
- [ ] 4.4 Failing test (D6): a swallowed `updateComment` on a `section()` call
      leaves `RunResult.reported` false, while a swallowed *tick* edit does not
      touch it; and a run killed after `open()` reports false with the live
      header still on the thread.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [ ] 4.5 Set `reported` from an accepted `section()` edit only. Keep `attempt`
      swallowing every GitHub error; the flag, not the throw, is what changes.
      `bun test tests/opencode-agent/ && bun run typecheck`
- [ ] 4.6 Failing test: `persistState` rewrites the block in the reply comment —
      the same comment `locateLatestBlock` selects — and the one-comment lag
      still holds, i.e. the block that first records `prNumber` lands on the
      issue when the run opened its comment there.
      `bun test tests/opencode-agent/status.test.ts`

## 5. The workflow steps edit rather than post (D5)

- [ ] 5.1 Failing test: `REPLY_COMMENT_OUTPUT` is written to `$GITHUB_OUTPUT`
      when the comment opens, not at exit; absent `GITHUB_OUTPUT` (a local
      `--event-path` run) is not a failure; a failed write is a `warn`.
      `bun test tests/opencode-agent/cli.test.ts`
- [ ] 5.2 Publish the id from `status-reporter.ts`'s `open()` through
      `step-output.ts`, alongside `REPORTED_OUTPUT`.
      `bun test tests/opencode-agent/ && bun run typecheck`
- [ ] 5.3 Failing test: the workflow's infrastructure-failure step PATCHes
      `steps.pipeline.outputs.reply-comment` when set and posts when unset; the
      transcript step runs **after** it and appends to whichever comment
      exists; both `if:` expressions name the same output key the pipeline
      writes. Asserted against the parsed workflow, as the existing suite does.
      `bun test tests/opencode-agent/workflow.test.ts`
- [ ] 5.4 Rewrite both steps in `.github/workflows/agent-pipeline.yml`, keeping
      the artefact-id gate, the derived `VIEWER_URL`, and the `reported` gate
      exactly as they are. Reorder so the transcript step is last.
      `bun run workflows:lint && bun test tests/opencode-agent/workflow.test.ts`

## 6. Docs and full verification

- [ ] 6.1 Update `opencode-agent/CLAUDE.md` — **Shape** still describes
      `AGENT_STATUS` as "read by nothing else" and the comment surfaces as
      separate — and `README.md`. Record the resolved behaviour in `ROADMAP.md`.
- [ ] 6.2 Rewrite the module doc comments the change falsifies:
      `status-comment.ts` ("it is the entire comment budget… never a second",
      "carries no free model text", "deliberately carries no `AGENT_STATE`
      block"), `status-reporter.ts` ("a status comment is not a report"),
      `run-post.ts` (both functions' surface reasoning), `prompt-budget.ts`
      (`isStatusComment`), `step-output.ts` ("the one thing this pipeline tells
      the rest of its own workflow").
      `bun run lint`
- [ ] 6.3 Full verification: `bun test`, `bun run typecheck`, `bun run lint`,
      `bun run workflows:lint`, and `bun run test:mutate:changed` for the
      per-file ratchet on every file touched above.
