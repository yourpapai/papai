<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0064: ACP Review Automation — Multi-Agent Review/Verify/Fix Loop

## Status

Accepted

## Date

2026-04-12

## Context

The project uses two agentic tools for code quality: Claude Code for architectural review and OpenCode for verification and fixing. Today the review loop is manual: an engineer runs Claude, reads the output, copies issues into OpenCode, waits for fixes, then re-runs Claude to check. This copy-paste cycle is slow, error-prone, and burns engineer attention on mechanical orchestration.

The Agent Client Protocol (ACP) provides a structured way to interact with agent subprocesses over JSON-RPC on stdio. Both Claude (via an ACP adapter over the Claude Agent SDK) and OpenCode (via `opencode acp`) support ACP. This makes it possible to automate the full review/verify/fix cycle programmatically.

The automation is developer tooling, not runtime behavior. It belongs in `scripts/` so it can evolve independently of the papai bot and depend on local machine configuration without affecting production.

## Decision Drivers

- Must automate the full review -> verify -> fix -> re-review cycle without manual intervention
- Must use ACP as the single integration surface for both agents (no screen-scraping or terminal driving)
- Must require structured JSON outputs from both reviewer and verifier so the orchestrator never parses prose
- Must be crash-resumable via durable run state and session persistence
- Must enforce repo-local safety policy for ACP permission requests (allow safe edits, deny destructive operations)
- Must keep the first version local-only, not CI-integrated
- Should treat agent slash commands (`/review-code`, `/verify-issue`) as configurable, not hardcoded

## Considered Options

### Option 1: Shell-script orchestration with ad-hoc output parsing

- **Pros:** Simple, no new dependencies, quick to prototype
- **Cons:** Fragile output parsing breaks on any format change, no structured error recovery, no session persistence across crashes, no protocol-level permission handling, difficult to test deterministically

### Option 2: ACP-based orchestrator with structured contracts

- **Pros:** Protocol-level integration with both agents, structured Zod-validated issue contracts, durable run state survives crashes, automatic permission policy enforcement, testable with fake ACP agents
- **Cons:** New dependency on `@agentclientprotocol/sdk`, more upfront implementation, requires both agents to support ACP

### Option 3: MCP-based orchestration

- **Pros:** MCP is widely adopted for tool integration
- **Cons:** MCP is designed for tool calling, not session-based multi-turn agent orchestration; the review loop needs session continuity, slash command discovery, and permission handling that ACP provides natively

## Decision

We chose **Option 2**: a dedicated ACP orchestrator script under `scripts/review-loop/` that uses `@agentclientprotocol/sdk` to control two ACP agent subprocesses (reviewer and fixer) through structured JSON contracts.

The orchestrator:

1. Spawns a Claude-backed reviewer session and an OpenCode fixer session via ACP
2. Sends structured review prompts and parses Zod-validated issue lists
3. For each critical/high issue, sends verification prompts and parses verdict payloads
4. For valid + auto-fixable issues, sends fix prompts and lets the fixer edit code
5. Re-reviews after fixes and loops until no critical/high issues remain
6. Persists run state, session IDs, issue ledger, and raw transcripts under `.review-loop/`

Key design choices:

- **Issue fingerprinting** uses normalized file+title+evidence hashing to track issues across rounds without trusting agent-generated IDs
- **Long-lived sessions** let both agents accumulate context across rounds; `session/load` is attempted on resume when supported
- **Permission policy** auto-allows repo-local edits and safe commands, auto-denies out-of-repo writes and destructive operations
- **Stop conditions**: clean exit on zero issues, `maxRounds` cap, `maxNoProgressRounds` cap to prevent infinite loops

## Consequences

### Positive

- Eliminates manual copy-paste between review and fix tools
- Structured contracts prevent misinterpreting agent output
- Durable state allows crash recovery without restarting from scratch
- Full transcript capture enables post-hoc debugging
- Fake ACP agent test strategy provides deterministic test coverage without burning tokens

### Negative

- Adds `@agentclientprotocol/sdk` as a dev dependency
- Requires both Claude and OpenCode to expose ACP interfaces (adapter dependency for Claude)
- First version is local-only; CI integration requires additional work
- Agent command names are user-configured, which adds configuration complexity

### Risks

- ACP protocol changes could break the orchestrator; mitigation: pin SDK version
- Agents may not always return valid JSON; mitigation: fail loudly, save raw response, stop the run
- Same issue reopening repeatedly; mitigation: `maxNoProgressRounds` guardrail

## Related Decisions

- The review-loop script is intentionally separate from papai runtime code (lives in `scripts/`, not `src/`)

## References

- Plan: `docs/superpowers/plans/2026-04-12-acp-review-automation.md`
- Design: `docs/superpowers/specs/2026-04-12-acp-review-automation-design.md`
- `@agentclientprotocol/sdk` npm package
