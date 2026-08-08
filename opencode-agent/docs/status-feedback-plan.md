<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Status feedback UX — audit and plan

How a maintainer finds out what the agent is doing, in what state their issue
is, and where the job that is doing it lives.

Audit of the pipeline as it stands on `claude/opencode-agent-feedback-ux-mr89ep`,
then a staged plan. Nothing here is implemented yet; this is the design and the
reasoning behind it, in the shape the rest of this workspace records decisions.

**Re-anchored** against `origin/master` at `07b2586`, after nine state-machine
fixes landed under this document. Three of them moved ground it stands on: a
refused slash command now answers on the issue, `RunResult.reported` gave the
pipeline a way to tell its own workflow whether it spoke, and the token-budget
stop learned to park somewhere `/retry` can reach. What each one closed, left
open, or made newly possible is recorded per finding below and summarised in the
Drift Log at the end.

---

## 1. What a maintainer can see today

Three surfaces exist, and only one of them is durable.

| Surface            | Written by                                           | When                        | Seen by                  |
| ------------------ | ---------------------------------------------------- | --------------------------- | ------------------------ |
| Issue comments     | `run-report.ts` `postAndAppend`, from phase handlers | **only when a phase ends**  | everyone                 |
| Actions job log    | `progress.ts` events + heartbeat                     | continuously, once a minute | whoever opens it         |
| Hidden state block | `state-manager.ts` `renderStateComment`              | with every comment          | nobody — it is a comment |

That is the whole of it. There are no labels, no reactions, no issue-title
decoration, no link from the issue to the run doing the work, and no surface
that is updated _while_ a phase runs.

Verified absences, not assumptions:

- `grep -rn 'GITHUB_RUN\|run_id\|runUrl' src/` finds `runUrl` only on
  `CiTriggerEvent` — the URL of the **red run that triggered** a CI fix. The
  pipeline never learns the URL of its _own_ run. The one place it exists is the
  workflow's failure fallback step, which builds `RUN_URL` in YAML and only ever
  posts it when the job itself dies.
