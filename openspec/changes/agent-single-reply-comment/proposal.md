<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: One command, one reply

## Why

Issue #281 carries 43 comments, 30 of them the agent's. Every maintainer
command drew exactly three, in the same order — the live status comment
finalised (`### 📋 Design spec is waiting for you`), the report (`### Answer`),
and a two-link transcript notice. Often the first two say the same thing twice:
the 04:49 failure posted `### ❌ Run failed`, then `### ❌ Run failed in
INIT_OR_CLARIFY`.

Three writers, each with a defensible reason, and none of them owning the
comment count: `status-reporter.ts` opens its comment before the work,
`postAndAppend` writes the record and its `AGENT_STATE` block, and the
workflow's transcript step cannot know the artefact URL until after the upload.

The cost is not only noise. Three notifications per command train a maintainer
to stop reading them, and the thread the model reads back is padded with the
agent's own bookkeeping — `renderThread` already spends code dropping the
status comment out of the prompt window.

## What Changes

- **A run posts one comment, once, when the job ends.** Phase reports are
  buffered in memory and rendered together. The live status comment is
  **deleted**, not repurposed: no comment is opened at the start, nothing is
  edited mid-run, and the progress table survives as a collapsed `Run detail`
  summary of the finished run.
- **A multi-phase job accumulates rather than repeats.** Each phase report is a
  section of that one comment, latest last, nothing dropped.
- **The live channel goes with it.** `StatusReporter.start/enter/tick`,
  `MIN_EDIT_INTERVAL_MS` and the heartbeat's `onTick` reader lose their only
  callers. The heartbeat's log half — its original job — is untouched, and with
  the 👀 reaction and the `agent:working` label it stays the signal that a run
  is alive.
- **Hidden blocks move with it.** `AGENT_STATE`, `AGENT_REPORT` and
  `AGENT_HANDOFF` append into that body. `readBlock` already returns the *last*
  block of a marker in a body and `locateLatestBlock` walks comments
  newest-first, so newest-wins survives and superseded blocks stay readable.
- **The transcript notice and the infrastructure-failure notice edit that
  comment** instead of posting their own. The pipeline publishes the comment id
  on `$GITHUB_OUTPUT` beside `reported=true` — the channel `step-output.ts`
  already owns — at the same exit that posts it. A job that died posted
  nothing, so the fallback posts the run's one comment and the transcript
  appends to that.
- **`renderThread` stops dropping the comment**, truncating it at the run
  detail instead: it now carries the answer the model must read.

## Capabilities

### New Capabilities

None. A dev-workflow change confined to `opencode-agent/` and its workflow —
nothing under `src/` imports it and it never runs in the papai container. No
platform instance, task instance, or config-context scope is touched, and no
papai runtime behavior changes. `skip_specs: true`, matching
`opencode-agent-openspec-compliance` and `agent-pr-surface-and-blocked-commits`.

### Modified Capabilities

None. `openspec/specs/` is empty (strangler); nothing to modify.

## Non-goals

- Reducing what the agent *says*. This changes how many comments carry the
  words, not the words.
- Editing earlier runs' comments. A thread still grows by one per command.
- Replacing the live view with another live surface — a job summary, a check
  run, a label per phase. The reaction, the label and the Actions-log heartbeat
  are what a run in flight has, and that is the accepted trade.
- Revisiting the surface rule `agent-pr-surface-and-blocked-commits` settled.
- A comment-per-phase mode behind a flag, which would keep both renderers alive.

## Impact

`opencode-agent/src/`: `status-comment.ts` and `status-reporter.ts` become
`reply-comment.ts` / `reply-buffer.ts` (marker string held at `AGENT_STATUS`),
with the run's self-description split into a new `run-detail.ts`; plus
`run-post.ts`, `cascade.ts`, `orchestrator.ts`, `contain.ts`, `deps.ts`,
`phase-context.ts`, `heartbeat.ts`, `turn-run.ts`, `prompt-budget.ts`,
`run-result.ts`, `step-output.ts`.
`.github/workflows/agent-pipeline.yml`: the transcript-link and
infrastructure-failure steps become edits. Tests in `tests/opencode-agent/`
(`reply`, `orchestrator`, `workflow`, `adapters`, `cli`, `progress`). Docs:
`opencode-agent/CLAUDE.md` (the `AGENT_STATUS` rule in **Shape**), `README.md`,
`ROADMAP.md` (S5-14).
