<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# opencode-agent — GitHub Actions issue agent (spike)

An event-driven coding agent that lives in GitHub Actions. A maintainer opens an
issue; the agent writes a design spec, discusses it, plans the work, discusses
that, implements it on `agent/issue-<n>`, runs the repository's own review loop,
and opens a pull request — then fixes that pull request when its checks go red.
Every step runs in its own short-lived job; nothing long-polls.

> **Spike status.** This is a proof of concept, not a hardened product. See
> `ROADMAP.md` for the open findings, including the ones that still matter.

## How the ephemeral model works

An Actions job has no memory of the previous one, so state lives on the issue in
hidden HTML blocks:

- `<!-- AGENT_STATE: … -->` — phase and counters. Rewritten on every comment.
- `<!-- AGENT_SPEC: … -->` — the current design spec.
- `<!-- AGENT_PLAN: … -->` — the current execution plan.
- `<!-- AGENT_REPORT: … -->` — the implementation report.

Artefacts get their own blocks rather than being scraped back out of the visible
markdown. That is not a style preference: a spec is model-written markdown full
of headings and `---` rules, and any heading-and-trailer scraping truncates it at
the first horizontal rule.

The spec and the plan are numbered **separately**, each by its own revisions: the
first spec is "Design spec (revision 1)" and the first plan is "Execution plan
(revision 1)", whether or not the spec was revised on the way there. `AGENT_STATE`
carries a counter each (`specRevision`, `planRevision`), and the number in a
heading is the number in that artefact's own block — one value renders both. A
single shared counter used to bump on either artefact, so the numbers interleaved
and the first plan on a straight-through issue called itself revision 2. Both
counters default, so blocks written before the split still parse; an issue
mid-conversation across that change restarts its counts at 1, because the number
it was carrying was the sum of two artefacts and never the count of either.
`AGENT_REPORT` carries the revision of the plan it implemented — provenance, not
a count of reports.

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

| Phase               | Trigger                                   | What happens                                                          | Ends at                                   |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| `INIT_OR_CLARIFY`   | issue opened, or a reply while clarifying | Reads the issue and thread, explores the repo                         | Questions (stays here) or a design spec   |
| `DESIGN_SPEC`       | —                                         | Waiting. The spec is under review                                     | `/approve`, `/changes`, `/ask`, `/cancel` |
| `EXECUTION_PLAN`    | spec approved                             | Planning skills produce a step breakdown; cuts `agent/issue-<n>`      | Plan posted                               |
| `PLAN_REVIEW`       | —                                         | Waiting. The plan is under review                                     | `/approve`, `/changes`, `/ask`, `/cancel` |
| `REVIEW_AND_MUTATE` | plan approved                             | Implements, runs the `review-loop/` workspace, commits **and pushes** | Changes pushed                            |
| `PR_DELIVERY`       | automatic                                 | Opens or refreshes the PR with `Closes #<n>`                          | PR opened                                 |
| `CI_FIX`            | a red check run on `agent/issue-<n>`      | Reproduces CI locally, repairs, pushes                                | Fix pushed                                |
| `COMPLETE`          | —                                         | Terminal, but re-enterable from `CI_FIX`                              | —                                         |
| `FAILED`            | any _phase_ handler throwing              | Failure comment posted, `resumeFrom` recorded                         | `/retry` or `/cancel`                     |

There are two review gates, not one. The spec and the plan are each parked in
front of a human before anything downstream is spent.

## Talking to the agent

| Command                     | Valid in                     | Effect                                                         |
| --------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `/approve`                  | `DESIGN_SPEC`, `PLAN_REVIEW` | Proceed to the next phase                                      |
| `/changes <what to change>` | `DESIGN_SPEC`, `PLAN_REVIEW` | Rewrite the spec or plan, with your feedback in the prompt     |
| `/ask <question>`           | anywhere                     | Answer, grounded in the repo, without moving the state machine |
| `/retry`                    | `FAILED`                     | Resume the exact phase that failed                             |
| `/cancel`                   | anything but `COMPLETE`      | Stop for good — a cancelled issue cannot be restarted          |

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
4. The maintainer replies `/approve`. The agent moves to `EXECUTION_PLAN`,
   cuts `agent/issue-42` from the default branch, and posts a step-by-step
   plan; `PLAN_REVIEW` waits for another `/approve`.
5. Once approved, `REVIEW_AND_MUTATE` implements the plan, runs this
   repository's own `review-loop/` workspace against the diff, and pushes to
   `agent/issue-42`.
