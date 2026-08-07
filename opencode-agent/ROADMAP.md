<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# opencode-agent — follow-up roadmap

> **Status update.** A follow-up change addressed several of the findings below
> while reworking the pipeline (OpenAI-only credentials, fetched superpowers
> skills, the real `review-loop/` workspace, CI-failure retries, and a
> conversational review flow). Resolved items are marked **[FIXED]** inline with
> a one-line note. Everything unmarked still stands — in particular **S1-5**
> (the OpenCode SDK response shapes remain unverified against a live server) and
> the whole of **S3** except S3-1.

Findings from a file-by-file audit of the spike as committed on
`claude/github-actions-opencode-agent-807fjo`. **Report only — nothing here is
fixed.**

## Method and confidence

Every source file, the workflow, the tests and the repo wiring were read line by
line. Claims marked **verified** were reproduced with a throwaway test or a
command; the rest are read-only reasoning and are marked **by inspection**.

Coverage numbers quoted below come from `bun test tests/opencode-agent
--coverage`. The suite is green (173 tests) and `lint`, `typecheck`,
`format:check`, `license-headers` and `knip` all pass — none of the findings
here are caught by the current gates, which is itself part of the finding.

Severity:

| Level  | Meaning                                                                              |
| ------ | ------------------------------------------------------------------------------------ |
| **S1** | Will misbehave on the first real run. Fix before pointing this at a live repository. |
| **S2** | Correctness bug with a real trigger, but a narrower blast radius.                    |
| **S3** | Security / containment gap.                                                          |
| **S4** | Gap against the spike spec, dead code, or a broken abstraction.                      |
| **S5** | Robustness, cost and operability.                                                    |
| **S6** | Test and tooling coverage.                                                           |

---

## S1 — Blockers

### S1-1 `/cancel` is a silent no-op; the issue stays live — **verified** — **[FIXED]**

_Fixed and independently re-verified. The terminal path now posts whenever the
trigger moved the state and no handler wrote it down (`orchestrator.ts` `settle`,
guarded by a `posted` flag) — the class fix, not just the `/cancel` instance.
Regression coverage asserts the persisted state, not only the returned status.

A follow-up defect **in that fix** was also corrected: the closing comment
invited the maintainer to "comment again to restart the conversation", but
`COMPLETE` accepts no command and no plain comment, so the machine answered
`No actionable command while in COMPLETE`. The wording now states plainly that
further comments will not restart the agent._

**Still open, by design:** `/cancel` is irreversible. Resuming a cancelled issue
would need `CANCELLED` to record the phase it cancelled from and `/retry` to be
admitted from `COMPLETE` — but only for the cancelled case, never for a
delivered one, where a retry would re-run implementation over a shipped pull
request. That is a feature decision, not part of this fix.

`src/orchestrator.ts:93-107` transitions the state to `COMPLETE`, then
`driveMachine` (`:122-130`) finds no handler for `COMPLETE` and returns
`completed` **without ever calling `postAndAppend`**. No comment is posted, so
no state block is written, so the next event restores the _pre-cancel_ state
from the older spec comment.

Reproduced: after `/cancel` on an issue parked in `DESIGN_SPEC`, zero comments
were posted, and a subsequent `/approve` on the same thread was accepted and ran
the plan phase. Cancelling does nothing at all.

Every other command lands in a phase that _has_ a handler, so the handler posts
and persists on its way through. `/cancel` is the only command whose target
phase is terminal, which is exactly why it falls through the hole.

