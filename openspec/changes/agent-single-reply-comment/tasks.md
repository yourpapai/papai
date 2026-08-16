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
progress table it does not need. The rename (§7) lands last, so every earlier
group has a stable file to be reviewed against. Each group is independently
verifiable and commits on its own.

**Revised during apply.** Two orderings changed once the types were in front of
us, both recorded here rather than discovered twice:

- **The liveness deletion moved out of §1 and into §5.** Removing `live` and
  `progress` from `StatusView` breaks `status-reporter.ts` before §4 replaces
  it, so §1 is purely additive and every intermediate commit stays green. What
  was 1.3 is now 5.3.
- **§1 split `status-comment.ts` rather than growing it.** Sections pushed the
  file past `max-lines` (pedantic, 300), which CLAUDE.md calls a design signal.
  The progress table, job/branch and budget lines moved to `run-detail.ts` —
  *how a run describes itself* — leaving `status-comment.ts` as *what a reply is
  made of*. D8's rename applies to the latter; `run-detail.ts` is already named
  for what it is.

## 1. The comment renders a header and sections (D2)

- [x] 1.1 Failing test: `renderStatus` with no sections renders the header, the
      collapsed run detail and the `AGENT_STATUS` block and nothing else; with
      sections it renders the header once, each section in order, every section
      but the newest inside `<details>` named for its phase, and the run detail
      **immediately above** the block. Asserted on ordering, not on prose, so a
      reworded heading cannot fail it and a reordered body cannot pass.
      `bun test tests/opencode-agent/status.test.ts`
- [x] 1.2 Add `sections: readonly ReportSection[]` to `StatusView` and render
      them in `status-comment.ts`. The progress table, job/branch and budget
      lines move to `run-detail.ts` and render inside a collapsed `<details>`,
      unchanged. `renderStatus` stays pure; the `AGENT_STATUS` block stays last.
      `bun test tests/opencode-agent/status.test.ts && bun run typecheck`

## 2. The overflow budget sheds sections, never blocks (D7)

- [x] 2.1 Failing test: a view whose sections exceed `BODY_BUDGET` renders under
      the budget; hidden blocks survive verbatim and parse through `readBlock`;
      the newest section survives; the oldest are replaced by the trimmed note
      with the correct count. A newest section that alone exceeds the budget is
      truncated from the top, keeping its tail.
      `bun test tests/opencode-agent/status.test.ts`
- [x] 2.2 Implement the budget in `status-comment.ts`: measure the block region
      first, spend what remains on visible sections newest-first. `BODY_BUDGET`
      is a named constant below GitHub's 65,536-character cap, with the margin
      stated in its doc comment.
      `bun test tests/opencode-agent/status.test.ts && bun run lint`

## 3. The prompt truncates at the run detail (D4)

- [x] 3.1 Failing test: `renderThread` keeps a comment carrying an
      `AGENT_STATUS` block, renders everything above the marker, and renders
      nothing from the marker down — including the progress table. A comment
      with no marker is unchanged. Asserted against a body built by
      `renderStatus`, so the two cannot drift apart.
      `bun test tests/opencode-agent/adapters.test.ts`
- [x] 3.2 Replace `isStatusComment` with a truncate-at-marker step running
      **before** `stripBlocks` in `prompt-budget.ts`, and rewrite the doc
      comment: the marker no longer means "drop this comment", it means "the
      bookkeeping starts here".
      `bun test tests/opencode-agent/ && bun run typecheck`

## 4. The reply is buffered and posted once (D1, D3, D6)

- [x] 4.1 Failing test: one `/ask` on an issue produces exactly **one**
      `createComment` for the whole run, no `createComment` before the run
      settles, and no `updateComment` against the reply at all. Driven end to
      end through `runPipeline`.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.2 Failing test: a job crossing two phases still makes one
      `createComment`; both reports appear as sections, oldest first; both
      phases' blocks are in that one body; `readBlock` returns the newer
      `AGENT_STATE` and `locateLatestBlock` selects the comment. The target is
      resolved once from the run's entry state, so a run that opens a pull
      request posts its whole reply to the issue.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.3 Replace `StatusReporter`'s four methods with `section()` (synchronous,
      infallible) and `flush()`, and update `noopStatusReporter`. Route
      `postAndAppend` and `postAnswer` through `section()`; both keep mirroring
      the rendered body into the in-memory thread, under a synthetic negative id
      until the flush has a real one.
      `bun test tests/opencode-agent/ && bun run typecheck`
