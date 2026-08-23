<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# opencode-agent — GitHub Actions issue agent (spike)

An event-driven coding agent that lives in GitHub Actions. A maintainer opens an
issue; the agent writes a design spec, discusses it, plans the work, discusses
that, implements it on `agent/issue-<n>`, and opens a pull request — then fixes
that pull request when its checks go red, and runs the repository's own review
loop over the branch when somebody asks it to. Every step runs in its own
short-lived job; nothing long-polls.

> **Spike status.** This is a proof of concept, not a hardened product. See
> `ROADMAP.md` for the open findings, including the ones that still matter.

## How the ephemeral model works

An Actions job has no memory of the previous one, so state lives on the
conversation in hidden HTML blocks — on the issue until a pull request exists,
and on the pull request after that:

- `<!-- AGENT_STATE: … -->` — phase and counters. Written afresh with every
  comment the pipeline posts, and rewritten **in place** by a run that spent
  model tokens and had nothing to post.
- `<!-- AGENT_REPORT: … -->` — the newest report. The implementation one, until
  a `/review` writes its own under the same marker: the scan takes the newest
  block of a marker, and that is what a later pull-request refresh presents, so
  the body and the thread cannot end up telling different stories.
- `<!-- AGENT_HANDOFF: … -->` — the wall-clock handoff a `/continue` reads.
- `<!-- AGENT_STATUS: … -->` — the odd one out: it marks a run's live status
  comment so the prompt layer can leave that comment out, and nothing else reads
  it. It is deliberately not `AGENT_STATE`, or the restore scan would have two
  sources of truth.

The design spec and the plan **used to** travel in `AGENT_SPEC` / `AGENT_PLAN`
blocks. Under the OpenSpec rework (design D1 — the folder is truth, comments are
renders) they live in `openspec/changes/<name>/` on `agent/issue-<n>`:

- `proposal.md` — the captured goal, drafted by triage and reviewed at the
  `DESIGN_SPEC` park via a rendered digest. When the name triage picks is one
  the base branch already carries, that change is **adopted** rather than
  recreated — its proposal is kept, the park comment names whatever artifacts it
  still owes, and `PLANNING` drafts those through the ordinary artifact loop.
- `design.md`, `tasks.md` — drafted by the `PLANNING` loop (`status --json` →
  compose → `validate --strict` → retry ≤2), reviewed at `PLAN_REVIEW`.
- `tasks.md` is the implementation's step source (D5): `REVIEW_AND_MUTATE`
  walks its checkboxes, ticking each box in the same commit as the step's work.

Artefacts get their own blocks (or their own folder) rather than being scraped
back out of the visible markdown. That is not a style preference: a spec is
model-written markdown full of headings and `---` rules, and any
heading-and-trailer scraping truncates it at the first horizontal rule.

`AGENT_STATE` carries one artefact-identity token — `planRevision` — bumped by
`PLAN_POSTED` alone. The former `specRevision` is gone: the proposal lives in
the folder and `DESIGN_SPEC` reviews a digest of it, so nothing counts spec
revisions. The report block stamps `planRevision`: it records which plan was
implemented, and no signal bumps a report counter. A deliberate `STATE_VERSION`
bump (D12) retires the legacy `AGENT_SPEC`/`AGENT_PLAN` blocks outright —
in-flight issues restart under the compliant pipeline rather than carrying a
dual format.

Blocks are read back byte-exact, and a payload cannot forge its own delimiter:
`<` and `>` are escaped as JSON unicode escapes before serialization, so text
containing `-->` — a mermaid arrow, a compiler diagnostic in `lastError` — cannot
terminate the block early.

Only blocks authored by the configured agent login are read. The scan then walks
newest-first past any block that fails validation **or names a different issue**,
down to the last good one for this issue — so neither a corrupt block nor a
planted one can steer the pipeline, and one bad block cannot reset a
conversation that has a good one behind it.

The `issueId` check matters because maintainers can edit the agent's own
comments, and that field is what the rest of the pipeline treats as
authoritative: it names the branch, the commit trailers and the `Closes #n` the
pull request carries. The branch itself is **not** persisted — it is exactly
`agent/issue-<issueId>` and every phase recomputes it, so there is no stored
value to point elsewhere.

## Phases

| Phase               | Trigger                                   | What happens                                                     | Ends at                                   |
| ------------------- | ----------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `INIT_OR_CLARIFY`   | issue opened, or a reply while clarifying | Reads the issue and thread, explores the repo                    | Questions (stays here) or a design spec   |
| `DESIGN_SPEC`       | —                                         | Waiting. The spec is under review                                | `/approve`, `/changes`, `/ask`, `/cancel` |
| `PLANNING`          | spec approved                             | Planning skills produce a step breakdown; cuts `agent/issue-<n>` | Plan posted                               |
| `PLAN_REVIEW`       | —                                         | Waiting. The plan is under review                                | `/approve`, `/changes`, `/ask`, `/cancel` |
| `REVIEW_AND_MUTATE` | plan approved                             | One turn per plan step, each committed **and pushed**            | Changes pushed                            |
| `PR_DELIVERY`       | automatic                                 | Opens or refreshes the PR with `Closes #<n>`                     | PR opened                                 |
| `CODE_REVIEW`       | `/review`, on the issue or its PR         | Runs the `review-loop/` workspace over the pushed branch         | Findings pushed, review reported          |
| `CI_FIX`            | a red check run on `agent/issue-<n>`      | Reproduces CI locally, repairs, pushes                           | Fix pushed                                |
| `COMPLETE`          | —                                         | Terminal, but re-enterable from `CI_FIX` and `CODE_REVIEW`       | —                                         |
| `FAILED`            | any _phase_ handler throwing              | Failure comment posted, `resumeFrom` recorded                    | `/retry` or `/cancel`                     |
| `INCOMPLETE`        | the job running out of wall clock         | Time notice posted, `resumeFrom` recorded, no attempt spent      | `/continue` or `/cancel`                  |

There are two review gates, not one. The spec and the plan are each parked in
front of a human before anything downstream is spent.

`REVIEW_AND_MUTATE` no longer reviews anything and keeps the name anyway, which
is worth knowing before reading the code: `IMPLEMENT` would be honest, but
`phase` is read back out of hidden blocks on live issues, so _removing_ a member
invalidates every conversation in flight — clarity in one file, paid for by
stranding the field. **Adding** `CODE_REVIEW` cost nothing for the same reason:
no block written before it existed names it, and `reviewAttempts` defaults, so
there was no `STATE_VERSION` bump.

`CODE_REVIEW` is not a waiting phase, although a human's `/review` is the only
way into it. A waiting phase is one the cascade _stops_ at; here the command
moves the phase and the handler runs behind it in the same job, exactly as
`/approve` into `REVIEW_AND_MUTATE` does.

## Talking to the agent

| Command                     | Valid in                            | Effect                                                         |
| --------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `/approve`                  | `DESIGN_SPEC`, `PLAN_REVIEW`        | Proceed to the next phase                                      |
| `/changes <what to change>` | `DESIGN_SPEC`, `PLAN_REVIEW`        | Rewrite the spec or plan, with your feedback in the prompt     |
| `/ask <question>`           | anywhere                            | Answer, grounded in the repo, without moving the state machine |
| `/review`                   | a **delivered** `COMPLETE`          | Run the review loop over the branch and push what it finds     |
| `/retry [note]`             | `FAILED`                            | Resume the exact phase that failed; the note rides the prompt  |
| `/continue [note]`          | `INCOMPLETE`                        | Pick up the phase the job ran out of time for; note as above   |
| `/cancel`                   | anything but `COMPLETE`             | Stop for good — a cancelled issue cannot be restarted          |
| `/sync`                     | any state whose agent branch exists | Merge the base branch into `agent/issue-<n>` and push          |

A `/retry` or `/continue` **note** is maintainer guidance, not a re-plan: it is
enveloped into the resumed handler's prompt under a fixed framing (the plan and
change folder remain the source of truth; `/changes` is the re-planning
channel), and it is never persisted — its lifetime is the prompt it rode in.
An argument-less `/retry` or `/continue` behaves exactly as before.

### `/sync`

A branch that falls behind its base shows GitHub's conflict banner and, before
this command, had no machine remedy — the only fix was a human with a local
checkout. `/sync` runs `git merge origin/<base>` into the agent branch, in any
state whose agent branch exists: on the pull request once one is open, and on
the issue before that (from capture on — the one branch-less state still naming
a change, a cancelled issue, refuses it, so it cannot resurrect the branch
`/cancel` deleted). That pre-pull-request reach is issue #323's lesson: the
dependency-drift refusal parks an issue `FAILED` naming `/sync` as the remedy,
and a `/sync` gated behind a pull request that would never open was a remedy
the state it was prescribed for could not take.

- **Clean merge** — the merge commit is pushed and reported; no model turn is
  spent. An up-to-date branch is reported and nothing is pushed.
- **Conflict** — bounded repair rounds (`AGENT_SYNC_REPAIR_MAX_ROUNDS`,
  default 3): each round's prompt names the conflicted paths and carries the
  markers; the model edits the files and is forbidden git; the pipeline
  completes the merge and pushes. Resolution is reported as unverified by
  checks — they run on the push.
- **Rounds exhausted or at the token ceiling** — the merge is aborted leaving
  the branch exactly as it was, and the reply names the human remedy: the code
  host's own **Update branch** control, which performs the same merge with a
  maintainer's permissions.
- **Push refused for base's own workflow edits** — translated the same way:
  the reply names the cause and the update-branch remedy, never the raw error.

`/sync` is a **non-moving side operation** in the `/ask` shape: whatever the
outcome, `phase`, `attempts`, `resumeFrom` and every per-PR budget are left
exactly as they were, so every existing trigger still works and typing `/sync`
again is always available. The merge is its own git operation and never passes
through the commit path's caps or protected-path dropping — base's
already-reviewed content (including its `.github/workflows/` edits) is carried
verbatim. The reply is a plain comment on the trigger surface carrying no
state block; a repair turn's spend is the one thing that changes, recorded by
rewriting the running token total in place.

**Where a command is typed depends on whether a pull request exists.** Until one
does, the issue is the only surface and every command is typed there. From the
moment `state.prNumber` is set, the pull request takes over: it is where the diff,
the checks and the merge button are, so it is where the run's reply is posted,
where the `agent:*` labels are reconciled, and where commands are accepted. A
command typed on the issue after that is refused with a comment naming the pull
request — not "does not apply", which would be false twice over, since the command
applies perfectly and would have worked one page over. `src/feedback-target.ts`
holds both halves of that rule.

**The record moves with it.** `AGENT_STATE` and `AGENT_REPORT` used to stay on the
issue whichever surface the command arrived on, for a mechanical reason rather than
an editorial one: `findLatestState` scans one list, so a block on the pull request
was a second source of truth that scan could never see. The scan moved instead.
`readThread` reads the issue, and if its newest block names a `prNumber`, reads that
thread too and takes the newest block across both — one extra read, only after a
pull request exists, so an issue with none behaves exactly as it did and nothing in
flight is stranded.

Two details keep that from being circular. The **issue is read first, always**,
because `prNumber` is itself a field of a state block and only the thread that needs
no lookup can bootstrap the other. And `postAndAppend` addresses the state the phase
**started from**, not the one it produced — otherwise the very block that first
records `prNumber` would be posted to the pull request it names, leaving the issue
with nothing that had ever heard of it. That one-comment lag puts the handover
comment on the issue, which is where a reader wants it.

A comment typed on a pull request has to name its issue before anything else in
this pipeline can run, and the payload does not carry one —
`github.event.issue.number` there is the **pull request**. The one link is the
branch, exactly as it is for a red CI run: `head.ref` is `agent/issue-<n>`, and
`issueNumberFromBranch` already parses that shape. So `resolvePullRequestTrigger`
(`src/pr-trigger.ts`) reads the head through the API and recovers the issue from
it, in an order that is the design rather than a preference:

1. **A slash command, or nothing.** Parsed by the same `parseSlashCommand` the
   issue path uses, so a command has to start a line and a fenced block is
   ignored. Every other comment on every pull request in the repository is
   dropped here, with no API call at all — which is the whole reason the test
   comes first. The door used to admit `/review` alone; it cannot now that the
   issue refuses commands, or `/retry` and `/cancel` would have nowhere to go.
2. **The head, from the API**, because nothing on the payload carries it.
3. **The head repository is this one**, or `PR_FOREIGN_REPOSITORY` — the fork
   guard, and the one check here that is not bookkeeping. See **Guardrails**.
4. **The pull request is open**, or `PR_NOT_OPEN`. A merged or closed one has
   nothing left to review: the findings would land as commits on a branch nobody
   is going to merge again.
5. **The branch names an issue**, or `PR_NOT_AGENT_BRANCH`. A pull request the
   agent did not open has no state block, no approved plan to review against and
   no thread to answer on.

That lookup is deliberately **not** swallowed, unlike every other GitHub call
this pipeline degrades to a `warn`. It is the only thing that says which issue
the run is about, and the fork guard reads its answer, so a rejection has to
leave the job red rather than become a skip indistinguishable from a comment
nobody typed.

**The report and the state block go where the reader is** — the pull request, once
one exists, whichever door the command came through. So a `/review` typed on the
pull request is answered on the pull request: the 👀 on the comment that was typed,
the findings as further commits on its branch, and the report itself, block and all.

This used to be the other way round, and the difference is worth recording. The
report went to the issue and the pull request got a short note pointing at it,
because the restore scan could only read one thread. `src/pull-request-note.ts` was
that note and is gone: with the report on the pull request, a pointer would send a
reader to a page that no longer has it.

**`/ask` is answered where it was asked.** It used to be refused from a pull
request altogether, on the argument that its answer would land on the issue while
the reader was looking at the diff. With commands on the issue refused too that
left it nowhere to be typed, so the answer moved instead: `postAnswer` replies on
the surface the question came from. It is the one exception to "the record stays
on the issue", and only because a question is not a record — it moves no phase,
spends no attempt and writes no artefact, so the comment carries no state block
and the spend is written through `state-persist.ts`, which rewrites the issue's
newest block in place without posting. The cost is that a question answered on a
pull request is invisible to the next run's prompt, since `renderThread` reads the
issue thread.

Every other comment still goes to the issue, and gains one line naming where
commands go while a pull request is open. Almost all of them end by inviting one
— "reply `/retry`", "raise the ceiling and reply `/review`" — and every one of
those became right-advice-wrong-page the day the issue started refusing commands.

`/review` is also the first command `COMPLETE` has ever accepted, and the only
one whose availability the transition table cannot decide alone. `COMPLETE` is
where a **delivered** issue and a **cancelled** one both live, and the phase
cannot tell them apart; a cancelled issue has no pull request, so a `/review`
there would name a branch nobody asked for and report against a pull request that
does not exist. One predicate on `prNumber` settles it, and the list a maintainer
is shown and the gate the machine enforces both read that one function, so the
offer and the refusal cannot drift apart — there it is turned down as the **wrong
command** rather than as a spent budget, and the refusal answers on the issue
naming what does work. Both the delivery comment and the closing comment name the
command, because a command nobody can discover is not a feature.

