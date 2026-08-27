# sdd-runner-autonomy Specification

## Purpose

Defines the deterministic decision ladder that lets sdd-runner settle the gates
it can decide and present the ones it cannot, the never-cut invariants that no
rule may cross, and the audit trail every decision leaves behind. Autonomy is
single-mode: the ladder always evaluates, bounded by the one `budget` key and
the optional `deadline` (see the sdd-runner-config capability).

## Requirements

### Requirement: Unconditional audit record

Every presented gate SHALL carry an `### Auto-decision preview` block naming the rule that fired or would have fired, the decision it made or would have made, and an evidence digest; the same record SHALL be appended to the run's append-only `auto-policy.jsonl`, and an `auto_decision` event SHALL be emitted. These records SHALL be written unconditionally — they SHALL NOT depend on any level, flag, or configuration. A gate the ladder could not decide SHALL additionally append an entry to the workdir-level policy-debt ledger. The preview block SHALL be parse-inert: it SHALL NOT be readable as gate input, and a hand-mangled preview SHALL NOT change the parsed decision.

#### Scenario: Every gate carries its preview and ledger line

- **WHEN** any gate is presented
- **THEN** the gate file gains the preview block, `auto-policy.jsonl` gains one line, and an `auto_decision` event is emitted

#### Scenario: Preview cannot become gate input

- **WHEN** the preview block in a gate file is hand-edited to look like a decision
- **THEN** the parsed gate response is unaffected by the preview's content

### Requirement: Decision ladder ordering

Before any human gate is presented the pipeline SHALL evaluate the decision ladder in order: never-cut pre-checks first, then a deterministic rule, and only when no rung decides SHALL the human gate be presented. A rule SHALL apply only while the run remains under the configured budget. Every auto-decision SHALL cite the rule id and an evidence digest that fired it.

#### Scenario: Undecidable situation presents the gate

- **WHEN** a gate situation arises and no rule's predicate matches the recorded signals
- **THEN** the human gate SHALL be presented and the situation SHALL be recorded as policy debt

#### Scenario: Auto-decision cites its rule and evidence

- **WHEN** a rule settles a gate
- **THEN** the decision record names the rule id and the evidence digest that fired it

### Requirement: R1 converged-final-approve

A final gate whose review round recorded zero open BLOCKER findings, zero open MATERIAL findings, and zero open NITPICK findings, with every surviving assumption classified low-blast, SHALL be auto-approved by rule R1. The auto-decided gate SHALL still write `gate-<n>.md`, consume a gate version, have its checkboxes pre-checked, and annotate each decided line with `decided-by: policy R1`.

#### Scenario: Fully converged final gate auto-approves

- **WHEN** a run converges with zero findings of any severity and all surviving assumptions low-blast
- **THEN** rule R1 approves the gate, writes the versioned gate file with `decided-by` annotations, and the pipeline continues without waiting for a human

#### Scenario: A surviving finding blocks R1

- **WHEN** the final round recorded any open finding of any severity
- **THEN** R1 SHALL NOT fire and the gate SHALL be presented

### Requirement: R2 trajectory-auto-extend

When a round cap is hit with zero open BLOCKERs, at least one open MATERIAL, a strictly decreasing open-findings count across the last 2 rounds, and projected spend under the configured budget, rule R2 SHALL auto-extend exactly one round using the existing extend-round mechanics and `state.roundCap`. Eligibility SHALL be bounded by the trajectory window and the budget guard alone — there SHALL be no auto-extend count limit and no auto-extend count state. Each auto-extend SHALL append the trajectory row and an `auto_decision` event, and SHALL persist the bumped cap before the extended round spends.

#### Scenario: Converging loop earns an extension

- **WHEN** a cap-hit run has zero BLOCKERs, open MATERIALs, strictly decreasing open-findings counts across the last 2 rounds, and projected spend under budget
- **THEN** exactly one more review round runs and eligibility is re-evaluated at the next cap hit

#### Scenario: Flat trajectory never auto-extends

- **WHEN** a cap-hit run's open-findings counts are not strictly decreasing across the last 2 rounds
- **THEN** no automatic extension occurs and the early gate SHALL be presented

### Requirement: R3 assumption blast-radius triage

