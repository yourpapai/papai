<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Making the review loop an explicit `/review` command

Today phase 3 implements the plan **and** runs the `review-loop/` workspace
inside one job, and pushes only once both are done. This document audits what
that costs, then plans the split: implement → push → pull request, with the
review loop moved behind an explicit `/review` typed on the pull request.

Nothing here is implemented. It is the design and the reasoning behind it, in
the shape the rest of this workspace records decisions.

Anchored on `claude/opencode-review-loop-command-2boppn`.

---

## 1. What phase 3 does today

`src/phases/implement.ts`, in order:

| Line    | Step                                                           |
| ------- | -------------------------------------------------------------- |
| `36`    | `ensureBranch(agent/issue-<n>)`                                |
| `40-50` | one `build` model turn that writes the implementation          |
| `59`    | `commitAll(feat(agent): implement issue #n)` — **local only**  |
| `61`    | `deps.runReview(plan)` — the whole `review-loop/` workspace    |
| `63`    | `commitAll(fix(agent): apply review-loop findings)`            |
| `64`    | `push(branch)` — **the first time anything leaves the runner** |

`PR_DELIVERY` then opens the pull request in the same cascade, from the same
job. The state block naming `PR_DELIVERY` is written by phase 3's own comment,
which is posted after the push.

So the implementation commit lives **only in the runner's working tree** for the
entire duration of the review loop, and the pull request does not exist until
after the review loop has finished.

### 1.1 The window, measured in configuration

`agentTimeoutMs` (`AGENT_TIMEOUT_MS`, default 30 minutes) is applied three
times over: as the deadline on the implementation model turn (`deadline.ts`), as
the subprocess timeout on the whole review loop (`deps.ts:36-54` →
`review-runner.ts:141`), and as the review loop's own per-agent and per-build
timeout (`buildReviewLoopConfig`). Above that sits `timeout-minutes: 90` on the
job. The review loop is configured with `maxRounds: 4` and `poolSize: 2` by
default.

The honest reading: a small change buys one model turn of implementation and
then waits on up to four reviewer/fixer rounds plus a build gate before anybody
can see a diff.

### 1.2 What is actually lost when it goes wrong

A timed-out review loop is _not_ the dangerous case: `runCommand` resolves with
a non-zero exit rather than throwing (`shell.ts:60-62`), so the phase carries on
to `commitAll` and `push` and the pull request still opens with a red review
line. The paths that lose the work are the ones that never reach line 64:

- **The job timeout or a cancellation.** 90 minutes covers install, skills
  checkout, one implementation turn, the review loop, and delivery. A run killed
  there has an implementation commit in a tree that is about to be deleted. The
  issue gets the workflow's "Agent job did not finish" comment and no pull
  request.
- **The review loop leaving the tree uncommittable.** It merges worker
  worktrees back into the working branch; a conflict or a partial merge lands in
  `commitAll` at line 63, and from there in `guardStaged` → `diffGuardError`,
  which throws.
- **Anything thrown by `writeReviewInputs`** (`mkdir`/`writeFile` under
  `.opencode-agent/`) — a full disk, a permission problem.
- **An OOM kill**, which the review loop's worker pool makes measurably more
  likely than the implementation turn alone does.

Each of those reaches `failRun` (`orchestrator.ts:210`), which parks the issue
in `FAILED` with `resumeFrom: REVIEW_AND_MUTATE`. And `/retry` from there
re-enters `handleImplement` **from the top** — a second full implementation
model turn, paid for again, because the first one's output was never pushed.
The retry budget (`AGENT_MAX_ATTEMPTS`, default 3) is spent on re-doing work
that succeeded.

### 1.3 The three problems, named

1. **A review failure discards a successful implementation.** The push is on the
   far side of the review, so everything between them is a single point of
   failure for work the model has already been paid for.
2. **Every task pays the review loop's wall clock**, whether or not the diff
   warrants it, before anybody sees a pull request.
3. **`/retry` re-implements.** The resume point is the whole phase, because the
   phase is the whole of implement-and-review.

All three are the same defect: two independently expensive operations, with two
independent failure modes and two different natural cadences, share one phase,
one job, one retry budget and one state-machine resume point.

---

## 2. The shape of the change