**`/ask` really does mean anywhere,** and in both directions. `ANSWERED` is not
in the transition table at all: it is a non-moving signal the machine accepts in
every phase, so a question in `COMPLETE`, in `FAILED`, or halfway through the
pipeline is answered exactly where the issue stands. A question that _fails_
moves nothing either — the failure is posted, but the phase, `resumeFrom` and
the retry budget are left alone, and the notice does not offer `/retry`. The
phase records where the **work** is, and a side conversation about that work is
not the work; parking a delivered pull request in `FAILED` because a model turn
about it broke would be a lie about what happened.

**Plain replies work too.** A comment with no command on a waiting phase is
classified as a question, a change request, or an approval, and handled
accordingly. The classifier is deliberately biased: **anything ambiguous, and
any classification failure, resolves to "question"** — answering a comment that
was really a change request costs one reply, whereas re-planning a comment that
was really a question discards an approved artefact.

**`INIT_OR_CLARIFY` classifies too, with that default inverted.** A comment
arriving while the agent waits for answers to its own clarifying questions is
skipped only when the classifier positively reports "no action" — a thanks, an
emoji, a bystander's aside. Every other reading, including the "question" the
classifier falls back to whenever it fails or cannot tell, re-runs triage, which
is what this phase used to do for every comment unconditionally. The bias cannot
be borrowed from the waiting phases, because it protects an approved artefact
and there is none here: a maintainer's answer misread as a question would be
answered rather than acted on, leaving the issue parked on the same questions
and the maintainer repeating themselves. That is worse than the triage turn a
"thanks" used to buy, so only the one verdict a classifier has to actively
choose acts on anything. The classification prompt tells the model what this
phase means, since a real answer is often a bare fragment that reads like
chatter to anyone who has not matched it against the question it replies to.

A command only counts on a line that _starts_ with it, and fenced code blocks
are ignored, so the agent quoting its own instructions does not fire them.

Three phases — triage, planning, and that classifier — want JSON back. When a
reply does not validate, the model is asked **once** more, with the reason and
its own rejected reply quoted back to it. Once, not until it works: a model that
cannot produce the shape twice will not produce it on the fifth attempt, and the
job has its own timeout. A second bad reply fails the phase as before, with the
raw text in the failure comment.

## A worked example

1. A maintainer opens issue #42: "Add retries to the HTTP client. Requests
   should retry twice on 5xx." The `issues.opened` event fires the workflow;
   the guardrails check the sender's `author_association` and let it through.
2. The agent runs `INIT_OR_CLARIFY`: reads the issue and explores the repo,
   then posts a design spec and parks in `DESIGN_SPEC`.
3. The maintainer replies `/changes only retry on 502 and 503`. The agent
   rewrites the spec from that feedback and posts it again, still in
   `DESIGN_SPEC`.
4. The maintainer replies `/approve`. The agent moves to `PLANNING`,
   cuts `agent/issue-42` from the default branch, and posts a step-by-step
   plan; `PLAN_REVIEW` waits for another `/approve`.
5. Once approved, `REVIEW_AND_MUTATE` implements the plan **a step at a time**:
   one model turn per step, each committed and pushed to `agent/issue-42` before
   the next one starts. That is the whole phase — nothing has reviewed the diff,
   and nothing is waiting to.
6. `PR_DELIVERY` opens a pull request carrying `Closes #42`, one model turn
   after the approval. Its comment names `/review`; if the commit came to
   `AGENT_REVIEW_HINT_LINES` changed lines or more it also says it would run
   one, quoting both figures so the advice can be disagreed with.
7. The maintainer replies `/review` — on the issue, or on the pull request while
   reading the diff — or does not, which is a decision rather than an omission.
   From the pull request the comment is resolved back to issue #42 through the
   head branch before anything else runs; either way `CODE_REVIEW` fast-forwards
   the branch back into a fresh runner, runs this repository's own `review-loop/`
   workspace against the approved plan, pushes whatever it finds as further
   commits, refreshes the pull request body with the review report, and returns
   to `COMPLETE`. The report and the state block land on issue #42 whichever door
   was used; a `/review` typed on the pull request also leaves a 👀 on that
   comment and a short note there saying what the loop concluded.
   `AGENT_MAX_REVIEW_ATTEMPTS` bounds how often that can be asked for on one pull
   request.
8. CI runs on the branch — only if `AGENT_GITHUB_TOKEN` is configured, see
   **Red pull requests** below — and comes back red. The `workflow_run` event
   brings the agent back into `CI_FIX`: it checks out the branch, reproduces
   the failing checks locally, hands the real output to the model, and
   pushes a fix. This repeats, bounded by `AGENT_CI_FIX_MAX_ROUNDS` and
   `AGENT_MAX_CI_ATTEMPTS`, until CI is green or the budget runs out.
9. A maintainer merges the pull request like any other. `COMPLETE` stays
   re-enterable from `CI_FIX` and `CODE_REVIEW`, in case a later push
   retriggers a check or somebody wants a second pass over the diff.

A plain reply with no command — "why retry only on 502/503?" — is answered
without moving the state machine at any of the waiting steps above, and
`/cancel` stops the run for good from anywhere but `COMPLETE`.

## Red pull requests

When the `CI` workflow concludes `failure` on `agent/issue-<n>`, the agent comes
back: it checks out the branch, runs the configured checks locally, hands the
real failure output to the model, and pushes a fix. Reproducing beats reading
logs from another machine — and the runner has the branch anyway.

The first round runs **every** configured check, so one repair prompt sees the
lint error and the failing test together and can fix both at once. Later rounds
re-run only what failed — re-running a twenty-minute test suite to watch it pass
again is where the time went. A narrowed round going green does not end the loop:
the checks it skipped have not been looked at since before a repair edited the
tree, and a fix for one check can break another, so a **full pass is what
declares green**. That pass costs commands but no model call, and so no round.

A red run is acted on in `COMPLETE` and in `PR_DELIVERY`, and nowhere else.
`PR_DELIVERY` is the race that matters: phase 3 pushes the branch and posts a
state block naming that phase before phase 4 opens the pull request, so a job
that died in between leaves a live branch whose checks go red against a state
that is not `COMPLETE` yet. Before the branch exists there is nothing pushed to
repair, and a fix round would run the configured checks against a branch cut
fresh from the base. `FAILED` is deliberately left out even though its branch
_is_ pushed: entering `CI_FIX` from there would leave the one phase `/retry`
accepts and, once green, land the issue in `COMPLETE` claiming success for a
delivery that never finished — and the issue is not silent in the meantime, it
is sitting under a failure comment asking for that `/retry`. A refused red run
is logged at `warn` with the phase; it draws no comment, for the same reason a
red run on a merged pull request draws none.

`CODE_REVIEW` needs no row of its own and the absence costs nothing: the machine
never persists that phase — the handler posts the `COMPLETE` it moved to — so a
check that goes red while a review is running is read against the `COMPLETE`
block the issue is still carrying, and acted on there. What keeps the two jobs
off the branch at once is the concurrency group, and all **three** event kinds
have to resolve to the same one.

That group is declared by the `agent` job rather than by the workflow, and it is
keyed on `needs.resolve.outputs.branch` — the branch the `resolve` job computed,
not one an expression guessed. A workflow-level group cannot spell it: on a
pull-request comment `github.event.issue.number` is the **pull request**, so the
best any top-level expression could produce is `agent/issue-<pr>`, a group
nothing else uses, in which a `/review` job and a `/retry` job for one issue
would not serialize while both push the same branch. `jobs.<id>.concurrency` may
read `needs`, which is the only way to key a group on an answer that costs an API
call. `cancel-in-progress` stays false: a half-finished run must be allowed to
post its state comment, or the next trigger restores stale state.

Two budgets bound it. `AGENT_CI_FIX_MAX_ROUNDS` caps repair rounds within one
job; `AGENT_MAX_CI_ATTEMPTS` caps rounds across the pull request's whole life, so
a genuinely broken branch cannot bounce between the agent and CI forever. The
agent's own workflow is excluded, so its failures never feed itself.

When that lifetime budget runs out the agent says so on the issue, once, naming
the pull request — it does not simply stop. Later red runs are then ignored
silently, because CI fires on every push and repeating the notice would be spam.

That budget is **per pull request**, not per issue: opening a _new_ pull request
resets both the spent rounds and the "I have stopped trying" flag, so the second
delivery gets its own rounds and can say its own piece. The review budget below
is handed back on that same branch and by the same rule, because it is the same
kind of fact — a review round is spent on the diff one pull request carries, and
a genuinely new one has never had a review. Refreshing the pull
request that is already open does not reset anything — it is the same branch and
the same commits whose checks spent the rounds, and handing it a clean slate is
how one broken branch bounces off the agent for as long as anyone keeps replying
`/retry`.

> **This path only fires if CI runs on the agent's branch.** Pushes made with the
> default `GITHUB_TOKEN` deliberately do not trigger other workflows. Set
> `AGENT_GITHUB_TOKEN` to a GitHub App installation token or a PAT if you want
> CI — and therefore CI fixing — to happen at all.

## The review loop is the repository's own

The pipeline implements no review loop; `CODE_REVIEW` drives the `review-loop/`
workspace that already lives in this repo, via `bun run review-loop/src/cli.ts
--config … --plan …`. That workspace owns the hard parts — a durable issue
ledger, reviewer/fixer rounds, worktree isolation, a build gate, and a merge into
the working branch — and it is separately tested. `review-runner.ts` only
generates its config, hands over the approved plan, and translates the exit code.

It is a **phase** now, not a step inside phase 3. It used to run between the
implementation commit and the push, and that one arrangement made three separate
problems:

1. **A review failure discarded a successful implementation.** The push sat on
   the far side of the review, so everything between them — a job killed at
   `timeout-minutes`, an OOM the loop's worker pool makes likelier, a tree the
   loop left uncommittable — threw away a model turn that had already been paid
   for.
2. **Every task paid the loop's wall clock** before anybody saw a diff, whether
   or not the diff warranted it.
3. **`/retry` re-implemented.** The resume point was the whole phase, because the
   phase was the whole of implement-and-review, so recovering from a broken
   review bought a second full implementation turn.

All three are one defect: two independently expensive operations, with two
independent failure modes and two natural cadences, sharing one phase, one job,
one retry budget and one resume point. Split, the branch is pushed and the pull
request is open before the review is a decision anybody has taken; a failure
costs the review and nothing else, because `resumeFrom` names `CODE_REVIEW` and
`/retry` re-runs the loop alone; and the findings arrive as commits on a pull
request somebody is already reading, rather than as a `<details>` block posted
before the pull request it describes existed.

The phase starts with `ensureBranch`, which the inline review never needed: this
one usually runs in a job that implemented nothing, where the remote branch is
the only copy of the work. It fast-forwards an existing remote branch and cuts a
fresh one otherwise, so the one call serves both.

A clean tree afterwards is a **result**, not a failure — it means the loop found
nothing to change, which is the outcome a reviewer most wants to hear — so the
report says so, nothing is pushed, and the phase still completes.

The `mutation-improve/` workspace is deliberately _not_ wired in: it selects
files and opens its own pull requests, which would conflict with a pipeline whose
job is to open one. Run it separately.

The workspace is **detected, not assumed**. A checkout without `review-loop/` has
no review configured — which is a different thing from a review that failed — and
the review report says so rather than showing a permanently red review. Point
`AGENT_REVIEW_COMMAND` at your own reviewer to change that, or set it to `none`
to disable it; `/review` then reports that this repository has no review loop,
which is the honest answer and not an error.

`check-loop.ts` remains, but only for CI fixing — "make these named commands
green" is a different problem from "review this diff", and the workspace does not
cover it.

## What bounds a run

Seven bounds, each on a different kind of runaway.

| Bound            | Where                                                                                                                                          | What it stops                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt size      | `prompt-budget.ts`                                                                                                                             | 12k characters of thread, and 12k across _all_ failing checks, per prompt                                                                                        |
| Turn duration    | `AGENT_TIMEOUT_MS`, applied in `deadline.ts`                                                                                                   | A turn that never answers — and one merely too slow, whose work is kept                                                                                          |
| Provider stalls  | `AGENT_STALL_TIMEOUT_MS`, applied in `turn-run.ts` on the heartbeat tick                                                                       | A turn the provider stopped serving — no progress for the window while retries pile up — burned to the turn deadline; `0` disables                               |
| Job wall clock   | `AGENT_JOB_TIMEOUT_MINUTES`, applied in `time-budget.ts`                                                                                       | A job dying on `timeout-minutes` with nothing posted at all — and it is the review loop's only ceiling too                                                       |
| Provider hiccups | `provider-proxy.ts` — 3 attempts, with backoff                                                                                                 | A single 429 or 5xx failing the phase                                                                                                                            |
| Rounds           | `AGENT_MAX_ATTEMPTS`, `AGENT_CI_FIX_MAX_ROUNDS`, `AGENT_MAX_REVIEW_ATTEMPTS`, `AGENT_COMMIT_REPAIR_MAX_ROUNDS`, `AGENT_SYNC_REPAIR_MAX_ROUNDS` | An agent and CI bouncing off each other, a review nothing else bounds, a tree the repository will never accept, and a `/sync` conflict whose markers never clear |
| Total spend      | `AGENT_MAX_TOKENS`, per **issue**                                                                                                              | An issue quietly costing more than it is worth                                                                                                                   |

The prompt caps are on the **finished prompt**, not on any one input: a per-input
cap bounds one log and nothing else, and three red checks at 8k each still put
24k into a repair prompt that then gets re-sent every round. When several
failures compete for the room, whoever fits inside an equal share is kept whole
and the rest is re-divided among the others, so a 200-character lint error cannot
crowd out the 20k test log that is the actual failure.

The turn deadline bounds the **waiting**, not the work — nothing can cancel an
in-flight request. What it buys is which failure happens: an error the pipeline
can post to the issue, rather than a runner vanishing at `timeout-minutes` with
no comment, no state block, and the issue left in whatever phase it started in.

The stall bound is a health check beside that clock, and the two questions are
different: the deadline asks _how long has this turn been outstanding_, the
stall bound asks _is the provider still serving it_. It fires only when both
are true — no finished model step and no newly started tool call for
`AGENT_STALL_TIMEOUT_MS` (default five minutes), **and** provider retries or
session errors accumulating the whole while. The retry evidence is what
separates a provider wave from one very long generation, which is the
deadline's business and must keep being. A turn it aborts is salvaged like a
deadline's — whatever the tree holds is committed and pushed — minus the
wrap-up ask, whose premise of an idle session that can still answer is exactly
what a stall disproves; the run then parks in `FAILED` and `/retry` resumes it
once the wave has passed. `0` switches the bound off and restores the
turn-deadline-only behaviour. Each provider retry and session error also leaves
its own message — the provider's own text — in the encrypted debug transcript,
one row per occurrence; the public Actions log keeps carrying names, statuses
and counts only.

