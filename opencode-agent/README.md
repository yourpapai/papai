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
| `FAILED`            | any handler throwing                      | Failure comment posted, `resumeFrom` recorded                         | `/retry` or `/cancel`                     |

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

## Red pull requests

When the `CI` workflow concludes `failure` on `agent/issue-<n>`, the agent comes
back: it checks out the branch, runs the configured checks locally, hands the
real failure output to the model, and pushes a fix. Reproducing beats reading
logs from another machine — and the runner has the branch anyway.

Two budgets bound it. `AGENT_CI_FIX_MAX_ROUNDS` caps repair rounds within one
job; `AGENT_MAX_CI_ATTEMPTS` caps rounds across the pull request's whole life, so
a genuinely broken branch cannot bounce between the agent and CI forever. The
agent's own workflow is excluded, so its failures never feed itself.

When that lifetime budget runs out the agent says so on the issue, once, naming
the pull request — it does not simply stop. Later red runs are then ignored
silently, because CI fires on every push and repeating the notice would be spam.

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

CI events: the run must have concluded `failure`, on a branch matching
`agent/issue-<n>`, from a workflow that is not this one.

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
3. Otherwise the repository owner, **with a warning naming `AGENT_SELF_LOGIN`**.
   A GitHub App installation token cannot read `/user`, so this is the expected
   path for the token this README recommends — set the variable to
   `<app-slug>[bot]`.

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
| `OPENAI_API_KEY`                           | yes      | —                                               | Model credentials                                     |
| `OPENAI_MODEL`                             | yes      | —                                               | Model name, e.g. `gpt-5`                              |
| `OPENAI_BASE_URL`                          | no       | `https://api.openai.com/v1`                     | Any OpenAI-compatible endpoint                        |
| `GITHUB_TOKEN`                             | yes      | —                                               | Comments, branches, pull requests                     |
| `GITHUB_REPOSITORY`                        | yes      | —                                               | `owner/repo`                                          |
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
| `AGENT_COMMIT_NAME` / `AGENT_COMMIT_EMAIL` | no       | `opencode-agent[bot]`                           | Commit identity                                       |
| `AGENT_LOG_LEVEL`                          | no       | `info`                                          | `debug`, `info`, `warn`, `error`                      |

`OPENAI_MODEL` is required rather than defaulted: with a custom base URL there is
no model name that is right by default, and a wrong guess surfaces deep inside
the first model call instead of at config load.

Every numeric knob is validated as an integer **and range-checked**, because
rejecting non-integers only closes "not a number", never "a number that cannot
work". Round counts accept 1–20, `AGENT_TIMEOUT_MS` accepts 1 000–7 200 000 (one
second to two hours), and `AGENT_REVIEW_POOL_SIZE` accepts 1–16. `AGENT_TIMEOUT_MS=1`
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

1. Repository secret `OPENAI_API_KEY`.
2. Repository variable `OPENAI_MODEL` (and `OPENAI_BASE_URL` for a non-OpenAI
   endpoint).
3. Repository variable `AGENT_SELF_LOGIN` — the login the agent comments under.
   Optional for a PAT, but required for a GitHub App token, which cannot report
   its own identity.
4. Optionally `AGENT_GITHUB_TOKEN`, a GitHub App installation token. Without it
   the agent's pushes do not trigger CI, so the CI-fix path never runs.
5. Actions needs write access to contents, issues and pull requests.

The workflow lives at `.github/workflows/agent-pipeline.yml`.

## Local runs

```bash
GITHUB_REPOSITORY=acme/widgets \
GITHUB_TOKEN=ghp_… \
OPENAI_API_KEY=sk-… \
OPENAI_MODEL=gpt-5 \
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

## Module map

| File                                          | Responsibility                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `src/index.ts`                                | CLI entry: flags, config, dependency wiring, agent teardown, exit code |
| `src/orchestrator.ts`                         | The state machine: guardrails and the phase cascade                    |
| `src/triggers.ts`                             | Turning a command, comment or red CI run into the state move to make   |
| `src/run-report.ts`                           | Everything the orchestrator writes back to the issue                   |
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
| `src/sdk-contract.ts`                         | The recorded response shapes the SDK answers with                      |
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