6. `PR_DELIVERY` opens a pull request carrying `Closes #42`.
7. CI runs on the branch — only if `AGENT_GITHUB_TOKEN` is configured, see
   **Red pull requests** below — and comes back red. The `workflow_run` event
   brings the agent back into `CI_FIX`: it checks out the branch, reproduces
   the failing checks locally, hands the real output to the model, and
   pushes a fix. This repeats, bounded by `AGENT_CI_FIX_MAX_ROUNDS` and
   `AGENT_MAX_CI_ATTEMPTS`, until CI is green or the budget runs out.
8. A maintainer merges the pull request like any other. `COMPLETE` stays
   re-enterable from `CI_FIX`, in case a later push retriggers a check.

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

Two budgets bound it. `AGENT_CI_FIX_MAX_ROUNDS` caps repair rounds within one
job; `AGENT_MAX_CI_ATTEMPTS` caps rounds across the pull request's whole life, so
a genuinely broken branch cannot bounce between the agent and CI forever. The
agent's own workflow is excluded, so its failures never feed itself.

When that lifetime budget runs out the agent says so on the issue, once, naming
the pull request — it does not simply stop. Later red runs are then ignored
silently, because CI fires on every push and repeating the notice would be spam.

That budget is **per pull request**, not per issue: opening a _new_ pull request
resets both the spent rounds and the "I have stopped trying" flag, so the second
delivery gets its own rounds and can say its own piece. Refreshing the pull
request that is already open does not reset anything — it is the same branch and
the same commits whose checks spent the rounds, and handing it a clean slate is
how one broken branch bounces off the agent for as long as anyone keeps replying
`/retry`.

> **This path only fires if CI runs on the agent's branch.** Pushes made with the
> default `GITHUB_TOKEN` deliberately do not trigger other workflows. Set
> `AGENT_GITHUB_TOKEN` to a GitHub App installation token or a PAT if you want
> CI — and therefore CI fixing — to happen at all.

## The review loop is the repository's own

Phase 3 does not implement a review loop; it drives the `review-loop/` workspace
that already lives in this repo, via `bun run review-loop/src/cli.ts --config …
--plan …`. That workspace owns the hard parts — a durable issue ledger,
reviewer/fixer rounds, worktree isolation, a build gate, and a merge back into
the working branch — and it is separately tested. `review-runner.ts` only
generates its config, hands over the approved plan, and translates the exit code.

The `mutation-improve/` workspace is deliberately _not_ wired in: it selects
files and opens its own pull requests, which would conflict with a pipeline whose
job is to open one. Run it separately.

The workspace is **detected, not assumed**. A checkout without `review-loop/` has
no review configured — which is a different thing from a review that failed — and
the implementation report says so rather than showing a permanently red review.
Point `AGENT_REVIEW_COMMAND` at your own reviewer to change that, or set it to
`none` to skip the step deliberately.

`check-loop.ts` remains, but only for CI fixing — "make these named commands
green" is a different problem from "review this diff", and the workspace does not
cover it.

## What bounds a run

Four bounds, each on a different kind of runaway.

| Bound            | Where                                              | What it stops                                                             |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| Prompt size      | `prompt-budget.ts`                                 | 12k characters of thread, and 12k across _all_ failing checks, per prompt |
| Turn duration    | `AGENT_TIMEOUT_MS`, applied in `deadline.ts`       | A model turn that never answers                                           |
| Provider hiccups | `provider-proxy.ts` — 3 attempts, with backoff     | A single 429 or 5xx failing the phase                                     |
| Rounds           | `AGENT_MAX_ATTEMPTS`, `AGENT_CI_FIX_MAX_ROUNDS`, … | An agent and CI bouncing off each other forever                           |
| Total spend      | `AGENT_MAX_TOKENS`, per **issue**                  | An issue quietly costing more than it is worth                            |

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

Three things it cannot see: the review loop's `opencode run` subprocesses, which
have their own sessions; any spend before the first prompt of a job; and the turn
that classifies a plain maintainer comment as needing no action. That last one is
a deliberate residual. Classification happens before any phase runs, and when it
answers "no action" the run posts nothing — replying to every "thanks!" would be
spam — so there is no comment for a state block to ride on. What the agent does
instead is refuse to pay for it: once an issue is over budget the comment goes
straight to the answer path, which reports the ceiling without a model turn, so a
maxed-out issue stops buying a classification per comment.

## Watching a run

A phase that runs for twenty minutes emitting nothing is, in a CI log,
indistinguishable from a hang — and the usual response to a job that looks hung
is to cancel it. So the log says what is happening:

```
Model tool call        { tool: "read", status: "running", call: "call_1" }
Model step finished    { inputTokens: 1200, outputTokens: 340, cost: 0.004 }
Still waiting on the model; the job is not stuck
                       { elapsedMs: 60011, lastAction: "read (running)", toolCalls: 7, tokens: 41200, cost: 0.31 }
```