Retries live at the provider proxy rather than in the adapter. It is the layer
that sees an actual HTTP status, so nothing has to guess which SDK error means
"rate limited"; it is shared with the review loop's `opencode run` subprocesses;
and it is the only place where retrying is safe by construction, because the
status arrives before the body and there is no half-streamed reply to replay.
Only 408, 429 and 5xx are retried — a 401 from a wrong key is a fact about the
request, and repeating it three times only delays saying so. OpenCode retries a
rate limit itself as well, with its own backoff, so this is a second and closer
layer rather than the only one.

The retry budget bounds the other loop: `AGENT_MAX_ATTEMPTS` consecutive
failures, after which `/retry` is **refused where it stands** rather than
applied and then regretted. That distinction is the whole behaviour. Applying it
first clears `resumeFrom` and moves the issue into the phase it was resuming,
and once the budget check then stops the run, the issue is parked in a phase
nothing can re-enter — `/retry` needs `FAILED`, a plain comment needs a waiting
phase — with only `/cancel` left. Refused, the issue stays in `FAILED` with its
resume point intact, so raising `AGENT_MAX_ATTEMPTS` and replying `/retry`
resumes exactly where it broke. The give-up notice says so, because a notice
that invites a command the machine will refuse is worse than no notice.

`AGENT_MAX_REVIEW_ATTEMPTS` is that same refusal against the other command with a
budget, and it exists because of a hole in the ceiling below it: the review
loop's `opencode run` subprocesses have sessions of their own, so
`AGENT_MAX_TOKENS` cannot see a token of them. Without this, `/review` would be
the one command in the pipeline that spawns a fleet of model runs and is bounded
by nothing but the job timeout. It counts rounds against a **pull request**, like
`AGENT_MAX_CI_ATTEMPTS` and handed back by the same genuinely new one, and it is
refused before the signal is applied for exactly the reason the retry budget is:
applied and then regretted, it would park the issue in `CODE_REVIEW`, a handler
phase no trigger re-enters, under a notice inviting the command that had just
become impossible. The notice names `AGENT_MAX_REVIEW_ATTEMPTS` rather than
`/retry`, because nothing is parked and raising the ceiling is the only thing
that makes another review possible — `/retry` in `COMPLETE` is refused outright.
It carries no "I have said this already" flag either, unlike the CI one: it
answers a command somebody typed, so repeating it is the acknowledgement rather
than spam.

The token budget is the one bound that spans jobs. It is counted **per issue**
and kept in the state block, because the runaway it stops is not a single run —
it is an issue bouncing through retries and CI-fix rounds, each on a fresh runner
with no memory of what the last one spent.

When it runs out the agent parks the issue in `FAILED`, with `resumeFrom` naming
the phase it refused to start, and says so on the issue. Parking rather than
stopping where it stands is the whole behaviour, and it is deliberately _not_
the refusal the retry budget uses. The token check runs before each phase,
inside the cascade, and half its firings have no trigger to refuse: it also
fires between `REVIEW_AND_MUTATE`, `PR_DELIVERY` and `COMPLETE` inside a single
job, where the earlier phase legitimately did its work and posted. Stopping in
place left the issue in a phase with a handler that nothing re-enters — `/retry`
needs `FAILED`, a plain comment needs a waiting phase — so `/cancel` was the
only event left, and the notice's own "raise `AGENT_MAX_TOKENS` to continue" led
nowhere at any ceiling. Reachable on a first `/approve` with no failure in the
story at all. Parked, the remedy the notice names really works: raise
`AGENT_MAX_TOKENS`, reply `/retry`, and the named phase runs.

The stop carries `attempts` across rather than spending one, because running out
of tokens is not a failed attempt at anything — and because spending one would
collide the two budgets, letting the retry gate turn down the very `/retry` the
token notice asks for over a ceiling it never mentioned. A question is the one
exception: an over-budget `/ask` reports and moves nothing, since answering is a
side conversation about work that lives elsewhere, `resumeFrom` may never name a
waiting phase, and `COMPLETE` accepts no `FAILED` at all.

Tokens rather than currency, deliberately. Token counts come from the provider's
own usage block and are always right; the cost figure OpenCode reports is derived
from its model catalogue and reads **0** for a model it does not price — verified
against a real server with a made-up model id, which returned correct token
counts and zero cost. For a pipeline built around one arbitrary configured
endpoint that is the ordinary case, and a ceiling that silently never fires is
worse than none.

Every state block a job writes carries the running total, whether the phase
succeeded, threw, or was the one the budget refused to start. A failure counts
for the same reason the budget is persisted at all: the model turn is paid for
long before the parse that rejects its reply, and `/retry` out of `FAILED` is
exactly how an issue comes back for another expensive round. A failure that
recorded nothing let an issue burn the ceiling and then hand the next runner a
clean slate, round after round.

Classifying a plain comment used to be the hole in that. Classification happens
before any phase runs, and when it answers "no action" the run posts nothing —
replying to every "thanks!" would be spam — so there was no comment for a state
block to ride on, and an issue could buy one classification per comment for as
long as anybody kept commenting. It is closed now, from both ends. Over budget,
the comment skips the classifier entirely and goes to the path that reports the
ceiling without a model turn — the answer path on a waiting phase, triage's own
stop in `INIT_OR_CLARIFY`. Under budget, the skip **rewrites the newest state
block in place** rather than appending a comment, so the turn is written down
without anything being said — which is the whole reason `state-persist.ts`
exists, and the one write in this pipeline that edits rather than posts.

The in-place rewrite targets the comment the restore scan itself selected, not
the newest in the thread, so that comment stays the newest-with-a-block and the
scan is unaffected — and it re-serializes through the same `renderBlock`
escaping, because a rewrite that assembled the block by hand would reintroduce
the forged-terminator bug on a new surface. It is best-effort like every other
write this pipeline added: a refused rewrite reports the figure the issue
actually carries, rather than one no reader will ever find.

Two things the counter still cannot see: the review loop's `opencode run`
subprocesses, which have their own sessions, and any spend before the first
prompt of a job, since the running total comes from the job's own session and
that session does not exist yet. The first of those is why `/review` carries a
round budget of its own — a ceiling that cannot see the spend it is meant to
bound is not a ceiling.

### The job's wall clock, and `INCOMPLETE`

The last bound is the runner's own, and it is the one that used to be invisible.
An Actions job dies at `timeout-minutes` and a job killed that way posts
**nothing** — no comment, no state block — so the issue is left in whatever phase
it started in with no record that anything happened. The per-turn deadline
(`AGENT_TIMEOUT_MS`) was meant to stay ahead of that and did not: it was a
separate number in a separate file, defaulting to 30 minutes against a job ceiling
of 90, so a turn opened at minute 75 was allowed to wait until minute 105 — past a
runner that dies at 90. A live run died the other way round, cut off 30 minutes
into a healthy turn with 59 minutes of its cap unused, and reported as "the model
did not answer" about a turn that had answered 355 times.

Both halves are fixed by deriving the clock from the job instead of guessing at
it. `AGENT_JOB_STARTED_MS` is recorded by the workflow's first step and
`AGENT_JOB_TIMEOUT_MINUTES` is the same repository variable the job's own
`timeout-minutes:` reads — one value with two readers rather than a pair kept in
step by hand. From those two the pipeline knows the moment the runner will be
killed, and does two things with it: it shrinks each turn's deadline to
`min(AGENT_TIMEOUT_MS, time left − reserve)`, so a per-turn bound can never fire
after the process is gone; and it checks before every phase, exactly where the
token ceiling is checked, whether there is time to start another one.
`AGENT_TEARDOWN_RESERVE_MS` is the slice held back from that — three minutes for
the `git add`, the commit, the push, the comment, the state block and the label a
stop still has to do, against an observed tail of about ten seconds.

With the shrink in place the per-turn cap is free to be generous, and it now is:
`AGENT_TIMEOUT_MS` defaults to **ninety minutes** rather than the half-hour above.
The 30-minute default outlived the defect that made it dangerous and became the
opposite problem — with the job ceiling at 90 it was the _only_ bound long runs
ever reached, and three consecutive live runs ended at the same 33 minutes of
wall clock, each one a single turn aborted at its cap, wrapped up and parked with
an hour of paid-for runner unspent. Raising it cannot recreate D3, because the
`min` above is what stands between a turn and the runner: a turn opened late gets
what is left of the job minus the two slices, whatever this is set to.

The pair has since moved together a second time, and that is the thing to
remember when changing either. The job ceiling is **300 minutes** now, and at that
size an hour-long turn cap was the binding bound again for the first four hours of
every job — the same smallness one scale up, and the shape a phase that is one
_indivisible_ turn would have died of: a plan with no steps, or
`REVIEW_AND_MUTATE`, aborting at its cap and parking with hours of runner unspent.
Raising the ceiling without raising the cap buys much less than it looks like it
does.

300 rather than the 360 GitHub allows, because `timeout-minutes` may only ever
_lower_ the hosted-runner cap: a larger value is ignored and the job is killed at
360 regardless. At exactly 360 the deadline this pipeline derives would land
_after_ the one GitHub enforces — `AGENT_JOB_STARTED_MS` is recorded a few seconds
into the job — so the stop would be cut off doing the one thing it exists to do.
300 leaves a full hour of real slack over the three-minute reserve.

What made 90 worth changing was a measurement rather than a preference. Run
`31669199768` parked "out of time" after 87m33s on **step 12 of a 30-step plan**,
having spent 736k of a 5 000 000-token ceiling: time ran out, tokens were nowhere
near, and the remedy the notice suggests is this variable. At the ~7.7 minutes a
step that run averaged, that plan wants about four hours. On a public repository
standard runners are free, so a longer ceiling costs no minutes — what a long job
spends is a concurrency slot and, because `cancel-in-progress` is `false`, this
issue's serialization group.

**A wall-clock stop is a ceiling reached, not work that broke**, and the pipeline
says so in the vocabulary it already had: ⛔ rather than ❌, and a park in
`INCOMPLETE` rather than in `FAILED`. That is a phase of its own, not a flag,
because the command that gets out of it is not the same command — `/retry` means
"the thing that broke, again" and `/continue` means "you were not finished". One
phase carrying both would need a field on the state to tell the two parks apart,
consulted by every reader of `FAILED`.

Three consequences worth stating outright:

- the run reports **`waiting`**, not `failed`, so it exits 0. A run that saved
  what it had and handed the issue back did not fail, and the Actions page should
  not be red for it. `reported` is true either way, so the workflow's fallback
  comment stays out of scope;
- `attempts` is **carried, not spent**, exactly as the token stop carries it.
  Otherwise the notice would invite a `/continue` that the retry gate eventually
  refuses over a ceiling the notice never mentioned;
- what bounds a chain of continuations is the **token budget**, not `attempts`.
  That budget is per issue and persisted, so it already spans an unbounded chain —
  and every link in that chain is a human typing a command.

`CI_FAILED` and `REVIEW_REQUESTED` are deliberately refused in `INCOMPLETE`, even
though the branch is pushed there, which is the one condition those signals
normally want. The work is by definition unfinished, and CI-fixing or reviewing a
half-done increment is worse than waiting for the `/continue` that finishes it.

With neither job knob set — every local `--event-path` run, and any workflow that
has not been updated — there is no job deadline at all and nothing here fires; the
run is bounded by `AGENT_TIMEOUT_MS` alone, exactly as it was before.

### The other stop: when the clock runs out _inside_ a turn

The stop above sits _before_ a handler, so the phase it refuses never starts and
nothing is lost. The stop that matters more is the one the finding actually came
from: a turn already running when the clock ran out, cut off mid-`bash` with half a
module written and thirty minutes of work in the tree. That one used to arrive as
`❌ the model did not answer`, spend an attempt, and throw the tree away.

It now spends the budget in **three** slices — work, wrap-up, teardown — and only
the first is the model's to use freely. `turnTimeoutMs` subtracts both of the
others, so a turn's own bound fires with room still left in the job:

1. **Soft stop.** `session.abort`, then one prompt in the same session under
   `AGENT_WRAP_UP_MS`: stop, start nothing new, finish only the file you are
   part-way through, then say what you completed, what remains, and **what you tried
   that did not work**. That last clause is what the window is for — a continuation
   can read the diff and the plan, but nothing else can recover a rejected approach,
   and a fresh session would try it again.
2. **Hard stop.** `abort` again, unconditionally, whether the wrap-up replied,
   refused or started editing. Nothing here depends on the model cooperating, and
   `close()` is never the fallback: measured against a live server, an abort kills
   the running tool child and leaves the server up, while `close()` — one SIGTERM to
   one pid on POSIX — kills the server and **orphans** the tool child. `abort` is
   the stop; `close()` is the leak, and the production log had been showing it all
   along in the runner's `Terminate orphan process` lines.
3. **Teardown.** `git.salvageAll`, which commits with `--no-verify` and pushes the
   same way, then the notice, the handoff block and the state block.

`--no-verify` is not a preference. `package.json`'s `prepare` copies
`scripts/pre-commit.sh` into `.git/hooks/pre-commit` on any install where `.git`
exists — the Actions runner included — and that hook runs lint, typecheck and
format over the staged files. A tree interrupted mid-edit fails all of them, so
without the flag `git commit` exits non-zero and the salvage loses exactly what it
exists to keep. The diff guard still runs, and its four refusals split in two on
this path: **secrets by value and binaries stay absolute**, because a credential is
in history whether the file is later deleted or not, while the **file and line caps
drop to reporting**, because discarding a real 3,000-line increment over a 2,000
cap recreates the loss this whole item is about. The count rides out on
`StagedTotals` into the notice and the state block.

Everything about the salvage degrades to **"nothing pushed, and here is why"** and
never to a new failure: the run it is rescuing is already out of time and cannot
afford a second thing to go wrong. That covers a refused guard, a git that rejects,
a push that cannot reach the remote — and a clean tree, which is a legitimate
outcome rather than an error. One case pushes nothing on purpose: if **no** abort
was accepted, the pipeline cannot show the tree has stopped being written to, and
staging one in that state is the single thing this path must not do now that the
size caps only report.

The wrap-up's reply travels to the next job in an `AGENT_HANDOFF` block, like the
spec, the plan and the report, and the implement prompt includes it — enveloped
as untrusted text, framed as a report to check rather than as instructions. It is
stamped with the plan revision it describes, so a re-planned issue is never handed
an account of work measured against a document that has been replaced, and it is
handed to the **first** step of a continuation and to no later one, because that is
the step it is an account of.

### The unit of work is a plan step

Salvaging an interrupted turn is the consolation prize. The prize is not needing to:
if the implementation is one turn for the whole plan then a clock reached anywhere
inside it costs whatever that turn had not written down, and if the unit of work is a
**step** it costs at most one step — and usually nothing at all, because it lands
between two of them.

