## Why

`AGENT_MAX_TOKENS` bounds what one issue may spend, and on the claude backend it counts a number that is not spend. `claude-contract.ts:255` sums `input + output + cache_creation + cache_read` into `usage.total`, and the CLI's `result` line has already summed those buckets over **every API iteration in the turn** — so `cache_read` counts the same context once per assistant step. The figure grows as _steps × context_, not as content processed.

Issue #385 parked in `FAILED` at 6,835,879 of 5,000,000 tokens having cost $9.23 and used 10% of a 5-hour window. Its blended rate ($1.30/M against $0.30/M for cache reads) puts cache reads at ~80% of the count; the archived `cached-token-accounting` change measured 95% on a comparable run. The ceiling stopped a run nowhere near its budget, under a notice naming a limit that was never the problem.

The OpenCode route gets this right by doctrine — `sdk-contract.ts:252` counts `input + output + reasoning`, and its `cacheBucketSchema` comment says cache buckets _"feed the price instead"_. One environment variable, two incompatible scales.

## What Changes

- **BREAKING (meaning, not shape):** the ceiling counts `input + output + reasoning + cacheWrite` on both routes. Cache **reads** leave the claude ceiling and stay in the price; cache **writes** join the OpenCode ceiling, being content entering the context for the first time — what OpenCode's `input` already measures.
- Carried `tokensSpent` on the old scale resets once per issue, marked by a defaulted state field, so no total mixes two scales and no `STATE_VERSION` bump strands anyone.
- An over-budget stop no longer flips `usdUnpriced`: it calls `deps.spend()` on a session that prompted nothing this job, and "spent nothing" currently reports as "could not be priced" — why #385's last comment reads `≥ $9.23 (some turns unpriced)` when every turn was priced.
- Pricing is untouched; every dollar figure stays as it is.

## Capabilities

### New Capabilities

- `agent-token-ceiling`: what the per-issue ceiling counts, when it stops a run, and how a carried total survives a change of scale.

Nothing pins this today, which is how the backends drifted: each took a different plausible reading of "tokens" and no artifact made them answer the same question. Without it, the fix is a one-line edit the next backend is free to get wrong again. The archived `cached-token-accounting` took `skip_specs: true` correctly — it changed _reporting_; this changes a guardrail that parks issues in `FAILED`.

### Modified Capabilities

None.

## Non-goals

- **Any cost figure.** `run-spend.ts`'s ladder, `costOfUsage` and the `total_cost_usd` pass-through stay byte-identical.
- **Recalibrating the `AGENT_MAX_TOKENS` default.** Picking an honest number needs runs measured on the new scale. Declined, not overlooked.
- **Rendering cache reads in the run-detail comment.** Justified only by an anticipated need to explain the new number.
- **`review-loop` and `sdd-runner`.** Both keep cache buckets unsummed (`claude-stream.ts:131`, `usage-aggregate.ts:71`); sdd-runner's budget is cost-based. Neither carries the bug.
- **The killed-turn under-count** on the claude route — real, separate, already in `README.md`.

## Impact

- **Scope model: none.** `opencode-agent` is developer tooling outside papai's runtime: no platform instance, no task instance, no config context. Its one durable scope key is the issue number, and `tokensSpent` is already per-issue.
- `opencode-agent/src/`: `claude-contract.ts`, `sdk-contract.ts`, `claude-spend.ts`, `claude-adapter.ts`, `agent-state.ts`, `orchestrator.ts`, `token-budget.ts`.
- Tests: `claude-contract.test.ts:116,140,160` pin today's `total`; the adapter, budget, state and orchestrator suites follow.
- Docs: `opencode-agent/README.md` (budgets table, claude-route trade-offs) and `opencode-agent/CLAUDE.md`. No `docs/architecture/*.md` page covers this workspace. The mutation gate does not reach this workspace — `stryker.config.json`'s `mutate` globs cover `src/`, `plugins/`, `sdd-runner/` and `review-loop/` only, and `scripts/mutation/baseline.json` holds no `opencode-agent/` entry.