Two halves, answering different questions. OpenCode's event stream says **what**
the model is doing, and only fires when something happens. The heartbeat, once a
minute while a turn is outstanding, says it is **still** doing it — which is the
only thing that distinguishes slow from dead during a single long model call
that uses no tools.

**Progress never carries content.** Not tool input, not tool output, not the
model's text, not the provider's error message on a retry — only names, statuses
and counts. That is enforced by the decoding schemas rather than by care: they
name the scalar fields they want and drop everything else, so there is nowhere
for a `bash` command or a file's contents to land. It matters more here than
elsewhere: a CI log is world-readable on a public repository and is **not**
covered by the outbound redaction that guards issue comments.

Token and cost totals ride along, per step and in every heartbeat. That is
visibility, not a ceiling — see `ROADMAP.md` S5-6.

## Guardrails

Applied in `src/guardrails.ts`, and mirrored as a first-pass `if:` in the
workflow so an unauthorized event never boots a runner with keys mounted.

Human events: supported event and action only; no comments on pull requests; no
`Bot` senders; nothing from the agent's own login; and the author association
must be `OWNER`, `MEMBER`, or `COLLABORATOR` — read from the _commenter_, not the
issue author.

CI events: the run must have concluded `failure`, **on this repository**, on a
branch matching `agent/issue-<n>`, from a workflow that is not this one.

The repository check is the one that is not bookkeeping. `head_branch` carries a
fork's branch name verbatim, so a pull request opened from a branch called
`agent/issue-42` produces a payload that passes every other test — and would
start a privileged job that prompts the model, spends the issue's token budget
and pushes a commit to a real agent branch.

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

| Variable                                   | Required | Default                                         | Purpose                                               |
| ------------------------------------------ | -------- | ----------------------------------------------- | ----------------------------------------------------- |
| `LLM_API_KEY`                              | yes      | —                                               | Model credentials                                     |
| `LLM_MODEL`                                | yes      | —                                               | Model name, e.g. `gpt-5`                              |
| `LLM_BASE_URL`                             | yes      | —                                               | Any OpenAI-compatible endpoint                        |
| `GITHUB_TOKEN`                             | no       | the job's own `secrets.GITHUB_TOKEN`            | Comments, branches, pull requests; see below          |
| `GITHUB_REPOSITORY`                        | no       | the job's own `owner/repo`                      | `owner/repo`; see below                               |
| `AGENT_SELF_LOGIN`                         | no       | derived from the token                          | Login the agent posts as; see above                   |
| `AGENT_WORKFLOW_NAME`                      | no       | `OpenCode Issue Agent`                          | This workflow's name, for the CI recursion guard      |
| `AGENT_BASE_BRANCH`                        | no       | detected                                        | Branch the PR targets; see below                      |
| `AGENT_CHECK_COMMAND`                      | no       | `bun run lint && bun run typecheck && bun test` | review-loop's build gate                              |
| `AGENT_REVIEW_COMMAND`                     | no       | detected                                        | JSON argv running the review loop; `none` disables it |
| `AGENT_CHECKS`                             | no       | lint / typecheck / test                         | JSON `[{ "name", "argv" }]` the CI-fix phase runs     |
| `AGENT_REVIEW_MAX_ROUNDS`                  | no       | `4`                                             | review-loop rounds                                    |
| `AGENT_REVIEW_POOL_SIZE`                   | no       | `2`                                             | review-loop worker pool                               |
| `AGENT_CI_FIX_MAX_ROUNDS`                  | no       | `2`                                             | Repair rounds per CI-fix job                          |
| `AGENT_MAX_CI_ATTEMPTS`                    | no       | `3`                                             | CI-fix jobs per pull request                          |
| `AGENT_MAX_ATTEMPTS`                       | no       | `3`                                             | Failures before `/retry` stops resuming               |
| `AGENT_MAX_CHANGED_FILES`                  | no       | `100`                                           | Files one commit may carry                            |
| `AGENT_MAX_CHANGED_LINES`                  | no       | `20000`                                         | Lines one commit may change                           |
| `AGENT_TIMEOUT_MS`                         | no       | `1800000`                                       | Timeout for one model turn, and for each subprocess   |
| `AGENT_MAX_TOKENS`                         | no       | `5000000`                                       | Model tokens one issue may spend, across all its jobs |
| `AGENT_COMMIT_NAME` / `AGENT_COMMIT_EMAIL` | no       | `opencode-agent[bot]`                           | Commit identity                                       |
| `AGENT_LOG_LEVEL`                          | no       | `info`                                          | `debug`, `info`, `warn`, `error`                      |