Split `REVIEW_AND_MUTATE` in two.

```
today:   PLAN_REVIEW --/approve--> REVIEW_AND_MUTATE [implement, review, push]
                                          |
                                   PR_DELIVERY --> COMPLETE

planned: PLAN_REVIEW --/approve--> REVIEW_AND_MUTATE [implement, push]
                                          |
                                   PR_DELIVERY --> COMPLETE
                                                      |
                                                 /review (from the PR)
                                                      |
                                                 CODE_REVIEW [review, push]
                                                      |
                                                   COMPLETE
```

Three consequences worth stating before the mechanics:

- The pull request now appears after **one** model turn. That is the whole
  point: a reviewer sees the diff while the review loop is still a decision
  nobody has taken yet.
- A failed review costs the review, and nothing else. The branch is pushed, the
  pull request is open, and `/retry` in `CODE_REVIEW` re-runs the review loop
  alone.
- The review loop's output arrives where a reviewer is already reading — as new
  commits on the pull request — instead of as a `<details>` block on the issue
  that predates the pull request it describes.

### 2.1 Naming, and why `REVIEW_AND_MUTATE` keeps its name

`REVIEW_AND_MUTATE` will no longer review, so `IMPLEMENT` would be the honest
name. It stays anyway: `phase` is a `z.enum(PHASES)` read back out of comment
blocks, so removing a member invalidates every in-flight issue's state — the
migration hazard the README already warns about under `STATE_VERSION`. Renaming
buys clarity in one file and strands conversations in the field. The new phase
is `CODE_REVIEW`, and the README table carries the note.

**Adding** a member needs no version bump: old blocks name phases that are still
in the enum, and every new state field below is `.default()`ed — the same
argument that let `tokensSpent`, `specRevision` and `planRevision` land without
one.

---

## 3. Stage A — split the phase, `/review` from the issue

Stage A is shippable on its own and fixes §1.3 in full. It does not touch
guardrails, the workflow, or the pull-request event surface; `/review` is typed
on the **issue**, where every other command already works. Stage B then adds the
pull request as a second door onto the same command.

### A1 · `src/types.ts`

- `PHASES`: add `CODE_REVIEW`, between `PR_DELIVERY` and `CI_FIX`.
- `TRANSITION_SIGNALS`: add `REVIEW_REQUESTED` and `REVIEW_DONE`.
- `agentStateSchema`: add `reviewAttempts: z.number().int().min(0).default(0)`,
  documented as per **pull request**, not per issue — the same rule `ciAttempts`
  carries and for the same reason.
- Update the `WAITING_PHASES` comment only; `CODE_REVIEW` has a handler and is
  not a waiting phase.

### A2 · `src/state-manager.ts`

```ts
PR_DELIVERY: { PR_OPENED: 'COMPLETE', CI_FAILED: 'CI_FIX' },
CODE_REVIEW: { REVIEW_DONE: 'COMPLETE' },
COMPLETE:    { CI_FAILED: 'CI_FIX', REVIEW_REQUESTED: 'CODE_REVIEW' },
```

`REVIEW_REQUESTED` names **one** row, and the absences are the decision — the
same audit `CI_FAILED`'s comment already sets out, with one difference that
changes the answer:

- The four phases before the branch exists have nothing to review.
- `REVIEW_AND_MUTATE` and `CI_FIX` are never persisted (a block is written only
  when a handler posts, and both post the phase they moved _to_), so a
  `/review` appearing to find one is reading a hand-edited block, and honouring
  it would put a second job on a branch another is mid-commit on.
- `PR_DELIVERY` is out, and this is where `/review` differs from `CI_FAILED`.
  That row exists because a refused red run is **silent** — nothing is posted,
  nothing is spent, and a maintainer has no way to learn the run was dropped.
  A refused `/review` answers on the issue through `refuseCommand`, naming what
  the phase does accept. There is no silence to fix, and in `PR_DELIVERY` the
  pull request may not exist yet, which is precisely what the review has to
  report against.
- `FAILED` is out: the issue is parked under a comment asking for `/retry`, and
  reviewing a delivery that did not finish reviews a branch nobody has claimed
  is complete.

`forwardTransition` bumps `reviewAttempts` on `REVIEW_REQUESTED`, exactly as it
bumps `ciAttempts` on `CI_FAILED`.

