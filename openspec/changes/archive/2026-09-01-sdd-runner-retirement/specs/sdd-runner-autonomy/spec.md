<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## REMOVED Requirements

### Requirement: Unconditional audit record
- **Reason**: The audit record belonged to the deleted workspace's autonomy surface; the reconsider/audit-verb consumer it fed was already declined in this change.
- **Migration**: Declined scope, recorded here: the auto-decision events in `events.ndjson` are the audit trail any reader folds (the `afk-runner-autonomy` spec's `auto_decision` event requirement); a reconsider surface re-enters as a fresh requirement if a live cycle demands it (U8-adjacent).

### Requirement: Decision ladder ordering
- **Reason**: The capability retires with the deleted workspace; the ladder ordering is re-specified by the afk stack.
- **Migration**: The `afk-runner-gate` spec ("Autonomy ladder as producer") carries the ordered rungs and the always-logs invariant, with the rung order governed by the `afk-runner-autonomy` spec ("Decision ladder ordering").

### Requirement: R1 converged-final-approve
- **Reason**: The capability retires with the deleted workspace; afk-runner's auto-policy implements rule R1.
- **Migration**: The `afk-runner-autonomy` spec ("R1 converged-final-approve") carries the rule over the openness predicate.

### Requirement: R2 trajectory-auto-extend
- **Reason**: The capability retires with the deleted workspace; afk-runner's auto-policy implements rule R2.
- **Migration**: The `afk-runner-autonomy` spec ("R2 trajectory-auto-extend"), with extend suppressed from rendered gates where the R5 escalation rung owns the decision.

### Requirement: R3 assumption blast-radius triage
- **Reason**: The capability retires with the deleted workspace; afk-runner's auto-policy implements rule R3 over the gate's assumption set.
- **Migration**: The `afk-runner-autonomy` spec ("R3 assumption blast-radius triage"); blast-radius inputs ride the presented gate's assumption items.

### Requirement: R4 budget guard
- **Reason**: The capability retires with the deleted workspace; afk-runner's auto-policy implements the spend-ceiling guard.
- **Migration**: The `afk-runner-autonomy` spec ("R4 budget guard", metered semantics); the guard's spend input is the gate-signals cost summary (tokens-first, fail-closed on unknown spend).

### Requirement: R5 reversibility boundary
- **Reason**: The capability retires with the deleted workspace; the reserved escalation rung on the afk stack enforces the same reversibility boundary.
- **Migration**: The `afk-runner-recovery` spec ("Escalation ladder rung and steer answerability") carries the reserved rung; the `afk-runner-autonomy` spec carries "R5 escalation rung".

### Requirement: Never-cut invariants
- **Reason**: The capability retires with the deleted workspace; the invariants are enforced by the afk stack's guards and settle grammar.
- **Migration**: The `afk-runner-gate-settle-robustness` spec ("Expressible decisions at every gate shape", "Steer directives are never silently ignored") carries the decision-surface totality; `afk-runner-recovery` carries the escalation never-silent-death guarantee; the `afk-runner-autonomy` spec re-states the never-cut invariants.

### Requirement: auto_decision event
- **Reason**: The capability retires with the deleted workspace; afk-runner's ladder logs its decisions to the same event vocabulary.
- **Migration**: The `afk-runner-autonomy` spec's `auto_decision` event requirement (one event per evaluation, waiter outcomes attributed) governs emission honesty.

### Requirement: Deadline waiter mechanics
- **Reason**: The capability retires with the deleted workspace; afk-runner arms deadlines as a thin config-gated layer with its own expiry producer.
- **Migration**: The `afk-runner-gate` spec ("Deadline expiry is thin and config-gated", "Foreground waiter") and the `afk-runner-autonomy` spec ("Deadline waiter") carry the claim/re-arm/expiry protocol.

### Requirement: Policy debt and after-the-fact overturn
- **Reason**: The reconsider surface fed by this requirement had no consumer in the re-host and rode the deleted workspace's autonomy levels.
- **Migration**: None — declined scope, recorded here. The auto-decision event log is the replayable record of every policy decision; an overturn surface re-enters as a fresh requirement if an attended cycle demands it (U8-adjacent).

### Requirement: Report gains block
- **Reason**: The capability retires with the deleted workspace; afk-runner's `report` port renders the same gains/median-dwell math.
- **Migration**: The `afk-runner-tail` spec ("Run report") governs `report`; the `afk-runner-runs` spec covers the cross-run roll-up.

### Requirement: Queued steering
- **Reason**: The capability retires with the deleted workspace; afk-runner steers live runs and parked gates through its own grammar.
- **Migration**: The `afk-runner-gate-settle-robustness` spec ("Steer directives are never silently ignored") carries the steer-landing grammar, including gate-level answers with consume-with-warning hygiene; the `afk-runner-autonomy` spec ("Pre-settle steer override") carries the queued-human-word precedence.
