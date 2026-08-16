<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: One command, one reply

## Context

See `proposal.md` — Why. Four existing properties shape every decision below,
and none may be weakened to get the comment count down.

**Feedback must never fail a run.** `status-reporter.ts` states it and enforces
it in one place: `attempt` swallows every GitHub error. That rule was written
for a channel that was pure decoration. The run's *report* is not decoration, so
consolidation cannot inherit the swallow unexamined — D6 carves it.

**A status comment is not a report.** `RunResult.reported` gates the workflow's
fallback comment, and the two claims must stay separable even though they now
travel in one comment.

**The block layer is already comment-agnostic.** `readBlock` returns the *last*
block of a marker within a body; `locateLatestBlock` walks the thread
newest-first; `replaceBlock` rewrites the last. Newest-wins is therefore "last
block in the newest comment carrying one", true whether a run wrote four
comments or one. This is what makes D3 nearly free.

**GitHub caps a comment at 65,536 characters.** Today a run's output spreads
over as many comments as it has phases, so the cap has never been reachable.
One comment per run makes it reachable, and it fails loudly and destructively.
D7 is not optional.

## Goals / Non-Goals

**Goals:**

- One maintainer command produces exactly one agent comment, in every exit path
  including a crashed job.
- Nothing the agent says today is lost, only relocated — and the comment lands
  when the work is done, so GitHub's notification marks the answer.
- The restore scan, the handoff read and the report read behave identically.

**Non-Goals:**

- Shortening any report, or replacing the live view with another live surface.
  See `proposal.md` — Non-goals.
- Recovering the buffered sections of a run killed by SIGKILL. See Risks.

## Decisions

### D1 — The reply is buffered and posted once, at the end of the run

The live status comment is **deleted**, not repurposed. Nothing is written to
the thread while a run is in flight; each phase's report and blocks are
appended to an in-memory buffer, and the buffer is rendered and posted as one
comment when the run settles.

`StatusReporter` collapses to a buffer — `ReplyBuffer`, under D8 — with three
methods:

```ts
/** Records the state the run entered on, which fixes the surface. */
begin(state: AgentState): void
/** Adds a phase's report. Terminal by construction: never re-rendered. */
section(state: AgentState, section: ReportSection): void
/** Posts the run's one comment, or null. The only write this module makes. */
flush(): Promise<PostedComment | null>
```

*Added during apply:* `begin`. The sketch above had two methods and no way to
say *which* state fixes the surface, which D3 needs; it also has to clear the
previous run's sections, the way `open()` did, or a buffer reused across runs
posts a finished run's sections under the next run's heading. It writes nothing.
It is called before `applyTrigger`, not before the cascade: a refused command —
an exhausted `/retry`, a `/review` past its ceiling, a command on the wrong
surface — is buffered by the trigger layer, and a `begin` that waited for the
cascade would strand those sections in a buffer nothing flushed.

`section` is synchronous and cannot fail — it appends to an array — which is
most of the complexity of the old channel gone. What goes with it, because
nothing calls it any more: `start`, `enter`, `tick`, `MIN_EDIT_INTERVAL_MS`,
the unchanged-body suppression, the `commentId`/`lastBody`/`lastEditMs`
bookkeeping, `StatusView.live` and `StatusView.progress`, the `⏳ **now**`
branch in `stepMark`, and `spentTokens`' reconciliation of the heartbeat's
running total against `state.tokensSpent` — at flush the state figure is
authoritative, which is the case that function existed to work around.

`heartbeat.ts`'s `onTick` reader goes too. Its only wiring is `contain.ts`, and
its doc names the live status comment as the reason it exists. The heartbeat's
**log** half — its original and stated job, "is it still alive" once a minute
into the Actions log — is untouched, and is what `contain.ts`'s build-order
comment must be rewritten to stop claiming.

