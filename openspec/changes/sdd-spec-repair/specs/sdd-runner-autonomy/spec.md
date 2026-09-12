## REMOVED Requirements

### Requirement: Autonomy levels and resolution

**Reason:** The subcommand cutover removed autonomy levels, the CLI `--autonomy` flag, the `autonomy` config block, the `rules` map, and `permittedAt`; the ladder now always evaluates and settles what it can (assist semantics), and config is the strict five-key schema.

**Migration:** Single-mode evaluation is specified by the new "Single-mode policy evaluation" requirement; the five-key config schema (`repoRoot`, `workDir`, `model`, `budget`, `deadline`) is the sole configuration surface, with removed keys rejected at load time naming their replacements.

### Requirement: Observe mode is behavior-identical with counterfactual record

**Reason:** Observe was a level, and levels are gone; previews and the counterfactual sidecar became unconditional — every presented gate carries its preview regardless of any level.

**Migration:** Preview and sidecar behavior is specified unconditionally by the new "Unconditional policy previews" requirement; `auto-policy.jsonl` keeps its append-only contract.

### Requirement: Audit verb and reconsider list

**Reason:** The `audit` subcommand and the `sdd-runner gate reopen` subcommand shape were removed with the subcommand cutover; both fail today with errors naming their replacements.

**Migration:** The overturn surface is the reopen start flag specified by the new "Reopen is the overturn surface" requirement; the policy-debt ledger survives as specified there. The reconsider list has no current surface and is not re-specified.

### Requirement: Auto level dead-man deadline

**Reason:** `--auto-deadline`, the `gate resume` invocation, and `--no-wait` are removed surfaces; the deadline is now the `deadline` config key, and the waiter derives from TTY context rather than a level.

**Migration:** Current semantics — config key, presentation-time arming, non-TTY derivation, claim-file exclusivity, conservative ladder, single re-arm, never auto-abort — are specified by the new "Deadline waiter" requirement.

## ADDED Requirements

### Requirement: Single-mode policy evaluation

The policy ladder SHALL always evaluate every presented gate and settle what it can: there SHALL be no autonomy levels, no `rules` map, no `permittedAt`, and no per-rule enablement. Configuration SHALL be the strict five-key schema (`repoRoot`, `workDir`, `model`, `budget`, `deadline`); any other key SHALL be rejected at load time naming its replacement. The trajectory window and the budget guard SHALL be the sole extension bounds.

#### Scenario: Unknown config key fails naming the replacement

- **WHEN** config contains `autonomy` or `budgetUsd` or `models`
- **THEN** loading SHALL fail with an error naming the replacement key, and no run SHALL start

#### Scenario: Every gate is evaluated with no level selection

- **WHEN** a run presents a gate with no level, flag, or rule configuration anywhere
- **THEN** the ladder SHALL evaluate the gate and settle exactly what its rules permit, with every undecidable gate left pending for a human

### Requirement: Unconditional policy previews

Every presented gate SHALL carry an `### Auto-decision preview` block naming the rule that would have fired, the decision it would have made, and an evidence digest, regardless of any configuration. Every presented gate SHALL append one record to the append-only `auto-policy.jsonl` sidecar in the run directory and one `auto_decision` event to the run's event log; undecidable gates SHALL additionally append a workdir-level policy-debt ledger entry at gate-decision time.

#### Scenario: Observe run keeps today's gate flow

- **WHEN** any run presents a gate
- **THEN** the gate SHALL be presented to the human, and the gate file SHALL gain an `### Auto-decision preview` block with rule, would-be decision, and evidence digest

#### Scenario: Counterfactual sidecar is append-only and complete

- **WHEN** a run presents multiple gates
- **THEN** `auto-policy.jsonl` SHALL contain one appended record per gate preview, and no record SHALL be mutated or removed after writing

#### Scenario: Undecidable decisions are recorded as policy debt

- **WHEN** the ladder fails to decide a gate and a human decides instead
- **THEN** the decision SHALL be recorded in the policy-debt ledger at gate-decision time

### Requirement: Reopen is the overturn surface

