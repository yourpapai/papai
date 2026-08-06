<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# opencode-agent — GitHub Actions issue agent (spike)

An event-driven coding agent that lives in GitHub Actions. A maintainer opens an
issue; the agent writes a design spec, waits for `/approve`, plans the work,
implements it on `agent/issue-<n>`, drives a review + mutation loop, and opens a
pull request. Every step runs in its own short-lived job — nothing long-polls.

> **Spike status.** This is a proof of concept, not a hardened product. It is
> deliberately conservative about who can trigger it and deliberately loud about
> what it did, but it has not been run against a real repository at scale.

## How the ephemeral model works

An Actions job has no memory of the previous one, so state lives on the issue.
Every comment the agent posts ends with a hidden block:

```html
<!-- AGENT_STATE:
{
  "phase": "EXECUTION_PLAN",
  "issueId": 42,
  "branch": "agent/issue-42",
  "approved": true,
  "resumeFrom": null,
  "attempts": 0,
  "lastError": null,
  "prUrl": null,
  "updatedAt": null
}
-->
```

On each trigger, `state-manager.ts` walks the thread backwards, takes the newest
comment authored by the agent that carries a parsable block, and restores from
it. A corrupt or spoofed block is skipped rather than trusted: only comments
authored by the configured agent login count, and a block that fails schema
validation is ignored in favour of the last good one.

## Phases

| Phase               | Trigger                                              | What happens                                                            | Ends at                                            |
| ------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `INIT_OR_CLARIFY`   | issue opened, or a maintainer reply while clarifying | Reads the issue and the thread, explores the repo                       | Clarifying questions (stays here) or a design spec |
| `DESIGN_SPEC`       | —                                                    | Waiting state. No handler runs                                          | `/approve`, `/replan`, `/cancel`                   |
| `EXECUTION_PLAN`    | `/approve`                                           | Planning skills produce a step breakdown; cuts `agent/issue-<n>`        | Plan posted                                        |
| `REVIEW_AND_MUTATE` | automatic                                            | Applies the plan, runs the review loop, then the mutation loop, commits | Changes committed                                  |
| `PR_DELIVERY`       | automatic                                            | Pushes the branch, opens (or reuses) the PR with `Closes #<n>`          | PR opened                                          |
| `COMPLETE`          | —                                                    | Terminal                                                                | —                                                  |
| `FAILED`            | any handler throwing                                 | Failure comment posted, `resumeFrom` recorded                           | `/retry` or `/cancel`                              |

Phases 2–4 cascade inside a single job: one `/approve` normally takes the issue
all the way to an open pull request.

### Commands

| Command    | Valid in                | Effect                             |
| ---------- | ----------------------- | ---------------------------------- |
| `/approve` | `DESIGN_SPEC`           | Plan, implement, deliver           |
| `/replan`  | `DESIGN_SPEC`           | Send the spec back through triage  |
| `/retry`   | `FAILED`                | Resume the exact phase that failed |
| `/cancel`  | anything but `COMPLETE` | Park the issue in `COMPLETE`       |

