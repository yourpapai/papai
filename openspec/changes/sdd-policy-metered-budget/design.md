# Design — sdd-policy-metered-budget

## Context

See proposal.md — the census (31 R4 gates, zero ladder decisions, zero auto-extends) and the waiter forensics. Current constraints: `RunnerConfigSchema` is a strict five-key schema (`budget: number`, default 5) whose removed-key error surface is a deliberate contract; `auto-policy.ts` is pure and ladder-ordered (R1→R5, first match wins the *decision*, R4 "always gates"); `deadline-waiter.ts` re-runs a conservative subset at expiry and settles through the same file seam; `auto_decision` events are emitted by the gate prelude, not by the waiter's settle path.

## Goals / Non-Goals

**Goals:** unmetered runs get a working ladder; metered semantics unchanged for numeric budgets; waiter settles auditable in the event log; both ladders agree. Five-key strictness preserved (no sixth required key; both additions are optional/defaulted).

**Non-Goals:** ladder reordering, R1/R2/R3/R5 predicate changes, provider cost APIs, TUI changes.

## Decisions

### D1 — `budget: number | null` with default unchanged; `metered` optional boolean

`budget` widens to `number | null` (absent → `5`, so every existing config parses identically). `metered` is optional; when absent, metered-ness derives: `budget !== null`. R4's cost-unknown branch predicates on the *derived* metered flag; the explicit-exceedance branch predicates on numeric budget presence (a `budget: null` run has no numeric ceiling to exceed — the round cap and R2's persisted bound are the spend guards, per the spec's unmetered scenario). Alternatives rejected: a `pricing: "subscription"` enum — provider naming leaks into policy; dropping R4's unknown branch entirely — breaks metered users' fail-closed protection the day a provider's pricing data breaks.

### D2 — The carve-out lives inside R4, not as a ladder re-order

`auto-policy.ts` R4 gains the metered predicate; ladder order and every other rule are untouched. This keeps the pure decision function single-sourced and makes the corpus simulation directly testable: the same recorded gate states that measured 11-of-26 R2-eligible become the fixture set for "unmetered ladder decides R2-extend". Alternative rejected: short-circuiting the ladder before R4 in the prelude — two places would then encode metered-ness, and the waiter's ladder (which has its own copy of conservative logic) would drift again.

### D3 — Waiter settle emits `auto_decision` through the existing event seam

The waiter's claim path already runs through orchestrator-owned settle functions; those gain an emit of the standard `auto_decision` event with the conservative rule that applied (`R1`/`R2`/`stay-pending`) before writing the gate file. Decision values extend additively (`'gate' | 'approve' | 'extend' | 'pending'` as the waiter's outcomes); `SddEventSchema` unions widen, old logs parse unchanged. The `.expiry-claim` file remains the append-only claim artifact it already is — the event is the *decision* record, the claim is the *writer-exclusivity* record. (The gate-row text defect the corpus exposed — `- [x] F13 F13` — is fixed in `sdd-review-loop-memory`, which owns finding identity and the id→gap join its unique-id constraint makes sound.) Alternative rejected: inferring waiter settles from claim files in the analyzer — makes replay-sufficiency depend on a file, contradicting the event-model contract.

### D4 — Expiry parity by reusing the prelude's R4 predicate object

The waiter's `conservativeBranchApplies` calls the same metered-aware R4 predicate function the prelude uses, instead of its own hardcoded R1/R2 list. One predicate, two ladders. Alternative rejected: mirroring the condition in waiter code — the exact asymmetry this change removes.

## Hook / TDD interaction

Files touched: `config.ts` (schema), `auto-policy.ts` (R4), `gate-prelude.ts` (pass-through), `deadline-waiter.ts` (emit + parity), `events.ts` (decision values), each with its `tests/sdd-runner/` twin red-first. Fixture strategy: corpus-derived gate states (the 26 early gates with trajectories) pin both the metered and unmetered ladders' decisions.

## Risks / Trade-offs

- [`budget: null` runs lose cost telemetry entirely] → usage events and repricing are unchanged; only the *gate-forcing* branch is disabled; report still shows costs as estimated/unknown.
- [Unmetered R2-extend chains spend] → R2's own bounds stand (strictly-decreasing trajectory, persisted extend bound, round cap); the corpus shows the trajectory predicate rejects plateau cases a human should see.
- [Waiter-emitted events on a crashed settle] → the event is appended after the settle write succeeds, same ordering discipline as existing emits; a crash between write and emit degrades to today's claim-file-only audit, never to a false decision record.

## Migration Plan

Config-only opt-in: existing configs are metered by construction and behave byte-identically. Adopters set `budget: null` (or `metered: false`) to unblock the ladder on subscription providers. No state migration; `auto_decision` additions are schema-widening. Rollback = revert; waiter-emitted events from the interim period remain valid history.