### A3 · `src/commands.ts`

- `SLASH_COMMANDS`: add `/review`.
- `COMMAND_SIGNALS`: `'/review': 'REVIEW_REQUESTED'`.

`acceptedCommands` derives its list from the transition table, so `COMPLETE`
starts advertising `/review` for free — it is the first command that phase has
ever accepted. But `COMPLETE` is also where a **cancelled** issue lives, with
`prUrl === null` and no branch anyone should review, and the phase alone cannot
tell the two apart. `presentationKey` already splits them on `state.prUrl`, and
this needs the same split:

```ts
/** Commands whose availability the transition table cannot decide alone. */
const COMMAND_APPLIES: Partial<
  Record<SlashCommand, (state: AgentState) => boolean>
> = {
  "/review": (state) => state.prNumber !== null,
};
```

`acceptedCommands` takes the **state** rather than the phase and consults it;
`triggers.ts` consults the same predicate before applying the signal, so the
list a maintainer is shown and the gate the machine enforces are one function
with two readers, not two spellings of one rule. Both existing call sites
(`run-report.ts:109`, `triggers.ts:102`) already hold a state.

### A4 · `src/phases/implement.ts` — stop reviewing

Delete the `deps.runReview(plan)` call, the review commit and `REVIEW_LINE` /
`renderReport`; push immediately after the implementation commit. The phase
keeps its `CHANGES_COMMITTED` signal, its branch handling, its prompt and its
`AGENT_REPORT` block — the block now records what was implemented and states
that the review has not run, naming `/review`.

The file drops to roughly half its length, and the doc comment's "Pushing here
rather than in phase 4 is deliberate" argument survives unchanged and gets
stronger: the push now happens as early as it possibly can.

### A5 · `src/phases/review.ts` — new

```
handleReview(input):
  plan   = requireArtifact(thread, PLAN_MARKER)          // as implement does
  branch = branchNameFor(state.issueId)
  ensureBranch(branch, baseBranch)                       // a fresh runner has no tree
  review = deps.runReview(plan)
  committed = commitAll('fix(agent): apply review-loop findings for issue #n')
  if (committed) push(branch)
  updatePullRequest(state.prNumber, presentation(issue, state, report))
  return { signal: 'REVIEW_DONE', comment: report, blocks: [reportBlock(report, state)] }
```

Four decisions inside that:

- **`ensureBranch` is not optional.** Unlike today's review, this one usually
  runs in a job that did not implement anything; the remote branch is the only
  copy. `ensureBranch` already fast-forwards an existing remote branch, so the
  same call serves both.
- **A clean tree is a result, not a failure.** `commitAll` returning `false`
  means the loop found nothing to change, which is the outcome a reviewer most
  wants to hear. The report says so and the phase still reports `REVIEW_DONE`.
- **A red review does not block.** The loop's non-zero exit is reported, exactly
  as today, and the phase completes. CI on the pull request is the gate, and the
  CI-fix loop is what acts on it — the README already states this and it does
  not change.
- **A throw parks in `FAILED` with `resumeFrom: CODE_REVIEW`**, so `/retry`
  re-runs the review and nothing else. This is §1.3's third problem, closed by
  construction rather than by care.

`CODE_REVIEW` is never persisted, for the same reason `REVIEW_AND_MUTATE` is
not: the handler posts `COMPLETE`. So the `CI_FAILED` rows need no change, and
a red run arriving during a review is refused in `COMPLETE`… which it is not —
`COMPLETE` is the row it lands on, because the block on the issue still names
`COMPLETE` throughout the review job. The workflow's concurrency group is what
keeps the two jobs off the branch simultaneously; see B6.

### A6 · `src/pull-request-body.ts` — new

`renderPresentation` moves out of `deliver.ts` and takes the report **text** as
an argument instead of finding it in the thread. Delivery passes what
`findArtifact` returns; the review handler passes the report it has just built,
because `postAndAppend` runs in the orchestrator _after_ the handler returns and
a handler cannot read its own block back. One renderer, so a pull request
refreshed after a review presents exactly what a freshly opened one would — the
property the shared `PullRequestPresentation` type already exists to enforce.

### A7 · `src/presentation.ts`

