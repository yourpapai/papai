<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: One command, one reply

## Why

Issue #281 carries 43 comments, 30 of them the agent's. Every maintainer
command drew exactly three, in the same order, every time — the live status
comment finalised (`### 📋 Design spec is waiting for you`), the report
(`### Answer`), and a two-link transcript notice. Often the first two say the
same thing twice: the 04:49 failure posted `### ❌ Run failed` and then
`### ❌ Run failed in INIT_OR_CLARIFY`.

Each writer has a defensible reason and none of them is the comment count.
`status-reporter.ts` opens its comment before the work and must survive a dead
job; `postAndAppend` writes the record and its `AGENT_STATE` block; the
workflow's transcript step cannot know the artefact URL until after the
upload. Three writers, no one place deciding how much a run may say.

The cost is not only noise. Three notifications per command train a maintainer
to stop reading them, and the thread the model reads back is padded with the
agent's own bookkeeping — `renderThread` already spends code dropping the
status comment out of the prompt window.

## What Changes

- **A run gets one comment.** The comment `status-reporter.ts` opens is the
  run's only write: live while working, its body replaced by the report at the
  end rather than by a finished progress table. The table survives as a
  collapsed `Run detail` section.
- **A multi-phase job accumulates rather than repeats.** Each phase report is
  appended as a section of that comment, latest last, nothing dropped.
- **Hidden blocks move with it.** `AGENT_STATE`, `AGENT_REPORT` and
  `AGENT_HANDOFF` append into the same comment. `readBlock` already returns the
  *last* block of a marker in a body and `locateLatestBlock` walks comments
  newest-first, so newest-wins survives and superseded blocks stay readable.
- **The transcript notice and the infrastructure-failure notice edit that
  comment** instead of posting their own. The pipeline publishes the comment id
  on `$GITHUB_OUTPUT` when it opens the comment — the channel `step-output.ts`
  already owns, processed by the runner in a `finally`, so the id survives a
  crashed step. With no comment opened, the fallback posts one and the
  transcript edits that.
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
- Editing or deleting earlier runs' comments. A thread still grows by one
  comment per command.
- Collapsing the 👀 reaction or the `agent:working` label — the only signals a
  maintainer has before the comment opens.
- Revisiting the surface rule `agent-pr-surface-and-blocked-commits` settled.
- A comment-per-phase mode behind a flag, which would keep both renderers alive.

## Impact

`opencode-agent/src/`: `status-comment.ts`, `status-reporter.ts`,
`run-post.ts`, `cascade.ts`, `prompt-budget.ts`, `step-output.ts`,
`state-persist.ts`, and the renderers reaching the thread through
`postAndAppend` (`run-report.ts`, `time-budget.ts`, `token-budget.ts`,
`triggers.ts`, `ci-trigger.ts`, `phase-failure.ts`).
`.github/workflows/agent-pipeline.yml`: the transcript-link and
infrastructure-failure steps become edits. Tests in `tests/opencode-agent/`
(`status`, `orchestrator`, `workflow`, `adapters`, `cli`). Docs:
`opencode-agent/CLAUDE.md` (the `AGENT_STATUS` rule in **Shape**), `README.md`,
`ROADMAP.md`.
