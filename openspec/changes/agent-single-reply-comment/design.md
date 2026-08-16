<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: One command, one reply

## Context

See `proposal.md` — Why. Four existing properties shape every decision below,
and none of them may be weakened to get the comment count down.

**Feedback must never fail a run.** `status-reporter.ts` states it and enforces
it in one place: `attempt` swallows every GitHub error, and a failed *create*
leaves `commentId` null so every later call is a no-op. Consolidation puts the
run's report inside that channel, so the swallow can no longer be unconditional
— a dropped report is not decoration. The exception is carved in D6.

**A status comment is not a report.** `RunResult.reported` gates the workflow's
fallback comment. A run killed mid-phase leaves "run in progress" on the issue,
which is precisely what the fallback exists to explain. Merging the two surfaces
must not merge the two claims.

**The block layer is already comment-agnostic.** `readBlock` returns the *last*
block of a marker within a body; `locateLatestBlock` walks the thread
newest-first; `replaceBlock` rewrites the last. Newest-wins is therefore
"last block in the newest comment carrying one", which is true whether a run
wrote four comments or one. This is what makes D3 nearly free.

**GitHub caps a comment at 65,536 characters.** Today a run's output is spread
over as many comments as it has phases, so the cap has never been reachable.
One comment per run makes it reachable, and it is the one hard limit here that
fails loudly and destructively. D7 is not optional.

## Goals / Non-Goals

**Goals:**

- One maintainer command produces exactly one agent comment on the thread, in
  every exit path including a crashed job.
- Nothing the agent says today is lost, only relocated.
- The restore scan, the handoff read and the report read behave identically.

**Non-Goals:**

- Shortening any report. See `proposal.md` — Non-goals.
- A second rendering mode, flagged or otherwise.
- Recovering the end-of-run notification GitHub does not send for an edit. See
  Risks — this is the accepted cost of the chosen shape.

## Decisions

### D1 — `status-reporter.ts` becomes the reply channel, and is the only writer

No new module. The file already owns the run's comment id, the edit
rate-limiter, the unchanged-body suppression and the "never fail a run" rule —
which is the entire mechanism a consolidated reply needs. `run-post.ts` keeps
its two functions and its reasoning; what changes is where they land the body.

`StatusReporter` gains one method:

```ts
/** Adds a phase's report to the run's comment. Terminal: never re-rendered. */
section(body: string, blocks: readonly string[]): Promise<void>
```

`postAndAppend` and `postAnswer` call it instead of `github.createComment`.
Their return contract is unchanged — both still mirror the rendered body into
the in-memory `thread`, which is what lets a later phase in the same job read an
artefact the earlier one just wrote. The mirrored entry now carries the reply
comment's real id, so `persistState`'s in-place rewrite addresses the same
comment the reader would select.

*Alternative rejected:* a new `reply-channel.ts` above both. It would own a
comment id, an edit rate-limiter and a swallow policy — three things
`status-reporter.ts` owns already — and leave that file as a renderer with a
lifecycle it no longer controls. The smallest thing that works is one method on
the object that already holds the id.

*Alternative rejected:* keeping `createComment` and deleting the status comment
instead. That is the option the maintainer declined: it costs every live signal
during a long run and leaves a crashed job with nothing on the thread.

### D2 — The comment is a header plus accumulated sections

The rendered body, in order:

1. **Header** — `phaseHeading` for the run's current state, exactly as
   `renderStatus` renders it today. One heading for the run, which is where the
   `### ❌ Run failed` / `### ❌ Run failed in INIT_OR_CLARIFY` duplication goes.
2. **Sections** — each phase's report, oldest first. Every section but the last
   is wrapped in `<details>` named for its phase; the newest is open, because it
   is what the maintainer came to read.
3. **Run detail** — the progress table, job/branch lines and budget line, in a
   collapsed `<details>`. Always last of the visible body: D4 depends on it.
4. **Hidden blocks** — `AGENT_STATUS`, then whatever D3 appended.

While the run is live there are no sections yet and the header carries
`— run in progress`, so an in-flight comment reads exactly as the status comment
does today. `renderStatus` stays a pure function of a `StatusView`; the view
gains `sections: readonly ReportSection[]`.

Phase reports are **terminal by construction** — written from a finished
`PhaseOutcome` — so a section is appended once and never re-rendered. Only the
header, the run detail and the block region change on an edit.

### D3 — Blocks append into the same comment, unchanged in semantics

`postAndAppend` appends `AGENT_STATE` and any `outcome.blocks` into the reply
comment's block region rather than onto a fresh comment. Nothing in `blocks.ts`
changes: last-in-body wins for `readBlock`, superseded blocks stay present for
the newest-first walks `findHandoff` and the report read do, and `replaceBlock`
already targets the last.

The one-comment lag `postAndAppend` documents — addressing the write with
`input.state` rather than the state it produced, so the block that first records
`prNumber` lands on the issue — is **preserved and made cheaper**: the reply
comment's target is fixed when it is opened, at the start of the run, which is
by definition before any phase in that run could have set `prNumber`. The lag
becomes a property of the channel instead of a rule each caller must not forget.

*Cost:* a run that both opens a pull request and then runs further phases writes
all of it to the issue rather than moving mid-run. That is what the lag already
bought, one comment at a time.

### D4 — The prompt truncates at the run detail rather than dropping the comment

`isStatusComment` in `prompt-budget.ts` drops the whole comment from the model's
thread window. It cannot survive: that comment now carries the answer, the
design-spec digest and the plan — the artefacts `renderThread`'s own doc says
must not be hidden from the model.

