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

- `<!-- AGENT_STATE: … -->` — phase, branch, counters. Rewritten on every comment.
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

Only blocks authored by the configured agent login are read, and a block failing
schema validation is skipped in favour of the last good one, so neither a
planted block nor a corrupt one can steer the pipeline.

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

## Guardrails

Applied in `src/guardrails.ts`, and mirrored as a first-pass `if:` in the
workflow so an unauthorized event never boots a runner with keys mounted.

Human events: supported event and action only; no comments on pull requests; no
`Bot` senders; nothing from the agent's own login; and the author association
must be `OWNER`, `MEMBER`, or `COLLABORATOR` — read from the _commenter_, not the
issue author.

CI events: the run must have concluded `failure`, on a branch matching
`agent/issue-<n>`, from a workflow that is not this one.

Issue text reaches the model inside a nonce-terminated envelope
(`<untrusted_input source="…" id="<nonce>">`). A fixed closing tag would be
escapable by text containing that tag; the nonce is not guessable from the issue
side, and a forged terminator is neutralised before wrapping. Commands are
spawned as argv vectors with `shell: false`, so untrusted text never reaches a
shell.

### A note on the "actor matches repository owner" rule

The original spike spec asked for the run to abort when the actor matches
`github.repository_owner` — which also locks out the human owner, usually the
maintainer driving the issue. The rule is aimed at the _agent's_ identity, which
merely defaults to the owner, so it compares against `AGENT_SELF_LOGIN`
(defaulting to the owner). Set it to the bot account's login.

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
| `AGENT_SELF_LOGIN`                         | no       | repository owner                                | Login treated as the agent itself                     |
| `AGENT_WORKFLOW_NAME`                      | no       | `OpenCode Issue Agent`                          | This workflow's name, for the CI recursion guard      |
| `AGENT_BASE_BRANCH`                        | no       | `main`                                          | Branch the PR targets                                 |
| `AGENT_CHECK_COMMAND`                      | no       | `bun run lint && bun run typecheck && bun test` | review-loop's build gate                              |
| `AGENT_REVIEW_COMMAND`                     | no       | detected                                        | JSON argv running the review loop; `none` disables it |
| `AGENT_CHECKS`                             | no       | lint / typecheck / test                         | JSON `[{ "name", "argv" }]` the CI-fix phase runs     |
| `AGENT_REVIEW_MAX_ROUNDS`                  | no       | `4`                                             | review-loop rounds                                    |
| `AGENT_REVIEW_POOL_SIZE`                   | no       | `2`                                             | review-loop worker pool                               |
| `AGENT_CI_FIX_MAX_ROUNDS`                  | no       | `2`                                             | Repair rounds per CI-fix job                          |
| `AGENT_MAX_CI_ATTEMPTS`                    | no       | `3`                                             | CI-fix jobs per pull request                          |
| `AGENT_MAX_ATTEMPTS`                       | no       | `3`                                             | Failures before `/retry` stops resuming               |
| `AGENT_TIMEOUT_MS`                         | no       | `1800000`                                       | Per-subprocess timeout                                |
| `AGENT_COMMIT_NAME` / `AGENT_COMMIT_EMAIL` | no       | `opencode-agent[bot]`                           | Commit identity                                       |
| `AGENT_LOG_LEVEL`                          | no       | `info`                                          | `debug`, `info`, `warn`, `error`                      |

`OPENAI_MODEL` is required rather than defaulted: with a custom base URL there is
no model name that is right by default, and a wrong guess surfaces deep inside
the first model call instead of at config load. Every numeric knob is validated
as a positive integer.

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

For the CI-fix path, pass a `workflow_run` payload with
`--event-name workflow_run`.

Exit code is `0` for skipped/waiting/completed, `1` only when a phase failed.
Logs are NDJSON on stdout.

## Module map

| File                                          | Responsibility                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `src/index.ts`                                | CLI entry: flags, config, dependency wiring, agent teardown, exit code |
| `src/orchestrator.ts`                         | The state machine: guardrails, triggers, phase cascade                 |
| `src/run-report.ts`                           | Everything the orchestrator writes back to the issue                   |
| `src/state-manager.ts`                        | Transition table and the `AGENT_STATE` block                           |
| `src/blocks.ts` / `src/artifacts.ts`          | The hidden-block channel and the spec/plan/report artefacts            |
| `src/guardrails.ts`                           | Payload normalization (issue vs CI) and every abort rule               |
| `src/commands.ts` / `src/intent.ts`           | Slash commands, and classifying plain replies                          |
| `src/openai-config.ts`                        | The single endpoint, and the OpenCode config both paths share          |
| `src/opencode-adapter.ts`                     | Headless OpenCode server + session                                     |
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
- Bumping `STATE_VERSION` strands in-flight issues — old blocks fail validation
  and the scan falls back to an older one, or to a fresh state. Drain before
  bumping, or write a migration.
- No cost ceiling beyond the round caps and the job timeout.
- The model runs with unrestricted tools and repository credentials in the same
  process. `AgentPromptRequest.tools` exists as the seam for narrowing this and
  is not yet used — see `ROADMAP.md` S3-2.