So the plan travels as data. The planning turn already produced JSON and the phase
already threw the structure away, keeping only the markdown; now the steps ride in the
`AGENT_PLAN` block beside the text, and the text a maintainer approves is _rendered
from them_, so the plan somebody signed off on and the steps the implementation walks
cannot disagree. They are never recovered by parsing the markdown back — that is the
oldest rule here, and it exists because heading-scraping once truncated specs at their
first `---`. `AGENT_PLAN` blocks with no steps in them are implemented in one turn,
exactly as before, and that fallback is **permanent rather than a migration**: nothing
can invent a step breakdown for a document a maintainer has already approved without
one, and re-deriving it would mean a second planning turn inside the phase whose job is
to implement.

Then the walk: one turn per step, `commitAll`, `push`, next step. Pushing per step
rather than once at the end is the same argument that put the push in this phase at
all — an Actions working tree dies with the job, so work is durable the moment it is
pushed and not before. Between two steps the tree is clean, the branch carries every
finished step, and the state block records the cursor, which makes it the **best moment
in the pipeline to stop**: the clock is checked in front of every step, and a step that
cannot fit is not started. The run parks in `INCOMPLETE` under a notice of its own —
one that can say both "work was done" and "nothing was lost", which neither of the
other two wall-clock notices can — and the `/continue` picks up at the recorded step
rather than re-implementing the branch.

Five things worth stating outright, because each is a decision:

- **the cursor is `stepsDone`**, a count in the state block, reset whenever a plan is
  posted and when an implementation finishes. It counts into the plan
  `planRevision` names, so a `/changes` starts the new plan from its first step;
- **a step's turn gets the whole remaining clock**, not a share of it. A share needs an
  estimate of what a step costs, which nothing here has, and it would bound an early
  step tightly to reserve time a later one may not need. A step that finishes early
  hands the rest to the next one;
- **the per-turn bound is re-read for every turn.** It is derived from the job's
  remaining clock, and one job now takes many turns, so a bound computed once when the
  session booted would hand the last step of a long plan a bound sized against a clock
  half an hour stale — which is the runner death this bound exists to prevent;
- **a plan may declare at most `MAX_PLAN_STEPS` (25) steps.** Enforced on the ask, so
  `promptForJson`'s single re-ask carries zod's own complaint and the ordinary outcome
  is a coarser breakdown from the same planning turn. A step is a turn plus a commit
  plus a push, so a step per edit spends the job on the boundaries rather than the work;
- **`changedLines` sums across the steps of a run**, where it used to be overwritten by
  each commit — harmless with one commit per phase, an under-report by a factor of the
  plan's length now. It stays a raw count and never a verdict. The diff guard runs per
  commit, so `AGENT_MAX_CHANGED_FILES` / `AGENT_MAX_CHANGED_LINES` now bound a **step**
  rather than a whole implementation; those caps exist to refuse a runaway
  `git add --all`, which is a property of one staging operation.

The token ceiling deliberately stays **per phase**: its stop parks in `FAILED`, and
firing it mid-walk would leave a `FAILED` issue whose branch carries half a plan, under
a notice inviting a `/retry` into a phase that is partly done. The runaway it bounds is
an issue across many jobs, which the check in front of the next phase still catches,
and one job's overshoot is itself bounded by the clock this walk does check per step.

### A refused commit is repaired, not a failure

A repository that gates commits on its own checks makes `git commit` the last place
a lint error can surface, and it used to be the one place the pipeline had no answer
for it. `package.json`'s `prepare` installs `scripts/pre-commit.sh` as
`.git/hooks/pre-commit` on any install where `.git` exists — the Actions runner
included — and it runs lint, typecheck, `format:check` and the licence scan over the
staged files. So an implementation turn that wrote working code with one unformatted
file in it could not commit at all: the phase threw, the issue parked in `FAILED`, and
a maintainer had to reply `/retry` to buy a whole fresh job — one that re-ran the model
turn that had already succeeded — for a fix the model could have made in seconds from
the output git had just printed.

Now `commit-repair.ts` hands that output straight back to the same session, enveloped
like any other check output, and commits again. Bounded by
`AGENT_COMMIT_REPAIR_MAX_ROUNDS` (default 3 attempts, so two repairs), and a rejection
that outlives its rounds fails exactly as it did before — same message, same `FAILED`,
same `/retry` — so the change can only turn a failure into a success. Three things it
deliberately does not do:

- **it does not repair the diff guard.** A staged credential, a binary or a runaway
  `git add --all` is refused before the commit is ever issued and still ends the run;
  no number of repair rounds can talk the pipeline into committing a secret;
- **it does not commit for itself.** The repair prompt edits the tree and the pipeline
  re-stages, re-guards and re-commits, so nothing reaches history that the hook and the
  guard have not both accepted. `--no-verify` remains the salvage path's alone;
- **it does not become a check runner.** The repository's hook is the judge; the
  pipeline never chooses, runs or interprets the checks, and the only verdict it reads
  is whether `git commit` was accepted. That is what keeps this separate from
  `check-loop.ts`, which owns a named set of commands and decides what green means.

The CI-fix phase's commit gets the same treatment for the same reason: the checks it
reproduces are the ones CI ran, and the ones a commit has to satisfy are the
repository's own over the staged files. The `/review` phase does not, and that is a
cost decision rather than an oversight — its findings arrive from `opencode run`
subprocesses and the phase opens no session of its own, so repairing there would mean
booting the OpenCode server for a phase built to avoid it.

## Watching a run

**The issue is the surface; the Actions log is the deep dive.** This section
used to teach the opposite, and that was the bug. A phase can run for tens of
minutes emitting nothing, and for that whole window an issue where the agent is
working looks exactly like an issue where the workflow never fired — which is a
real outcome, because a guardrail can drop the event. A log nobody has a link to
does not close that gap, and the usual response to a job that looks hung is to
cancel it.

Four things now speak on the issue itself: a reaction, a pair of labels, one
live comment, and a link to the job in every comment a maintainer reads when
something has gone wrong. Between them they cost **one** extra comment per run;
everything else is a reaction, a label, or an edit to that same comment. A run
started by a `/review` on a pull request adds a second, and it is the one comment
in this pipeline that is not on the issue: the note described under **Talking to
the agent**, on the thread the person waiting is reading, because everything else
that run produces goes somewhere they are not looking.

Every one of them is best-effort by construction. Each channel has exactly one
function that talks to GitHub and that function swallows every rejection into a
`log.warn`, so a repository whose token cannot write labels, a fork run, or an
organisation policy on reactions all reach the same result and the same
persisted state as a run with no feedback at all. Nothing here can fail a
pipeline that used to work.

### Reactions — the instant acknowledgement

One API call, no thread noise, and it lands on the comment you just typed, so it
is already where you are looking.

| What the run concluded                        | Reaction |
| --------------------------------------------- | -------- |
| Trigger accepted; work is starting            | 👀       |
| Artefact posted, the issue is yours again     | 👍       |
| Comment read, nothing to do about it          | 👍       |
| Sender has no write access on the repo        | 😕       |
| Command unknown, or not accepted here         | 😕       |
| The run broke and parked in `FAILED`          | 😕       |
| A delivery opened or refreshed a pull request | 🚀       |

**👀 does not survive the run that placed it.** It means "this arrived and
something is running", and a run is one CI job — so a job that ends without
clearing it leaves that claim on a comment nobody will touch again, and every
issue the agent had ever finished read as one it was still thinking about. The
run's last act is therefore to place the outcome reaction and then take the 👀
back off, in that order: both writes are best-effort, and the other order would
leave the comment bare for the width of an API call, or for good if the second
write failed. So a finished `/approve` wears 👍, a broken one 😕, a delivery 🚀 —
one mark each, not a pile.

Two endings deliberately leave nothing behind. `/cancel` reaches the same
`COMPLETE` a delivery does, and so does a stand-down on a branch whose pull
request had already merged or been closed; neither delivered anything, and 🚀
there would announce a delivery that did not happen. Both post a comment saying
what happened, which is the account — the reaction never is.

The rejected outsider is the other exception: the guardrails turn that event away
before the 👀 is ever placed, so it gets only the 😕.

A reaction lands on the comment that triggered the run, or on the issue itself
for `issues.opened`, which has no comment to address. A `/review` typed on a pull
request is the one case where that comment is not on the issue at all, and it is
the case that matters most: the run will answer on the issue, so the 👀 is the
only thing that reaches the person where they are actually reading before the work
is done. It needs no new endpoint — an issue comment and a pull-request comment
share `issues/comments/{id}/reactions`. A red-CI `workflow_run` event gets nothing
at all: nobody typed it and nobody is waiting on an answer to it, so the log line
is the whole of the right record. That decision lives in one function
(`reactionTarget`), not in a check at each call site.

👍 is the one worth understanding, because it is the only trace four paths leave
anywhere but the log: an empty comment, a comment the classifier read as chatter
on a waiting phase, the same reading in `INIT_OR_CLARIFY`, and a plain comment on
a phase that is not waiting for one at all. A comment would be the wrong
instrument for any of them — answering "I have decided to do nothing" to every
"thanks!" is exactly the noise the one-comment budget exists to prevent — but
silence left no way to tell a comment the agent read and set aside from a
workflow that never ran. All four go through one function, because a fix that
acknowledged three of them is the close-the-instance-leave-the-class defect this
workspace keeps re-opening.

### Labels — the state, from a list view

The phase lives in a hidden HTML block, so "which of my twelve agent issues are
waiting on me" used to mean opening each one and reading the last comment's
prose. A label is the only thing an issue list, a project board and a
notification all carry.

| The issue is                   | Label                | Colour |
| ------------------------------ | -------------------- | ------ |
| Being read for the first time  | `agent:triaging`     | blue   |
| Waiting on your answers        | `agent:clarifying`   | amber  |
| Parked on a design spec review | `agent:spec-review`  | amber  |
| Being broken into steps        | `agent:planning`     | blue   |
| Parked on a plan review        | `agent:plan-review`  | amber  |
| Being written                  | `agent:implementing` | blue   |
| Being delivered                | `agent:delivering`   | blue   |
| Having its diff reviewed       | `agent:reviewing`    | blue   |
| Having its red checks repaired | `agent:ci-fixing`    | blue   |
| Delivered                      | `agent:done`         | green  |
| Stopped — cancelled, no PR     | `agent:stopped`      | grey   |
| Parked in `FAILED`             | `agent:failed`       | red    |

Two more carry the filtering value, and they are the part worth having even if
the per-phase set were dropped, because each answers a question a phase name
does not:

- **`agent:working`** — a run is holding this issue right now. That is "is
  anything actually happening", answerable from a list view.
- **`agent:needs-you`** — the run ended and the next move is yours. That is
  "which of my issues am I blocking", which is the one that costs a maintainer
  time.

They are mutually exclusive by construction: while the agent holds the issue it
is not waiting on anybody, so a run in flight must not also appear in the filter
it is busy clearing. `agent:needs-you` goes on exactly the amber and red rows
above.

Labels are reconciled at most **twice per run**, not per phase move: once when a
run is about to do real work, and once when it ends, whatever the outcome — a
run that only skipped gets the closing one alone. Together with the 👀 reaction
they are the _only_ live signal a run gives on the thread, since the reply is
not posted until the run settles. Each reconcile is a diff — the desired set is
computed and only the difference issued — so a run that moved nothing writes
nothing, rather than clearing and reapplying and costing two timeline entries
and a visible flicker per phase.

Each reconcile is also a **repair**, which is the half that is easy to leave
out. Any `agent:*` label the state does not imply is removed, so an issue
whose labels were edited by hand and an issue left carrying `agent:working` by a
killed runner both heal on the next event. Labels outside the prefix are never
touched in either direction: they are the repository's own, and removing one is
the worst thing this channel could do.

A killed runner is the one failure mode the marker has, so it has two
mitigations and neither covers the other. The reconcile above repairs it on the
next event; an `if: always()` workflow step takes `<prefix>working` off as the
job exits, including a job that was cancelled or timed out. That step cannot
know which labels the state implies and cannot repair a hand edit; the reconcile
cannot run in a process that is already gone.

`AGENT_LABEL_PREFIX` namespaces the lot — a repository with its own label
conventions is the ordinary case, not the exception. Set it to `none` and the
channel is off: the pipeline reconciles nothing and the workflow's cleanup step
reads the same variable the same way and leaves the issue's labels alone, since
opting out of a channel has to opt out of every writer on it.

### The run's one comment

One comment per maintainer command. A run collects each phase's report as it
goes and posts them together, as a single comment, when it settles.

It used to be two channels: a live status comment opened before the work and
edited as the run moved, plus a comment per phase carrying the report — and the
workflow added a third for the transcript link. Issue #281 shows the result:
thirty agent comments against thirteen human ones, three per command, the first
two of which routinely said the same thing twice (`### ❌ Run failed` followed
by `### ❌ Run failed in INIT_OR_CLARIFY`).

```markdown
### 🧭 Plan is waiting for you

<details><summary>Reading the issue</summary>

### Captured: add-retries

…the triage phase's report…

</details>

### Plan (revision 1)

…the plan, which is what you came to read, left open…

<!-- AGENT_STATUS: … -->

<details><summary>Run detail</summary>

**Job:** [this run](https://github.com/acme/widgets/actions/runs/1482) · started 14:02 UTC
**Branch:** `agent/issue-42` · **Pull request:** _not opened yet_

| Phase             |                 |
| ----------------- | --------------- |
| 🔍 Triage         | ✅              |
| 📋 Design spec    | ✅              |
| 🗺️ Planning       | 🧭 · revision 1 |
| 🛠️ Implementation | ⬜              |
| 📦 Pull request   | ⬜              |

**Budget:** 218,400 of 5,000,000 tokens · attempt 1 of 3

</details>
```

One heading for the run; every phase report below it as a section, oldest folded
away and newest left open. Five milestones rather than a row per phase:
`PLAN_REVIEW` is the plan waiting for you rather than a sixth thing that
happens, and `CI_FIX` and `CODE_REVIEW` are both work _on_ the pull request row
— the branch is pushed and the pull request open before either can start. The
question the table answers is "how far along is my issue", not "draw me the
state machine". In `CI_FIX` the budget line says "attempt 2 of 3 **on this pull
request**", because that budget is per pull request and reading it as per-issue
would have you conclude the agent had given up when it had not started.

**A post, not an edit**, and that is the decision everything else follows from.
GitHub does not notify on an edit, so a comment opened at the start and
rewritten at the end announces itself when the run _begins_ and delivers the
answer in silence. Buying that notification costs the live view: while a run is
in flight you have the 👀 reaction, the `agent:working` label, and the
heartbeat's once-a-minute line in the Actions log — and nothing on the thread.

Four more things worth knowing:

- **The `AGENT_STATUS` marker is a position, not state.** Everything above it is
  what the run said; everything below — the run detail, and every phase's hidden
  blocks — is bookkeeping. `renderThread` cuts each body there before handing
  the model its twenty-comment window, which is what keeps previous runs'
  progress tables out of it. Cut by marker, never filtered by author: the agent
  writes the spec, the plan and every report too.
- **It carries `AGENT_STATE`.** The live status comment deliberately did not,
  because two comments per run meant two candidate sources of truth. One comment
  removes the competition: `readBlock` returns the _last_ block of a marker in a
  body and `locateLatestBlock` walks comments newest-first, so newest-wins is
  unchanged whether a run wrote four comments or one.
