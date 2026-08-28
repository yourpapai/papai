# sdd-policy-metered-budget

## Why

The auto-policy ladder has never decided anything: across all 14 retained runs, 31 presented gates were R4-gated, R1/R2/R3 fired zero decisions, and `autoExtendsUsed` is 0 in every run — 100% of the ~27 round-cap extensions were human `RUN 1 MORE` writes. Root cause: subscription providers (`zai-coding-plan/*`) report `costUsd: 0`, repricing falls through to unknown, and R4's `costKnown === false → always gate` fires first, which blocks R2 (whose projection needs a known cost) on every gate. Trajectory simulation over the same corpus shows 11 of 26 early gates were R2-eligible (0 blockers, ≥1 material, strictly decreasing) — roughly 40% of human gate interrupts were absorbable. A second defect surfaced in the same census: the deadline waiter's settle emits no `auto_decision` event, so a waiter-approved gate is indistinguishable from a human approval in `events.ndjson` (the lone corpus firing — the trilogy run's final gate — was approved by the 90-minute timer, visible only via the `.expiry-claim` sidecar), and the waiter's conservative ladder skips R4, making it *more* permissive than the prelude ladder it mirrors.

## What Changes

- `budget` accepts `null` (schema: `number | null`): null means unmetered — R4's cost-unknown branch is disabled and the round cap plus the R2 trajectory bound are the sole spend guards. `budget: 5` semantics unchanged.
- A new optional `metered: boolean` (default derived: true when `budget` is a number) lets a subscription config declare intent explicitly; R4 treats `metered: false` like `budget: null` for the cost-unknown branch while still enforcing explicit numeric budgets.
- The deadline waiter emits the standard `auto_decision` L2 event (with rule and `gateVersion`) when it claims and settles/re-arms/stays pending at expiry, preserving the replay-sufficiency contract.
- The waiter's conservative expiry ladder applies the same R4 treatment as the prelude ladder (an unmetered run's expiry may R2-extend; a metered run with unknown cost stays pending), removing the asymmetry.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `sdd-runner-autonomy`: R4 budget guard requirement gains unmetered semantics (`budget: null` / `metered: false` skip only the cost-unknown branch, never the explicit-exceedance branch); the `auto_decision` event requirement extends to deadline-waiter settles; the dead-man deadline requirement's conservative ladder aligns with R4. Without the change: every gate on a subscription provider is undecidable by policy (measured: all 31), the waiter's approvals are invisible in the audit log, and the two ladders disagree on what expiry may do.

## Impact

- Code: `sdd-runner/src/{config,auto-policy,gate-prelude,deadline-waiter,events}.ts` + tests under `tests/sdd-runner/`; `config.example.json` documentation of the two keys.
- Scope model: offline runner workspace; config is per-workdir runner config, not chat config-context state; no DB, no chat surfaces, no new dependencies.
- Docs: `docs/architecture/sdd-pipeline.md` (Config and autonomy, Deadline, Event model sections).
- Backward compat: existing five-key configs parse unchanged (`budget` stays a number; both new shapes are additive).
- Ordering: apply/archive `sdd-spec-repair` first — this change MODIFIES the R4 requirement, and its rewrite reads against a coherent parent spec.

## Non-goals

- Changing R1/R2/R3/R5 semantics or ladder order — the ladder's discrimination measured fine once unplugged.
- Provider-side metering or cost APIs; reprice sources beyond the existing `pricing.ts` resolver.
- Charging the gate screen or TUI with new decision surfaces — gates that R4 previously forced are simply no longer forced.
- The skeptic-merge/ledger defects (`sdd-review-loop-memory`) and oversize routing (`sdd-oversize-estimator-signals`).