The existing test (`tests/opencode-agent/orchestrator.test.ts`, "`/cancel` parks
the issue in COMPLETE without doing more work") asserts only the returned status
and that no git calls happened — it passes while the behaviour is broken.

**Direction:** make the terminal path post its own acknowledgement, or more
generally have `driveMachine` persist state whenever `applyCommand` changed the
phase and no handler will do it. The second is the real fix — it closes the
whole class rather than the one instance.

### S1-2 Resuming `PR_DELIVERY` on a fresh runner cannot work — by inspection — **[FIXED]**

_Fixed and verified. Phase 3 commits **and pushes**, so the work is durable
before the phase that made it returns; `PR_DELIVERY` makes zero `deps.git` calls
and derives its branch from `branchNameFor(issueId)` rather than the persisted
`state.branch`. The phase boundary now matches the durability boundary, which is
what `resumeFrom` always assumed.

Regression coverage closes **S6-2** at the same time: a `hostileGit()` fake that
throws on every operation drives a full resume — delivery fails once, the state
parks at `resumeFrom: PR_DELIVERY`, and a fresh runner with no working tree
retries and opens the pull request. Both new tests were mutation-checked by
reintroducing the original defects (a `git.push` in delivery, and a push ordered
before the last commit); each test goes red, so neither is vacuous._

`src/phases/deliver.ts:18-34` calls `deps.git.push(branch)` without first
calling `ensureBranch`. That is correct only when phase 4 runs in the same job
as phase 3, which created the branch and the commit locally.

On `/retry` after a `PR_DELIVERY` failure, the runner is brand new: the working
tree is a fresh checkout of the default branch and `agent/issue-N` does not
exist locally. `git push -u origin agent/issue-N` fails with `src refspec ... does
not match any`, so the retry fails identically, forever, until the attempt
budget runs out.

The deeper issue is that `resumeFrom` records a phase, but phases 3 and 4 depend
on **ephemeral working-tree state that no longer exists**. Resuming
`REVIEW_AND_MUTATE` has the same problem in reverse: the previous run's local
commit died with its container, so the work is silently redone from scratch.

**Direction:** push at the end of `REVIEW_AND_MUTATE` so the branch is durable,
and make `PR_DELIVERY` purely API-side with no git at all. That makes the phase
boundary match the durability boundary, which is what `resumeFrom` assumes. As a
stopgap, `handleDeliver` calling `ensureBranch` first at least stops the crash,
but it does not recover the lost commit.

### S1-3 The clarification loop is unreachable in CI — by inspection — **[FIXED]**

_Fixed and verified. The workflow no longer filters `issue_comment` on slash
commands, so a plain reply — a clarifying answer, a question, a change request —
reaches the pipeline and the in-process guardrails decide what to do with it.

This also closes **S6-8**, partly. `tests/opencode-agent/workflow.test.ts` parses
the workflow and pins its trigger surface: the job condition carries no
comment-body filter, the maintainer check reads the _commenter's_ association
before the issue author's, CI events are admitted only when red and on an agent
branch, and machine events are not asked for an author association. Both the
comment-body guard and the concurrency guard were mutation-checked against the
reintroduced defects.

A second workflow bug surfaced while verifying this one and is fixed here: the
concurrency group keyed issue events on the issue number and CI events on the
branch, so `opencode-agent-42` and `opencode-agent-agent/issue-42` were different
groups. A CI-fix run and a maintainer-triggered run for the same issue did not
serialize, and both push the same branch. Both kinds now resolve to the branch
name via `format()`._

`src/phases/triage.ts:58` tells the maintainer "Reply in this thread and I will
pick it up from there", and `src/orchestrator.ts:94-96` implements exactly that:
a comment with no slash command re-runs triage while in `INIT_OR_CLARIFY`. There
is a passing test for it.

But `.github/workflows/agent-pipeline.yml:40-44` only starts a job when the
comment contains `/approve`, `/replan`, `/retry` or `/cancel`. A plain reply
answering the agent's questions never boots a runner. **The documented, tested,
advertised clarification flow cannot happen in production.**

**Direction:** either drop the command filter for `issue_comment` (accepting a
runner boot per maintainer comment — the in-process guard already skips
correctly), or gate on the issue carrying a state block, or introduce an
explicit `/answer` command and change the prompt text to match. The current
split is the worst of the three because the code and the docs both claim a
behaviour the deployment forbids.

### S1-4 A spec or plan containing `---` is silently truncated — **verified** — **[FIXED]**

_Fixed in two steps. The first moved artefacts out of heading-scraped prose into
hidden blocks (`blocks.ts` / `artifacts.ts`); `thread.ts` is deleted.

That was not sufficient, and verifying it found the same defect one layer down.
`JSON.stringify` does not escape `-->`, and the block pattern is non-greedy, so a
payload containing `-->` terminated its own block — the truncation had moved from
`---` to `-->`, not gone. Both live consequences were reproduced: a spec with a
mermaid diagram (`A --> B`) became unreadable, and a `lastError` carrying a
compiler diagnostic (`--> src/a.rs:3:9`) destroyed the **state** block outright,
which is worse than losing an artefact because the next job then restarts a live
issue from phase one.

`renderBlock` now escapes every `<` and `>` as a JSON unicode escape. Both
characters occur only inside string literals — JSON's structural syntax has
neither — so the replacement is safe on the serialized form and `JSON.parse`
decodes it back exactly. A payload can no longer forge its own delimiter.

Eight regression tests cover the class (terminator, mermaid arrow, compiler
diagnostic, opening marker, a forged block of the payload's own, angle brackets,
a literal `\u003C` in the text, and the state-block cases), and were
mutation-checked by removing the escape: six go red._

`src/thread.ts:13` defines `TRAILER_PATTERN = /\n---\n[\S\s]*$/u` and `:46`
applies it to strip the agent's trailing call-to-action. It strips from the
**first** `\n---\n` to the end of the body.

A horizontal rule is ordinary markdown and extremely common in a generated
design spec. Reproduced: a spec reading
`Goal: do the thing.\n\n---\n\n## Files\n\n- src/a.ts` is recovered as just
`Goal: do the thing.` — the planning phase receives a mutilated spec and never
knows.

The same applies to the execution plan, and to the implementation report on its
way into the PR body (a lint log containing `---` truncates it).

**Direction:** stop parsing prose. Persist the spec, plan and report in the
state block (or in dedicated `<!-- AGENT_SPEC: ... -->` blocks) instead of
recovering them by heading and stripping decorations. Comment-scraping is the
fragile part of the whole design; the hidden-block channel already exists and is
schema-validated.

### S1-5 The OpenCode SDK response shapes are guesses, and untested — by inspection

`src/opencode-adapter.ts:118-152` probes for a session id at `.id` _or_
`.data.id`, and for reply text at `.parts` _or_ `.data.parts`. Those are
defensive guesses, not verified contracts. Lines 126-149 — `readSessionId` and
the entire `connectSdk` real-SDK path — are at **0% coverage**; every test
injects a fake `connect`.

If both guesses are wrong, `collectText` returns `''`, `parseModelJson` throws
"Model reply contained no JSON object", and **every run fails in triage** with a
message that points at the model rather than at the adapter.

`createOpencodeServer({ hostname: '127.0.0.1', port: 0 })` is likewise
unverified — port `0` may or may not be honoured.

**[FIXED]** _Settled empirically, not by inspection. A real `opencode serve`
1.18.7 was booted and driven through the pipeline's own generated config against
a stub OpenAI-compatible endpoint, which also proves the custom `baseUrl` is
honoured end to end.

The observed contract matches the generated types: the client returns
`{ data, error, request, response }` (`ThrowOnError = false`,
`ResponseStyle = "fields"`), so the session id is at `.data.id` and the reply
parts at `.data.parts` — the old probing tried the **top level first**, a branch
that never matches. A reply carries `step-start` / `text` / `step-finish` parts,
so `collectText`'s `type === 'text'` filter was right.

Probing is replaced by schema decoding: `decodeSessionId` and `decodeReply` are
exported (they sit on the one path a `connect` seam cannot reach, which is how
they stayed untested), and an SDK upgrade that relocates the payload now fails
naming the contract instead of yielding empty text that surfaces three layers
away as "the model returned no JSON". The `adapters.test.ts` fixtures are
recorded from the live run, and the pre-existing fixtures that encoded the guess
failed when the decoder landed — which is the point.

`tests/opencode-agent/live-sdk.integration.ts` preserves the check; run it with
`bun run opencode-agent:test:live`. It is deliberately not a `*.test.ts`: it
needs the `opencode` CLI on PATH, so it stays out of default discovery and is not
a gate.

**Two further defects surfaced while verifying:** `createOpencodeServer` passes
`port` straight to `opencode serve`, and `port: 0` there does **not** mean
"ephemeral" — the server was observed booting on its 4096 default, so two agent
processes on one host collide. A port is now reserved from the OS first, and the
live check boots two servers concurrently to prove it. The SDK's 5-second boot
timeout was also raised to 60s; a cold runner with a large repo can miss it._

### S1-6 No skills ever load; the superpowers integration is inert — **verified** — **[FIXED]**

_Fixed and verified against the real files. `obra/superpowers` is checked out to
a gitignored `.superpowers/`, and driving the production loader against an actual
clone confirms every phase resolves all of its skills, frontmatter stripped,
composing prompts of 9–18 KB. Required skills are fatal; optional misses are
logged.

Verifying it exposed two defects in the first fix:

**The ref was not pinned.** The workflow comment read "Pinned obra/superpowers
checkout. Bump deliberately" while the value was `main` — a moving branch. This
is third-party markdown that goes straight into the system prompt, so a moving
ref lets it change without review. Now pinned to `44c9b2d`, and a workflow test
asserts the ref is a 40-character SHA (mutation-checked by reverting it to
`main`).

**The claim that a ref bump would fail the test suite was false.** The "upstream
list" in `adapters.test.ts` is a set typed by hand, so it catches a typo in
`PHASE_SKILLS` and cannot see upstream drift at all. The README said otherwise;
it now says what the test really does.

The real guard is new: `bun run opencode-agent:verify-skills` drives the
production `loadPhaseSkills` against the fetched files — not a bash
reimplementation that could drift from `PHASE_SKILLS`. Proven to fail both when
one required skill is removed and when the whole checkout is absent, naming the
skill each time. The workflow runs it after install and **before** the model
credentials are used, so a bad checkout costs nothing._

`src/obra-skills.ts:24` searches `.claude/skills/`,
`docs/superpowers/extensions/` and `.superpowers/skills/` for
`<name>/SKILL.md`, and `:30-38` asks for `brainstorming`, `writing-plans`,
`subagent-driven-development`, `test-driven-development`, `systematic-debugging`
and `using-git-worktrees`.

This repository contains exactly three `SKILL.md` files —
`designing-new-provider`, `syncing-plan-with-code`, `ux-review` — and
`docs/superpowers/extensions/` holds a `.ts` file, not skill directories. **None
of the six requested skills resolve.** `loadSkills` drops every miss silently
(`:72-78`, no logging), so `composeSystemPrompt` emits no skills section and
nobody ever finds out.

The spec asked for the agent to "invoke Obra Superpowers/Skills planning
module". As shipped it is a well-tested loader pointed at nothing.

**Direction:** verify the real obra/superpowers vendored layout and skill names
against the upstream repo; add a `log.warn` per missing skill; and decide
whether a missing _planning_ skill should be fatal for `EXECUTION_PLAN` rather
than silently degrading. Also strip YAML frontmatter before inlining — it is
prompt noise.

### S1-7 The OpenCode server is never closed; the job may hang — by inspection — **[FIXED]**

_Fixed and verified — the first S1 item whose original fix was wholly correct.
`runCli` closes the agent in a `finally`, and `main` exits explicitly.

Three things were checked rather than assumed, because `process.exit()` would
_mask_ a leak rather than fix one:

1. `close()` really terminates the child. The SDK's `close()` reaches
   `proc.kill()`, and an observed run went from 3 live `opencode serve`
   processes to 2 across a close.
2. The process exits **naturally** in ~3 ms with no `process.exit()` at all, so
   the `finally` is doing the work and the explicit exit is belt-and-braces
   rather than a cover-up.
3. `process.exit()` does not truncate piped stdout under Bun — 2000/2000 lines
   survived — so the explicit exit costs nothing. A suspected log-truncation
   problem was measured and found not to exist, so nothing was changed for it.

A false alarm is worth recording: `pgrep -f "opencode serve"` matches the shell
command doing the counting, which reads as a phantom leak. Matching the binary
path instead shows zero leaked servers across repeated runs.

The real gap was coverage — removing the `finally` broke nothing. `memoizeAgent`
now takes its factory as an argument, so the lifecycle is testable without
booting a server, and four tests pin it: never boot merely to close, boot at most
once however many phases ask, close a booted session, and never turn a failed
boot into a second failure during teardown. The live check additionally asserts
no server is left behind, mutation-checked by removing the `close()` call — it
reports `2 server(s) leaked` and exits 1._

`src/index.ts:86-97` memoizes the agent but nothing ever calls
`agent.close()`. `src/opencode-adapter.ts` exposes `close()` on the interface and
implements it; no caller exists.

`main()` sets `process.exitCode` and returns rather than calling
`process.exit()`, so the process only ends when the event loop drains. A
listening OpenCode server keeps a handle open. The likely outcome is a job that
completes its work and then sits until `timeout-minutes: 45` kills it — and a
timed-out job posts the _infrastructure_ failure comment rather than the real
result, even though the pipeline succeeded.

**Direction:** close the agent in a `finally` around `runPipeline`, and consider
an explicit `process.exit(code)` after flushing logs.

---

## S2 — Correctness

### S2-1 `attempts` is never reset on success — **verified** — **[FIXED]**

_Fixed in two steps. The first added a `PROGRESS_SIGNALS` allow-list, which
looked equivalent to "reset on success" and was not: `NEEDS_CLARIFICATION`,
`ANSWERED` and `CHANGES_REQUESTED` are forward moves that it omitted, and the
first two are _handler successes_. Reproduced — a conversation that failed,
retried, and successfully asked a clarifying question twice still reached
`attempts = 3`, so the next hiccup locked the issue out at the default cap
despite every clarification round having worked. A successful `/ask` did not
clear it either.

`attempts` now resets on **every** forward move, which is what "consecutive
failures" means. `RETRY` is the deliberate exception and preserves the count in
its own branch, so a genuinely broken issue still reaches the cap — verified as
`1 → 2 → 3`, because a budget that never trips bounds nothing.

Mutation-checked in both directions: restoring the allow-list turns the
clarification and answer cases red, and making `RETRY` reset as well turns the
boundedness case red._

`src/state-manager.ts:139-143`: normal transitions carry `attempts` through from
the previous state. Reproduced: a run that fails once, is `/retry`-ed, and then
walks all the way to `COMPLETE` still reports `attempts: 1`.

Consequence: the failure budget is per-issue-lifetime, not per-incident. An
issue that hiccups twice early has one attempt left for the rest of its life; a
later, entirely unrelated failure hits the ceiling immediately.

**Direction:** reset `attempts` to 0 on any signal that represents forward
progress, or track it per `resumeFrom` phase.

### S2-2 Exhausting the retry budget is completely silent — by inspection — **[FIXED]**

_Fixed in two steps. The first made the **retry** budget post a "Giving up"
comment and stopped there, leaving its sibling untouched: the **CI-fix** budget
still returned a bare `skip`, posting nothing. The test written alongside it
asserted `posted).toEqual([])` — it pinned the defect rather than the fix.

That gap mattered more than the one that was closed. A red check arrives on its
own schedule with nobody reading the Actions log, so an agent that quietly stops
fixing is indistinguishable from one still working; the pull request simply never
improves again.

Both budgets now report. The CI notice names the pull request and says plainly
that no further attempt will be made. It posts **once** — CI fires on every push
and re-run, so repeating it would be the opposite mistake, and a new
`ciBudgetReported` flag on the state prevents that. The flag is added with a
default, so a state block written before it existed still restores (covered by a
test, since a mid-flight deploy must not strand a live issue).

Mutation-checked in both directions: reverting to a silent `skip` turns two tests
red, and dropping the already-reported guard turns the spam test red._

`src/orchestrator.ts:132-134` returns `failed` when
`attempts >= maxAttempts` **before** running a handler and without posting
anything. A maintainer who types `/retry` past the budget gets no reply on the
issue at all; the only evidence is a red workflow run.

Worse, the check sits inside the recursion, so it also fires _mid-cascade_: a
run that is succeeding can be aborted between phases by a stale attempt count
(see S2-1), again with no comment.

**Direction:** post a "budget exhausted" comment, and evaluate the budget once
at entry rather than on every recursion step.

### S2-3 `renderFailure` has an unreachable branch — by inspection — **[FIXED]**

_The dead `attempts >= 1` branch is gone; the comment always reports
`Attempt N of M`.

Checking it surfaced a live defect in the same function. Every error message it
renders is wrapped in a fixed ` ` ``` fence, and the messages carry raw model
output — `modelResponseError` embeds up to 2 KB of the reply, which for a
"contained no JSON object" failure is usually prose **with a fenced code block in
it**. Traced against CommonMark: the model's inner fence closes the outer one
early, the reply's tail escapes into prose, and the closing fence opens a fresh
block that swallows the trailing line. That trailing line is
"Reply `/retry` to resume" — the one instruction the maintainer needs, rendered
as code.

Backtick _parity_ misses this entirely: the fences balance while pairing wrongly,
so the regression tests model CommonMark spans instead of counting.

New `markdown.ts` sizes each fence one backtick longer than anything inside, and
the three places that fence foreign text now use it: the failure comment, the
CI-fix check output, and the review-loop summary. Delimiters written by something
else have now bitten three times — `---`, `-->`, and ` ` ``` — so this closes
the third the same way as the others: at the boundary, for the whole class.

Mutation-checked by restoring the fixed-length fence: six tests go red.
`renderFailure` also stopped taking the whole `PhaseDeps` to read one number._

`src/orchestrator.ts:189-191` branches on `next.attempts >= 1`, but
`transition(state, 'FAILED')` always increments `attempts`, so `next.attempts`
is always ≥ 1. The `else` string can never render. Harmless, but it signals the
author expected `attempts` to mean something it does not.

### S2-4 The mutation check is hardcoded and papai-specific — by inspection — **[FIXED]**

_Fixed differently than suggested: the custom mutation loop is gone. `mutation-improve/` opens its own pull requests, so it is not wired into a pipeline whose job is to open one._

`src/config.ts:19-22` hardcodes `bun run test:mutate:changed`, and `:116` wires
it in with no environment override (unlike `AGENT_CHECKS`). Any repository other
than papai has no such script, so the command exits 127, `parseMutationScore`
finds no score, and `runMutationImprove` spends `AGENT_MAX_MUTATION_ROUNDS`
model calls asking the agent to "kill surviving mutants" from a `command not
found` log — then reports ❌ on the issue.

**Direction:** add `AGENT_MUTATION_CHECK`, and treat "runner not found" (exit 127) as _skip the mutation phase_ rather than _fail it_.

### S2-5 `AGENT_BASE_BRANCH` defaults to `main`; this repo's default is `master` — by inspection

`src/config.ts:112`. The workflow overrides it with
`github.event.repository.default_branch`, so CI is fine — but every local run
and every README example targets a branch that does not exist here, and
`ensureBranch` fails at `git fetch origin main`.

**Direction:** make the default the detected default branch, or fail loudly when
the configured base does not exist rather than surfacing a raw `GitError`.

### S2-6 A reused pull request is never actually updated — by inspection — **[FIXED]**

_Fixed: `updatePullRequest` refreshes the body on reuse._

`src/phases/deliver.ts:24-33` reuses an existing open PR and
`renderDelivery` (`:57-64`) announces "**Updated** existing pull request" — but
nothing updates it. The fresh implementation report stays on the issue and never
reaches the PR body.

**Direction:** either patch the PR body on reuse, or change the wording to match
what happened.

### S2-7 A merged PR is not detected on retry — by inspection

`findOpenPullRequest` (`src/github.ts:62-77`) filters `state: 'open'`. If the PR
merged and someone `/retry`s, the pipeline opens a _second_ PR from the
now-merged branch, almost certainly with an empty diff.

### S2-8 `parseRepository` silently truncates — by inspection — **[FIXED]**

`src/config.ts:77` destructures `raw.split('/')` into two variables, so
`a/b/c` parses as owner `a`, repo `b`, discarding `c` without complaint.

### S2-9 Numeric configuration is unvalidated — by inspection — **[FIXED]**

_Fixed: every knob is a validated positive integer._

`src/config.ts:67-73` accepts any finite float. `AGENT_MAX_ATTEMPTS=0` makes
every run fail instantly and silently (see S2-2). `AGENT_MUTATION_THRESHOLD=95`
(meaning 95%) can never be satisfied, because the code expects 0–1.
`AGENT_MAX_REVIEW_ROUNDS=2.5` is accepted and compared with `>=`.

**Direction:** integer/range validation per key, and accept `95` as `0.95` for
the threshold since that mistake is near-certain.

### S2-10 `hasChanges()` then `commitAll()` runs `git status` twice — by inspection

`src/phases/implement.ts:52` and `src/git.ts:72`. Harmless, but `commitAll`
already returns `false` for a clean tree, so the guard is redundant — except
that it produces a better error message. Worth collapsing deliberately rather
than by accident.

---

## S3 — Security and containment

### S3-1 The untrusted-input envelope is trivially escapable — by inspection — **[FIXED]**

_Fixed: nonce-terminated envelope, with a forged terminator neutralised before wrapping._

`src/prompts.ts:10-11` wraps issue text in `<untrusted_input source="...">` …
`</untrusted_input>` with **no escaping**. An issue body containing the literal
closing tag ends the envelope early, and everything after it reads as trusted
prompt text. This is the primary injection defence the README advertises.

**Direction:** strip or entity-escape the closing tag, or use a per-run random
nonce in the delimiter (`<untrusted_input id="a3f9…">`) and state in the system
prompt that only the matching id terminates the block.

### S3-2 The model runs unconstrained with repository and provider credentials — by inspection

The workflow checks out with `persist-credentials: true`
(`agent-pipeline.yml:53`) and exports `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY` and `OPENCODE_API_KEY` into the same process
(`:68`, `:73-75`). The OpenCode session runs the `build` profile with **no tool
restrictions** — `AgentPromptRequest.tools` exists in the adapter
(`src/opencode-adapter.ts:53-58`) and is never set by any caller.

So a successful prompt injection reaches `.git/config` (which holds the token as
an extraheader), the provider keys in `process.env`, and arbitrary `git push`.
The defence is entirely prompt-level; there is no capability-level containment.

**Direction:** this is the gap that most deserves attention before the agent
touches anything real. Options, roughly in order of value: pass an explicit
`tools` allow-list per phase (planning phases need no write tools at all);
use a short-lived GitHub App token scoped to the agent branch instead of
`persist-credentials`; run the model in a container without the provider keys
mounted for phases that do not need them.

### S3-3 Check output and git stderr are published verbatim to a public issue — by inspection

`src/phases/implement.ts:117` embeds `formatFailures(...)` in the issue comment;
`src/orchestrator.ts:181-192` posts raw error messages, including `GitError`,
which carries git's stderr (`src/git.ts:23`).

A failing integration test that prints an environment variable, or a git error
echoing a credentialed remote, is published to a public issue. The logger's
`REDACT_KEYS` (`src/logger.ts:27-36`) protects **stdout only** — nothing
redacts the issue-comment path.

**Direction:** run every outbound comment body through a redaction pass, keyed
on the known secret values from the environment rather than on key names.

### S3-4 The persisted branch name is never validated — by inspection

`state.branch` is read straight from the hidden block and handed to
`git checkout -B` and `git push -u origin` (`src/phases/implement.ts:35`,
`src/phases/deliver.ts:20`). Maintainers can edit bot comments. Editing the
block to `"branch": "master"` makes the pipeline commit and push directly to the
default branch.

This requires maintainer rights — someone who could push anyway — but it routes
around the expectation that the agent only ever touches `agent/issue-N`, and it
does so without a reviewable diff.

**Direction:** ignore the persisted branch and always recompute
`branchNameFor(issueId)`, or assert the two match before any git write.

### S3-5 `git add --all` commits whatever the model left behind — by inspection

`src/git.ts:75`. Everything untracked and not gitignored is committed:
downloaded fixtures, `.env` files the model created while debugging, coverage
output, stray caches. There is no pathspec restriction and no size or scope
guard.

Both sibling workspaces in this repo (`review-loop/`, `mutation-improve/`) have
explicit diff guards; the spike has none.

**Direction:** port a `diff-guard` — cap changed-file count and total diff size,
refuse to commit files outside the plan's declared `files` list (the plan schema
already collects them and currently uses them only for display).

