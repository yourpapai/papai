<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks

Ordered test-first, per design.md — Migration Plan. Group 1 is the one ordering
constraint that is not about tests: the decoders in group 3 are written against a
recording, so the recording has to exist first. It needs no credentials — the
recorder drives the real CLI against a stub Anthropic endpoint (design D7), the
technique the OpenCode route already uses.

## 1. A credential-free recorder, and the pin it lets us move

- [x] 1.1 Add a hermetic claude recorder lane
      (`tests/opencode-agent/claude-stub.integration.ts` + an
      `opencode-agent:test:claude-stub` script): a stub Anthropic endpoint
      answering the `anthropic-ratelimit-unified-*` headers over
      `ANTHROPIC_BASE_URL`, driving the real CLI on the native profile's own
      flags. Verify the lane runs green with no token set and on a machine that
      has never held one.
- [x] 1.2 Record `stub-rate-limit-turn.ndjson` from that lane and stamp
      `VERSION`. Verify the recorded `rate_limit_event` carries
      `unifiedWindows.five_hour` and `.seven_day`, each with `utilization` and
      `resetsAt`, and that the `result` line beside it carries a non-zero
      `total_cost_usd` over populated cache buckets.
- [x] 1.3 Re-answer the census pins from the same lane's init line at zero spend,
      per the route rule in `opencode-agent/CLAUDE.md`: `mcp_servers: []`,
      built-ins-only skills, no memory-file row. Verify the regenerated
      `facts.json`, and record any pin that moved between CLI versions in the
      corpus README rather than quietly overwriting it.
- [x] 1.4 Bump `.github/workflows/agent-pipeline.yml` (line ~470,
      `@anthropic-ai/claude-code@2.1.239`) to the recorded version — 2.1.239
      emits no `unifiedWindows`, so CI must run the newer pin or the feature is
      dead in production. Verify `bun run workflows:lint` **and**
      `bun test tests/opencode-agent/workflow.test.ts`, whose
      `the recorded stamp equals the workflow install pin` assertion is what
      makes the pin and the stamp atomic.
- [x] 1.5 Record in the corpus README what the hermetic lane does and does not
      prove: it pins the line's *shape*, never authentication — the credentialed
      legs remain the native profile's proof and keep their own 2.1.239
      provenance, marked as awaiting a re-record by a token holder. Verify by the
      README entry.

## 2. Reusable pricing arithmetic (`sdd-runner`)

- [x] 2.1 Write the failing test for an exported `costOfUsage(buckets, cost)` in
      `sdd-runner`: token buckets × per-million rates, cache read and cache write
      priced at their own rates when present and skipped when absent, reasoning
      tokens at the input rate. Verify `bun run sdd-runner:test` fails on the
      missing export.
- [x] 2.2 Extract `costOfUsage` out of `repriceEvent` in
      `sdd-runner/src/usage-aggregate.ts` and have `repriceEvent` call it. Verify
      `bun run sdd-runner:test` passes with the existing `usage-aggregate` and
      `pricing` suites unchanged — an unchanged suite is the proof this is a pure
      extraction.
- [x] 2.3 Verify the extraction is behaviour-neutral end to end:
      `bun run sdd-runner:typecheck && bun run sdd-runner:lint`.

## 3. Decoders: widen what each backend is allowed to say

- [x] 3.1 Write the failing `claude-contract` test asserting the whole
      re-recorded `rate_limit_info` decodes — window, `utilization`, status,
      `resetsAt`, overage status, overage reset, `isUsingOverage`, and each
      `unifiedWindows` entry's `utilization`/`resetsAt` — from
      `native-success-turn.ndjson`, plus a case proving a malformed or absent
      field degrades to unknown without failing its line. Verify
      `bun test tests/opencode-agent/claude-contract.test.ts` fails.