- `grep -rni 'label\|reaction' src/` finds four unrelated hits (an
  `activity.ts` comment, `prompts.ts`'s envelope `label`). `GitHubApi` has seven
  methods; none of them touches a label or a reaction.
- `issuePayloadSchema` parses `comment.id`, and `parseIssueEvent` **drops it** —
  so the pipeline currently cannot address the comment that triggered it even if
  it wanted to.

### The nine gaps

**G1 — nothing acknowledges a trigger.** A maintainer types `/approve` and the
next thing that appears on the issue is the finished artefact, up to
`AGENT_TIMEOUT_MS` (default 30 minutes) later; `REVIEW_AND_MUTATE` also runs the
whole `review-loop/` workspace inside that silence, under a 90-minute job
timeout. For that entire window the issue is indistinguishable from one where
the workflow never fired at all — which is also a real outcome, since a
guardrail can drop the event.

**G2 — no link to the running job.** The one question a maintainer has during
the silence in G1 is "is something actually running, and where do I look". The
answer exists (`GITHUB_RUN_ID` is in the runner environment of every step) and is
never wired anywhere. Even the CI-fix comment, which _does_ post a run URL, posts
the red run's — not the agent run repairing it.

**G3 — the state is invisible at a glance.** The phase lives in an HTML comment.
Answering "which of my twelve agent issues are waiting on me" means opening
each one and reading the last comment's prose. An issue list, a project board, a
notification — none of them carry a thing.

**G4 — rejections are silent — half closed upstream.** The premise was that a
typo'd slash command and a broken pipeline look identical from the issue.
`7d6958c` proved it the expensive way: a mis-set `AGENT_SELF_LOGIN` meant the
agent could not read back its own state block, so every `/changes` was refused
against a freshly-restarted state — and because refusals were silent, the bug was
invisible for as long as nobody opened the Actions log. That commit closed the
loudest half by adding `renderRefusedCommand`, which answers on the issue and
lists what the current phase _does_ accept, derived from the transition table so
it cannot drift from what the machine will take.

What is still silent:

| Path                                                      | What the maintainer typed                      | Now                       |
| --------------------------------------------------------- | ---------------------------------------------- | ------------------------- |
| `triggers.ts` `moveOrSkip` catch → `refuseCommand`        | `/approve` while in `REVIEW_AND_MUTATE`        | **posts** a comment       |
| `applyCommand` unknown command → `refuseCommand`          | `/aprove` — a typo                             | **posts** a comment       |
| `guardrails.ts` deny `NOT_MAINTAINER`                     | anything, from an account without write access | silent                    |
| `applyTrigger` `No actionable command while in ${phase}`  | a plain comment on a non-waiting phase         | silent                    |
| `applyIntent` `Comment needs no action` / `Empty comment` | a comment the classifier read as chatter       | silent                    |
| `ci-trigger.ts` `refuseUnfixablePhase` / settled PR       | nothing — a machine event                      | `warn`, silent on purpose |

The three remaining human-facing rows are the ones where a comment would be the
wrong instrument: a rejected outsider, and two readings of "this comment asked
for nothing". Each still leaves a maintainer with no signal that the agent even
saw them, which is what §4.1 is for — and the argument is now narrower and
better, because the loud cases have a comment and these do not need one.

**G5 — no live surface.** Comments are terminal by construction: `postAndAppend`
is called with a finished `PhaseOutcome`. Nothing exists that can say "round 2 of
4" or "still working" without adding a comment, and adding a comment per tick is
obviously wrong. The heartbeat that already knows all of this writes to a log
nobody has a link to (G2).

**G6 — no consistent visual vocabulary — and it grew.** Emoji still appear in
exactly two places: `implement.ts`'s `REVIEW_LINE` (`✅ clean` / `❌ exited N` /
`— not configured`) and `ci-fix.ts`'s check line. `run-report.ts` went from six
exported renderers to nine and carries **zero** — the new ones are
`renderRefusedCommand`, `renderAnswerFailure` and `renderAnswerOverBudget`. So
the register spread rather than settled: `### Done`, `### Stopped`,
`### Giving up`, `### Waiting`, `### Run failed in EXECUTION_PLAN`,
`### I could not answer that`, ``### `/approve` does not apply right now``,
`### Token budget spent`. Every one of them is well-written and none of them is
scannable as a class. Nine renderers is also past the point where a phase→glyph
mapping can be added by hand without missing one, which is rule 5's whole
argument.

**G7 — spend is invisible until it is fatal.** Still true, and the notice around
it got much better without touching the gap. `af57837` made the over-budget stop
park in `FAILED` with `resumeFrom`, and `renderOverBudget` now names the phase it
parked, so "raise `AGENT_MAX_TOKENS`, reply `/retry`" is finally advice that
works. `b3d4d3a` made every path that writes state record spend through one
`recordSpend` seam, so the figure is no longer zero on the failure path. All of
which improves what the issue says **at the wall** — none of it tells a
maintainer they are approaching one. `tokensSpent` is read before every phase and
surfaces to a human exactly once: when it is too late to act on.

**G8 — the waiting comment says nothing useful.** `renderSettled` for a
non-terminal phase renders `### Waiting\n\nParked in \`PLAN_REVIEW\`.` — the
phase name, and no statement of what would move it. Every other waiting comment
in the codebase carries a "What now?" block; this one does not.

**G9 — the infrastructure fallback misses two cases — narrowed.** This finding
originally had two halves and the larger one is fixed. `04a324b` gave
`RunResult` a required `reported` flag, wrote `reported=true` to `$GITHUB_OUTPUT`
via `step-output.ts`, and gated the fallback step on it — so the six pipeline
paths that exit 1 _after_ posting their own report no longer draw a second
comment contradicting the first. That was the serious defect, and the fix is
better than what this document would have proposed: the pipeline knows which of
its exits spoke, so it says so, rather than the workflow guessing from a status
that cannot distinguish them.

What remains is coverage, on the line that commit deliberately left alone:

```yaml
if: failure() && github.event.issue.number && steps.pipeline.outputs.reported != 'true'
```