Add the `CODE_REVIEW` row. It is a compile error until it exists, by design.

```ts
CODE_REVIEW: {
  glyph: '🔬',
  label: { suffix: 'reviewing', color: BLUE },
  whoseTurn: 'agent',
  headline: 'Reviewing the pull request',
},
```

### A8 · `src/orchestrator.ts`

`HANDLERS`: `CODE_REVIEW: handleReview`. Nothing else moves — `willWork`,
`driveMachine`, the status reporter and the label reconcile all read the same
table.

### A9 · `src/run-report.ts`

`renderClosing`'s **delivered** branch invites `/review`; its **cancelled**
branch keeps "further comments here will not restart me", which stays true
because A3's predicate refuses `/review` without a pull request.

`renderDelivery` in `deliver.ts` gains the same line: the pull request is open,
checks are running, and `/review` runs the review loop over the branch.

### A10 · `src/config.ts`

`maxReviewAttempts` from `AGENT_MAX_REVIEW_ATTEMPTS`, default 3, `ROUND_RANGE`,
forwarded in the workflow beside the other knobs. `handleDeliver`'s
`FRESH_CI_BUDGET` gains `reviewAttempts: 0` and becomes `FRESH_PR_BUDGETS` —
the budget belongs to a pull request, so a genuinely new one hands it back and
a refreshed one does not. The refusal reuses `refuseExhausted`'s shape with its
own wording, since raising `AGENT_MAX_REVIEW_ATTEMPTS` is the remedy and
`/retry` is not.

### A11 · The delivery hint, from the diff the agent just committed

`/review` being explicit only helps if a maintainer knows when to reach for it,
and the pipeline already holds the one fact that answers that: `guardStaged`
calls `measure(staged)` between `git add --all` and the commit, and throws the
figure away.

- `Git.commitAll` returns `StagedTotals | null` instead of `boolean` — `null`
  for a tree that was already clean, otherwise `measure`'s `{ files, lines }`.
  The doc comment's argument survives intact ("the only did-anything-change
  answer the pipeline needs"), and every existing call site tests truthiness, so
  `if (!(await commitAll(…)))` keeps working unchanged in `implement.ts`,
  `review.ts` and `ci-fix.ts`.
- `handleImplement` patches `changedLines` into the state from what it just
  committed.
- `renderDelivery` **always** states that `/review` is available — a command
  nobody can discover is not a feature — and **adds a recommendation line** when
  `changedLines >= config.reviewHintLines`.
- `reviewHintLines` from `AGENT_REVIEW_HINT_LINES`, default 200, bounded by
  `LINES_RANGE`, forwarded in the workflow.

The state field is the **raw count**, never a `shouldReview` boolean. A derived
flag frozen at delivery time could only ever disagree with the threshold the
config carries when the comment is read — the same argument that keeps
`approved` out of the state block, where the phase already is the approval gate.

---

## 4. Stage B — `/review` from the pull request

Stage A puts `/review` on the issue. Stage B is what the request actually asks
for: typing it on the pull request, where the diff is.

Two layers refuse a pull-request comment today, both deliberately:
`agent-pipeline.yml:68` (`github.event.issue.pull_request == null`) and
`guardrails.ts:214` (`PULL_REQUEST`). Both must open by exactly the width of one
command.

### B1 · Resolving a pull-request comment to an issue

State lives in blocks on the **issue**, and the restore scan reads the issue
thread. A comment on a pull request therefore has to name its issue before
anything else can run, and the payload does not carry one:
`github.event.issue.number` on a pull-request comment is the **pull request**
number.

The one link is the branch, as it is for CI: `head.ref` is `agent/issue-<n>`,
and `issueNumberFromBranch` already parses exactly that shape. That needs an API
call, so resolution cannot live in the pure `parseTriggerEvent`.

```
parseTriggerEvent(...)                     → PendingPullRequestEvent (no issueNumber)
resolvePullRequestTrigger(pending, github) → TriggerEvent | null
```

The resolver, in a new `src/pr-trigger.ts`, in this order:

1. **`/review` present?** `parseSlashCommand` on the body. Anything else on a
   pull request is dropped with no API call at all — this is the cheap filter
   that keeps every ordinary code-review comment free.