### S3-6 Thread rendering leaks state blocks and allows role impersonation — by inspection

`src/prompts.ts:14-18` renders every comment body raw, including the agent's own
hidden `AGENT_STATE` blocks (the model sees the state schema), and prefixes each
with `@login:`. A comment whose body starts with `@agent-bot:` renders as if the
agent had said it.

**Direction:** strip state blocks before rendering, and put author metadata in
attributes rather than in-band text.

---

## S4 — Spec gaps and dead code

| #     | Item                                                | Where                              | Note                                                                                                                                                                                                                  |
| ----- | --------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4-1  | `dryRun` parsed, logged, never honoured             | `config.ts:42,121`; `index.ts:158` | `AGENT_DRY_RUN=true` does nothing. Either implement (skip all writes) or delete. A working dry run would also make S1-5 much cheaper to validate.                                                                     |
| S4-2  | `updatedAt` never written                           | `types.ts:59`                      | Always `null`. Useful for staleness detection if actually set.                                                                                                                                                        |
| S4-3  | `approved` written, never read                      | `types.ts:53`                      | The real gate is the phase. Dead flag.                                                                                                                                                                                |
| S4-4  | `getAuthenticatedLogin()` implemented, never called | `github.ts:31,100-103`             | This is the fix for the `AGENT_SELF_LOGIN` footgun: derive the agent identity from the token instead of from an env var the operator must remember to set. Wiring it up removes a whole class of misconfiguration.    |
| S4-5  | `currentSha()` implemented, never called            | `git.ts:36,101-104`                | Would be useful in the state block for provenance.                                                                                                                                                                    |
| S4-6  | `buildPrBodyPrompt` / `PrPromptInput` dead          | `prompts.ts:97-107`                | Vestige of a design where the model wrote the PR body; `deliver.ts` builds it deterministically. Confirmed by coverage (lines 102-106 unhit).                                                                         |
| S4-7  | No state schema version                             | `types.ts:48-60`                   | Any future field change invalidates live blocks; `findLatestState` then falls back to an older block or to `initialState`, silently restarting an in-flight issue at phase 1. Add a `v` field and a migration branch. |
| S4-8  | `mutationCheck` not configurable                    | `config.ts:116`                    | Asymmetric with `AGENT_CHECKS`. See S2-4.                                                                                                                                                                             |
| S4-9  | `TRIAGE_INSTRUCTIONS` sent twice                    | `triage.ts:33` + `prompts.ts:43`   | Once in the system prompt, once in the user prompt. Wasted tokens, and the two can drift.                                                                                                                             |
| S4-10 | Commit identity vars undocumented in the workflow   | `agent-pipeline.yml`               | `AGENT_COMMIT_NAME` / `AGENT_COMMIT_EMAIL` are in the README table but not passed through.                                                                                                                            |