- `github.event.issue.number` is empty on a `workflow_run` event, so a runner
  that dies during a **CI-fix** run still posts nothing anywhere. `04a324b`'s own
  message names this — CI runs escaped the double-comment bug "by accident" —
  which is the same fact seen from the side where it helps.
- `cancelled()` is still not selected, and a cancelled job is the documented
  consequence of G1: a run that looks hung is a run someone cancels.

Kept here rather than split out, because both cases are the same failure this
whole document is about — work happening, or stopping, with nothing on the issue
to say so.

---

## 2. Design rules this has to obey

The workspace's existing rules constrain the solution more than the solution
constrains itself. Stating them up front because two of them kill otherwise
obvious designs.

1. **Feedback must never fail a run.** Every write added here is decoration on
   work that matters. A 403 on a label (a token without `issues: write`, a fork
   run, an org policy) must degrade to `log.warn`, never to a failed phase. This
   is the single most important rule in the plan, because every new call is a new
   way to break a pipeline that used to work.
2. **Never send free text through a new `GitHubApi` method without `clean`.**
   `CLAUDE.md` states it; `github.ts` enforces it by making `secrets` required.
   `updateComment` carries free text and must be redacted exactly like
   `createComment`. Label names and reaction contents are pipeline-computed
   constants, so they are treated like `head`/`base` branch names — passed
   through untouched, and that exemption is stated in code rather than implied.
3. **Progress carries names, statuses and counts only.** `activity.ts` decodes
   through schemas that give tool input, tool output and model text nowhere to
   land. An issue comment _is_ covered by outbound redaction, unlike the log — but
   the rule still holds when piping activity to the issue, because a redaction
   list only knows the secrets the pipeline loaded, and a status line is not the
   place to relax that.
4. **The state block is the durability channel and must stay untouched.**
   `findLatestState` restores from the newest agent comment carrying a valid
   block. Any new comment this plan introduces must **not** carry an
   `AGENT_STATE` block, or an edited status comment becomes a second, competing
   source of truth. Testable invariant, and worth pinning as one.
5. **One place per vocabulary.** The recurring defect in this workspace is a fix
   that closes an instance and leaves the class open. A phase→emoji mapping
   spread across nine renderers is that defect waiting to happen; it goes in one
   `Record<Phase, …>` so a phase added later fails to compile until it is named.
6. **Comment budget.** More feedback fails by becoming noise. Hard budget: **at
   most one new comment per run** beyond the artefact comments that already
   exist. Everything else is a reaction, a label, or an edit.
7. **A status comment is not a report.** `RunResult.reported` means "the issue
   carries this run's account of what happened", and the workflow's fallback
   comment is gated on it. A live status comment must therefore **never** set the
   flag: a run killed mid-phase leaves "🛠️ Implementing — run in progress" on the
   issue, which is the precise case the fallback exists for, and marking it
   reported would suppress the one comment that would have explained the silence.
   Finalising the status comment on a **returning** path is a different question
   and still does not set it — the paths that report already do, and two writers
   of one flag is how it drifts. The flag is required on every terminal path, so
   a new one has to decide; this rule is what it decides.

---

## 3. The vocabulary

One module, `src/presentation.ts`, owning a total `Record<Phase, PhasePresentation>`.
Every renderer, the label reconciler and the status comment read from it.

| Phase               | Glyph | Label                | Whose turn | Headline                       |
| ------------------- | ----- | -------------------- | ---------- | ------------------------------ |
| `INIT_OR_CLARIFY`   | 🔍    | `agent:triaging`     | agent      | Reading the issue              |
| `INIT_OR_CLARIFY`\* | ❓    | `agent:clarifying`   | **you**    | Waiting on your answers        |
| `DESIGN_SPEC`       | 📋    | `agent:spec-review`  | **you**    | Design spec is waiting for you |
| `EXECUTION_PLAN`    | 🗺️    | `agent:planning`     | agent      | Breaking the spec into steps   |
| `PLAN_REVIEW`       | 🧭    | `agent:plan-review`  | **you**    | Plan is waiting for you        |
| `REVIEW_AND_MUTATE` | 🛠️    | `agent:implementing` | agent      | Writing and reviewing the code |
| `PR_DELIVERY`       | 📦    | `agent:delivering`   | agent      | Opening the pull request       |
| `CI_FIX`            | 🚑    | `agent:ci-fixing`    | agent      | Repairing red checks           |
| `COMPLETE` + PR     | ✅    | `agent:done`         | —          | Delivered                      |
| `COMPLETE`, no PR   | 🛑    | `agent:stopped`      | —          | Stopped                        |
| `FAILED`            | ❌    | `agent:failed`       | **you**    | Run failed                     |