2. **`getPullRequestHead(prNumber)`** — a new `GitHubApi` method returning
   `{ ref, repoFullName, state }`.
3. `repoFullName === owner/repo`, or refuse. The fork guard, and the same one
   `CI_FOREIGN_REPOSITORY` exists for: `head.ref` is attacker-controlled, and a
   pull request opened from a fork whose branch is named `agent/issue-42` looks,
   to every other field, like the agent's own.
4. `state === 'open'`, or refuse.
5. `issueNumberFromBranch(ref)`, or refuse.

`runCli` calls it between `parseTriggerEvent` and `contain`, which means
`createOctokitApi` moves up out of `contain` and is passed in — `assembleDeps`
already takes `github` as an input, and `contain`'s doc comment on construction
order is unaffected because the reporter and the session still come after.

`TriggerEvent` gains a third member, `kind: 'pull-request'`, carrying the
resolved `issueNumber`, `prNumber`, `commentId`, `commentBody`, the sender
fields and `defaultBranch`. It is a third member and **not** a flag on the issue
event, because `resolveIssue` would otherwise hand the phases the pull request's
title and body as if they were the issue's.

### B2 · Every `kind` test, audited

Nine sites discriminate on `kind` today. A third member makes each one a
decision, and the ones written as `!== 'issue'` would otherwise bucket the new
kind silently. Every one of them becomes a positive test or an exhaustive
switch:

| Site                         | Decision                                                      |
| ---------------------------- | ------------------------------------------------------------- |
| `guardrails.ts:267` dispatch | three-way; new `evaluatePullRequestGuardrails`                |
| `orchestrator.ts:103`        | parse the slash command for the pull-request kind too         |
| `orchestrator.ts:155`        | falls through to `deps.github.getIssue`, like CI              |
| `feedback.ts:58`             | **must** react — the 👀 belongs on the comment that was typed |
| `triggers.ts:49`             | new branch: `applyPullRequestCommand`, `/review` only         |
| `comment-intent.ts:107,177`  | unreachable by construction; assert rather than infer         |
| `phases/answer.ts:50`        | unchanged — `/ask` from a pull request is out of scope, §6.2  |
| `phases/ci-fix.ts:75`        | unchanged                                                     |
| `index.ts:245`               | logging only                                                  |

`applyPullRequestCommand` accepts `/review` and refuses everything else through
`refuseCommand`, which posts on the issue. That asymmetry — typed on the pull
request, answered on the issue — is B5's subject.

### B3 · Guardrails

New codes: `PR_NO_COMMAND`, `PR_FOREIGN_REPOSITORY`, `PR_NOT_OPEN`,
`PR_NOT_AGENT_BRANCH`. The sender checks (`BOT_SENDER`, `SELF_RECURSION`,
`NOT_MAINTAINER`) are shared with the issue path verbatim — a pull-request
comment is a human write and gets the same treatment, including the one
`confused` reaction `NOT_MAINTAINER` earns.

The existing `PULL_REQUEST` denial stays for every issue-shaped path; it is now
reached only by a pull-request comment that the resolver did not claim.

### B4 · Where the reply goes

The report and the state block go to the **issue**. That is not a preference —
`findLatestState` scans the issue thread, and a block posted on the pull request
would be a second source of truth the restore scan cannot see.

The maintainer is looking at the pull request, so:

- the 👀 lands on their comment (B2), which is the acknowledgement the whole
  reaction channel exists for;
- the review loop's findings land as **commits on the branch**, which is the
  form a reviewer actually wants;
- optionally, a best-effort note on the pull request linking to the issue
  comment — `createComment(prNumber, …)` is the same endpoint, and it obeys the
  one-door rule: one function, catches everything, degrades to a `warn`, never
  reaches `RunResult.reported`.

That last one is genuinely optional and is listed separately in §7 so it can be
dropped without unpicking anything.

### B5 · The workflow's `if:`

```yaml
(github.event_name == 'issue_comment' &&
github.event.issue.pull_request != null &&
contains(github.event.comment.body, '/review') &&
github.event.sender.type != 'Bot' &&
contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association))
```