- **It is bounded.** GitHub refuses a comment over 65,536 characters, which was
  unreachable while reports were a comment each. Over budget the renderer sheds
  the _oldest_ sections and says how many; a newest section that alone will not
  fit is clipped from the top so its conclusion survives. Hidden blocks are
  never shed — a trimmed report reads short, a trimmed `AGENT_STATE` strands the
  issue.
- **A refused post is a `warn`, and leaves `reported` false.** The run reaches
  the same outcome and the same persisted state it would have with no comment at
  all; what it may not do is claim the issue carries a report GitHub turned
  down, because the workflow's fallback comment is gated on that flag.

The cost of collecting before posting, stated plainly: a process that never runs
its `finally` — an OOM kill, a cancelled job, a runner past `timeout-minutes` —
loses every section it had buffered, where the old shape had each report on the
thread the moment it existed. A throw still posts (the flush is in a `finally`),
`teardownReserveMs` still holds back wall-clock time for that write, and the
encrypted transcript still uploads. SIGKILL is what the fallback comment covers,
as it always did.

### Where the run link is

`GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_SERVER_URL` and
`GITHUB_REPOSITORY` are in every step's environment already, so the link needed
no workflow change — only a nullable `runUrl` in the config, absent on a local
run, where the line is omitted rather than left pointing nowhere. The attempt
segment is appended only above 1, because a re-run's logs live under the attempt
path and a job on attempt 3 linking `/attempts/1` would point you at the run it
superseded.

It appears in four places: the reply's run detail, the failure comment
("The job that failed"), the CI-fix report, and the workflow's own fallback
comment. The CI-fix report is the one that changed meaning — it names **two**
runs now, "Red run I am repairing" and "This repair ran in", which until now
were the same word.

### One vocabulary for the glyphs

Every glyph above comes from `presentation.ts`, which holds two closed tables: a
phase table (where the issue is) and an outcome table (what just happened to
this run). Both are `Record`s over a closed union, so a phase added later fails
to compile until it has been given a row, and a renderer cannot invent a glyph
locally — `run-report.ts` and `budget-notices.ts` build every heading through one
of two helpers, and a test asserts no `###` literal survives in either file. The
distinction the two tables buy is worth stating: ❌ means the work **broke**, ⛔
means a **bound was reached** and nothing broke at all, and ⚠️ is a failed
_answer_, where nothing moved and no attempt was spent.

The phase handlers' own artefact comments — `### Design spec (revision 1)`,
`### Plan (revision 1)`, `### Implementation report`, `### Review report`,
`### Answer` — are outside that table and carry no glyph. They name an artefact
rather than a state, and there is nothing for the label beside them to disagree
with.

The glyph is decoration and never the only carrier of meaning. The headline sits
next to it in every rendering and the label name is plain text, so a screen
reader that announces "clipboard, design spec is waiting for you" loses nothing
by dropping the first word.

### The Actions log

Still the deep dive, and the only place that says what the model is doing
second by second. Each phase is a collapsible section, and each tool call is a
pair of lines with the time it took:

```
::group::🛠️ Writing and reviewing the code
▸ read (running)
✓ read 0.1s
▸ bash (running)
✓ bash 3.2s
✓ finished a step — 1527 tokens, 2 tool calls so far
▸ edit (running)
✗ edit 0.4s
Still waiting on the model; the job is not stuck
                       { elapsedMs: 60011, lastAction: "read (running)", toolCalls: 7, tokens: 41200, cost: 0.31 }
::endgroup::
```

Three things about that shape are decisions rather than styling. The glyphs are
`▸` starting, `✓` finished, `✗` failed and `●` a session status, and the
duration comes from the pipeline's own clock rather than the server's `time.start`
— a completion whose start was never seen carries no duration instead of a
wrong one. A tool call is **two lines and no more**: the server republishes the
running state as the arguments stream in, and ten republishes of one call used
to be ten identical lines and a tool-call count ten times too high. And the
section headings come from the same presentation table the issue comments and
the labels read, so the log folds the way the issue reads.

The line is the message and the metadata is empty, deliberately: a JSON renderer
adds no structure to `✓ bash 3.2s` and a plain-text renderer loses nothing. The
heartbeat is the exception and keeps its fields, because a snapshot is exactly
the sort of thing structured logging is for.

Two halves, answering different questions. OpenCode's event stream says **what**
the model is doing, and only fires when something happens. The heartbeat, once a
minute while a turn is outstanding, says it is **still** doing it — which is the
only thing that distinguishes slow from dead during a single long model call
that uses no tools. It briefly fed a live status comment as well; with the reply
posted once, at the end, the log is again the only place a tick goes — and it is
the place that matters, because a job silent for an hour is indistinguishable
from a hung one.

**Progress never carries content.** Not tool input, not tool output, not the
model's text, not the provider's error message on a retry — only names, statuses
and counts. That is enforced by the decoding schemas rather than by care: they
name the scalar fields they want and drop everything else, so there is nowhere
for a `bash` command or a file's contents to land. It mattered here because a CI
log is world-readable on a public repository and is **not** covered by the
outbound redaction that guards issue comments. The run detail in the reply
satisfies the rule by construction rather than by care: every field it carries
is a phase, a count or a status, so there is nowhere for tool input, tool output
or model prose to land.

Token and cost totals ride along, per step and in every heartbeat, and the token
half is now a ceiling as well as a reading — see **What bounds a run** above.

### The debug transcript, for the detail the log may not carry

The rule above — names, statuses and counts, never content — is what makes the
Actions log safe to publish, and it is also what makes it thin exactly when a
run has gone wrong. `✗ bash 0.4s` says a command failed; **which** command is
the thing you actually want, and it cannot go in a world-readable log.

So it goes somewhere else, encrypted, and only if an operator asks for it.

1. Generate a key and store it as the repository secret `AGENT_LOG_KEY`:

   ```sh
   openssl rand -base64 32
   ```

2. Enable Pages once, under **Settings → Pages → Source: GitHub Actions**. The
   `Transcript viewer` workflow publishes `opencode-agent/viewer/` on every push
   to master that touches it, and on demand.

3. From then on, every run that has a key uploads a `debug-transcript-<run id>`
   artefact and comments two links on the issue. Download the artefact, open the
   viewer, drop the `.enc` file in, paste the key.

**Without the secret nothing changes.** The pipeline warns once that no
transcript will be written, writes no file, uploads no artefact and posts no
comment, and the public log is byte-for-byte the one it always wrote.

What the transcript carries is a whitelist, not "the rest of the event":
`src/activity-detail.ts` names one scalar field per tool — `command` for bash
(truncated at 200 characters, because a command can be a heredoc carrying a
whole file), `filePath` for read, edit and write, `pattern` for grep and glob —
and everything else decodes to no detail at all. Tool **output**, file contents
and the model's own text have nowhere to land in that shape, which is why the
transcript is not simply "the log with the redaction switched off".

Two properties do the containment, and both are in `src/debug-transcript.ts`:

- every line is AES-256-GCM under a fresh 12-byte nonce, written as
  `<base64 nonce>.<base64 ciphertext>`, so the artefact reads as noise to anyone
  without the key — and decrypts **line by line**, which is what lets a run
  killed mid-write leave a truncated file that still reads up to its last whole
  line;
- `redactSecrets` runs **before** encryption and by value, so a pipeline
  credential that reached a bash command is not in the ciphertext at all. Even
  the key holder never reads one back.

The viewer is one file with no network access in it — no script, stylesheet or
font from anywhere else. That is not tidiness: it is a page opened by someone
holding a decryption key, and a third-party script on it would be code that
could take the key, controlled by whoever controls that origin.
`tests/opencode-agent/transcript-viewer.test.ts` imports the page's own script
and decodes a transcript the real writer produced, so the reader and the writer
cannot drift apart unnoticed.

The key is never in the comment and never in a URL. The artefact sits behind
repository read access, the key behind the secret store, and the page brings
them together in a tab that talks to neither.

### The post-mortem, for a job whose server died

The rule above has a cost, and it was paid on issue #239: when a run failed three
times with `The socket connection was closed unexpectedly`, nothing in the log
could say why. That message is Bun's wording for a `fetch` whose peer went away
and names neither end of it, so it reads as a model-provider problem — while the
peer that had actually gone was the `opencode serve` this job spawned on
loopback. The pipeline now says so itself: a turn that fails asks the server
whether it is still there, and reports **the local OpenCode server stopped
answering** rather than quoting the transport.

_Why_ it died is not visible from inside the process that lost it, so a
`if: failure()` step asks the runner before it disappears:

```
--- processes still alive (names only, no command lines) ---
--- how many of them are opencode ---
--- kernel out-of-memory kills ---
--- peak memory for this job cgroup ---
```

Two live `opencode` processes means something started a second one; a line from
the OOM killer means the runner ran out of memory. **Names and counts only**, by
the same rule as the rest of this section — `ps` is asked for `comm` and never
`args`, because a tool child's argument vector is model-authored content and this
log is public. When you need the commands themselves, reproduce locally: see
**Local runs** below, and `bun run opencode-agent:test:survival`, which drives
candidate commands at a throwaway server and reports which of them it does not
survive.

## Guardrails

Policy lives in `src/guardrails.ts`. What an event _is_ lives in
`src/trigger-events.ts`, and that split is what lets the pull-request resolver
finish a parse without importing the layer that will judge the finished event. The
policy half is mirrored as a first-pass `if:` on the workflow's **`resolve`** job,
which is the door: `agent` is reachable only through `needs`, so one condition in
one place gates both, and an unauthorized event never boots a runner with keys
mounted.

Three kinds of event, and three sets of rules.

**Issue events**: supported event and action only; no `Bot` senders; nothing from
the agent's own login; and the author association must be `OWNER`, `MEMBER`, or
`COLLABORATOR` — read from the _commenter_, not the issue author. A comment whose
target is a pull request is still refused here (`PULL_REQUEST`), but that refusal
is now the fallback rather than the whole story: it covers exactly what the
pull-request door did not claim — the wrong action, no comment at all, or a body
carrying no `/review`.

**Pull-request comments**: everything structural about one is settled before the
policy layer sees it, and had to be, because resolving the comment to its issue is
what discovers those facts. `parseTriggerEvent` admits only an `issue_comment`
carrying a comment on a pull request, and `resolvePullRequestTrigger` then settles
the `/review`, the repository the head branch lives in, that pull request's state,
and the branch name itself — the numbered list under **Talking to the agent**.
What is left here is the sender, asked in the same three rules and the same words
as the issue path, including the 😕 that `NOT_MAINTAINER` earns: a `/review` typed
on a pull request is a human write with an `/approve`'s reach, so a rule that held
on one door and not on the other would be a hole in whichever was written second.
The **action** is the one thing nothing in-process checks, unlike the issue path's
`SUPPORTED_ISSUE_ACTIONS` — the only constraint is the workflow's
`on: issue_comment: types: [created]`. There is no gap today, because no other
action reaches this pipeline at all, but it is a rule held in YAML alone and worth
knowing before anyone widens that `types:` list.

**CI events**: the run must have concluded `failure`, **on this repository**, on a
branch matching `agent/issue-<n>`, from a workflow that is not this one.

The repository check on each of the two branch-carrying paths is the one that is
not bookkeeping, and it is one attack answered twice. A branch name is
attacker-controlled — `workflow_run.head_branch` carries a fork's branch verbatim,
and so does a pull request's `head.ref`. Call a fork's branch `agent/issue-42` and
the payload passes every other test here. So `CI_FOREIGN_REPOSITORY` compares the
head repository on the red-check path and `PR_FOREIGN_REPOSITORY` compares it on
the pull-request one; without either, anyone who can open a pull request could let
its checks go red, or simply type `/review` on it, and buy a privileged job that
prompts the model, spends issue 42's token budget and pushes commits to a real
agent branch.

Relatedly, the checkout takes **no `ref:`**. Every event kind checks out the
default branch and the pipeline switches to `agent/issue-<n>` itself. Checking
the agent's branch out in the workflow would mean `bun install` and the
pipeline's own source came from a branch the model writes to, in a job holding
every repository secret.

Text the pipeline did not write — issue bodies, comments, approved artefacts and
**check output** — reaches the model inside an id-terminated envelope
(`<untrusted_input source="…" id="<id>"> … </untrusted_input:<id>>`). A fixed
closing tag is escapable by text containing that tag, so three things hold the
envelope together, and all three are load-bearing:

1. The id is a random UUID minted per prompt. It used to be derived from
   `issueId`, `revision` and the attempt counters — every one of which the agent
   publishes in the `AGENT_STATE` block on the very issue an attacker is writing
   into, and which collapses to `<number>-0-00` on a fresh one.
2. **Every** delimiter-shaped run in the body is neutralised, not just the one
   that would have matched. Rewriting the exact terminator alone left the plain
   `</untrusted_input>` intact.
3. The system prompt states the rule and names the id, so "is this a real
   terminator?" is decidable. Telling the model to distrust issue text says what
   to distrust but never where the untrusted region _ends_ — which is the only
   thing an injected terminator is lying about.

Each comment in the thread gets **its own** envelope, with its author in the
`source` attribute rather than as a text prefix. Anyone can comment on a public
issue — the guardrails stop a non-maintainer triggering the agent, not their text
reaching the prompt — so an in-band `[comment by maintainer]` line was a forged
approval waiting to happen. The system prompt states that `source` is the only
trustworthy attribution.

Commands are spawned as argv vectors with `shell: false`, so untrusted text never
reaches a shell.

### Files the agent cannot commit

`.github/workflows/**` is off limits, and not as a matter of taste.

GitHub refuses a push from a GitHub App or an Actions token that creates or
updates anything under `.github/workflows/` unless the App holds the `workflows`
permission — and the `permissions:` block a workflow grants its own
`GITHUB_TOKEN` has no `workflows` key at all, so the shipped default can never
do it. The refusal is for the **whole push**, not the offending file: a commit
carrying one blocked workflow file and forty good ones delivers none of them.
Issue #240 lost two runs that way, several hundred thousand tokens each, on work
that had nothing to do with the workflow.

So `src/protected-paths.ts` names the prefixes and `git-commit.ts` takes them
back out of the index between `git add --all` and the diff guard, on the
ordinary commit and on the salvage alike. The file is **dropped, not refused** —
refusing would lose the same work the remote would have lost — its working-tree
copy is reverted (or removed, if the model created it) so the next step cannot
stage it again, and the drop is reported — at `warn`, **and to the maintainer**,
because a guardrail nobody sees fire is indistinguishable from a model that
quietly failed to make the edit.

That reporting is the part run 31779566286 was missing, and it cost a pull
request's whole CI-fix budget. `commitAll` answers `clean | blocked | committed`
rather than `StagedTotals | null`, so "the tree was already clean" and
"everything the turn wrote is a file the remote refuses" stop being the same
answer; `dropped` rides on `committed` too, since a partial drop pushes real work
and every other signal then reads as success. The CI-fix report names the file
and says a maintainer must apply it by hand — `/retry` cannot reach the remedy,
because another round re-derives the same edit — and `ciBlockedPaths` carries the
path into the next round's prompt so it stops trying. A green check verdict on a
round that pushed nothing is scoped to **this job**, not to the branch: the
repair turn holds `bash`, and that run got its green by running `build:client`
and `docker pull` on its own runner before re-running the tests.