\* `INIT_OR_CLARIFY` is the one phase that is both a working state and a waiting
state — it is where the agent sits after asking questions. The presentation is
therefore keyed on `(phase, whether the last signal was NEEDS_CLARIFICATION)`,
not on the phase alone. Handling that by hand in each renderer is precisely the
class of bug rule 5 exists to prevent, so it belongs in the table's key.

Two orthogonal markers carry the actual filtering value, and they are the part
worth shipping even if the per-phase labels are dropped:

- **`agent:working`** — set at the start of a run, removed when it ends,
  whatever the outcome. "Is something happening right now", answerable from a
  list view.
- **`agent:needs-you`** — set in every **you** row above. "Which of my issues are
  blocked on me", which is the question that actually costs a maintainer time.

`agent:working` has one failure mode: a runner killed mid-flight leaves it stuck
on. Two mitigations, both needed, because either alone leaves a hole — an
`if: always()` cleanup step in the workflow, **and** a reconcile at the top of
every run that computes the desired label set from the restored state and
removes any `agent:*` label the state does not imply. The reconcile is the one
that also repairs an issue whose labels were edited by hand.

**Accessibility.** The glyph is decoration and never the only carrier of
meaning: the phase word sits next to it in every rendering, and the label name is
plain text. A screen reader that announces "clipboard, design spec is waiting for
you" loses nothing by dropping the first word.

**Namespacing.** `AGENT_LABEL_PREFIX` defaults to `agent:`; setting it to `none`
disables labelling entirely. Same shape as `AGENT_REVIEW_COMMAND` — the pipeline
already knows it runs in repositories with their own conventions, and a hardcoded
label set is the papai-specific hardcoding S2-4 was reopened for.

---

## 4. The four channels, and what each one is for

### 4.1 Reactions — instant, zero-noise acknowledgement

Closes **G1** and what is left of **G4**, and it is the cheapest thing in this
document: one API call, no thread noise, and it lands on the comment the
maintainer just wrote, so it is already where they are looking.

| Situation                                 | Reaction | Where                       |
| ----------------------------------------- | -------- | --------------------------- |
| Trigger accepted, work starting           | 👀       | triggering comment or issue |
| Comment understood, nothing to do         | 👍       | triggering comment          |
| Sender lacks maintainer rights            | 😕       | triggering comment          |
| Command rejected — wrong phase, unknown   | 😕       | triggering comment          |
| Run finished and delivered a pull request | 🚀       | triggering comment          |

The fourth row is now **redundancy rather than the fix**: `refuseCommand` posts a
comment naming the accepted commands, and that is the better answer. Keeping the
reaction is still worth one call — it lands instantly, before the run has done
anything, whereas the comment arrives after `postAndAppend` — but if the row has
to be cut for noise, cut this one first. The rows that carry the argument now are
the first two: 👀 is the only acknowledgement any trigger gets, and 👍 is the only
trace a `Comment needs no action` classification leaves anywhere but the log.

Silent on purpose, still: bot senders, self-recursion, pull-request targets and
CI events. Those are machine noise with no human waiting on them, and the
existing log line is the right amount of record.

Wiring needed: carry `comment.id` out of `parseIssueEvent` (the schema already
parses it and throws it away), and add `addReaction` to `GitHubApi`. Reactions
are idempotent server-side — a repeat returns the existing one — so no
bookkeeping is required.

The one judgement call: reacting to a `NOT_MAINTAINER` comment is a write
triggered by someone without write access. It is bounded (one reaction per
comment, no content, no notification storm), and the alternative is that an
outside contributor's comment vanishes into a log they cannot read.

### 4.2 Labels — the at-a-glance state