Each assumption at a gate SHALL be classified deterministically as low-blast or high-blast using only arithmetic over recorded run artifacts (files referenced, spec deltas, tasks touched); classification SHALL NOT involve agent judgment. An assumption SHALL be classified low-blast only when all of the following hold: every file it references lies inside the change folder or the run directory, was recorded by the pipeline itself, touches no spec delta, and touches no tasks checklist line; every other assumption SHALL be classified high-blast. The per-assumption file evidence SHALL come from a recorded `evidence.files` field in the resolver sidecar contract, cross-checked against recorded artifact events; an assumption with missing, empty, or unverifiable evidence SHALL be classified high-blast (fail closed — never vacuously low-blast). The agent-emitted `blast_radius` text SHALL be display-only and SHALL NOT be consulted by the classifier. When R3 finds a low-blast subset on a gate that also contains items no rule can decide, those low-blast items SHALL be pre-checked with `decided-by: policy R3` annotations and the gate SHALL still be presented to the human for the remaining items; such partial acceptance SHALL NOT count as an intervention avoided.

#### Scenario: Unverifiable evidence fails closed

- **WHEN** an assumption carries missing, empty, or un-cross-checkable file evidence
- **THEN** it SHALL be classified high-blast and SHALL require a human decision

#### Scenario: Mixed gate is pre-checked and still presented

- **WHEN** a gate carries both low-blast assumptions and an item no rule can decide
- **THEN** the low-blast items are pre-checked with `decided-by: policy R3` and the gate is still presented for the rest

#### Scenario: High-blast assumption always gates

- **WHEN** an assumption's deterministic classification is high-blast
- **THEN** the pipeline SHALL present that assumption to the human

### Requirement: R4 budget guard

All auto-decisions in a run SHALL be bounded by the configured `budget`. Any projected or actual exceedance SHALL cause a human gate regardless of any other rule's predicate. When the run's cumulative cost is unknown (unmetered or fallback-priced models), the guard SHALL fail closed: every auto-decision SHALL be declined in favor of a human gate. For a nested run the comparison SHALL include the ancestor spend the parent passed down, so every level of a run tree compares against the single configured budget.

#### Scenario: Budget exceedance gates despite other rules

- **WHEN** a rule's predicate matches but the run's projected spend reaches or crosses `budget`
- **THEN** the pipeline SHALL present a human gate and SHALL NOT auto-decide

#### Scenario: Unknown cost fails closed

- **WHEN** a rule's predicate matches but the run's cumulative cost cannot be metered
- **THEN** the pipeline SHALL present a human gate and SHALL NOT auto-decide

### Requirement: R5 reversibility boundary

A rule SHALL auto-decide only actions whose entire write set is the run directory plus the change folder on the current branch. Actions that leave the branch — PR creation, merges, deletion of other branches — SHALL never be auto-decided.

#### Scenario: PR creation is never auto-decided

- **WHEN** the pipeline reaches a step that would create a PR, merge, or delete another branch
- **THEN** the action SHALL require a human decision

### Requirement: Never-cut invariants

(1) An open BLOCKER at a gate SHALL always produce a human gate; no rule SHALL auto-answer or auto-override a BLOCKER. (2) Budget or round-cap exceedance SHALL always gate. (3) Leaving-the-branch actions SHALL always be human. (4) Auto-decided gates SHALL still write `gate-<n>.md`, consume a gate version, and settle through the same integrity-verification path as human approvals, so they remain hash/audit anchors; the gate-file grammar carries only an optional `decided-by:` annotation, covered by the write-then-parse self-check, and the hand-edited path SHALL be unaffected. (5) `events.ndjson` SHALL remain append-only and replay-sufficient.

#### Scenario: Open BLOCKER always gates

- **WHEN** any gate situation includes an open BLOCKER finding
- **THEN** the pipeline SHALL present a human gate and no rule SHALL auto-decide it

#### Scenario: Auto-decided gate file parses under extended grammar

- **WHEN** a `gate-<n>.md` written by an auto-decision is parsed
- **THEN** it SHALL parse under the existing grammar plus the optional `decided-by:` annotation, and the write-then-parse self-check SHALL pass

### Requirement: auto_decision event

`events.ndjson` SHALL carry an L2 event type `auto_decision` with `{ rule, decision, evidenceDigest, gateVersion }`. The log SHALL remain append-only, and replaying `events.ndjson` alone SHALL rebuild every auto-decision record.

#### Scenario: Replay rebuilds decisions from the log alone

- **WHEN** `events.ndjson` from a run is replayed without any other run artifacts
- **THEN** every auto-decision SHALL be reconstructible from the `auto_decision` events

### Requirement: Deadline waiter mechanics