A start invocation with a run id and `--reopen [<n>]` SHALL re-present a settled auto-decided gate at a fresh version as an unanswered digest — boxes unchecked, answered section cleared, fresh hashes sidecar — SHALL revert a terminal `completed` status to the pre-settle stage state, SHALL clear deadline fields, and SHALL set the run's gate pending so the existing veto/abort resume mechanics apply. Reopen SHALL refuse when a gate is already pending, when the named version is missing or was never settled, or when the named gate is not the latest settled gate; omitted `n` SHALL mean the latest settled gate.

#### Scenario: Reopen re-presents a settled auto-decided gate

- **WHEN** an auto-settled gate is reopened
- **THEN** the run SHALL present a fresh unanswered gate version and revert any terminal status, with deadline fields cleared

#### Scenario: Reopen refuses a pending gate

- **WHEN** reopen is invoked while the run's gate is pending
- **THEN** the invocation SHALL fail and the pending gate SHALL be untouched

### Requirement: Deadline waiter

The config `deadline` key (minutes, optional) SHALL arm a gate deadline at presentation, accompanied by a bell/notification line, without blocking the process. A deadline SHALL cause a waiter to run only when the context is non-TTY. The waiter SHALL poll run state and the gate file without caching, SHALL settle stable hand edits through the normal settle path, and SHALL translate landing steering directives. At expiry the waiter SHALL claim the gate via an exclusive-create claim file (the claim remains as an append-only audit artifact), SHALL re-run the conservative ladder (R1 approve, else R2 extend, else stay pending), and SHALL re-arm at most once; it SHALL never auto-abort. Deadline fields SHALL clear on any settle and on reopen, and SHALL be overwritten or cleared at every presentation.

#### Scenario: Deadline auto-proceeds an unvetoed gate

- **WHEN** a deadline-armed gate remains undecided at expiry in a non-TTY context
- **THEN** the waiter SHALL claim the gate and settle under the conservative ladder if a branch applies, or stay pending with the deadline re-armed at most once, and in either case emit a bell/notification line

#### Scenario: Gate settled externally before expiry

- **WHEN** a deadline-armed gate is settled by another invocation before expiry
- **THEN** the waiter SHALL observe the settlement and exit without acting

#### Scenario: Deadline off by default

- **WHEN** config omits `deadline`
- **THEN** gates SHALL wait for the human indefinitely, exactly as blocking gates do

## MODIFIED Requirements

### Requirement: Report gains block

The completed-run report — rendered through the routing verb or session screen — SHALL include a gains block sourced from `auto_decision` events: interventions avoided, the number of human gates, estimated wall-time saved, and per-rule counts. Only events with `decision` of `approve` or `extend` that are paired with a subsequent `gate answered` event (i.e., the decision was actually settled, not crash-orphaned) SHALL count as interventions avoided; `accept-items` records (partial pre-check-and-present — a human gate was still presented) SHALL be reported separately as per-rule items auto-accepted and SHALL NOT count; undecidable `gate`/`none` records SHALL be excluded from that count.

#### Scenario: Gains block reflects recorded auto-decisions

- **WHEN** a run's `events.ndjson` contains `auto_decision` events for rules R1 and R2
- **THEN** the report gains block SHALL show the interventions avoided per rule id, the total human gates, and an estimated wall-time saved figure

### Requirement: Queued steering

For long runs, `runs/<id>/steer.md` SHALL accept the directives `extend`, `veto <id>=<redirect>`, and `abort`, consumed at the next round boundary. Queued steering SHALL NOT replace blocking gates — blocking gates SHALL remain the default; staged directives SHALL be persisted before the append-on-consume rename, unknown directives SHALL warn and skip, and a steered `extend` SHALL NOT consume any auto-extend budget.

#### Scenario: Steer directive consumed at round boundary

- **WHEN** a `veto <id>=<redirect>` line exists in `runs/<id>/steer.md` while a run is mid-round
- **THEN** the directive SHALL take effect at the next round boundary without requiring the human to sit in a blocking prompt

#### Scenario: Blocking gates unchanged at observe and assist

- **WHEN** any run reaches a gate
- **THEN** the gate SHALL be presented as blocking for human decision exactly as today, regardless of queued-steering support