Closes **G3**. Reconciled once per run and once more at the end, computing the
desired set from state and issuing the minimal add/remove diff — not a
clear-and-reapply, which would produce two timeline entries per phase and a
visible flicker.

Labels are created on demand with a fixed palette (blue for agent-owned states,
amber for `needs-you`, green for done, red for failed, grey for stopped), and a
422 from `createLabel` means it already exists and is ignored. Per rule 1, every
label call is best-effort.

### 4.3 The live status comment — what is happening right now

Closes **G2**, **G5**, **G7** and **G8**. This is the substantial piece.

One comment per **run**, created when the run starts, edited as it progresses,
finalised when it ends. It is the only comment this plan adds, which is the
entire comment budget from rule 6.

```markdown
### 🛠️ Implementing — run in progress

**Job:** [run #1482, attempt 1](https://github.com/o/r/actions/runs/1482) · started 14:02 UTC · 6m elapsed
**Branch:** `agent/issue-42` · **Pull request:** _not opened yet_

| Phase             |             |
| ----------------- | ----------- |
| 🔍 Triage         | ✅          |
| 📋 Design spec    | ✅ approved |
| 🗺️ Execution plan | ✅ approved |
| 🛠️ Implementation | ⏳ **now**  |
| 📦 Pull request   | ⬜          |

**Doing:** `bash` (running) · 34 tool calls · 218k tokens
**Budget:** 218k of 5,000,000 tokens · attempt 1 of 3
```

The spec and plan rows carry their own revision numbers now — `418c1ad` split the
shared `revision` counter into `specRevision` and `planRevision` precisely
because one number could not honestly label two artefacts, and this table is the
second place that would have gone wrong. It reads them, it does not recount.
Likewise the CI budget line, when `CI_FIX` is the live phase, says "attempt 2 of
3 **on this pull request**": `ciAttempts` is per pull request since `c4a43bd`,
cleared when `handleDeliver` opens a new one.

Design decisions worth recording, because each had a plausible alternative:

- **One per run, not one per issue.** A single long-lived status comment edited
  forever ends up hundreds of comments above the thing the maintainer just
  typed, which defeats the purpose. Per-run keeps it at the bottom where the
  conversation is, gives every run a permanent record, and — usefully — needs no
  `AgentState` field at all in v1, since the id lives only for the life of the
  process that created it.
- **It carries no `AGENT_STATE` block** (rule 4). The phase-end comments remain
  the sole state channel, so the durability path this plan touches is _none of
  it_. Worth an explicit test: the state restored from a thread containing status
  comments must equal the state restored from the same thread without them.
- **Edits are rate-limited to one per 60 s and skipped when the rendered body is
  unchanged.** A 90-minute run then costs at most ~90 edits, comfortably inside
  the secondary rate limit on content-mutating requests, and unchanged-body
  suppression means a quiet stretch costs nothing.
- **The activity line comes from the existing `ProgressSnapshot`**, which already
  carries exactly `lastAction`, `toolCalls`, `tokens`, `cost` and nothing else —
  so rule 3 is satisfied by construction rather than by care. `HeartbeatOptions`
  grows an optional `onTick`; the log half is unchanged.
- **A failed edit is a warning, not a failure** (rule 1), and a failed _create_
  degrades the run to today's behaviour exactly.
- **It never sets `reported`** (rule 7). A stale "in progress" status is the
  fallback comment's reason for existing, not a substitute for it.

#### What `updateComment` also unlocks — and this plan now owns

`applyIntent` records a leak it chose not to close: classification is the one
model turn in the pipeline whose spend can never be written down, because state
is persisted only by posting a comment and the `none` branch deliberately posts
nothing. The comment names the fix — "a way to persist state without posting — an
`updateComment` on the last state block" — and calls it a larger design change
than a few thousand stray tokens justified. Stage 3 builds exactly that call for
its own reasons, so the objection no longer holds, and the plan takes the fix on
rather than leaving a documented leak beside the mechanism that closes it.

This widens the goal by one sentence, deliberately: the plan is about feedback,
and this is budget correctness. It is in scope because the cost of _not_ doing it
once `updateComment` exists is a rule in three documents (the code comment,
`CLAUDE.md`, the README) explaining why something is hard, next to the thing that
made it easy.