added as a third arm. The `contains` is a first-pass filter only — the pipeline
re-parses with `parseSlashCommand`, which requires the command to start a line
and ignores fenced blocks — and it exists for the reason the other arms do: an
event that will be dropped anyway must not boot a runner with the API keys
mounted. Every pull request in the repository gets comments; without it, every
one of them starts a job.

### B6 · Concurrency — the part that needs care

```yaml
concurrency:
  group: opencode-agent-${{ github.event.workflow_run.head_branch ||
    format('agent/issue-{0}', github.event.issue.number) }}
```

On a pull-request comment, `github.event.issue.number` is the **pull request**
number, so this resolves to `agent/issue-<pr>` — a group nothing else uses. A
`/review` job and a `/retry` job for the same issue would not serialize, and
both push the same branch. The workflow-level expression cannot fix this: the
branch is only knowable after an API call.

Job-level `concurrency` may read the `needs` context, so:

- a new **`resolve`** job, no model credentials, `permissions: issues: read,
pull-requests: read`, outputs `issue` and `branch`. It carries the existing
  resolve step's shell verbatim for the issue and CI paths — which
  `tests/opencode-agent/workflow.test.ts` differential-tests against
  `issueNumberFromBranch`, and that test must keep passing — plus one
  `gh api repos/{owner}/{repo}/pulls/{n} --jq .head.ref` for the pull-request
  path;
- the **`agent`** job gains `needs: resolve` and
  `concurrency: { group: opencode-agent-${{ needs.resolve.outputs.branch }},
cancel-in-progress: false }`; the workflow-level block is removed;
- the two feedback steps at the bottom read `needs.resolve.outputs.issue`
  instead of `steps.issue.outputs.number`, which is a simplification: the
  resolve currently has to run before the checkout precisely so a job that dies
  in `bun install` still knows where to post, and a separate job makes that
  structural rather than positional.

**Verify before building:** that job-level `concurrency` accepts `needs`. If it
does not, the fallback is to keep the workflow-level group, accept that a
pull-request-triggered review runs in its own group, and make the review
handler's push resilient (`fetch` + fast-forward check before `push`, fail
loudly rather than force). That is strictly worse and should be a last resort.

---

## 5. Tests

TDD is the house rule and the write hook enforces it; this is the list the
implementation is written against, not a coverage audit afterwards.

**`state-manager.test.ts`** — `REVIEW_REQUESTED` accepted in `COMPLETE` and
refused in each of the other eight phases; `REVIEW_DONE` accepted in
`CODE_REVIEW` only; `reviewAttempts` bumped by `REVIEW_REQUESTED` and by nothing
else; a v2 block written before `reviewAttempts` existed still parses and
defaults to 0.

**`orchestrator.test.ts`** — the big one, and every assertion is on the
**persisted state**, per the local rule:

- `/approve` in `PLAN_REVIEW` reaches `COMPLETE` with a pull request and
  **without** calling `deps.runReview` at all;
- a `runReview` that throws leaves the pull request open and parks in `FAILED`
  with `resumeFrom: CODE_REVIEW`; `/retry` from there calls `runReview` again
  and the implementation prompt **not at all**;
- a `runReview` that exits non-zero reports and still reaches `COMPLETE`;
- a clean tree after the review reports "nothing to apply" and does not push;
- `/review` with `prNumber === null` (a cancelled issue) is refused and the
  refusal comment does not list `/review`;
- `/review` past `maxReviewAttempts` is refused **before** the signal is
  applied, so the state still reads `COMPLETE` — the invariant
  `refuseExhausted` exists to protect.

**`guardrails.test.ts`** — a pull-request comment with no `/review` is dropped
without an API call; one on a fork's `agent/issue-42` is refused; one on a
closed pull request is refused; one on a non-agent branch is refused; a bot and
a non-maintainer are refused with the same codes the issue path uses. The
existing `drops bot senders and pull-request comments` case in
`workflow.test.ts` asserts today's blanket refusal and has to be narrowed
rather than deleted — a pull-request comment carrying no `/review` is still
dropped, and that half is the half worth keeping green.

**`diff-guard.test.ts` / delivery** — `commitAll` reports the totals `measure`
computed for the commit it made, and `null` for a clean tree; a delivery whose
`changedLines` sits below `reviewHintLines` states that `/review` exists and
does **not** recommend it, one above does both.