The review loop needs a guard of its own (`src/git-revert.ts`, driven from
`review-push.ts`): its fixes are commits it makes in a worktree and merges, so
they never pass through an index `stageAllowed` sees. Those paths are reverted as
a further commit before the push, and named in the review report.

Every instruction block that can write a file states the rule — `IMPLEMENT`,
`CI_FIX` and both planning blocks, sharing one `PROTECTED_PATHS_RULE` constant so
a copy cannot be softened — and `instructions.test.ts` asserts it against that
constant. `CI_FIX` was the phase that had no copy of it and is the likeliest to
want one, since a red job's root cause is often the workflow that ran it. That is
the courtesy; the staging step is the mechanism, and it is where the model has no
say.

**If you want the agent to change its own workflow**, grant the App behind
`AGENT_GITHUB_TOKEN` the `workflows: write` permission, re-install it, and drop
the prefix from `PROTECTED_PREFIXES`. Weigh it first: an agent that can rewrite
`agent-pipeline.yml` can rewrite the permissions, the concurrency group, the
guardrails and the secret wiring that bound it, from inside a job that file
defines. The alternative costs a maintainer one commit — the agent says in its
reply exactly what to apply.

The full option space — what the remote refuses and to whom, why `ci.yml` and
`agent-pipeline.yml` are not the same risk, and four routes that need no grant
at all — is in [`docs/workflow-edit-options.md`](docs/workflow-edit-options.md).
Nothing there is implemented.

### Capability containment

Prompt-level defences fail eventually, so the model's capabilities are bounded
independently of what it is persuaded to attempt.

The OpenCode config denies by default (`"*": "deny"`) and grants by name. A
forbid-list would have to enumerate every dangerous tool, so a tool added by a
later OpenCode release would arrive enabled.

| profile                                     | reads | edits files | runs commands |
| ------------------------------------------- | ----- | ----------- | ------------- |
| `plan` — triage, planning, `/ask`, classify | ✅    | ❌          | ❌            |
| `build` — implement, CI fix, review loop    | ✅    | ✅          | ✅            |

Both review gates run on the read-only profile, so an injection landing before a
maintainer has approved anything cannot reach the working tree. The **default**
profile is the read-only one, which covers the agents this pipeline never names
(`explore`, `general`, `summary`, …) rather than leaving them a free pass.

Credentials are removed from the process environment once config is loaded and
before anything can spawn. `createOpencodeServer` starts `opencode serve` with
`{ ...process.env }` and offers no environment option, so a key left there is one
`echo $VAR` away from the model. Nothing needs them there: the provider key
travels in `OPENCODE_CONFIG_CONTENT`, the GitHub token goes to Octokit directly,
and git reads `.git/config`. They are matched by **value**, not name, so an
aliased export goes too.

Nothing is committed unchecked. `git add --all` stages whatever the model left
behind, so between staging and the commit a guard inspects the index and unstages
if it refuses: staged content containing one of the pipeline's own credentials
(by value, not by filename — a `.env` renamed `notes.txt` is the same disaster),
more than `AGENT_MAX_CHANGED_FILES` files, more than `AGENT_MAX_CHANGED_LINES`
lines, or a binary it cannot size-check. A credential reaching git history is not
undone by deleting the file.

Every outbound body — issue comments, pull request titles and bodies — is
stripped of the pipeline's credentials at the GitHub adapter, not in the
renderers. A comment is assembled from check output, git stderr, review
summaries, model prose and the hidden state block's `lastError`; redacting at the
boundary means none of those can forget. GitHub masks registered secrets in an
Actions log, but it does not mask an issue comment.

The repository token is never persisted. The checkout runs with
`persist-credentials: false`, and git receives its credential through
`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0` on each
invocation's environment — so it is in no file the model can read, in no argv
(where `/proc` and a published `GitError` would both carry it), and in no
environment the OpenCode server inherits. The header is scoped to
`GITHUB_SERVER_URL`; a header scoped to the wrong host is silently not sent.

The **provider** key is never given to OpenCode either. The SDK spawns
`opencode serve` with the serialized config in `OPENCODE_CONFIG_CONTENT`, and
every process the model starts with `bash` inherits it — so a key in that config
is one `echo` away. OpenCode is configured with a placeholder and a loopback URL
instead, and a proxy holding the real key swaps in the `Authorization` on the way
out. The same generated config drives the review loop's `opencode run`
subprocesses, so both paths are covered.

Log lines get the same treatment, and for the same reason: a credential quoted
into a message or echoed into an `argv` array has no field name to match on. The
value pass runs on the serialized line; the older name-based pass stays alongside
it, because that one catches a third-party token the pipeline never loaded.

> **Still open:** there is no container or network boundary around the model,
> only these capability and credential boundaries — see S3-2 in `ROADMAP.md`.

### A note on the "actor matches repository owner" rule

The original spike spec asked for the run to abort when the actor matches
`github.repository_owner` — which also locks out the human owner, usually the
maintainer driving the issue. The rule is aimed at the _agent's_ identity, so it
compares against the login the agent actually posts as.

### The agent's own identity

That login is **not** only a recursion guard: it is the author filter the
pipeline reads its own state and artefacts back through. Get it wrong and nothing
matches — every event restores a fresh state, so the issue restarts at phase one,
forever, with no error. It used to default to the repository owner, which is
wrong for every token that posts as a bot.

It is now resolved, in order:

1. `AGENT_SELF_LOGIN`, if set. An operator who knows the answer is not
   second-guessed, and this is the escape hatch for everything below.
2. Otherwise the token's own identity. Exact for a personal access token.
3. Otherwise `github-actions[bot]`, **with a warning naming `AGENT_SELF_LOGIN`**.
   A GitHub App installation token cannot read `/user`, so this is the expected
   path for an Actions-issued token — and it is the account the runtime's own
   `GITHUB_TOKEN` posts as. For any other app, set the variable to
   `<app-slug>[bot]`.

Step 3 used to fall back to the repository owner, which was never a possible
answer: the branch is only reached for an installation token, whose author is
always a `[bot]` account.

Because step 1 wins outright, **the workflow must pass `AGENT_SELF_LOGIN`
through unset when the variable is unset** — no `|| github.repository_owner`
default. Defaulting it upstream turned "nobody pinned a login" into "an operator
pinned the owner", which skipped steps 2 and 3 and their warning with them. The
agent then failed to recognise its own comments, restored a fresh state on every
event, and refused `/approve` and `/changes` as invalid in `INIT_OR_CLARIFY`.

Whatever it resolves to is checked against reality for free: a created comment
comes back carrying its author, and a mismatch is logged at `error`. The in-job
thread mirror uses that recorded author too, so a wrong identity fails on the
run that made it rather than on the next one.

## Configuration

One OpenAI-compatible endpoint. That covers OpenAI, Azure-style gateways,
OpenRouter, vLLM and anything else that speaks the protocol, so there are no
provider-specific keys to keep in step. The same generated OpenCode config is
used by the in-process SDK session _and_, via `OPENCODE_CONFIG_CONTENT`, by the
`opencode run` subprocesses the review loop spawns — one definition, so the two
cannot drift.

| Variable                                   | Required | Default                                                                         | Purpose                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_API_KEY`                              | yes      | —                                                                               | Model credentials                                                                                                                                                                                                                                                                         |
| `LLM_MODEL`                                | yes      | —                                                                               | Model name, e.g. `gpt-5`                                                                                                                                                                                                                                                                  |
| `LLM_BASE_URL`                             | yes      | —                                                                               | Any OpenAI-compatible endpoint                                                                                                                                                                                                                                                            |
| `LLM_PROVIDER`                             | no       | `openai`                                                                        | models.dev id `LLM_MODEL` resolves under; see below                                                                                                                                                                                                                                       |
| `GITHUB_TOKEN`                             | no       | the job's own `secrets.GITHUB_TOKEN`                                            | Comments, branches, pull requests; see below                                                                                                                                                                                                                                              |
| `GITHUB_REPOSITORY`                        | no       | the job's own `owner/repo`                                                      | `owner/repo`; see below                                                                                                                                                                                                                                                                   |
| `AGENT_SELF_LOGIN`                         | no       | derived from the token                                                          | Login the agent posts as; see above                                                                                                                                                                                                                                                       |
| `AGENT_WORKFLOW_NAME`                      | no       | `OpenCode Issue Agent`                                                          | This workflow's name, for the CI recursion guard                                                                                                                                                                                                                                          |
| `AGENT_BASE_BRANCH`                        | no       | detected                                                                        | Branch the PR targets; see below                                                                                                                                                                                                                                                          |
| `AGENT_CHECK_COMMAND`                      | no       | `bun check:full`                                                                | review-loop's build gate                                                                                                                                                                                                                                                                  |
| `AGENT_REVIEW_COMMAND`                     | no       | detected                                                                        | JSON argv running the review loop; `none` disables it                                                                                                                                                                                                                                     |
| `AGENT_CHECKS`                             | no       | `bun run` lint / typecheck / test                                               | JSON `[{ "name", "argv" }]` the CI-fix phase runs                                                                                                                                                                                                                                         |
| `AGENT_MCP_SERVERS`                        | no       | unset — no MCP servers                                                          | Secret or variable: JSON map of MCP servers; see below                                                                                                                                                                                                                                    |
| `AGENT_REVIEW_MAX_ROUNDS`                  | no       | `4`                                                                             | review-loop rounds                                                                                                                                                                                                                                                                        |
| `AGENT_REVIEW_POOL_SIZE`                   | no       | `1`                                                                             | review-loop worker pool                                                                                                                                                                                                                                                                   |
| `AGENT_CI_FIX_MAX_ROUNDS`                  | no       | `2`                                                                             | Repair rounds per CI-fix job                                                                                                                                                                                                                                                              |
| `AGENT_COMMIT_REPAIR_MAX_ROUNDS`           | no       | `3`                                                                             | Commit attempts when the repo's own checks refuse one                                                                                                                                                                                                                                     |
| `AGENT_MAX_CI_ATTEMPTS`                    | no       | `3`                                                                             | CI-fix jobs per pull request                                                                                                                                                                                                                                                              |
| `AGENT_MAX_REVIEW_ATTEMPTS`                | no       | `3`                                                                             | `/review` rounds per pull request                                                                                                                                                                                                                                                         |
| `AGENT_REVIEW_HINT_LINES`                  | no       | `200`                                                                           | Diff size at which a delivery recommends `/review`                                                                                                                                                                                                                                        |
| `AGENT_MAX_ATTEMPTS`                       | no       | `5`                                                                             | Failures before `/retry` stops resuming                                                                                                                                                                                                                                                   |
| `AGENT_MAX_CHANGED_FILES`                  | no       | `100`                                                                           | Files one commit may carry                                                                                                                                                                                                                                                                |
| `AGENT_MAX_CHANGED_LINES`                  | no       | `20000`                                                                         | Lines one commit may change                                                                                                                                                                                                                                                               |
| `AGENT_TIMEOUT_MS`                         | no       | `5400000`                                                                       | Timeout for one model turn, and for each subprocess                                                                                                                                                                                                                                       |
| `AGENT_STALL_TIMEOUT_MS`                   | no       | `300000`                                                                        | No-progress window that aborts a turn the provider stopped serving; `0` disables                                                                                                                                                                                                          |
| `AGENT_JOB_STARTED_MS`                     | no       | unset — no job deadline                                                         | Epoch ms this job began; the workflow's first step                                                                                                                                                                                                                                        |
| `AGENT_JOB_TIMEOUT_MINUTES`                | no       | unset here; `300` from the workflow                                             | The job's own ceiling, shared with `timeout-minutes:`                                                                                                                                                                                                                                     |
| `AGENT_TEARDOWN_RESERVE_MS`                | no       | `180000`                                                                        | Held back from the job so a time stop can report                                                                                                                                                                                                                                          |
| `AGENT_WRAP_UP_MS`                         | no       | `120000`                                                                        | The model's slice of a stop: finish up and hand over                                                                                                                                                                                                                                      |
| `AGENT_MAX_TOKENS`                         | no       | `5000000`                                                                       | Model tokens one issue may spend, across all its jobs                                                                                                                                                                                                                                     |
| `AGENT_MODEL_CONTEXT`                      | no       | unset — ask the catalogue                                                       | Context window, for a model no catalogue carries                                                                                                                                                                                                                                          |
| `AGENT_MODEL_OUTPUT`                       | no       | unset — ask the catalogue                                                       | Output cap, same case                                                                                                                                                                                                                                                                     |
| `AGENT_MODEL_REASONING`                    | no       | unset — ask the catalogue                                                       | `true`/`false`: does this model support reasoning                                                                                                                                                                                                                                         |
| `LLM_MODEL_LIGHT`                          | no       | unset — the main model                                                          | Cheaper model for the read-only phases; see below                                                                                                                                                                                                                                         |
| `AGENT_EFFORT_PLAN`                        | no       | unset — OpenCode's default                                                      | Reasoning effort for the read-only profile                                                                                                                                                                                                                                                |
| `AGENT_EFFORT_BUILD`                       | no       | unset — OpenCode's default                                                      | Reasoning effort for implement / CI-fix / review                                                                                                                                                                                                                                          |
| `AGENT_COMMIT_NAME` / `AGENT_COMMIT_EMAIL` | no       | `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com` | Commit identity — explicit pin wins per field; otherwise author is the per-run actor (`issue`/`pull-request` → `senderLogin` via `GET /users/:login`, `id+login` noreply) and committer is `github-actions[bot]`; `ci`/`pr-merged` and lookup failures fall back to `github-actions[bot]` |
| `AGENT_LABEL_PREFIX`                       | no       | `agent:`                                                                        | Namespace for the status labels; `none` disables them                                                                                                                                                                                                                                     |
| `AGENT_LOG_LEVEL`                          | no       | `info`                                                                          | `debug`, `info`, `warn`, `error`                                                                                                                                                                                                                                                          |
| `AGENT_LOG_KEY`                            | no       | unset — no transcript                                                           | Secret: base64 32 bytes; encrypts the debug transcript                                                                                                                                                                                                                                    |

`LLM_MODEL` and `LLM_BASE_URL` are both required rather than defaulted: with a
model gateway that is not necessarily OpenAI's own, there is no base URL or
model name that is right by default, and a wrong guess surfaces deep inside the
first model call instead of at config load. A default of
`https://api.openai.com/v1` used to stand in for `LLM_BASE_URL`, which made a
forgotten value indistinguishable from a deliberate one; this pipeline is built
around one arbitrary configured endpoint, not OpenAI specifically, so there is
no endpoint that is right unless someone said so.

`LLM_PROVIDER` is a **catalogue key, not a transport**, and it is the one
variable here whose default is wrong for most gateways. OpenCode builds its
model database from models.dev and merges this pipeline's config provider _over_
it, keyed by this id and then by `LLM_MODEL`. A row it does not find contributes
nothing, and the two defaults that follow are silent:

- `limit.context` becomes `0`, and `isOverflow` opens with
  `if (model.limit.context === 0) return false` — so **auto-compaction never
  fires** and a long implement turn grows until the provider rejects it.
- `reasoning` becomes `false`, and `ProviderTransform.variants()` opens with
  `if (!model.capabilities.reasoning) return {}` — so no reasoning effort is
  selectable, for any phase.

Leave it unset when `LLM_MODEL` is an OpenAI model id. Set it to the model's own
provider — `anthropic`, `alibaba`, `zai`, `deepseek` — when `LLM_BASE_URL` is a
gateway serving somebody else's model, so the lookup reaches a real row. The
transport is unaffected either way: the emitted config pins
`npm: "@ai-sdk/openai-compatible"`, which wins over the borrowed row's own
package in OpenCode's resolution order, and the key still reaches the endpoint
through the provider proxy. The run log names the reference it resolved at
`debug`.

A model no catalogue carries at all — a self-hosted alias, a fine-tune — has no
id that helps here. The three `AGENT_MODEL_*` variables state those facts
outright, and they sit at the top of a four-rung ladder:

```
AGENT_MODEL_CONTEXT / _OUTPUT / _REASONING   an operator said so → always wins
        ↓ (unset)
the models.dev row for <LLM_PROVIDER>/<LLM_MODEL>
        ↓ (miss, or the catalogue could not be read)
nothing emitted            → OpenCode's own catalogue merge stays free to answer
        ↓ (miss there too)
OpenCode's zero defaults   → compaction off, no effort variants
```

Each rung is per field, so declaring only `AGENT_MODEL_CONTEXT` still takes the
output cap and the capability flags from the row. An unresolved fact is
**omitted** from the emitted config rather than written as a zero — a written
`limit.context` of `0` would pin the broken value instead of leaving the merge to
answer.

Reading the catalogue is best-effort and bounded: the run fetches
`https://models.dev/api.json` once on the boot path through the same cached,
timeout-bounded reader `sdd-runner` uses, after the guardrail door so a payload
the pipeline is about to drop never pays for it. An unreachable host warns and
falls to the next rung; it never fails a run. The `debug` line names the model,
the resolved context window and **which rung answered**, so "why did this run
never compact" is a log read rather than a rerun.

The pipeline runs three **agent profiles**, which already differ by what they
may do and now differ by what they cost:

| Profile   | Phases                                                          | Model             | Effort               |
| --------- | --------------------------------------------------------------- | ----------------- | -------------------- |
| `plan`    | triage, comment classification, `/ask`, both review gates       | `LLM_MODEL_LIGHT` | `AGENT_EFFORT_PLAN`  |
| `propose` | drafting proposal / spec / design / tasks                       | `LLM_MODEL`       | —                    |
| `build`   | implement, CI fix, and the review loop's `opencode run` workers | `LLM_MODEL`       | `AGENT_EFFORT_BUILD` |

`LLM_MODEL_LIGHT` is a model on the **same** endpoint and key — not a second
provider — and it reaches `plan` and OpenCode's `small_model` (title and summary
generation) and nothing else. `propose` and `build` deliberately keep the main
model: a weak spec is the input to every later phase, and the gates that would
catch one cost wall clock rather than tokens.

The effort variables take whatever tier the model offers — `minimal`, `none`,
`low`, `medium`, `high`, `xhigh`, `max` depending on the family and its release
date. They are **not** validated against a list here, because the valid set is
computed per model: a list copied into this pipeline would reject tiers that work
and be wrong on the next model. A malformed value is refused at load; an
unknown-but-well-formed one is refused by OpenCode at the first prompt, which is
where that knowledge lives. An effort tier only exists at all when the model is
known to support reasoning — see `LLM_PROVIDER` and `AGENT_MODEL_REASONING`
above.

Both are set as `agent.<name>.variant` in the generated config rather than per
call, which is what makes them reach the review loop: it shells out to
`opencode run` with no `--agent`, so its workers resolve to `build` and pick the
variant up from the same config the in-process session reads.

### MCP servers

`AGENT_MCP_SERVERS` declares MCP servers for the whole pipeline — one JSON map
of server names to declarations, validated at job start before any model turn:

```json
{
  "fetcher": {
    "type": "local",
    "command": ["bunx", "mcp-server-fetch@1.0.0"],
    "environment": { "FETCH_TIMEOUT": "5000" }
  },
  "index": {
    "type": "remote",
    "url": "https://mcp.example.com/sse",
    "headers": { "Authorization": "Bearer <token>" }
  }
}
```

A local entry carries a non-empty `command` array and may carry `environment`;
a remote carries a `url` and may carry `headers`. Pin exact versions in
`command` — the ephemeral runner refetches every job either way, and an
unpinned `bunx` is a moving third-party dependency in a job holding every
repository secret. An `oauth` key is refused outright: an unattended job can
complete no browser flow, and an OAuth remote parks at `needs_auth` for ever.
Remotes are always emitted with OAuth disabled — a failing endpoint degrades to
its HTTP error rather than a silent stall.

Server names must match `[A-Za-z0-9_-]+`, because OpenCode surfaces a server's
tools as `<name>_<tool>` and the pipeline generates the matching
`"<name>_*": "allow"` permission keys in the `plan` and `build` profiles and
the global default. Grants are generated, never hand-keyed — a bare server
name as a permission key is a silent no-op — and are `allow` only; the
drafting (`propose`) profile gets none, keeping it the most confined surface
the pipeline prompts. A server that fails to start or connect does not fail
the job: its tools are simply absent, bounded by OpenCode's own 30-second
client timeout, and the run proceeds.

The knob takes **two spellings** — `secrets.AGENT_MCP_SERVERS` (which wins) or
the `AGENT_MCP_SERVERS` variable. A declaration whose `headers` or
`environment` carry a token belongs in the secret, which GitHub masks in logs
and encrypts at rest; a token-free declaration may live in the variable, which
non-admin maintainers can read and diff. Every `headers` and `environment`
value joins the pipeline's credential list, so the environment scrub removes
them from anything the model's shell can read and outbound text is redacted by
value.

One residual risk scrubbing cannot close: the generated config itself is
delivered through `OPENCODE_CONFIG_CONTENT`, which the write-capable profile
can read with one `echo`. A credential in the knob is reachable by the model
regardless of scrubbing — declare unauthenticated local servers, or remote
headers whose static tokens you can afford to expose. And each review-loop
worker is its own `opencode run` subprocess, so every local server is booted
once per concurrent worker — one more reason `AGENT_REVIEW_POOL_SIZE` defaults
to `1`.

`GITHUB_TOKEN` and `GITHUB_REPOSITORY` need no operator setup on GitHub
Actions, unlike the variables above. `GITHUB_REPOSITORY` is one of the
[default environment variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables)
every Actions job carries — it needs no `env:` entry to exist, and the
workflow's `GITHUB_REPOSITORY: ${{ github.repository }}` line only makes that
already-present value explicit. `GITHUB_TOKEN` is not a default environment
variable — it is a secret every repository already has, and the shipped
workflow wires it in from `secrets.GITHUB_TOKEN` (or `secrets.AGENT_GITHUB_TOKEN`
when set) without the operator creating anything. Both stay `required()` at
config load, because a genuinely missing value — a hand-edited workflow, or a
local run that forgot to set one — should fail loudly rather than guess; the
"no" above is about operator setup, not about the loader's validation. A local
run has no Actions runtime to supply them and must set both explicitly, as
shown under **Local runs** below.

Every numeric knob is validated as an integer **and range-checked**, because
rejecting non-integers only closes "not a number", never "a number that cannot
work". Round counts accept 1–20, `AGENT_TIMEOUT_MS` accepts 1 000–7 200 000 (one
second to two hours), `AGENT_MAX_TOKENS` accepts 50 000–1 000 000 000, and
`AGENT_REVIEW_POOL_SIZE` accepts 1–16, and defaults to the bottom of that
range deliberately: a review-loop worker is an `opencode run` **plus** a full
`AGENT_CHECK_COMMAND`, so on a stock 4-vCPU runner two of them overlap into an
OOM that takes the runner down before the pipeline can post anything. Raise it
only where the build gate is cheap enough to overlap. `AGENT_TIMEOUT_MS=1`
is a positive integer that kills every subprocess after a millisecond, so the
pipeline reports every check as failing; `AGENT_REVIEW_MAX_ROUNDS=9007199254740991`
is a positive integer that removes the bound the knob exists to impose. A
rejection names the range, so a legitimate need for a wider one is not a
guessing game.

The three job-clock knobs are read the same way and are worth reading together.
`AGENT_JOB_STARTED_MS` and `AGENT_JOB_TIMEOUT_MINUTES` have **no defaults**,
because half a deadline is not a bound: with either unset there is no job deadline
at all and a run is bounded by `AGENT_TIMEOUT_MS` alone, exactly as every run was
before they existed — which is what every local `--event-path` run gets.
`AGENT_JOB_STARTED_MS` accepts 1 577 836 800 000–4 000 000 000 000 (2020 to 2096):
a value in seconds rather than milliseconds reads as 1970, putting the derived
deadline permanently behind the clock so **every** run parks before it starts, and
an extra digit puts it past any job's life, removing the bound instead. Both are
positive integers that used to be accepted.
`AGENT_JOB_TIMEOUT_MINUTES` accepts 1–1 440 and is the same repository variable the
workflow's own `timeout-minutes:` reads — deliberately one value with two readers,
since the pair kept in step by hand is the defect S5-11 records. The range is wider
than a hosted runner can honour on purpose: it cannot tell a hosted runner (capped
at 360 minutes) from a self-hosted one (five days), so a value over 360 loads here
and is then ignored by GitHub, which kills the job at 360 anyway. On hosted runners
treat 360 as the hard ceiling and leave room under it — the workflow's own fallback
of 300 is where that room is taken.
`AGENT_TEARDOWN_RESERVE_MS` accepts 1 000–1 800 000: below a second the reserve
cannot post the comment and write the state block it exists for, and above half an
hour it is larger than most jobs and stops every run before any phase begins.
`AGENT_WRAP_UP_MS` accepts 5 000–900 000 and is the **third** slice of the same
clock: below five seconds the window can only ever expire, buying a second abort
and no handoff, and above fifteen minutes it is the work slice given away to the
tidying — the wrap-up has one paragraph to write, not a file to refactor. Unlike
the reserve it is taken off the _work_, which is why `turnTimeoutMs` subtracts
both: a turn allowed to run right up to the reserve leaves nothing to ask it in.

`AGENT_REVIEW_HINT_LINES` takes the line range `AGENT_MAX_CHANGED_LINES` takes,
1–1 000 000, because it is the same quantity read off the same measurement — and
both ends matter here too. A threshold of 0 recommends a review on every
delivery, which is the same as having no recommendation at all.

`AGENT_LABEL_PREFIX` is validated at load for the same reason: at most 32
characters, and only letters, digits and `-_./: `. That is narrower than what
GitHub itself accepts on a label, deliberately — the prefix is what decides by
`startsWith` which of an issue's labels this pipeline owns and may remove, so it
has to be a plain, predictable string. A comma splits a label list in half of
GitHub's own UI, and a leading or trailing space makes two labels that look
identical. Checking it here turns a bad value into a message naming the
variable, rather than a 422 inside a best-effort path that swallows it.

`AGENT_BASE_BRANCH` has no literal default for the same reason. It used to
default to `main`, which is wrong for the repository this spike lives in — its
default branch is `master` — so every local run died on `fatal: couldn't find
remote ref main`; `master` would have been just as wrong elsewhere. The branch is
resolved instead, in order:

1. `AGENT_BASE_BRANCH`, when an operator pins one.
2. `repository.default_branch` from the webhook payload — always present on the
   events this pipeline listens to, so this is the normal path. The workflow
   deliberately does **not** forward it as `AGENT_BASE_BRANCH`; doing so would
   mask this rung and let it rot untested.
3. The checkout's own `origin/HEAD`, for runs driven from an event file. Probed
   locally first, then via `git ls-remote --symref`, because `git clone` writes
   that ref and `actions/checkout` does not.
4. Otherwise a `ConfigError` naming `AGENT_BASE_BRANCH` — never a guess.

Resolution is lazy and memoized: it can cost a round trip to the remote, and a
run that a guardrail stops must neither pay for that nor fail on it.

## Skills

`obra/superpowers` is fetched, not vendored — it is MIT-licensed and separately
maintained, so a pinned checkout keeps updates to a ref bump rather than a copy.
The workflow checks it out to `.superpowers/` (gitignored) and then _verifies_
the skills landed, because a silently empty skill layer is indistinguishable
from a working one.

Each phase declares required and optional skills. A missing **required** skill
fails the phase with a message naming it; optional ones are logged and skipped.
YAML frontmatter is stripped before inlining.

The ref is pinned to a **commit**, not a branch: this is third-party markdown
that goes straight into the system prompt, and a moving ref would let it change
without review. After bumping it, run `bun run opencode-agent:verify-skills` —
that drives the production loader against the actual fetched files, so a renamed
or missing skill fails with the skill named. The workflow runs the same check
before any model credentials are used.

(The skill-name list in `tests/opencode-agent/adapters.test.ts` is a hand-copied
snapshot. It catches a typo in `PHASE_SKILLS`; it cannot see upstream drift.)

`subagent-driven-development` and `writing-skills` are deliberately excluded:
both are 26–28 KB and neither applies to a single-session CI run.

## Setup

1. Repository secret `LLM_API_KEY`.
2. Repository variables `LLM_MODEL` and `LLM_BASE_URL`.
3. Repository variable `AGENT_SELF_LOGIN` — the login the agent comments under.
   Leave it unset for a PAT (derived) or for the job's own `GITHUB_TOKEN`
   (`github-actions[bot]`, the fallback). Set it to `<app-slug>[bot]` for any
   other GitHub App token, which cannot report its own identity. Getting it
   wrong is not silent: the first comment the agent posts logs the mismatch at
   `error`, naming the account it actually posted as.
4. Optionally `AGENT_GITHUB_TOKEN`, a GitHub App installation token. Without it
   the agent's pushes do not trigger CI, so the CI-fix path never runs. It is also
   the token the `resolve` job's `gh api …/pulls/<n>` call uses when it is set, so
   whatever you put there needs to be able to read a pull request in this
   repository.
5. Optionally the repository secret `AGENT_LOG_KEY` — `openssl rand -base64 32`
   — which turns on the encrypted debug transcript and the two links the agent
   comments beside a run. It needs Pages enabled once, under Settings → Pages →
   Source: GitHub Actions, so the `Transcript viewer` workflow has somewhere to
   publish. Leave it unset and nothing about a run changes; see **The debug
   transcript** above. Note that `AGENT_GITHUB_TOKEN` cannot push a workflow
   file unless its App holds the `workflows` permission — which is why the
   agent refuses to commit one at all, see **Files the agent cannot commit**.
