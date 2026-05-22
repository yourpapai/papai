<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ACP Review Automation Design

**Date:** 2026-04-12
**Status:** Proposed
**Scope:** Local developer automation script that orchestrates Claude review and OpenCode verification/fixing through ACP
**Research basis:** ACP TypeScript SDK, ACP session lifecycle/config/slash-command docs, OpenCode ACP docs, Claude ACP adapter docs

## Overview

Build a local Bun/TypeScript CLI that automates the existing review loop with
one ACP client process controlling two ACP agents:

1. a Claude-backed reviewer session
2. an OpenCode verifier/fixer session

The loop is:

1. Claude reviews the implementation against the implementation plan and returns
   a structured critical/high issue list
2. OpenCode verifies each issue one at a time
3. OpenCode automatically fixes issues that are both valid and auto-fixable
4. Claude re-reviews the updated worktree
5. the loop stops when Claude reports no remaining critical/high issues

The first version is local-only, fully automatic after startup, and keeps a
durable run ledger so progress survives crashes and restarts.

## Goals

- Preserve the user's current workflow semantics while removing manual
  copy/paste between Claude Code and OpenCode
- Use ACP as the control plane for both agents instead of screen-scraping or
  terminal-driving the CLIs directly
- Require structured reviewer/verifier outputs so the orchestrator never has to
  parse prose into issue objects
- Keep the first version local, auditable, and resumable
- Apply fixes automatically for verified issues without pausing for approval
- Stop when the reviewer reports no remaining critical/high issues

## Non-Goals

- CI execution in v1
- Generic multi-agent workflow orchestration for unrelated tasks
- Parsing today's freeform review output
- Auto-committing code changes as part of the loop
- Chasing medium/low severity issues in the first pass
- Depending on repo-local definitions of `review-code` or `verify-issue`

## Current Constraints and Assumptions

- The script runs on a developer machine with access to the repository checkout
- OpenCode is available as an ACP subprocess via `opencode acp`
- Claude is exposed to ACP through a local adapter process built on the Claude
  Agent SDK
- Existing `review-code` and `verify-issue` behaviors may live in user-level
  agent configuration rather than this repository, so the script must treat
  those command names as configurable rather than hardcoded facts
- ACP capabilities such as `session/load`, `session/list`, config options, and
  advertised slash commands are optional, so the design must degrade cleanly
  when an agent does not expose them

## Why a Standalone Script

This workflow is developer tooling, not papai runtime behavior. The
implementation should live under `scripts/` rather than `src/` so it can:

- evolve independently of the bot runtime
- depend on local machine configuration without affecting production
- store run-state artifacts that are useful for engineers but irrelevant to the
  application itself

## Architecture

```
scripts/
├── review-loop.ts                    # CLI entry point
└── review-loop/
    ├── cli.ts                        # args, config loading, run bootstrap
    ├── acp-process-client.ts         # spawn subprocess + ACP connection wrapper
    ├── agent-session.ts              # initialize/load/new/prompt helpers
    ├── available-commands.ts         # slash command discovery and matching
    ├── prompt-templates.ts           # review / verify / fix / rereview prompts
    ├── issue-schema.ts               # zod schemas for reviewer/verifier outputs
    ├── issue-fingerprint.ts          # stable issue identity computation
    ├── issue-ledger.ts               # durable issue state transitions
    ├── loop-controller.ts            # review -> verify -> fix -> rereview state machine
    ├── permission-policy.ts          # ACP permission request decisions
    ├── run-state.ts                  # persisted run metadata and session ids
    └── summary.ts                    # final human-readable result output

tests/
└── review-loop/
    ├── acp-process-client.test.ts
    ├── issue-fingerprint.test.ts
    ├── issue-ledger.test.ts
    ├── loop-controller.test.ts
    ├── permission-policy.test.ts
    └── fake-agent-integration.test.ts
```

### Core Components

| Component          | Responsibility                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `AcpProcessClient` | Spawn each ACP subprocess, wire stdio, manage `ClientSideConnection`, and surface ACP events                         |
| `AgentSession`     | Handle `initialize`, `session/new`, `session/load`, `session/prompt`, optional config setting, and command discovery |
| `LoopController`   | Own the deterministic workflow and stop conditions                                                                   |
| `IssueLedger`      | Persist discovered, verified, fixed, closed, rejected, and reopened issues across rounds                             |
| `PermissionPolicy` | Convert ACP permission requests into automatic allow/deny decisions                                                  |
| `Summary`          | Produce final output suitable for the terminal and later handoff                                                     |

### ACP Integration Model

The orchestrator uses `@agentclientprotocol/sdk` as the single integration
surface. For each agent it:

1. spawns a subprocess
2. wraps stdio in `ndJsonStream`
3. creates a `ClientSideConnection`
4. calls `initialize`
5. creates or loads a session
6. sends `session/prompt` requests for each workflow step

This keeps both agents behind the same protocol contract even though the Claude
side is implemented by an ACP adapter over the Claude Agent SDK and the
OpenCode side is implemented by `opencode acp`.