A command only counts on a line that starts with it, and lines inside fenced
code blocks are ignored — so the agent quoting its own instructions ("reply with
`/approve`") does not fire the command.

## Guardrails

Applied in `src/guardrails.ts`, and mirrored as a first-pass `if:` in the
workflow so an unauthorized event never boots a runner with keys mounted:

1. Only `issues.opened` and `issue_comment.created`; comments on pull requests
   are dropped.
2. `sender.type == 'Bot'` aborts.
3. A sender matching the agent's own login aborts — the recursion guard.
4. The author association must be `OWNER`, `MEMBER`, or `COLLABORATOR`. For a
   comment event, the _commenter's_ association is what is checked, not the
   issue author's.

Issue and comment text is wrapped in `<untrusted_input>` envelopes before it
reaches the model, and the system prompt states that this text is a request to
be evaluated, never an instruction that can change the agent's rules. Commands
are executed as argv vectors with `shell: false`, so untrusted text is never
interpolated into a shell line.

### A note on the "actor matches repository owner" rule

The spike spec asks for the run to abort when the event actor matches
`github.repository_owner`. Taken literally that also locks out the human owner,
who on most repositories is the maintainer driving the issue — the rule is aimed
at the _agent's_ identity, which merely defaults to the owner. So it is
implemented as a comparison against `AGENT_SELF_LOGIN`, which **defaults to the
repository owner** (spec behaviour) and should be set to the bot account's login
once the agent posts under its own identity. Set it before expecting the owner
to be able to trigger the agent.

## Configuration

All configuration is environment variables; see `src/config.ts`.

| Variable                                   | Required | Default                       | Purpose                                                 |
| ------------------------------------------ | -------- | ----------------------------- | ------------------------------------------------------- |
| `GITHUB_TOKEN`                             | yes      | —                             | Repository access for comments, branches, pull requests |
| `GITHUB_REPOSITORY`                        | yes      | —                             | `owner/repo`                                            |
| `OPENCODE_MODEL`                           | no       | `anthropic/claude-sonnet-4-5` | `provider/model` reference                              |
| `AGENT_SELF_LOGIN`                         | no       | repository owner              | Login treated as the agent itself                       |
| `AGENT_BASE_BRANCH`                        | no       | `main`                        | Branch the PR targets                                   |
| `AGENT_CHECKS`                             | no       | lint / typecheck / test       | JSON array of `{ "name", "argv" }`                      |
| `AGENT_MUTATION_THRESHOLD`                 | no       | `0.6`                         | Mutation score floor, 0–1                               |
| `AGENT_MAX_REVIEW_ROUNDS`                  | no       | `3`                           | Review-loop attempts, including the first               |
| `AGENT_MAX_MUTATION_ROUNDS`                | no       | `2`                           | Mutation-loop attempts                                  |
| `AGENT_MAX_ATTEMPTS`                       | no       | `3`                           | Failures before `/retry` stops resuming                 |
| `AGENT_COMMIT_NAME` / `AGENT_COMMIT_EMAIL` | no       | `opencode-agent[bot]`         | Commit identity                                         |
| `AGENT_LOG_LEVEL`                          | no       | `info`                        | `debug`, `info`, `warn`, `error`                        |

Provider credentials (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or a custom
endpoint's variables) are read by the OpenCode server from the environment; the
adapter never handles them, and the logger redacts credential-shaped fields.

## Setup

1. Add the model provider key as a repository secret (`ANTHROPIC_API_KEY` or
   equivalent).
2. Optionally add `AGENT_GITHUB_TOKEN` — a GitHub App installation token or PAT.
   Use one if you want the agent's pull requests to trigger your other
   workflows; pushes made with the default `GITHUB_TOKEN` deliberately do not.
3. Optionally set repository variables for the knobs above.
4. Set `AGENT_SELF_LOGIN` to the login the agent comments under.
5. Ensure Actions has write access to contents, issues and pull requests.

The workflow lives at `.github/workflows/agent-pipeline.yml`.

## Local runs

The entry point takes an event payload file, exactly like the runner does:

```bash
GITHUB_REPOSITORY=acme/widgets \
GITHUB_TOKEN=ghp_… \
ANTHROPIC_API_KEY=sk-ant-… \
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

Exit code is `0` for `skipped`, `waiting` and `completed`, and `1` only when a
phase actually failed. The run writes NDJSON logs to stdout.

## Module map

| File                                          | Responsibility                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/index.ts`                                | CLI entry: flags, config, dependency wiring, exit code                          |
| `src/orchestrator.ts`                         | The state machine: guardrails, command handling, phase cascade, failure parking |
| `src/state-manager.ts`                        | `<!-- AGENT_STATE -->` serialization, thread restore, transition table          |
| `src/guardrails.ts`                           | Webhook payload normalization and every abort rule                              |
| `src/opencode-adapter.ts`                     | Headless OpenCode server + session wrapper                                      |
| `src/obra-skills.ts`                          | Loads superpowers `SKILL.md` files and composes system prompts                  |
| `src/review-loop.ts`                          | Review loop and mutation-improve loop                                           |
| `src/phases/*.ts`                             | One handler per acting phase                                                    |
| `src/github.ts`, `src/git.ts`, `src/shell.ts` | Octokit, git and process boundaries                                             |

Skills are looked up under `.claude/skills/`, `docs/superpowers/extensions/` and
`.superpowers/skills/`, first hit wins. A missing skill is skipped, not fatal —
the pipeline runs in a checkout that has not vendored superpowers, just with a
thinner system prompt.

## Tests

```bash
bun run opencode-agent:test        # unit tests
bun run opencode-agent:typecheck
bun run opencode-agent:lint
```

Tests live in `tests/opencode-agent/`. Every external boundary — GitHub, git,
the OpenCode session, the check runner, the filesystem — is an injected
interface, so the whole state machine runs against fakes with no network.

## Known limitations

- The mutation loop parses a Stryker-style `Mutation score: NN%` line. A runner
  that reports differently needs `parseMutationScore` extended.
- Review and mutation failures are reported, not enforced: the branch is pushed
  and the pull request opened with a red report rather than being withheld. CI
  on the pull request is the actual gate.
- The agent never edits or deletes its own comments, so a long issue accumulates
  one comment per phase.
- There is no cost ceiling. `AGENT_MAX_REVIEW_ROUNDS`, `AGENT_MAX_MUTATION_ROUNDS`
  and the job `timeout-minutes` are the only bounds on model spend.