*Alternative rejected:* keeping the comment live and editing it into the report.
That is the shape this change first proposed, and the maintainer declined it:
GitHub does not notify on an edit, so the answer would arrive silently into a
comment whose only notification fired when the run *started*. A live view is
worth less than knowing the reply landed.

*Alternative rejected:* a new `reply-buffer.ts` alongside a surviving
`status-reporter.ts`. There is no live channel left for the latter to be, so
this is a rename, not a second module — see D8.

*Discovered during apply:* `createReplyBuffer` no longer returns the no-op
reporter when `runUrl` is null. That short-circuit was right for decoration — a
status comment that cannot link the job doing the work is most of its value gone
— and is wrong for a report: it would silence every local `--event-path` run
entirely. `run-detail.ts` drops the job *link* instead, and `runUrl` becomes
nullable in the view.

### D2 — The comment is a header plus accumulated sections

The rendered body, in order:

1. **Header** — `phaseHeading` for the state the run settled on, as
   `renderReply` renders it today minus the `— run in progress` variant. One
   heading for the run, which is where the `### ❌ Run failed` /
   `### ❌ Run failed in INIT_OR_CLARIFY` duplication goes.
2. **Sections** — each phase's report, oldest first. Every section but the last
   is wrapped in `<details>` named for its phase; the newest is open, because it
   is what the maintainer came to read.
3. **`AGENT_STATUS`** — the marker, which opens the bookkeeping rather than
   closing the body. D4 cuts here.
4. **Run detail** — the progress table, job/branch lines and budget line in a
   collapsed `<details>`. It is now a summary of a finished run rather than a
   live view, and it keeps its place because "42k of 150k tokens · attempt 1 of
   3" is the figure a maintainer acts on. **Below** the marker, because a
   progress table is bookkeeping — it is the original reason the marker exists —
   and an HTML comment renders as nothing, so a human sees the disclosure
   exactly where it would otherwise have been.
5. **The sections' hidden blocks**, oldest first, so "last block in the body
   wins" resolves to the newest phase's.

*Corrected during apply.* This list first put the run detail **above** the
marker and had D4 cut at it, which leaves the progress table on the model's side
of the cut — the one thing the cut exists to remove. The marker moved up
instead. It is the cheaper fix and the more honest one: "the bookkeeping starts
here" was always the meaning, and a progress table is bookkeeping.

`renderReply` stays a pure function of a `ReplyView`, which now carries
`sections: readonly ReportSection[]` and no liveness. Phase reports are terminal
by construction — written from a finished `PhaseOutcome` — so a section is
rendered exactly once, and the whole body is rendered exactly once.

*Split during apply:* sections pushed the renderer past `max-lines` (pedantic,
300), which CLAUDE.md calls a design signal rather than something to compress
around. The progress table, the job/branch lines and the budget line moved to
`run-detail.ts` — *how a run describes itself* — leaving `reply-comment.ts` as
*what a reply is made of*. The two change for different reasons: a new phase or
a new budget adds a row to the former; a change to how reports are arranged
touches only the latter.

### D3 — Blocks append into the same comment, unchanged in semantics

`postAndAppend` appends `AGENT_STATE` and any `outcome.blocks` into the
buffer's block region rather than onto a fresh comment. Nothing in `blocks.ts`
changes: last-in-body wins for `readBlock`, superseded blocks stay present for
the newest-first walks `findHandoff` and the report read do, and `replaceBlock`
already targets the last.

The one-comment lag `postAndAppend` documents — addressing the write with
`input.state` rather than the state it produced, so the block that first records
`prNumber` lands on the issue — becomes structural instead of a rule each caller
must remember: the flush resolves `feedbackTarget` once, from the state the
**run** entered on, which is by definition before any phase in that run could
have set `prNumber`. A run that opens a pull request posts its whole reply to
the issue, which is where the handover belongs; every later run posts to the
pull request.

`postAnswer` keeps its distinction — no state block, and the surface is the one
the question was typed on — as a property of the buffered entry rather than of a
separate write. An empty buffer at flush posts nothing, so the `none`
classification branch still says nothing and `persistState` still records its
spend by rewriting the newest block of an earlier comment.