The mechanism is a `persistState` that rewrites the `AGENT_STATE` block in the
comment that already carries the newest one, rather than appending. Two things it
must respect, both already load-bearing:

- **`findLatestState` scans newest-first for the newest agent comment with a
  valid block.** Rewriting in place keeps that comment newest-with-a-block, so
  the scan is unaffected. Rewriting the _wrong_ comment is the failure mode; the
  target is the comment `findLatestState` itself selected, not the last comment
  in the thread.
- **The block escaping in `blocks.ts` is what makes this safe at all** —
  `renderBlock` escapes every `<` and `>` so a payload cannot forge its own
  terminator (S1-4). An in-place rewrite re-serialises through the same path or
  it reintroduces that bug on a new surface.

Shape: a `StatusReporter` interface on `PhaseDeps` — `start(state)`,
`enter(phase)`, `tick(snapshot)`, `finish(result)` — with a no-op implementation
used by every existing test and by local `--event-path` runs that have no run
URL. Injected like every other boundary in this workspace.

### 4.4 Run links everywhere else

`GITHUB_RUN_ID` / `GITHUB_RUN_ATTEMPT` / `GITHUB_SERVER_URL` /
`GITHUB_REPOSITORY` are present in every step's environment (GitHub sets them;
`scrubSecrets` matches by _value_, so they survive it), which means the run URL
needs **no workflow change** — only a nullable `runUrl` on `PipelineConfig`,
absent for local runs. Once it exists:

- the failure comment says which run failed, so `/retry` is not the only lead;
- the CI-fix comment distinguishes "the red run I am fixing" from "the run
  fixing it", which today are the same word;
- the pull request body links the run that produced it.

---

## 5. Breaking the remaining silences

Every skip path, with the decision. This table is the deliverable for **G4** —
the point is that no row is left as "log only" by omission.

| Path                                                    | Today       | Proposed                                   |
| ------------------------------------------------------- | ----------- | ------------------------------------------ |
| `NOT_MAINTAINER`                                        | log         | 😕 reaction                                |
| `PULL_REQUEST` / `BOT_SENDER` / `SELF_*`                | log         | log — machine noise, nobody is waiting     |
| `UNSUPPORTED_EVENT` / `UNSUPPORTED_ACTION`              | log         | log                                        |
| `CI_*` guardrail denials                                | log         | log — no human triggered them              |
| `refuseUnfixablePhase` (red run, no fixable phase)      | `warn`      | log — argued out in `ci-trigger.ts`        |
| `settledPullRequest` (red run, merged/closed/absent PR) | log         | log — CI fires per push; a comment is spam |
| Unknown command (`/aprove`)                             | **comment** | keep; add 😕 reaction as instant echo      |
| Command invalid in phase                                | **comment** | keep; add 😕 reaction as instant echo      |
| Plain comment, non-waiting phase                        | log         | 👍 reaction                                |
| `Comment needs no action` / empty                       | log         | 👍 reaction                                |
| Retry / token / CI budget exhausted                     | comment     | unchanged — these are already right        |

Four rows changed since the first draft and all four moved the same way: toward
the pipeline already doing the right thing. The two command refusals now post
`renderRefusedCommand`, which is strictly better than the reaction this document
proposed — it names the commands the phase accepts, from the transition table, so
it cannot go stale. The two CI rows are silent by an argument written out at
length in `ci-trigger.ts`, and it is a better argument than "add feedback here"
would be: a red run fires on every push and re-run, the phases that refuse are
ones where either nothing is pushed yet or the issue is already parked under a
failure comment saying what to do.

That leaves three genuinely silent human-facing rows, and the reaction channel is
sized to exactly those.

And **G8**: `renderSettled`'s non-terminal branch gains the same "What now?"
block every other waiting comment carries, read from the presentation table.

---

## 6. Workflow changes

Smaller than they were — `04a324b` did the hard half.