`LLM_MODEL` and `LLM_BASE_URL` are both required rather than defaulted: with a
model gateway that is not necessarily OpenAI's own, there is no base URL or
model name that is right by default, and a wrong guess surfaces deep inside the
first model call instead of at config load. A default of
`https://api.openai.com/v1` used to stand in for `LLM_BASE_URL`, which made a
forgotten value indistinguishable from a deliberate one; this pipeline is built
around one arbitrary configured endpoint, not OpenAI specifically, so there is
no endpoint that is right unless someone said so.

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
`AGENT_REVIEW_POOL_SIZE` accepts 1–16. `AGENT_TIMEOUT_MS=1`
is a positive integer that kills every subprocess after a millisecond, so the
pipeline reports every check as failing; `AGENT_REVIEW_MAX_ROUNDS=9007199254740991`
is a positive integer that removes the bound the knob exists to impose. A
rejection names the range, so a legitimate need for a wider one is not a
guessing game.

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
   the agent's pushes do not trigger CI, so the CI-fix path never runs.
5. Actions needs write access to contents, issues and pull requests.

Nothing to configure for `GITHUB_TOKEN` or `GITHUB_REPOSITORY` — see
**Configuration** above for why the Actions runtime already supplies both.

The workflow lives at `.github/workflows/agent-pipeline.yml`.

### The fallback failure comment

The workflow's last step posts an "Agent job failed" comment saying the issue
state is unchanged and inviting a `/retry`. That is only ever true for a job
that died with nothing on the issue: an install failure, a runner timeout, a
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

| File                                          | Responsibility                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `src/index.ts`                                | CLI entry: flags, config, dependency wiring, agent teardown, exit code |
| `src/orchestrator.ts`                         | The state machine: guardrails and the phase cascade                    |
| `src/triggers.ts`                             | Turning a command or comment into the state move to make               |
| `src/ci-trigger.ts`                           | Whether a red check run buys a fix round, a notice, or nothing         |
| `src/run-report.ts`                           | Everything the orchestrator writes back to the issue                   |
| `src/step-output.ts`                          | The one thing a run tells the rest of its own workflow job             |
| `src/token-budget.ts`                         | The per-issue token ceiling, and how a run over it parks in `FAILED`   |
| `src/state-manager.ts`                        | Transition table and the `AGENT_STATE` block                           |
| `src/blocks.ts` / `src/artifacts.ts`          | The hidden-block channel and the spec/plan/report artefacts            |
| `src/guardrails.ts`                           | Payload normalization (issue vs CI) and every abort rule               |
| `src/commands.ts` / `src/intent.ts`           | Slash commands, and classifying plain replies                          |
| `src/openai-config.ts`                        | The single endpoint, and the OpenCode config both paths share          |
| `src/opencode-adapter.ts`                     | Headless OpenCode server + session                                     |
| `src/ask-json.ts`                             | Asking the model for JSON, with one repair re-ask on a bad reply       |
| `src/prompt-budget.ts`                        | How much text a prompt carries, and what loses when it does not fit    |
| `src/activity.ts`                             | What one OpenCode event means, and what of it may be said out loud     |
| `src/progress.ts`                             | Reporting that, plus the heartbeat while a turn is outstanding         |
| `src/sdk-contract.ts`                         | The recorded request and response shapes the SDK speaks                |
| `src/config-values.ts`                        | Reading and range-checking one scalar from the environment             |
| `src/deadline.ts`                             | The upper bound on waiting for work that has none of its own           |
| `src/provider-proxy.ts`                       | Holds the provider key, and retries a transient upstream failure       |
| `src/obra-skills.ts`                          | Superpowers skill loading and system-prompt composition                |
| `src/review-runner.ts`                        | Drives the `review-loop/` workspace                                    |
| `src/check-loop.ts`                           | The CI-fix repair loop                                                 |
| `src/phases/*.ts`                             | One handler per acting phase                                           |
| `src/github.ts`, `src/git.ts`, `src/shell.ts` | Octokit, git and process boundaries                                    |

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
- Review-loop failures are reported, not enforced: the branch is pushed and the
  pull request opened with a red report. CI on the pull request is the real gate,
  and the CI-fix loop is what acts on it.
- Bumping `STATE_VERSION` strands in-flight issues — old blocks fail validation,
  and the scan walks back to an older valid one or to a fresh state. Drain before
  bumping, or write a migration.
- No cost ceiling beyond the round caps and the job timeout.
- Capability containment is config-level (see above), not process-level: there is
  no container or network boundary around the model, and the repository token is
  still in `.git/config` — see `ROADMAP.md` S3-7.