### D4 — The prompt truncates at the run detail rather than dropping the comment

`isStatusComment` in `prompt-budget.ts` drops the whole comment from the model's
thread window. It cannot survive: that comment now carries the answer, the
design-spec digest and the plan — the artefacts `renderThread`'s own doc says
must not be hidden from the model.

The `AGENT_STATUS` block stops meaning "drop this comment" and starts meaning
"the bookkeeping starts here". `renderThread` truncates each body at the first
`AGENT_STATUS` marker before `stripBlocks` runs. D2 puts the marker directly
below the last section and everything else below the marker, so the model sees
the header and every section and none of the progress table.

Truncation at a marker rather than a fenced region, because the failure mode is
the mild one: a model-authored report that literally types `<!-- AGENT_STATUS:`
truncates its own section early instead of leaking bookkeeping or corrupting a
block. That a report *can* type a marker is unchanged by this design — the same
pre-existing surface `AGENT_STATE` has — and closing it is not this change's job.

### D5 — The comment id is published at the same exit that posts it

`step-output.ts` already owns the pipeline → workflow channel, and its doc
states the property both workflow steps need: the runner processes
`$GITHUB_OUTPUT` file commands in a `finally` around the handler, so a marker
survives the step exiting 1. `REPLY_COMMENT_OUTPUT = 'reply-comment'` is written
from `recordReport`, beside `reported=true`, from the id the flush returned.

Because the comment is posted at the end, "the pipeline died" and "no comment
exists" are now the same condition, and the two workflow steps need no id-vs-no-id
subtlety beyond falling back to a post:

- **Infrastructure failure** (`if: (failure() || cancelled()) && … reported !=
  'true'`): unchanged in wording and gate. It fires exactly when nothing was
  posted, which is what it always claimed. It publishes its own comment id for
  the step below.
- **Transcript link**: appends its `<details>` to whichever comment the two
  above left, read back with `gh api … --jq .body` and PATCHed. Moved *after*
  the failure step so there is always something to attach to.

*Alternative rejected:* the pipeline rendering the transcript link itself against
the run page (`…/actions/runs/<id>#artifacts`), needing no id channel. One click
worse than the artefact URL the upload action reports, and the workflow's comment
is explicit that the direct link is the promise being kept.

### D6 — `reported` means the comment was accepted

With one write, the flag is what it always claimed to be: the flush sets
`reported` when `createComment` returns, and nothing else decides it. The old
carve-out — a status comment that must never be mistaken for a report — has
nothing left to guard.

Concretely, `flushAround` in `orchestrator.ts` **overwrites** whatever the
terminal path claimed, and `runPipeline`'s guardrail exit keeps its own answer
only because it returns before the buffer is begun. The per-path `reported`
values are therefore no longer read inside `runAccepted`. They are left in place
rather than deleted: each documents what its path *intends* to have said, which
is what a second write would have to be decided from, and stripping twenty-one
of them would be a wider diff than the clarity buys. `run-result.ts` says so, so
the next reader is not misled into thinking a path can still decide it.

This is the one place the "never fail a run" swallow is narrowed. `attempt`
keeps swallowing, so a refused post is still a `warn` rather than a crash, but
it must leave `reported` false: a report GitHub refused is a report the issue
does not carry, and claiming otherwise suppresses the fallback that is the only
thing that would explain the silence.

### D7 — An overflow budget that sheds visible sections, never blocks

The rendered body is measured once, at flush, against a `BODY_BUDGET` set below
GitHub's 65,536-character cap. Over budget, the renderer collapses and then
drops the **oldest** visible sections, replacing them with `_(N earlier sections
in this run were trimmed — see the run log.)_`, until the body fits.

Two invariants:

- **Hidden blocks are never shed.** They are the run's memory; a trimmed
  `AGENT_STATE` is a stranded issue. They are measured first and the visible
  budget is what remains.
