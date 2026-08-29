<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: What the run cost, and what the subscription has left

## Why

A maintainer reading a run's `Run detail` learns it spent `412,000 of 5,000,000
tokens` and nothing about money. Both backends report cost and this pipeline
discards it: `claude-contract.ts` decodes `total_cost_usd` while `foldLine` reads
only `usage.total` off the same line, and `readTokensUsed` logs OpenCode's
`usage.cost` to return `usage.tokens`. The seam between them —
`AgentSession.tokensUsed(): Promise<number>` — is one scalar wide.

The subscription window is worse: the CLI emits a `rate_limit_event` every
credentialed turn, `claude-progress.ts` drops it as "recorder evidence, never a
budget input", and an issue can spend its way into a five-hour lockout with
nothing saying so until the next run fails.

## What Changes

- **The `Run detail` reports money** — this run's spend, and the issue's across
  every job.
- **Cost resolves on a ladder, and unknown is a rendered state.** The backend's
  own figure first; failing that, the token buckets repriced through models.dev
  via `sdd-runner/src/pricing.ts` — this workspace's models.dev client, already
  imported by `model-metadata.ts`. A model no catalogue prices renders unpriced,
  never `$0.00`.
- **The subscription window is reported on the OAuth route**: the whole
  `rate_limit_info` decoded and rendered per window the stream carried — status,
  reset, overage.
- **A recorded spike settles the remaining figure.** The pinned CLI (2.1.239)
  emits no remaining fraction and no weekly window; the spike re-runs the live
  recorder against the current pin. The renderer gains a remaining figure only if
  a recording proves one exists.

## Capabilities

### New Capabilities

- `agent-run-accounting`: what one run reports about its own spend and its
  provider's standing — the cost ladder, the unpriced state, cross-job
  accumulation, the OAuth rate-limit render. Without it the discarded figures
  stay discarded: cost invisible on both backends, a lockout unannounced. Nothing
  existing covers it — `sdd-runner-output` specs another workspace's renderer;
  the `agent-*` capabilities cover commit identity and minimality instructions.

### Modified Capabilities

- _None._

## Impact

- **Code:** `opencode-agent/src/` — the `agent-session.ts` seam, both adapters,
  `claude-contract.ts`, `claude-progress.ts`, the handle/deps/phase-context
  wiring, `types.ts`, `run-detail.ts`, `reply-buffer.ts`, plus new pricing and
  rate-limit modules. `sdd-runner/src/usage-aggregate.ts` exports its reprice
  arithmetic, behavior unchanged.
- **State:** `AgentState` gains defaulted spend fields — no `STATE_VERSION` bump,
  the precedent `tokensSpent` records.
- **Docs:** `opencode-agent/CLAUDE.md`, `README.md`, the fixture corpus README.
- **Instances/scope:** none — no platform or task instances, no per-user,
  group-shared or thread-isolated config-context impact. `opencode-agent/` is
  developer tooling outside the papai runtime.
- **Tests:** contract, adapter, reply and run-detail suites; the recorder lane.

## Non-goals

- **No dollar ceiling.** `types.ts` records why the budget counts tokens: an
  unpriced model reads `0`, and a ceiling that silently never fires is worse than
  none. Reporting tolerates unknown; a guardrail does not.
- **No review-loop subprocess accounting** — its `opencode run` children spend in
  their own sessions, the gap `token-budget.ts` names. Declined; its own change.
- **No invented rate-limit figures**: no percentage, no weekly row, no estimate
  from reset timestamps unless a recording carries one.
- **No new configuration.**