- [x] 3.2 Widen `rateLimitLineSchema` and the `rate-limit-event` line shape in
      `opencode-agent/src/claude-contract.ts` for `utilization` and
      `unifiedWindows`, every field but the window optional and lenient —
      `unifiedWindows` is self-described `@internal` (design D7), so leniency is
      load-bearing rather than defensive. Verify that same test passes and the
      existing contract suite is green.
- [x] 3.3 Write the failing `sdk-contract` test for cache buckets on
      `session.get` usage: present-and-zero decodes as zero, absent decodes as
      absent (not zero), and an unrecognized shape still returns `null` rather
      than throwing. Verify `bun test tests/opencode-agent/adapters.test.ts` fails.
- [x] 3.4 Widen `sessionUsageSchema` in `opencode-agent/src/sdk-contract.ts` for
      the cache buckets, `.optional()` without `.default(0)` per design D5, and
      surface them on `SessionUsage`. Verify that test passes.
- [x] 3.5 Assert the live shape in
      `tests/opencode-agent/live-sdk.integration.ts` — whether the pinned server
      populates cache buckets — and record the answer in the test's own comment.
      Verify `bun run opencode-agent:test:live`.

## 4. The cost ladder

- [x] 4.1 Write the failing test for the ladder module: backend figure wins when
      non-zero (`source: 'backend'`); a zero backend figure with priceable
      buckets falls to the catalogue (`source: 'catalogue'`); no priced row
      yields `null` / `'none'`; an absent bucket yields `null` rather than a
      partial price; an unreachable catalogue yields `null` and does not throw.
      Verify the new test file fails.
- [x] 4.2 Implement the ladder in a new `opencode-agent/src/run-spend.ts` over
      `costOfUsage` plus `loadDb`/`resolveCost` from
      `sdd-runner/src/pricing.js` — the import edge `model-metadata.ts` already
      opened. Verify the 4.1 test passes.