- **The newest section is never shed.** If it alone exceeds the budget it is
  truncated from the top with the same note, because a maintainer reading a
  report wants its conclusion.

The cap is unreachable today, so this is new ground rather than a regression
guard — which is why it is a decision with tests rather than a note.

### D8 — The two modules are renamed to what they now are

`status-comment.ts` → `reply-comment.ts` (the renderer) and
`status-reporter.ts` → `reply-buffer.ts` (the buffer and the single write). A
file called `status-reporter.ts` that reports no status and holds no live
comment is a name that will mislead every future reader, and the rename is a
`git mv` plus import updates.

The **marker string stays `AGENT_STATUS`**, and that is deliberate rather than
oversight: old threads carry it, D4's truncation reads it on historical
comments, and renaming the constant's value would strand every comment written
before this change. The exported symbol keeps its name too, so the diff is
files and imports only.

## Risks / Trade-offs

**A hard-killed run loses everything it had buffered.** This is the sharpest
cost of the flip and the one thing the old shape did better. Today each phase
report is on the thread the moment it exists; buffered, a run that is OOM-killed
or cancelled past the teardown reserve, or whose runner hits `timeout-minutes`,
takes every section with it. Three things bound it: the flush sits in a
`finally` around `runAccepted`, so a throw — the common failure — still posts;
`teardownReserveMs` already holds back wall-clock time for exactly this write,
and now sizes one larger post rather than several small ones, which the deadline
tests must assert; and the encrypted transcript still uploads, so the run is
reconstructable. What remains uncovered is SIGKILL, where the workflow's
fallback comment is the whole answer — as it is today.

**No live view of a long implementation run.** Accepted, and the reason the
maintainer chose this shape: the 👀 reaction, the `agent:working` label and the
heartbeat's once-a-minute Actions-log line are what a run in flight has.

**The in-memory thread mirror no longer has a real comment id.** `postAndAppend`
mirrors each rendered body into `thread` so a later phase can read what an
earlier one wrote, and until flush there is no id to mirror it under. A
synthetic negative id keeps the shape total and makes an accidental
`updateComment` against it fail loudly rather than edit a real comment.

**An identity drift is now a diagnostic, not an early failure.** *(Found during
apply.)* `reportIdentityDrift` compared the author GitHub recorded against the
one the pipeline believes in, and it ran on every phase's post — so the in-job
mirror could carry the *recorded* author, and a drift made delivery unable to
find the report the same job had just written. That early, self-inflicted
failure is what made the misconfiguration visible within one run. Buffering
removes it: there is no posted author to learn until the flush, one line before
the run ends. The check moved there and still fires on the run that causes it,
but the run now succeeds rather than failing on itself. The hazard it warns
about is unchanged — a later job reading real authors back cannot see those
comments — and `AGENT_SELF_LOGIN` is still the fix.

**Nothing in `src/` is affected.** `opencode-agent/` is a standalone Bun
workspace that no papai module imports and that never runs in the papai
container: no capability gating, no `tool_prefs` surface, no scope-model
interaction, no DB migration, no new dependency.

## Migration Plan

No state migration and no `STATE_VERSION` bump. Blocks are unchanged in shape
and read semantics, so new code restores from a thread the old code wrote and
vice versa — an in-flight issue mid-review keeps working.

`renderThread` is the only change visible to an old thread: previous runs' status
comments carry an `AGENT_STATUS` block with nothing above it but a progress
table, so truncating at the marker yields a header and a table where the old code
yielded nothing. Marginally more prompt noise on historical comments, decaying
out of the twenty-comment window; not worth a compatibility branch.

## Open Questions

None blocking. One deliberate deferral: whether `BODY_BUDGET` should also cap
what a *single* phase report may render before it reaches the buffer. D7
truncates at the surface, which is right as a backstop; capping at the source is
a report-length decision, and `proposal.md` puts those out of scope.