- **Finish the infrastructure fallback (G9).** Keep the
  `steps.pipeline.outputs.reported != 'true'` gate exactly as it is; it is the
  part that works. Widen the other two conditions: resolve the issue number from
  `github.event.issue.number` **or** the `workflow_run.head_branch`'s
  `agent/issue-<n>` suffix (`issueNumberFromBranch` already does this in
  `git.ts`, so the workflow expression and the pipeline agree on the shape), and
  fire on `failure() || cancelled()`. Both additions are inside the `reported`
  gate, so neither can bring back the double comment.
- **Add an `if: always()` label cleanup step** removing `agent:working`, so a
  killed runner cannot strand the marker (belt to the in-run reconcile's braces).
- Optionally surface `AGENT_LABEL_PREFIX` alongside the other `vars.AGENT_*`
  knobs.

No permission change: `issues: write` already covers labels, reactions and
comment edits.

`workflow.test.ts` already parses the workflow and pins its trigger surface,
including that the fallback's `if:` names the same output key `step-output.ts`
writes — so both changes here land in a file that is asserted, not assumed.

---

## 7. Sequencing

Each stage is independently shippable and independently useful. Stage 1 alone
closes the two worst gaps.

| Stage | Contents                                                                                                                                                                                         | Closes                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| **1** | `runUrl` in config; `commentId` on `IssueTriggerEvent`; `addReaction`; acknowledgement + remaining-silence reactions; run link in the failure and CI-fix comments                                | G1, G2, G4 remainder    |
| **2** | `presentation.ts`; label reconciler; `AGENT_LABEL_PREFIX`; `renderSettled` gains next steps                                                                                                      | G3, G6, G8              |
| **3** | `StatusReporter`; `updateComment`; the live status comment; heartbeat `onTick`; budget line; **`persistState` closing the classifier's accounting leak** (§4.3)                                  | G5, G7, and G2 properly |
| **4** | Workflow fallback widened to `workflow_run` and `cancelled()`, inside the existing `reported` gate; `if: always()` label cleanup                                                                 | G9 remainder            |
| **5** | README "Watching a run" rewritten around the issue rather than the log; `CLAUDE.md` local rules for rule 1 (best-effort) and rule 7 (`reported`); the three notes on the classifier leak retired | —                       |

Stage 1 is unchanged in size but no longer the only thing standing between a
maintainer and a silent refusal — `refuseCommand` shipped that. It is still where
the acknowledgement and the run link live, which are the two things nothing else
covers.

---

## 8. Test plan

Following `tests/CLAUDE.md` and this workspace's own habits.

- **Presentation is total.** `Record<Phase, …>` makes a missing phase a compile
  error; a test asserts every `PHASES` entry resolves and that no two phases
  share a label.
- **Label reconcile is a diff.** Unchanged state issues zero calls; a phase move
  issues exactly one add and one remove; an issue carrying a hand-added
  `agent:*` label is repaired.
- **The state channel is untouched.** `findLatestState` over a thread with status
  comments interleaved equals the same call without them — the invariant from
  rule 4, and the one that would be expensive to discover later.
- **Feedback failures are not run failures.** A `GitHubApi` fake that throws on
  every label, reaction and edit call still drives a full pipeline to the same
  `RunResult` and the same **persisted state**. This is the rule-1 test and it is
  the most important one here.
- **Transport-level assertions for the new methods**, through the existing
  `fetch` seam. This workspace's recorded lesson (S2-6, S3-3, S3-8, S3-9) is that
  a correct adapter which is never wired in passes every phase test; `contain`
  and `assembleDeps` must be exercised, not just the modules.
- **Redaction covers `updateComment`.** A status body carrying a credential goes
  out clean — the same assertion `createComment` already carries, extended to the
  new path rather than trusted to it.
- **Rate limiting.** An injected clock proves a second `tick` inside the window
  issues no request, and that an unchanged body issues none regardless.
- **`reported` stays false for a status comment** (rule 7). A run killed after
  the status comment exists but before any report must still leave the flag
  unset, so the workflow's fallback fires. `RunResult.reported` is required, so
  the compiler catches a new terminal path that forgets to decide — but not one
  that decides wrongly, which is what this test is for.
- **`persistState` rewrites the right comment.** State restored after an in-place
  rewrite equals the state written; the target is the comment `findLatestState`
  selected, not the newest in the thread; and a payload containing `-->` survives
  the round trip, because an in-place rewrite that bypasses `renderBlock`'s
  escaping reintroduces S1-4 on a new surface.
- Mutation-check hints for the reviewer: empty the reaction map; make the
  reconcile clear-and-reapply; drop the unchanged-body guard; let a thrown label
  error propagate; set `reported: true` when the status comment is created; point
  `persistState` at the last comment instead of the selected one. Each should
  kill the test that names it.

---

## 9. Risks and non-goals

- **Noise is the failure mode.** Rule 6's one-comment budget is the mitigation,
  and it is worth re-checking against a real long conversation before stage 3
  ships.
- **Label churn in a repository with its own conventions.** Namespaced and
  disableable; the prefix knob is not optional polish.
- **API budget.** A run costs roughly 10–40 extra calls against 5,000/hour. The
  status edits are the only sustained writer and are capped at 1/minute.
- **A public issue is a public surface.** Everything new goes through the
  outbound redaction in `github.ts`, and the status comment carries only the
  scalar `ProgressSnapshot` fields — no tool input, no model text.
- **Explicitly not in scope:** editing the issue title or body (the maintainer's
  text, not the agent's), GitHub Checks or Deployments as a status surface (a
  much larger integration for the same information), project-board automation,
  and any notification channel outside the issue.

---

## Drift Log

Append-only. Each row is a reconciliation decision, not a change to the code.

| Date       | Category               | Item                                                                                                    | Decision                                                                                                                   |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-07 | Base moved             | Rebased `069f96e` → `07b2586` (nine opencode-agent fixes)                                               | Plan re-anchored; every claim below re-verified against the tree at `07b2586`                                              |
| 2026-08-07 | In-plan, partial       | **G4** — `7d6958c` added `renderRefusedCommand`                                                         | Rewritten: 2 of 5 rows closed by a comment. §4.1 and §5 narrowed to the three remaining silent rows                        |
| 2026-08-07 | In-plan, partial       | **G9** — `04a324b` added `RunResult.reported` + `step-output.ts` + the gate                             | Narrowed to `workflow_run` coverage and `cancelled()`; the double-comment half recorded as fixed, and better than proposed |
| 2026-08-07 | In-plan, stale framing | **G7** — `af57837`, `b3d4d3a` fixed the over-budget park and spend recording                            | Gap unchanged, framing rewritten: the notices at the wall are now right, the approach to it is still invisible             |
| 2026-08-07 | In-plan, accurate      | **G6** — `run-report.ts` 6 → 9 renderers, still zero emoji                                              | Strengthened; nine renderers is past hand-maintainable, which is rule 5's argument                                         |
| 2026-08-07 | In-plan, accurate      | **G1, G2, G3, G5, G8** — untouched by the nine fixes                                                    | Kept verbatim; `renderSettled` re-read and is byte-identical                                                               |
| 2026-08-07 | Out-of-plan, on-goal   | `RunResult.reported` semantics vs. a live status comment                                                | **User: add.** New design rule 7 — a status comment never sets the flag; test row and mutation hint added                  |
| 2026-08-07 | Out-of-plan, on-goal   | `applyIntent`'s documented accounting leak, whose stated fix is `updateComment`                         | **User: add as an explicit stage-3 task.** §4.3 gains `persistState`; goal widened by one sentence, stated in place        |
| 2026-08-07 | In-plan, stale anchors | `triggers.ts` split; `ci-trigger.ts`, `token-budget.ts`, `trigger-outcome.ts`, `step-output.ts` are new | All module references refreshed; `skip()` now takes a `reported` argument stage 1 must pass                                |
| 2026-08-07 | Out-of-plan, on-goal   | `specRevision` / `planRevision` split; `ciAttempts` now per pull request                                | Folded into the §4.3 status-comment spec — it reads both, and must not recount either                                      |
| 2026-08-07 | No plan claim          | `identity.ts`, `deps.ts`, `prompts.ts`, `phases/*`, `state-manager.ts`, tests                           | No plan change. `identity.ts`'s bug is cited under G4 as evidence the audit's premise was real                             |