When a gate is presented while a deadline is configured, the deadline SHALL be persisted in run state and announced with a terminal bell or notification line. The waiter SHALL reload run state from disk before acting, treat a gate settled by any other process as done, honor a hand-edited gate file by settling it through the normal resume path once its content is stable, and consume queued steering directives during the wait (rename-on-consume, the same protocol as round-boundary consumption), translating a landing `extend` to the extend outcome at an early gate and skipping it with a warning at a final or plan gate. The persisted deadline fields SHALL be cleared on any settle and on gate reopen, and SHALL be overwritten (when configured) or cleared (when not) at every gate presentation, so no stale deadline survives its gate. Before any expiry write the waiter SHALL claim the gate via an exclusive-create claim file so that it and an interactive decision cannot double-settle: the first writer wins and the loser SHALL be rejected as already-settled. At expiry the ladder SHALL be re-run conservatively — approve only what a rule permits, else extend if eligible, else leave the gate pending — the deadline SHALL re-arm at most once, and abort SHALL never be auto-chosen.

#### Scenario: Expiry settles conservatively or stays pending

- **WHEN** the deadline expires with the gate unanswered
- **THEN** the ladder settles only what a rule permits and otherwise leaves the gate pending with the deadline re-armed at most once, never aborting

#### Scenario: Gate settled externally before expiry

- **WHEN** a gate with a pending deadline is settled by another process before the deadline passes
- **THEN** the waiter SHALL observe the settlement and exit without auto-proceeding

#### Scenario: First writer wins the expiry race

- **WHEN** an interactive decision write and the expiry claim race for the same gate
- **THEN** exactly one wins, the loser is rejected as already-settled, and the settled state is rendered

### Requirement: Policy debt and after-the-fact overturn

Every gate the ladder could not decide SHALL be recorded in a workdir-level policy-debt ledger at gate-decision time — not deferred to a later reporting step — so recurring patterns can be promoted to candidate rules. An auto-settled decision SHALL remain overturnable after the fact through gate reopen, which re-presents the latest settled gate version as pending and unanswered so the existing veto and abort mechanics apply. Reopen SHALL refuse when a gate is already pending, when the named gate version does not exist or was never settled, or when it is not the latest settled gate of the run.

#### Scenario: Undecidable gate is recorded as policy debt

- **WHEN** the ladder fails to decide a gate and a human decides instead
- **THEN** the decision SHALL be recorded in the policy-debt ledger at that moment

#### Scenario: Auto-settled decision can be overturned

- **WHEN** an operator reopens a run's latest settled auto-decided gate
- **THEN** it is re-presented as pending and unanswered, and the veto and abort mechanics apply to it

### Requirement: Report gains block

The completed-run report SHALL include a gains block sourced from `auto_decision` events: interventions avoided, the number of human gates, estimated wall-time saved, and per-rule counts. Only events with `decision` of `approve` or `extend` that are paired with a subsequent `gate answered` event (that is, the decision was actually settled, not crash-orphaned) SHALL count as interventions avoided; `accept-items` records — partial pre-check-and-present, where a human gate was still shown — SHALL be reported separately as per-rule items auto-accepted and SHALL NOT count; undecidable `gate` records SHALL be excluded from that count.

#### Scenario: Gains block reflects recorded auto-decisions

- **WHEN** a run's `events.ndjson` contains `auto_decision` events for rules R1 and R2
- **THEN** the report gains block SHALL show the interventions avoided per rule id, the total human gates, and an estimated wall-time saved figure

### Requirement: Queued steering

For long runs, `runs/<id>/steer.md` SHALL accept the directives `extend`, `veto <id>=<redirect>`, and `abort`, consumed at the next round boundary with the staged set persisted before the append-only rename-on-consume. Unknown directives SHALL warn and be skipped. A steered `extend` SHALL re-read the persisted round cap at the next boundary. A staged abort or veto SHALL take precedence over any pending auto-settle, so queued steering never loses a race with the ladder.

#### Scenario: Steer directive consumed at round boundary

- **WHEN** a `veto <id>=<redirect>` line exists in `runs/<id>/steer.md` while a run is mid-round
- **THEN** the directive SHALL take effect at the next round boundary without requiring the human to sit in a blocking prompt

#### Scenario: Staged abort beats a pending auto-settle

- **WHEN** a staged abort or veto directive is queued while the ladder would otherwise auto-settle the gate
- **THEN** the gate SHALL be presented to the human instead of being auto-settled