---

## S5 — Robustness, cost, operability

| #                      | Item                                        | Where                                   | Note                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5-1                   | No retry on transient model errors          | `opencode-adapter.ts:167-170`           | A single 429 or 5xx fails the phase and burns an attempt.                                                                                                                                           |
| S5-2                   | No timeout on a prompt                      | `opencode-adapter.ts`                   | `ServerOptions.timeout` exists and is not passed. A hung call runs to the job timeout.                                                                                                              |
| S5-3                   | No JSON-repair retry                        | `model-json.ts:44-56`                   | One malformed reply fails the run and needs a human `/retry`. A single "return valid JSON matching this schema" re-ask would recover most of these cheaply.                                         |
| S5-4                   | No prompt size budget                       | `prompts.ts:14-18`; `review-loop.ts:43` | `renderThread` caps at 20 comments but not at characters; `truncateOutput` caps 8k _per failure_, so three failures put 24k into each repair round.                                                 |
| S5-5                   | `timeout-minutes: 45` is likely too low     | `agent-pipeline.yml:31`                 | Implement + up to 3 review rounds + 2 mutation rounds on a real repo can exceed it. A timeout loses everything — no state comment is posted, so the issue is stuck in whatever phase it started in. |
| S5-6                   | No cost ceiling                             | —                                       | Round caps and the job timeout are the only bounds. A token budget per issue would be a cheap guardrail.                                                                                            |
| S5-7                   | No progress output during a phase           | adapter                                 | A 20-minute implement prompt emits nothing; the Actions log looks hung. The SDK supports streaming.                                                                                                 |
| S5-8                   | Every check reruns every round              | `review-loop.ts:52-66`                  | Deliberate and documented, but on a repo with a 20-minute test suite three rounds is an hour. Consider rerunning only previously-failing checks after round 1, with a full pass at the end.         |
| S5-9                   | `parseMutationScore` is ambiguous at `1`    | `review-loop.ts:130`                    | `value > 1 ? value/100 : value` reads a bare `Mutation score: 1` as 100%, not 1%. Inherent to the format; worth documenting or requiring the `%`.                                                   |
| S5-10 **[SUPERSEDED]** | The comment filter is gone by design (S1-3) | `agent-pipeline.yml:41-44`              | A comment merely mentioning `/approve` starts a job that then correctly skips. Harmless, noisy, billable.                                                                                           |

