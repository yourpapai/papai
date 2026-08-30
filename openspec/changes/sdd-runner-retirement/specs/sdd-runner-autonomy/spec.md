<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## REMOVED Requirements

### Requirement: Autonomy levels and resolution
- **Reason**: The capability retires with the deleted workspace; afk-runner implements the same autonomy levels through its config-gated policy.
- **Migration**: The unarchived `afk-runner-gate` delta ("Autonomy ladder as producer") governs level resolution and the always-logging ladder.

### Requirement: Observe mode is behavior-identical with counterfactual record
- **Reason**: Observe mode was deliberately not ported to afk-runner — nothing in the C1–C7 delivery or the C7 live proof needed it, and carrying a counterfactual-recording mode across the re-host would have grown the engine for an absent consumer.
- **Migration**: None — declined scope, recorded here. If an unattended cycle later needs dry-run autonomy, it re-enters as a fresh requirement on the afk stack (U8-adjacent), not a port.

### Requirement: Decision ladder ordering
- **Reason**: The capability retires with the deleted workspace; the ladder ordering is re-specified by the afk stack.
- **Migration**: The unarchived `afk-runner-gate` delta ("Autonomy ladder as producer") carries the ordered rungs and the always-logs invariant.

### Requirement: R1 converged-final-approve
- **Reason**: The capability retires with the deleted workspace; afk-runner's auto-policy implements rule R1.
- **Migration**: `afk-runner`'s auto-policy (R1–R4) inside the autonomy-ladder producer specified by the `afk-runner-gate` delta.

### Requirement: R2 trajectory-auto-extend
- **Reason**: The capability retires with the deleted workspace; afk-runner's auto-policy implements rule R2.
- **Migration**: As with R1 — the `afk-runner-gate` delta's ladder producer, with extend suppressed from rendered gates where the R5 escalation rung owns the decision.

### Requirement: R3 assumption blast-radius triage
- **Reason**: The capability retires with the deleted workspace; afk-runner's auto-policy implements rule R3 over the gate's assumption set.
- **Migration**: The `afk-runner-gate` delta's ladder producer; blast-radius inputs ride the presented gate's assumption items.

### Requirement: R4 budget guard
- **Reason**: The capability retires with the deleted workspace; afk-runner's auto-policy implements the spend-ceiling guard.
- **Migration**: The `afk-runner-gate` delta's ladder producer; the guard's spend input is the gate-signals cost summary (tokens-first, fail-closed on unknown spend).

### Requirement: R5 reversibility boundary
- **Reason**: The capability retires with the deleted workspace; the reserved escalation rung on the afk stack enforces the same reversibility boundary.
- **Migration**: The unarchived `afk-runner-recovery` delta ("Escalation ladder rung and steer answerability") carries the reserved rung.

### Requirement: Never-cut invariants
- **Reason**: The capability retires with the deleted workspace; the invariants are enforced by the afk stack's guards and settle grammar.
- **Migration**: The unarchived `afk-runner-gate-settle-robustness` delta ("Expressible decisions at every gate shape", "Steer directives are never silently ignored") carries the decision-surface totality; `afk-runner-recovery` carries the escalation never-silent-death guarantee.

### Requirement: auto_decision event
- **Reason**: The capability retires with the deleted workspace; afk-runner's ladder logs its decisions to the same event vocabulary.
- **Migration**: The `afk-runner-gate` delta's always-logging ladder producer appends the auto-decision events; the log-fidelity change's deltas govern emission honesty.

### Requirement: Auto level dead-man deadline
- **Reason**: The capability retires with the deleted workspace; afk-runner arms deadlines as a thin config-gated layer with its own expiry producer.
- **Migration**: The unarchived `afk-runner-gate` delta's deadline behavior (thin config-gated deadlines) and the `gate-expiry` face specified alongside the foreground waiter.

### Requirement: Audit verb and reconsider list
- **Reason**: The audit verb belonged to the deleted workspace's CLI surface and was deliberately not ported — the events log is append-only and the reconsider surface had no consumer in the re-host.
- **Migration**: Declined scope, recorded here: the auto-decision events in `events.ndjson` are the audit trail any reader folds; a reconsider surface re-enters as a fresh requirement if a live cycle demands it (U8-adjacent).

### Requirement: Report gains block
- **Reason**: The capability retires with the deleted workspace; afk-runner's `report` port renders the same gains/median-dwell math.
- **Migration**: The unarchived `afk-runner-tail` delta governs `report`; the `afk-runner-runs` delta covers the cross-run roll-up.

### Requirement: Queued steering
- **Reason**: The capability retires with the deleted workspace; afk-runner steers live runs and parked gates through its own grammar.
- **Migration**: The unarchived `afk-runner-gate-settle-robustness` delta ("Steer directives are never silently ignored") carries the steer-landing grammar, including gate-level answers with consume-with-warning hygiene.