**`presentation.test.ts`** — the existing exhaustiveness test covers the new row
by construction; add the `CODE_REVIEW` glyph/label assertion beside the others.

**`workflow.test.ts`** — the resolve script still agrees with
`issueNumberFromBranch` over the branch corpus after the move into its own job;
the `if:` arm for pull-request comments matches what `evaluatePullRequestGuardrails`
accepts; every `AGENT_*` variable the config reads is forwarded (this test
already exists in spirit — extend it to `AGENT_MAX_REVIEW_ATTEMPTS`).

**`cli.test.ts`** — `runCli` resolves a pull-request comment to its issue before
`contain`, and skips with `reported: false` when the resolver returns `null`.

---

## 6. Decisions

The four questions this document opened with, answered. Each is settled; the
reasoning is kept because the alternative was live at the time.

**6.1 — `AGENT_MAX_REVIEW_ATTEMPTS` is built.** The review loop's `opencode run`
subprocesses are invisible to `AGENT_MAX_TOKENS` (a stated README limitation),
so `/review` is otherwise the one command in the pipeline whose spend nothing
bounds but the job timeout. It mirrors `ciAttempts` exactly, per pull request,
reset by a genuinely new one. See A10.

**6.2 — The pull request accepts `/review` and nothing else.** `/ask` there is a
natural request and the plumbing would be free once Stage B lands, but it widens
the surface from "one command naming a branch the agent owns" to "a
conversation", and its answer would still be posted on the issue — confusing in
a way `/review` is not, since `/review`'s real output is commits on the branch
the reader is already looking at. `applyPullRequestCommand` refuses everything
else through `refuseCommand`.

**6.3 — There is no escape hatch back to inline review.** An
`AGENT_REVIEW_TRIGGER=command|inline` flag would keep today's behaviour
available, at the price of a second code path through phase 3 that nobody runs
and every future edit has to keep working. The review is one comment away.

**6.4 — Delivery hints at `/review` from the diff size.** See A11.

---

## 7. Order of work

| #   | Change                                                            | Stage |
| --- | ----------------------------------------------------------------- | ----- |
| 1   | `types.ts`, `state-manager.ts`, `presentation.ts` — the new phase | A     |
| 2   | `commands.ts` + the `/review` applicability predicate             | A     |
| 3   | `implement.ts` — stop reviewing, push earlier                     | A     |
| 4   | `pull-request-body.ts` — extract the presentation renderer        | A     |
| 5   | `phases/review.ts` + `orchestrator.ts` handler table              | A     |
| 6   | `config.ts` review budget, `deliver.ts` budget reset and wording  | A     |
| 7   | `commitAll` totals, `changedLines`, the conditional hint (§6.4)   | A     |
| 8   | README, `CLAUDE.md`, worked example                               | A     |
| 9   | `github.ts` `getPullRequestHead`, `pr-trigger.ts` resolver        | B     |
| 10  | `TriggerEvent` third member; the nine `kind` sites                | B     |
| 11  | guardrails for pull-request comments                              | B     |
| 12  | workflow: `resolve` job, `if:` arm, job-level concurrency         | B     |
| 13  | pull-request note (one door, best-effort)                         | B     |

Stage A alone closes all three problems in §1.3 and is independently
releasable. Stage B changes where the command can be typed, not what it does.

## 8. Documentation to update when this lands

- `README.md`: the **Phases** table (new row; `REVIEW_AND_MUTATE`'s "What
  happens" no longer mentions the review loop), **Talking to the agent** (the
  `/review` row and the note that it is the one command a pull request accepts),
  **The review loop is the repository's own** (it is a phase now, not a step),
  the **worked example**'s steps 5–7, **What bounds a run** (the review budget),
  and **Known limitations** (the token-budget blind spot is unchanged but its
  wording assumes the review runs inside phase 3).
- `opencode-agent/CLAUDE.md`: the local rule "**The review loop is
  `review-loop/`, not a local reimplementation**" gains the second half — it is
  reached from `CODE_REVIEW`, on an explicit command, and `handleImplement` must
  not grow it back.
- `ROADMAP.md`: S5-5 (`timeout-minutes` too low) is partly overtaken — the
  longest phase is now one model turn rather than a turn plus four review
  rounds.