---

## S6 — Test and tooling coverage

Measured coverage of the spike's own suite:

| File                  | Lines  | Functions | Gap                                                                                                |
| --------------------- | ------ | --------- | -------------------------------------------------------------------------------------------------- |
| `shell.ts`            | 0.00%  | 9.38%     | The entire `spawn` path is untested.                                                               |
| `github.ts`           | 12.50% | 30.23%    | The entire Octokit implementation is untested.                                                     |
| `errors.ts`           | 66.67% | 75.00%    | `missingSpecError` / `missingPlanError` never constructed — no test drives a missing spec or plan. |
| `opencode-adapter.ts` | 66.67% | 71.62%    | `readSessionId` + `connectSdk` untested (see S1-5).                                                |
| `index.ts`            | 69.23% | 83.62%    | `memoizeAgent`, the check runner, the skill loader and `main()` untested.                          |
| `logger.ts`           | 77.78% | 97.30%    | —                                                                                                  |
| `prompts.ts`          | 80.00% | 80.00%    | Uncovered lines are the dead `buildPrBodyPrompt` (S4-6).                                           |
| `obra-skills.ts`      | 80.00% | 97.96%    | Real-filesystem path untested.                                                                     |
| `phases/implement.ts` | 90.00% | 94.19%    | The mutation `improve` callback never fires — the fake always scores 95%.                          |