The `AGENT_STATUS` block stops meaning "drop this comment" and starts meaning
"the bookkeeping starts here". `renderThread` truncates each body at the first
`AGENT_STATUS` marker before `stripBlocks` runs. D2 guarantees the run detail
sits immediately above it, so the model sees the header and every section and
none of the progress table.

Truncation at a marker, rather than fencing the region with a marker pair,
because the failure mode is the mild one: a model-authored report that literally
types `<!-- AGENT_STATUS:` truncates its own section early instead of leaking
bookkeeping or corrupting a block. That a report *can* type a marker at all is
unchanged by this design — it is the same pre-existing surface `AGENT_STATE` has
today, and closing it is not this change's job.

### D5 — The comment id is a step output, published when the comment opens

`step-output.ts` already owns the pipeline → workflow channel and states why the
marker survives a step that exits 1: the runner processes `$GITHUB_OUTPUT` file
commands in a `finally` around the handler. The same property is what the two
workflow steps need, so this is one more key on an existing channel rather than
a new one.

`REPLY_COMMENT_OUTPUT = 'reply-comment'` is written from `open()` — at the
moment the comment is created, not at exit — so a job killed mid-turn still
tells its own workflow which comment to edit.

Both workflow steps become edits, and both fall back to posting when the id is
absent, which is exactly the case where nothing is on the thread to edit:

- **Infrastructure failure** (`if: (failure() || cancelled()) && … reported !=
  'true'`): with an id, `PATCH /repos/{repo}/issues/comments/{id}` replacing the
  live header with "Agent job did not finish"; without one, `gh issue comment`
  as today. Its own id is published for the step below.
- **Transcript link**: appends its `<details>` to whichever comment the two
  steps above left, read back with `gh api … --jq .body` and PATCHed. It moves
  *after* the failure step so there is always something to attach to.

*Alternative rejected:* the pipeline rendering the transcript link itself
against the run page (`…/actions/runs/<id>#artifacts`), which needs no id
channel at all. It is one click worse than the artefact URL the upload action
reports, and the workflow's comment is explicit that the direct link is the
promise being kept.

### D6 — `reported` still means "a terminal section was written"

The flag stays a property of the *content*, not of the comment's existence.
`section()` sets it; opening the comment does not. A run killed after `open()`
leaves "run in progress" on the thread and `reported` false, so the fallback
step fires and — under D5 — rewrites that same comment. One comment, and the
lie is corrected rather than left standing beside a second comment.

This forces the one carve-out in the "never fail a run" rule: `attempt` keeps
swallowing every write, but a swallowed failure on a `section()` call must leave
`reported` false. A report GitHub refused is a report the issue does not carry,
and claiming otherwise suppresses the fallback that would have explained the
silence. `section()` therefore returns nothing and sets the flag only on an
accepted edit.

### D7 — An overflow budget that sheds visible sections, never blocks

Before each edit, the rendered body is measured against a `BODY_BUDGET` set
below GitHub's 65,536-character cap. Over budget, the renderer collapses and
then drops the **oldest** visible sections, replacing them with
`_(N earlier sections in this run were trimmed — see the run log.)_`, until the
body fits.

Two invariants:

- **Hidden blocks are never shed.** They are the run's memory; a trimmed
  `AGENT_STATE` is a stranded issue. They are measured first and the visible
  budget is what is left.
- **The newest section is never shed.** If the newest section alone exceeds the
  budget it is truncated from the top with the same note, because a maintainer
  reading a report wants its conclusion.

The cap is not reachable today, so this is new ground rather than a regression
guard — which is why it is a decision with tests rather than a note.

## Risks / Trade-offs

**GitHub does not notify on an edit.** This is the significant cost of the
shape chosen and it is worth stating plainly: today the maintainer is notified
when `### Answer` is *posted*; after this change they are notified when the run
*starts*, and the answer arrives silently into that same comment. For a long
implementation run that is arguably better — the notification now says "your
command was picked up". For a two-minute `/ask` it is worse. The alternative
that keeps the end-of-run notification is posting one comment at the end and
having no live channel at all, which was considered and declined. If the
notification turns out to matter more than the live view, the fix is to flip
that decision, not to add a second comment back.

**The in-memory thread mirror grows one entry per phase, all with the same
comment id.** Harmless for `readBlock`, which reads bodies; a hazard for any
future code that assumes ids are distinct within a thread. `postAndAppend`
mirrors the *whole rendered body* each time, so the last mirrored entry is the
authoritative one — the same "last wins" the block layer uses.

**Edit volume is unchanged in order of magnitude.** `MIN_EDIT_INTERVAL_MS`
already caps ticks at one edit a minute; a phase report forces an edit past that
cap, which adds at most one edit per phase — a handful per run against ~90 from
ticks alone.

**Nothing in `src/` is affected.** `opencode-agent/` is a standalone Bun
workspace that no papai module imports and that never runs in the papai
container, so there is no capability gating, no `tool_prefs` surface, no scope
model interaction, no DB migration and no new dependency.

## Migration Plan

No state migration and no `STATE_VERSION` bump. Blocks are unchanged in shape
and in read semantics, so a run of the new code restores from a thread the old
code wrote, and vice versa — an in-flight issue mid-review keeps working.

`renderThread`'s change is the only one visible to an old thread: previous runs'
status comments carry an `AGENT_STATUS` block with nothing above it but a
progress table, so truncating at the marker yields a header and a table where
the old code yielded nothing. Marginally more prompt noise on historical
comments, decaying out of the twenty-comment window; not worth a compatibility
branch.

## Open Questions

None blocking. One deliberate deferral: whether `BODY_BUDGET` should also cap
what a *single* phase report may render before it reaches the channel. D7
truncates at the surface, which is correct as a backstop; capping at the source
is a report-length decision and `proposal.md` puts those out of scope.