6. Actions needs write access to contents, issues and pull requests.
7. **Actions must be allowed to create pull requests.** The `permissions:` block
   in the workflow is not enough on its own: without this, `PR_DELIVERY` fails
   with _"GitHub Actions is not permitted to create or approve pull requests"_ on
   a branch that is already pushed and complete, and no `/retry` can change that.

   The repository setting is Settings → Actions → General → Workflow permissions
   → "Allow GitHub Actions to create and approve pull requests". **If that
   checkbox is greyed out, the organisation owns the setting** and the repository
   cannot override it — change it under the organisation's own Actions settings,
   which unlocks it for every repository in the organisation.

   `AGENT_GITHUB_TOKEN` from step 4 is usually the smaller step: a PAT or App
   installation token is not "GitHub Actions" as far as this rule is concerned,
   so it needs no policy change, and it is what the CI-fix path needs anyway.

   The failure comment names all of this and links a prefilled `compare` URL, so
   the branch can be turned into a pull request by hand meanwhile; `/retry`
   resumes from `PR_DELIVERY` once the token or the setting is in place.

Those grants are workflow-level and unchanged, but only one job takes them. The
`resolve` job names `permissions: pull-requests: read` for itself, which drops
every other scope to `none`: it mounts no model credentials, writes nothing, and
reads exactly one pull request's head. The write access above belongs to `agent`,
which is the job that comments, labels, pushes and opens pull requests.

Nothing to configure for `GITHUB_TOKEN` or `GITHUB_REPOSITORY` — see
**Configuration** above for why the Actions runtime already supplies both.

The workflow lives at `.github/workflows/agent-pipeline.yml`.

### The fallback comment for a job that never spoke

The workflow posts an "Agent job did not finish" comment saying the issue state
is unchanged and inviting a `/retry`. That is only ever true for a job that
stopped with nothing on the issue: an install failure, a runner timeout, a
cancelled job, a config error thrown before the first comment, a crash.

It cannot be gated on `if: failure()` alone, which is what it used to be:
`failure()` selects every red job, and the pipeline exits 1 from six paths that
have already posted their own report — a failed phase, a failed answer, either
over-budget stop, a refused `/retry` and the CI-fix give-up notice. Each of
those drew a second comment contradicting the first, next to a state block that
had just moved to `FAILED`.

So the run step carries `id: pipeline` and the pipeline appends `reported=true`
to `$GITHUB_OUTPUT` for every exit that posted; the fallback step is gated on
`steps.pipeline.outputs.reported != 'true'`. The marker survives the run step's
own exit 1 — the runner processes a step's file commands in a `finally` around
the handler — and the job still goes red, because the exit code is real signal.

Two conditions beside that gate were still too narrow, and both widenings sit
**inside** it, so neither can bring the double comment back:

- The issue number comes from the **`resolve` job**, not from a step in this one,
  because a run that dies in `bun install` — or is cancelled while the model is
  thinking — must still know where to post. It was a step that ran first, and
  "first" was a fact about step order that any later edit could quietly undo;
  reading it from another job makes it structural instead, since nothing can be
  inserted above a job it is not in, and no failure in the `agent` job can take
  away an answer computed before that job existed.

  Three sources now, because the three event kinds carry different things.
  `github.event.issue.number` answers for an issue-triggered run. It is empty on a
  `workflow_run` event, which knows only the branch that went red, so the
  `agent/issue-<n>` suffix of `workflow_run.head_branch` stands in — gating on the
  payload field alone meant a runner that died mid-CI-repair posted nothing
  anywhere. And on a **pull-request comment** that same field is the pull request,
  which is worse than nothing: it is a number no state block lives under, so this
  step would have posted the obituary of a review onto the pull request rather
  than onto the issue that carries the state. It is passed through empty there
  instead, and the head branch read by `gh api …/pulls/<n> --jq .head.ref` stands
  in through exactly the same parse. That parse and `issueNumberFromBranch` must
  agree, so `workflow.test.ts` runs _that script_ against _that function_ over a
  corpus of branch names rather than trusting two hand-written parsers to stay in
  step.

  The `agent` job is then gated on the answer being non-empty. Every path that
  leaves it empty — a CI branch like `agent/issue-x` that passes `startsWith` and
  fails the parse, a `/review` on a pull request the agent did not open — is one
  the pipeline would drop in-process with nothing posted anywhere, so refusing it
  a runner costs no feedback and saves booting a job with every secret mounted.

- `cancelled()` joins `failure()`, which does not select a cancelled job. A run
  that looks hung is a run somebody cancels, and that is precisely the moment
  the issue must not fall silent. The heading followed: "Agent job failed" is
  not true of a cancellation, and "did not finish" is true of every job this
  step now speaks for.

A second `if: always()` step takes the `agent:working` label off, and the
comment above it explains why that has to live in YAML rather than in the
pipeline — see **Watching a run**.

## Local runs

```bash
GITHUB_REPOSITORY=acme/widgets \
GITHUB_TOKEN=ghp_… \
LLM_API_KEY=sk-… \
LLM_MODEL=gpt-5 \
LLM_BASE_URL=https://api.openai.com/v1 \
AGENT_SELF_LOGIN=opencode-agent \
bun run opencode-agent/src/index.ts \
  --event-path ./fixtures/issue-opened.json \
  --event-name issues \
  --repo-root . \
  --log-level debug
```

A minimal `issues.opened` payload:

```json
{
  "action": "opened",
  "sender": { "login": "maintainer", "type": "User" },
  "issue": {
    "number": 42,
    "title": "Add retries to the HTTP client",
    "body": "Requests should retry twice on 5xx.",
    "author_association": "COLLABORATOR"
  },
  "repository": {
    "owner": { "login": "acme" },
    "name": "widgets",
    "default_branch": "main"
  }
}
```

`repository.default_branch` is what the pipeline forks from — set it to the
branch your checkout actually has, or drop the whole `repository` object and let
it read `origin/HEAD` from the checkout.

For the CI-fix path, pass a `workflow_run` payload with
`--event-name workflow_run`.

Exit code is `0` for skipped/waiting/completed, `1` only when a phase failed.
Logs are NDJSON on stdout.

`$GITHUB_OUTPUT` is absent on a local run, so the `reported` marker described
under **Setup** is simply not written. Nothing else changes.

## Module map

| File                                          | Responsibility                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `src/index.ts`                                | CLI entry: flags, config, dependency wiring, agent teardown, exit code  |
| `src/agent-handle.ts`                         | The OpenCode session's lifetime within one job                          |
| `src/orchestrator.ts`                         | The state machine: guardrails and the phase cascade                     |
| `src/trigger-events.ts`                       | What a raw webhook payload becomes, for each of the three kinds         |
| `src/pr-trigger.ts`                           | Resolving a command typed on a pull request back to its issue           |
| `src/triggers.ts`                             | Turning a command or comment into the state move to make                |
| `src/ci-trigger.ts`                           | Whether a red check run buys a fix round, a notice, or nothing          |
| `src/run-report.ts`                           | What the orchestrator says: a failure, a park, a refusal, a closing     |
| `src/run-post.ts`                             | The two writes: the durable one that carries the record, and an answer  |
| `src/budget-notices.ts`                       | What a run says when a ceiling stopped it and nothing broke             |
| `src/pull-request-body.ts`                    | The pull request's own body, for a delivery and after a review alike    |
| `src/presentation.ts`                         | One glyph, label, headline and whose-turn per state an issue can be in  |
| `src/outcomes.ts`                             | The second vocabulary: one glyph per outcome a comment announces        |
| `src/feedback.ts` / `src/labels.ts`           | The reaction channel, and the label reconcile                           |
| `src/feedback-target.ts`                      | Which of the issue and its pull request a run speaks on, and takes from |
| `src/status-comment.ts` / `-reporter.ts`      | What the run's live comment says, and when it is edited                 |
| `src/state-persist.ts`                        | Recording what a run spent without posting a comment                    |
| `src/step-output.ts`                          | The one thing a run tells the rest of its own workflow job              |
| `src/token-budget.ts`                         | The per-issue token ceiling, and how a run over it parks in `FAILED`    |
| `src/time-budget.ts`                          | The job's own wall clock, and how a run out of it parks in `INCOMPLETE` |
| `src/state-manager.ts`                        | The `AGENT_STATE` block: rendering it, and restoring it from a thread   |
| `src/transitions.ts`                          | The machine: which signals a phase accepts, and what each one does      |
| `src/blocks.ts` / `src/artifacts.ts`          | The hidden-block channel and the spec/plan/report artefacts             |
| `src/plan-steps.ts`                           | What a plan step is, and the markdown a plan's own steps render into    |
| `src/phases/implement-steps.ts`               | Walking those steps: a turn, a commit, a push, and then the clock       |
| `src/implement-prompts.ts`                    | What the model is told while implementing, and asked when interrupted   |
| `src/turn-stop.ts` / `src/salvage.ts`         | Stopping a turn part-way through, and keeping what it had written       |
| `src/time-notices.ts`                         | What a run says when the job's own wall clock stopped it                |
| `src/phase-names.ts`                          | What a phase is called, including what it used to be called             |
| `src/guardrails.ts`                           | Every abort rule, for each of the three kinds of event                  |
| `src/commands.ts` / `src/intent.ts`           | Slash commands, and classifying plain replies                           |
| `src/openai-config.ts`                        | The single endpoint, and the OpenCode config both paths share           |
| `src/opencode-adapter.ts`                     | Headless OpenCode server + session                                      |
| `src/ask-json.ts`                             | Asking the model for JSON, with one repair re-ask on a bad reply        |
| `src/prompt-budget.ts`                        | How much text a prompt carries, and what loses when it does not fit     |
| `src/activity.ts`                             | What one OpenCode event means, and what of it may be said out loud      |
| `src/activity-detail.ts`                      | The whitelist decoder feeding the encrypted transcript, and only it     |
| `src/progress.ts`                             | Reporting that as `▸`/`✓` lines, and the summary a heartbeat reads      |
| `src/heartbeat.ts`                            | "Still going" at a fixed interval while a turn is outstanding           |
| `src/ci-groups.ts`                            | The one module allowed to spell Actions' `::group::` commands           |
| `src/debug-transcript.ts`                     | The encrypted maintainer-only run log, when `AGENT_LOG_KEY` is set      |
| `src/protected-paths.ts`                      | Paths a push by this pipeline cannot carry, dropped before the commit   |
| `src/sdk-contract.ts`                         | The recorded request and response shapes the SDK speaks                 |
| `src/config-values.ts`                        | Reading and range-checking one scalar from the environment              |
| `src/check-spec.ts`                           | `AGENT_CHECKS`, the one config reading that parses a document           |
| `src/config-discovery.ts`                     | The two settings asked of the checkout and the event, not the env       |
| `src/deadline.ts`                             | The upper bound on waiting for work that has none of its own            |
| `src/provider-proxy.ts`                       | Holds the provider key, and retries a transient upstream failure        |
| `src/obra-skills.ts`                          | Superpowers skill loading and system-prompt composition                 |
| `src/review-runner.ts`                        | Drives the `review-loop/` workspace                                     |
| `src/check-loop.ts`                           | The CI-fix repair loop                                                  |
| `src/phases/*.ts`                             | One handler per acting phase; `review.ts` is the review loop's own      |
| `src/github-pulls.ts`                         | Pull-request endpoints, and what became of a branch's pull request      |
| `src/github.ts`, `src/git.ts`, `src/shell.ts` | Octokit, git and process boundaries                                     |

## Tests

```bash
bun run opencode-agent:test
bun run opencode-agent:typecheck
bun run opencode-agent:lint

# Opt-in: drives a real `opencode serve` against a stub OpenAI endpoint.
# Needs the opencode CLI on PATH; no model credentials.
bun run opencode-agent:test:live
```

Tests live in `tests/opencode-agent/`. Every external boundary — GitHub, git, the
OpenCode session, the check runner, the review-loop subprocess, the filesystem —
is an injected interface, so the state machine runs against fakes with no
network.

## Known limitations

- The SDK contract is verified against a live `opencode serve` 1.18.7, but only
  at that version. When the pin moves, re-run `bun run opencode-agent:test:live`
  to confirm — and re-record the fixtures in `adapters.test.ts` from it.
- Review-loop failures are reported, not enforced. The branch is pushed and the
  pull request opened before a review has run at all, so a red loop cannot block
  a delivery that already happened; what it does is post its report on the issue
  and into the pull request body, and the phase still completes. CI on the pull
  request is the real gate, and the CI-fix loop is what acts on it. A finding the
  loop could not fix is something for a human to read, not a reason to park an
  issue whose work is pushed.
- A `/review` on a pull request that the resolver turns down is **silent**. A
  fork's `agent/issue-42`, a closed or merged pull request, a branch the agent
  never opened: each is a `warn` in the Actions log and nothing else — not a
  comment, not even the 👀, because the event is dropped before the guardrails and
  the reaction channel are reached at all. For the fork that is the point, since
  it must be handed no write of any kind; for the other two it is simply the cost
  of resolving before acting. A refused command on the issue answers on the issue,
  and this door has no equivalent.
- A **failed** head lookup posts nothing either, and that one is a gap rather than
  a decision. `gh api …/pulls/<n>` in the `resolve` job is deliberately not
  best-effort — it is what names the issue and what the fork guard reads — so a
  rejection fails that job, and the "Agent job did not finish" comment lives in
  `agent`, which `needs: resolve` then skips. Whoever typed `/review` sees a red
  workflow run and no acknowledgement anywhere.
- Bumping `STATE_VERSION` strands in-flight issues — old blocks fail validation,
  and the scan walks back to an older valid one or to a fresh state. Drain before
  bumping, or write a migration.
- Spend is bounded in **tokens per issue** (`AGENT_MAX_TOKENS`), never in
  currency, for the reason given under **What bounds a run**. That ceiling
  cannot see the review loop's `opencode run` subprocesses, and moving the loop
  into `CODE_REVIEW` did not change that — it only moved the blind spot behind a
  command. A repository whose review loop is the expensive half is bounded by
  `AGENT_MAX_REVIEW_ATTEMPTS` (which exists for this reason), the loop's own
  round caps and the job timeout, and not by the token budget.
- A run killed outright — an OOM kill, a cancelled job, a runner past
  `timeout-minutes` — loses every phase report it had collected, because the
  reply is posted once at the end and the `finally` that posts it never runs. A
  throw is covered (the flush is in that `finally`) and so is a wall-clock stop
  (`teardownReserveMs` holds time back for the write); a SIGKILL is not. The
  workflow's fallback comment is what explains the silence, and the encrypted
  transcript is what reconstructs the run. `agent:working` is the labelling half
  of the same problem and does get repaired, twice over.
- Feedback is best-effort in one function per channel, which means a channel
  that is broken — a token without `issues: write`, an organisation policy, or a
  bug inside the reconcile — degrades to a `log.warn` and nothing else. The run
  is unaffected, which is the point, but nobody finds out without reading the
  Actions log.
- Capability containment is config-level (see above), not process-level: there is
  no container or network boundary around the model — the last direction of
  `ROADMAP.md` S3-2 still open.
