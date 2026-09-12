# afk-runner-metered-budget

## Why

`afk-runner/src/work/auto-policy.ts` sits verbatim at the pre-fix shape —
`if (!signals.costKnown) return { rule: 'R4', action: 'gate' }` — and
`config.ts` requires `budget: z.number().positive()`. The consequence was
measured on the shared ancestor: across 14 retained runs, **31 presented gates
were R4-gated, R1/R2/R3 fired zero decisions, and `autoExtendsUsed` was 0 in
every run** — 100% of the ~27 round-cap extensions were human `RUN 1 MORE`
writes. Root cause: subscription providers report `costUsd: 0`, repricing
falls through to unknown, and R4's cost-unknown branch fires ahead of R2 on
every gate. afk-runner inherits the deadlock unchanged. Second inherited defect: the expiry
waiter settles without emitting `auto_decision`, so a waiter approval is
indistinguishable from a human one in the log, and its ladder skips R4 — making
it *more* permissive than the prelude ladder it mirrors.

## What Changes

- `budget` accepts `null` (`number | null`): null means **unmetered** — R4's
  cost-unknown branch is disabled and the round cap plus the R2 trajectory
  bound become the sole spend guards. `budget: 5` semantics unchanged.
- A new optional `metered: boolean` (default derived: true when `budget` is a
  number) lets a subscription config declare intent explicitly; R4 treats
  `metered: false` like `budget: null` for the cost-unknown branch only.
- R4's explicit-exceedance branch predicates on numeric-ceiling presence, so an
  explicitly configured numeric budget is never bypassed by anything.
- The deadline waiter emits the standard `auto_decision` L2 event (rule +
  `gateVersion`) when it claims and settles, re-arms, or stays pending.
- The waiter's conservative expiry ladder applies the same R4 treatment as the
  prelude ladder, removing the asymmetry.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `afk-runner-autonomy`: the R4 budget-guard requirement gains unmetered
  semantics (`budget: null` / `metered: false` skip only the cost-unknown
  branch, never explicit exceedance); the `auto_decision` requirement extends
  to deadline-waiter settles; the deadline requirement's conservative ladder
  aligns with R4. Without it every gate on a subscription provider stays
  undecidable by policy, waiter approvals stay invisible in the audit log, and
  the two ladders keep disagreeing about what expiry may do.

## Impact

- Code: `afk-runner/src/config.ts`, `work/auto-policy.ts`, `work/gate-prelude.ts`,
  `work/gate-expiry.ts`, `work/gate-waiter.ts` + tests under `tests/afk-runner/`.
- Event grammar: `auto_decision` already exists — no new event type; the
  26-fixture parity harness and memo oracle must stay green. Five-key configs
  parse unchanged; both new shapes are additive.
- Docs: `afk-runner.md`, `sdd-pipeline.md` (autonomy, deadline, event model).
- Instances/scope: none — offline runner workspace, per-workdir config; no DB,
  no chat surfaces, no per-user / group-shared / thread-isolated state.
- Depends on `afk-runner-spec-home` for its parent capability.

## Non-goals

- R1/R2/R3/R5 semantics or ladder ordering — the ladder discriminated fine once
  unplugged.
- Provider-side metering or cost APIs; reprice sources beyond the existing
  pricing resolver.
- New gate or operator decision surfaces — gates R4 previously forced are
  simply no longer forced.
- The decomposition/plan branch, declined across this mirror wave: master built
  it and measured it never executed (0 `plan` events in 14 runs); U2 stays
  parked pending afk's own evidence.