- [x] 4.4 Failing test: the flush runs on every exit path — waiting, completed,
      failed and a handler that throws — and a throw still posts what was
      buffered before it. Asserts the `finally` placement, not just the happy
      path.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.5 Move the flush into a `try/finally` around `driveMachine` in
      `runAccepted`, where `deps.status.finish` sits today, and drop the
      `willWork` gate on opening a comment (the label gate stays).
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.6 Failing test (D6): `reported` is true only when `createComment`
      returned; a swallowed failure leaves it false with the run still
      succeeding, so the workflow fallback stays in scope.
      `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 4.7 Failing test: `persistState` still rewrites the newest block of an
      **earlier** comment when a run buffers nothing — the `none` classification
      branch — so a run that says nothing still records its spend.
      `bun test tests/opencode-agent/status.test.ts`
- [x] 4.8 Failing test: the wall-clock stop still posts. `teardownReserveMs` now
      sizes one larger write rather than several small ones; assert the park
      notice reaches `createComment` inside the reserve with a full buffer.
      `bun test tests/opencode-agent/time-budget.test.ts`

## 5. The live channel is deleted (D1)

- [x] 5.3 Delete what liveness paid for in the renderer: the `— run in progress`
      header variant, the `⏳ **now**` branch in `stepMark`, and `spentTokens`'
      reconciliation of a heartbeat total against `state.tokensSpent` — at flush
      the state figure is authoritative. Test asserts the budget line reads
      `state.tokensSpent` exactly, with no `carriedTokens` arithmetic left to
      drift. (Was 1.3; see the note at the top.)
      `bun test tests/opencode-agent/status.test.ts && bun run knip`
- [x] 5.1 Failing test: `withHeartbeat` still logs its once-a-minute line and
      `turnDeadlineError` still carries a `ProgressSnapshot` — the halves that
      are not moving — with no `onTick` in the options type.
      `bun test tests/opencode-agent/progress.test.ts`
- [x] 5.2 Remove `onTick` from `heartbeat.ts` and its wiring in `contain.ts`,
      and rewrite `contain.ts`'s build-order comment, which explains an ordering
      that no longer has a reason. `bun run knip` proves nothing else read it.
      `bun test tests/opencode-agent/ && bun run knip`

## 6. The workflow steps edit rather than post (D5)

- [x] 6.1 Failing test: `REPLY_COMMENT_OUTPUT` is written to `$GITHUB_OUTPUT`
      beside `reported=true` when a comment was posted, and neither is written
      when none was; absent `GITHUB_OUTPUT` (a local `--event-path` run) is not
      a failure; a failed write is a `warn`.
      `bun test tests/opencode-agent/cli.test.ts`
- [x] 6.2 Publish the id from `recordReport` in `step-output.ts`, taking it from
      what the flush returned.
      `bun test tests/opencode-agent/ && bun run typecheck`
- [x] 6.3 Failing test: the transcript step runs **after** the
      infrastructure-failure step and appends to whichever comment exists,
      reading `steps.pipeline.outputs.reply-comment` or the failure step's own
      id; the failure step's `if:` and wording are unchanged; both `if:`
      expressions name output keys the pipeline actually writes. Asserted
      against the parsed workflow, as the existing suite does.
      `bun test tests/opencode-agent/workflow.test.ts`
- [x] 6.4 Rewrite both steps in `.github/workflows/agent-pipeline.yml`, keeping
      the artefact-id gate, the derived `VIEWER_URL` and the `reported` gate
      exactly as they are.
      `bun run workflows:lint && bun test tests/opencode-agent/workflow.test.ts`

## 7. Rename, docs and full verification (D8)

- [x] 7.1 `git mv` `status-comment.ts` → `reply-comment.ts` and
      `status-reporter.ts` → `reply-buffer.ts`, updating imports. The
      `AGENT_STATUS` marker string and the `STATUS_MARKER` symbol are unchanged
      — old threads carry the value and D4 reads it on historical comments.
      Test asserts the marker value verbatim, so the rename cannot take it.
      `bun test tests/opencode-agent/ && bun run typecheck`
- [x] 7.2 Update `opencode-agent/CLAUDE.md` — **Shape** still calls
      `AGENT_STATUS` "read by nothing else" and describes the comment surfaces
      as separate — and `README.md`. Record the outcome in `ROADMAP.md`.
- [x] 7.3 Rewrite the module doc comments the change falsifies:
      `reply-comment.ts` ("the entire comment budget… never a second", "carries
      no free model text", "deliberately carries no `AGENT_STATE` block"),
      `reply-buffer.ts` ("a status comment is not a report", the two cost
      bounds), `run-post.ts` (both functions' surface reasoning),
      `prompt-budget.ts` (`isStatusComment`), `step-output.ts` ("the one thing
      this pipeline tells the rest of its own workflow"), `heartbeat.ts`
      (`onTick`), `orchestrator.ts` (the `willWork` and `finish` comments).
      `bun run lint`
- [x] 7.4 Full verification: `bun test` (14,425 pass / 0 fail / 3 skip),
      `bun run typecheck`, `bun run lint`, `bun run knip`,
      `bun run format:check`, `bun run workflows:lint` — all green.
      `bun run test:mutate:changed --base=<branch point>` reports **no changed
      mutation targets**: `stryker.config.json`'s `mutate` globs cover
      `src/providers/**`, `src/tools/**`, `plugins/task-provider-*/**` and a
      short list of `src/*.ts`, and this change touches none of them. The
      ratchet is a no-op here rather than a pass — worth stating, since a run
      against a *stale* base ref sweeps in unrelated files and dies in
      Stryker's dry run, which reads like a failure of this change and is not.
      `bun security` was **not run**: Semgrep is absent from this container and
      Docker is unavailable. The change adds no fetch, no credential handling
      and no plugin surface, and comment bodies still leave through
      `github.ts`'s unchanged redaction — but the scan did not run, so it is
      not claimed to have passed.