## Agent Command Strategy

The user's workflow mentions a Claude `review-code` agent and an OpenCode
`verify-issue` command. Because those names are not defined in this repository,
the script should treat them as configuration, not constants.

### Configuration Shape

```json
{
  "reviewer": {
    "command": "/absolute/path/to/claude-acp-adapter",
    "args": [],
    "invocationPrefix": "/review-code"
  },
  "fixer": {
    "command": "opencode",
    "args": ["acp"],
    "verifyInvocationPrefix": "/verify-issue",
    "fixInvocationPrefix": null
  }
}
```

### Resolution Rules

1. Treat each configured prefix as plain prompt text first
2. If a prefix begins with `/`, observe any ACP `available_commands_update`
   notification and validate the command name when the agent advertises commands
3. If the slash command is advertised, use it directly as the prompt prefix
4. If commands are not advertised or the prefix is not slash-based, keep using
   the configured text prefix or prompt wrapper
5. Fail fast only when the user explicitly marks a hook as required

This preserves the current workflow where possible without making the whole
automation depend on hidden local agent config or on ACP slash commands being
available.

## Session Strategy

Keep one long-lived reviewer session and one long-lived verifier/fixer session
for the entire run.

### Why long-lived sessions

- Claude benefits from remembering prior rounds and which issues were already
  fixed or rejected
- OpenCode benefits from remembering repo context and prior verification
- Re-review prompts can reference the prior issue ledger without replaying the
  full world on every turn
- If the agents support `session/load`, the run can resume instead of starting
  over after a crash

### Session Lifecycle

1. On startup, load the prior run-state file if one exists
2. For each agent:
   - `initialize`
   - inspect capabilities
   - `session/load` if a saved session ID exists and the agent supports it
   - otherwise `session/new`
3. If the agent exposes session config options, set the configured values once
   at startup
4. Save session IDs immediately after creation

### Graceful Degradation

If an agent does not support `session/load`, the orchestrator starts a fresh
session and seeds it with the minimal context needed for the next step:

- implementation plan path
- current issue ledger summary
- current round number
- working tree context

## Issue Contract

The orchestrator must never infer issue structure from prose. Both reviewer and
verifier responses are validated with Zod.

### Reviewer Output

```json
{
  "round": 2,
  "issues": [
    {
      "title": "Race condition in queue flush path",
      "severity": "high",
      "summary": "Two concurrent messages can bypass the intended lock.",
      "whyItMatters": "Can produce duplicate or stale assistant replies.",
      "evidence": "src/message-queue/queue.ts lines 84-107",
      "file": "src/message-queue/queue.ts",
      "lineStart": 84,
      "lineEnd": 107,
      "suggestedFix": "Move lock acquisition before the debounce flush branch.",
      "confidence": 0.91
    }
  ]
}
```

### Verifier Output

```json
{
  "verdict": "valid",
  "fixability": "auto",
  "reasoning": "The issue reproduces from the control flow in queue.ts.",
  "targetFiles": ["src/message-queue/queue.ts"],
  "fixPlan": "Take the processing lock before the flush branch and add a regression test."
}
```

### Fingerprinting

The orchestrator computes the stable issue fingerprint itself from normalized:

- file path
- line span
- issue title
- failure mode text

This avoids trusting any agent-generated identifier to remain stable across
rounds or prompt wording changes.

## Issue Ledger

The ledger is the durable source of truth for the run.

### States

- `discovered`
- `verified`
- `rejected`
- `needs_human`
- `fixed_pending_review`
- `closed`
- `reopened`

### Stored Fields

- fingerprint
- first seen round
- latest seen round
- reviewer payload snapshot
- verifier payload snapshot
- affected files
- fix attempts count
- current status
- transcript references

### Merge Rules

- If Claude reports a fingerprint already marked closed, reopen it
- If Claude no longer reports a `fixed_pending_review` issue, close it
- If OpenCode marks an issue invalid, keep the rejection record so the same
  issue is not re-verified every round without good reason

## Workflow State Machine

```
START
  -> session bootstrap
  -> REVIEW
  -> VALIDATE_REVIEW_OUTPUT
  -> FOR_EACH_ISSUE
       -> VERIFY
       -> if valid+auto => FIX
       -> else => REJECT or NEEDS_HUMAN
  -> REREVIEW
  -> MERGE_LEDGER
  -> if no critical/high issues => DONE
  -> else next round
```

### Review Step

The review prompt must include:

- the implementation plan path
- the current branch or diff scope
- a requirement to return only critical/high issues
- the structured JSON schema contract
- the prior ledger summary so Claude can confirm fixed vs reopened issues

### Verify Step

Each issue is handed to OpenCode independently with:

- the structured reviewer issue object
- the implementation plan path
- any prior verifier history for that fingerprint
- explicit instructions to return only the verifier schema

### Fix Step

Only `valid + auto` issues proceed to the fix prompt. The fix prompt includes:

- the issue object
- the verifier reasoning
- a requirement for the smallest correct fix
- permission to run targeted repo-safe checks
- an instruction not to broaden scope beyond the verified issue unless required
  for correctness

### Re-Review Step

The re-review prompt asks Claude to:

- check whether previously fixed issues are actually resolved
- identify any newly introduced critical/high issues
- ignore medium/low severity findings
- return the same schema as the original review step

## Permission Policy

ACP lets agents request permission before executing tool calls. The orchestrator
should answer those requests automatically according to a repo-local policy.

### Auto-Allow

- file reads inside the repo
- file edits inside the repo
- targeted search operations
- safe git inspection such as `git diff`, `git status`, `git show`
- targeted test, formatter, and linter commands that already exist in the repo

### Auto-Deny

- writes outside the repo root
- path traversal attempts
- destructive git operations
- broad deletes
- shell commands unrelated to verification or fixing
- secret exfiltration patterns or network operations not required by the task

### Denied-But-Valid Issues

If the verifier says an issue is valid but the required fix would need a denied
action, mark the issue `needs_human` and continue. The first version should not
pause for interactive approval mid-run.

## Persistence and Artifacts

Persist run data under a repo-local directory:

```
.review-loop/
└── runs/
    └── 2026-04-12T05-31-44Z/
        ├── state.json
        ├── reviewer-session.json
        ├── fixer-session.json
        ├── ledger.json
        ├── transcripts/
        │   ├── reviewer.ndjson
        │   └── fixer.ndjson
        └── summary.txt
```

### Why persist raw transcripts

- ACP schema failures can be debugged without rerunning the whole workflow
- reopened issues can be compared against the prior raw outputs
- failures in slash-command discovery or permission handling are visible after
  the fact

## Stop Conditions and Guardrails

### Primary stop condition

Stop when the latest Claude review round reports no critical/high issues.

### Secondary guardrails

Add two hard safety caps:

1. `maxRounds`
2. `maxNoProgressRounds`

These are not the success criteria; they prevent endless loops when the same
issues reopen or a fix keeps failing.

## Error Handling

| Scenario                                 | Behavior                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| ACP subprocess exits unexpectedly        | Restart process, attempt `session/load`, continue from saved state if possible |
| Agent lacks `session/load`               | Start fresh session and replay compact context from ledger                     |
| Reviewer/verifier returns invalid JSON   | Save raw response, fail the current step loudly, stop the run                  |
| Slash command not advertised             | Fall back to prompt template unless config marks the command as required       |
| Permission request does not match policy | Reject and mark issue `needs_human` if the issue was otherwise valid           |
| Same issue keeps reopening               | Count as no-progress and trip `maxNoProgressRounds` if repeated                |

## Testing Strategy

### Unit Tests

- issue fingerprinting stability
- ledger state transitions
- stop-condition logic
- no-progress detection
- permission policy allow/deny decisions

### Contract Tests

- reviewer schema accepts valid issue payloads
- reviewer schema rejects prose and malformed fields
- verifier schema accepts valid verdict payloads
- verifier schema rejects ambiguous outcomes

### Fake ACP Integration Tests

Use lightweight fake ACP subprocesses to simulate:

- successful initialization
- session creation and loading
- advertised slash commands
- permission requests
- malformed payloads
- crashes and recovery

These tests validate the orchestrator logic without burning tokens or depending
on external agent behavior.

### Manual Smoke Test

Run a narrow end-to-end trial on a small implementation change:

1. seed the run with a known implementation plan
2. complete one real Claude review round
3. verify and fix one or two issues through OpenCode
4. confirm resume behavior after a forced restart
5. confirm the stop condition when no critical/high issues remain

## First-Version Deliverables

1. `scripts/review-loop.ts` CLI
2. Bun/TypeScript ACP client wrapper based on `@agentclientprotocol/sdk`
3. Claude/OpenCode agent configuration file format
4. Prompt templates for review, verify, fix, and re-review
5. Zod schemas for reviewer/verifier outputs
6. Durable run-state and issue ledger
7. Terminal summary report
8. Deterministic tests with fake ACP agents

## Future Work

- CI mode after the local workflow proves stable
- support for medium/low severity follow-up rounds
- optional per-fix git checkpoints
- richer dashboards over the persisted run artifacts
- parallel verification for independent issues once session-safety is proven

## Research Notes

- ACP's TypeScript SDK already provides the client-side building blocks needed
  for a local orchestrator
- ACP session capabilities are intentionally optional, so resume and discovery
  must be capability-driven rather than assumed
- ACP slash commands are just normal prompt messages with a slash prefix, which
  makes them easy to preserve as configurable workflow hooks
- ACP permission requests can be answered automatically by the client, which is
  the right place to enforce repo-local safety policy
- OpenCode explicitly documents ACP subprocess mode via `opencode acp`
- Claude's ACP path currently relies on an adapter built over the Claude Agent
  SDK rather than a repo-local integration here