Everything else is at 100%.

Specific gaps worth closing, beyond the raw percentages:

- **S6-1 [FIXED]** The `/cancel` test asserted status and git calls but not persistence — which is why S1-1 shipped green. Assert the posted state on every command test.
- **S6-2** No test drives `handleDeliver` against a git fake that behaves like a _fresh runner_ (branch absent locally). That fake permissiveness is why S1-2 is invisible.
- **S6-3 [FIXED]** Both are now covered: a spec with `---` round-trips through the block channel, and a forged envelope terminator is asserted inert.
- **S6-4 [FIXED]** `live-sdk.integration.ts` drives the real SDK; the unit fixtures are recorded from it.
- **S6-5** **Stryker does not cover this workspace.** `stryker.config.json`'s `mutate` globs list `src/**` and `plugins/**` only, so the repo's strongest quality gate — the per-file mutation ratchet — never sees `opencode-agent/`. Ironic for a pipeline that runs a mutation loop. New files get a "first measurement, seeded" pass rather than an enforced floor, so this will not _block_ the PR; it just leaves the code unmeasured.
- **S6-6** **Coverage-floor risk on CI.** `scripts/coverage/floor.json` enforces an aggregate 90% lines / 90% functions. Eight of the spike's files sit below that. papai is large enough (~289k lines) that ~1,200 new lines at roughly 75% should not push the aggregate under the floor, but this has not been measured against a full coverage run and should be checked before merge.
- **S6-7** `opencode-agent:lint` / `:typecheck` / `:format:check` / `:test` are not in `scripts/check.sh`'s full check list (`:296`), unlike `review-loop:*`. They are covered transitively by the root `lint`, `typecheck` and `test`, so this is consistency rather than a hole — but the asymmetry will confuse the next person.
- **S6-8 [PARTLY FIXED]** `workflow.test.ts` now parses the workflow and asserts its trigger surface, condition, concurrency key, step wiring and permissions. That is a property check, not a linter: it cannot catch a shell-quoting or expression _syntax_ error the way `actionlint` would. Adding actionlint to CI is still worth doing.
- **S6-9** `bun security` (Semgrep) could not run in the authoring environment — no Semgrep binary and no Docker. The spike has **not** been through the repo's security scan. Run it before merge; S3-1, S3-3 and S3-5 are the kind of thing its AI/LLM rules target.