- [x] 4.3 Write and satisfy the test that the ladder's catalogue rung and
      `sdd-runner`'s repricing produce the identical figure for one set of counts
      and rates (the spec's cross-workspace scenario). Verify
      `bun run opencode-agent:test`.

## 5. Rate-limit accumulation and the session seam

- [ ] 5.1 Write the failing test for the per-window latest-wins fold: several
      turns reporting one window keep the last (including its `utilization`),
      `unifiedWindows` entries fold as their own windows beside the top-level
      one, an unknown window name passes through, a window reported without
      `utilization` folds without one, and a stream with no rate-limit line folds
      to `[]`. Verify the new test file fails.
- [ ] 5.2 Implement the fold and add `spend(): Promise<RunSpend>` to
      `AgentSession` in `opencode-agent/src/agent-session.ts`, leaving
      `tokensUsed()` and every caller of it untouched. Verify
      `bun run opencode-agent:typecheck` names every unimplemented adapter.
- [ ] 5.3 Implement `spend()` on the claude adapter: sum `total_cost_usd` and the
      usage buckets in `foldLine` beside the existing token total, and accumulate
      the rate-limit windows. Verify
      `bun test tests/opencode-agent/claude-adapter.test.ts`, including a case
      proving `claude-progress.ts` still ignores the rate-limit line for progress.
- [ ] 5.4 Implement `spend()` on the OpenCode adapter over `session.get` usage,
      windows always `[]`. Verify `bun test tests/opencode-agent/adapters.test.ts`.
- [ ] 5.5 Add `rateLimits()` to `AgentHandle` in
      `opencode-agent/src/agent-handle.ts`, returning `[]` when no session was
      booted, and thread `spend` through `deps.ts` / `phase-context.ts`. Verify
      `bun test tests/opencode-agent/adapters.test.ts tests/opencode-agent/orchestrator.test.ts`.

## 6. Persisted accumulation

- [ ] 6.1 Write the failing `state-manager` test: `usdSpent` and `usdUnpriced`
      default on a block that carries neither, an unpriced run flips the flag and
      adds nothing to the sum, and a priced run adds its figure once for a
      multi-phase cascade. Verify
      `bun test tests/opencode-agent/state-manager.test.ts` fails.
- [ ] 6.2 Add both fields to `agentStateSchema` in `opencode-agent/src/types.ts`
      with defaults and no `STATE_VERSION` bump, documenting why the ceiling
      stays in tokens (design D4, and the decision the file already records).
      Verify the 6.1 test passes.
- [ ] 6.3 Extend `spendPatch` / `recordSpend` in
      `opencode-agent/src/token-budget.ts` to write all three fields together, so
      the success path, `failRun`, `failAnswer` and both over-budget stops cannot
      disagree. Verify
      `bun test tests/opencode-agent/orchestrator.test.ts tests/opencode-agent/phase-failure.test.ts`.
- [ ] 6.4 Write and satisfy the regression test that `withinBudget`,
      `totalTokens` and `stopIfOverBudget` behave identically when pricing is
      unavailable. Verify `bun test tests/opencode-agent/time-budget.test.ts tests/opencode-agent/orchestrator.test.ts`.

## 7. Render

- [ ] 7.1 Write the failing `run-detail` tests: a priced run on a fresh issue, a
      priced run carrying an earlier total, an unpriced run inside a priced issue
      rendering a floor, an issue that has never been priced omitting the cost
      line entirely, a five-hour window at 23.5% consumed rendering `76.5%`
      remaining, a seven-day window rendering its own remaining percentage, a
      window at or above 100% consumed rendering no remaining rather than a
      negative, a window without `utilization` rendering status and reset only, a
      route with no windows omitting the limits line, and the budget line
      unchanged in every case. Verify
      `bun test tests/opencode-agent/reply.test.ts` fails.
- [ ] 7.2 Derive the per-run figure in `opencode-agent/src/reply-buffer.ts` from
      `latest.usdSpent − entry.usdSpent` (design D8) and pass the windows thunk
      through `ReplyDeps`, wired in `contain.ts`. Verify the 7.1 tests pass.
- [ ] 7.3 Render the cost and rate-limit lines in
      `opencode-agent/src/run-detail.ts`, deriving remaining as
      `100 − utilization × 100` at the render and nowhere else (design D6), and
      splitting the file if it crosses `max-lines` rather than compressing it.
      Verify
      `bun test tests/opencode-agent/reply.test.ts && bun run opencode-agent:lint`.
- [ ] 7.4 Write and satisfy the test that neither the rendered comment nor the
      run log carries the credential or any model or tool content (the spec's
      secrets scenario). Verify `bun test tests/opencode-agent/reply.test.ts`.

## 8. Verification and docs

- [ ] 8.1 Update `opencode-agent/CLAUDE.md` and `README.md` for the accounting
      surface: the ladder, the unpriced state, why the ceiling stays in tokens,
      and what the rate-limit line does and does not claim (the remaining
      percentage is the complement of a share the provider stated, and
      `total_cost_usd` on the subscription route is list price, not billed
      spend). Note the CLI pin floor and why it is a floor. Verify by reading the
      rendered sections.
- [ ] 8.2 Re-run the credentialed proof turn end to end on the bumped pin and
      confirm the posted comment's limits line matches the recorded
      `rate_limit_event` — the percentages, the reset times, and the windows.
      Verify `bun run opencode-agent:test:claude-live` and the rendered comment.
- [ ] 8.3 Run `bun run opencode-agent:test`, `bun run sdd-runner:test`,
      `bun run opencode-agent:typecheck`, `bun run sdd-runner:typecheck`,
      `bun run opencode-agent:lint`, `bun run sdd-runner:lint` and
      `bun run opencode-agent:format:check`; verify all pass.
- [ ] 8.4 Run the repo-wide `bun run test`, `bun run typecheck` and
      `bun run lint`, and confirm no `docs/architecture/*.md` page describes the
      run summary — `sdd-pipeline.md` covers the other workspace's renderer, so
      confirm rather than assume. Verify all three pass.