---

## Suggested sequencing

**Milestone 0 — before this is pointed at any live repository.**
S1-1 through S1-7. Nothing else matters until a run can complete, retry, and
actually use the model. S1-5 (SDK contract) and S1-6 (skills) are the two that
decide whether the spike does anything at all; S1-1, S1-2 and S1-3 are the three
that decide whether the maintainer-facing loop works.

**Milestone 1 — before trusting it with a real issue.**
S3-1, S3-2, S3-3, S3-4, S3-5 — the containment story. Right now the only thing
between an injected prompt and a repository token is a wrapper tag that can be
escaped with 19 characters. Alongside them, S2-1 and S2-2, so failures are
legible.

**Milestone 2 — before anyone else operates it.**
The rest of S2, plus S5-1, S5-2, S5-3 and S5-5. This is the difference between
"works when everything cooperates" and "recovers when it does not."

**Milestone 3 — housekeeping.**
S4 (delete or implement every dead field — `dryRun` and `getAuthenticatedLogin`
are the two worth implementing rather than deleting), then S6, then the
remaining S5 cost and operability items.

---

## What held up

Worth recording, since the audit above is uniformly negative by construction:

- The **state machine core** is sound. `transition` is total, guarded, and
  returns new objects; `state-manager.ts` and `orchestrator.ts` are at 100% and
  99% coverage and the transition table is easy to reason about. The
  waiting-state-by-absence-of-handler trick reads well.
- **Guardrail layering** — a workflow `if:` plus an in-process check, with the
  in-process one unit-tested — is the right shape, and reading the _commenter's_
  association rather than the issue author's is the non-obvious detail that
  matters.
- **Dependency injection is thorough.** Every external boundary is an interface,
  which is why 173 tests run with no network. It is also, precisely, why the
  fakes hid S1-2: the seams are good, the fakes are too agreeable.
- **`sequence.ts`** turns a lint constraint into a legible statement about
  ordering rather than a workaround.
