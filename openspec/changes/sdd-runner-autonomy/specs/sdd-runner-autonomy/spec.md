## Purpose

Reduces human-in-the-loop interventions in sdd-runner runs through bounded, deterministic, fully audited auto-decision policy — autonomy levels, decision rules R1–R5, never-cut invariants, and the audit/report surfaces that keep every auto-decision replayable and overturnable.

## ADDED Requirements

### Requirement: Autonomy levels and resolution

sdd-runner SHALL support three autonomy levels: `observe`, `assist`, and `auto`. The effective level SHALL resolve as CLI `--autonomy` when given, else the `autonomy.level` key in `sdd-runner/config.json`, else the default `observe`. The config SHALL gain an `autonomy` block `{ level, costCeilingUsd, autoExtendMax, deadlineMinutes, rules }` with safe defaults (`observe`, `5.0`, `1`, off, `{}`). Rules R1, R2, and R3 SHALL be individually enableable/disableable via the `rules` map; R4 (budget guard) and R5 (reversibility) are never-cut invariants and SHALL remain in force regardless of any `rules` entry naming them. When the existing top-level `budgetUsd` and `autonomy.costCeilingUsd` differ, the policy's effective ceiling SHALL be the smaller of the two.

#### Scenario: Default is observe

- **WHEN** a run starts with no `--autonomy` flag and no `autonomy` block in config
- **THEN** the run SHALL behave at level `observe`

#### Scenario: CLI overrides config

- **WHEN** config sets `autonomy.level` to `observe` and the CLI passes `--autonomy assist`
- **THEN** the run SHALL behave at level `assist`

### Requirement: Observe mode is behavior-identical with counterfactual record

At level `observe`, pipeline behavior and non-TTY output SHALL remain byte-identical to behavior without the autonomy feature. Every gate the pipeline presents SHALL additionally carry an `### Auto-decision preview` block naming the rule that would have fired, the decision it would have made, and an evidence digest. Every such preview SHALL also be appended to an append-only counterfactual sidecar `auto-policy.jsonl` in the run directory.

#### Scenario: Observe run keeps today's gate flow

- **WHEN** a run at level `observe` reaches any gate
- **THEN** the gate SHALL be presented to the human exactly as before, and the gate file SHALL gain an `### Auto-decision preview` block with rule, would-be decision, and evidence digest

#### Scenario: Counterfactual sidecar is append-only and complete

- **WHEN** an `observe` run presents multiple gates
- **THEN** `auto-policy.jsonl` SHALL contain one appended record per gate preview, and no record SHALL be mutated or removed after writing

### Requirement: Decision ladder ordering

Before any human gate is presented at `assist` or `auto`, the pipeline SHALL evaluate the decision ladder in order: a policy-defined decision applies first; an already-computed signal is reused next; a deterministic rule is applied next; a rule applies only while the run remains under its configured budget ceilings; only when no rung decides SHALL the human gate be presented. Every auto-decision SHALL cite the rule id and an evidence digest that fired it.

#### Scenario: Human gate only when no rung decides

- **WHEN** a gate situation arises at level `assist` or `auto` and no enabled rule's predicate matches the recorded signals
- **THEN** the pipeline SHALL present the human gate exactly as it does today

#### Scenario: Every auto-decision is attributable

- **WHEN** any rule auto-decides a gate
- **THEN** the decision record SHALL name the rule id and include an evidence digest sufficient to replay why the rule fired

### Requirement: R1 converged-final-approve

At level `assist` or higher, a final gate with 0 open BLOCKER findings, 0 open MATERIAL findings, all findings resolved, and all surviving assumptions classified low-blast SHALL be auto-approved by rule R1. The auto-decided gate SHALL still write `gate-<n>.md`, consume a gate version, have its checkboxes pre-checked, and annotate each decided line with `decided-by: policy R1`.

#### Scenario: Converged final gate completes without a prompt

- **WHEN** an `assist`-level run converges with 0 BLOCKER, 0 MATERIAL, all findings resolved, and all surviving assumptions low-blast
- **THEN** the run SHALL reach `completed` with zero human prompts, and the final `gate-<n>.md` SHALL exist with pre-checked boxes and `decided-by: policy R1` annotations

#### Scenario: High-blast surviving assumption blocks R1

- **WHEN** a final gate meets the convergence criteria but at least one surviving assumption is classified high-blast
- **THEN** R1 SHALL NOT fire and the final gate SHALL be presented to the human

### Requirement: R2 trajectory-auto-extend

At level `assist` or higher, when a round cap is hit with 0 open BLOCKERs, at least one open MATERIAL, a strictly decreasing open-findings count across the last 2 rounds, and projected remaining spend under the cost ceiling, rule R2 SHALL auto-extend exactly one round using the existing extend-round mechanics and `state.roundCap`. The number of auto-extends per run SHALL be bounded by `autoExtendMax` (default 1). Each auto-extend SHALL append the trajectory row and an `auto_decision` event. If the extended round does not converge or improve, the early gate SHALL be presented as today.

#### Scenario: Strictly decreasing burndown auto-extends once

- **WHEN** a cap-hit run at `assist` has 0 BLOCKERs, open MATERIALs, strictly decreasing open-findings counts across the last 2 rounds, and projected spend under the ceiling
- **THEN** the run SHALL auto-extend exactly one round, appending exactly one trajectory row and one `auto_decision` event, without prompting

#### Scenario: Flat trajectory does not auto-extend

- **WHEN** a cap-hit run's open-findings count is flat or increasing across the last 2 rounds
- **THEN** R2 SHALL NOT fire and the cap-hit gate SHALL be presented to the human

#### Scenario: Auto-extend bound is enforced

- **WHEN** a run has already consumed `autoExtendMax` auto-extends and cap-hit conditions recur
- **THEN** the pipeline SHALL present the gate to the human rather than auto-extending again

### Requirement: R3 assumption blast-radius triage

Each assumption at a gate SHALL be classified deterministically as low-blast or high-blast using only arithmetic over recorded run artifacts (files referenced, spec deltas, tasks touched); classification SHALL NOT involve agent judgment. An assumption SHALL be classified low-blast only when all of the following hold: every file it references lies inside the change folder or the run directory, it touches no spec delta, and it touches no tasks checklist line; every other assumption SHALL be classified high-blast. The per-assumption file evidence SHALL come from a recorded `evidence.files` field in the resolver sidecar contract (`review-model.ts` / `agent-layer.ts`), cross-checked against recorded artifact events; an assumption with missing, empty, or unverifiable evidence SHALL be classified high-blast (fail closed — never vacuously low-blast). The agent-emitted `blast_radius` text on an assumption SHALL be display-only and SHALL NOT be consulted by the classifier. Low-blast assumptions SHALL be auto-accepted at level `assist` or higher; high-blast assumptions SHALL always require a human decision. When R3 auto-accepts the low-blast items of a gate that also contains items no rule can decide (high-blast assumptions, open MATERIAL findings, unanswered blockers, the required ack), those items SHALL be pre-checked with `decided-by: policy R3` annotations and the gate SHALL still be presented to the human for the remaining items; such partial acceptance SHALL NOT count as an intervention avoided.

#### Scenario: Missing evidence fails closed

- **WHEN** an assumption's resolver sidecar entry lacks verifiable `evidence.files` at any autonomy level
- **THEN** the assumption SHALL be classified high-blast and SHALL be presented to the human

#### Scenario: Mixed gate is pre-checked and still presented

- **WHEN** R3 auto-accepts low-blast assumptions on a gate that also contains high-blast assumptions or other items requiring a human decision
- **THEN** the low-blast items SHALL be pre-checked with `decided-by: policy R3` annotations and the gate SHALL be presented to the human for the remaining items

#### Scenario: Low-blast assumption auto-accepted

- **WHEN** an assumption's deterministic classification from recorded artifacts is low-blast at level `assist` or higher
- **THEN** the assumption SHALL be auto-accepted and its decision record annotated with the rule and evidence digest

#### Scenario: High-blast assumption always gates

- **WHEN** an assumption's classification is high-blast at any autonomy level
- **THEN** the pipeline SHALL present that assumption to the human

### Requirement: R4 budget guard

All auto-decisions in a run SHALL be bounded by `costCeilingUsd` (default `5.0`) from config. Any projected or actual exceedance of the ceiling SHALL cause a human gate regardless of any other rule's predicate. When the run's cumulative cost is unknown (unmetered or fallback-priced models), the guard SHALL fail closed: every auto-decision SHALL be declined in favor of a human gate.

#### Scenario: Budget exceedance gates despite other rules

- **WHEN** a rule's predicate matches but the run's projected spend crosses `costCeilingUsd`
- **THEN** the pipeline SHALL present a human gate and SHALL NOT auto-decide

#### Scenario: Unknown cost fails closed

- **WHEN** a rule's predicate matches but the run's cumulative cost cannot be metered
- **THEN** the pipeline SHALL present a human gate and SHALL NOT auto-decide

### Requirement: R5 reversibility boundary

A rule SHALL auto-decide only actions whose entire write set is the run directory plus the change folder on the current branch. Actions that leave the branch — PR creation, merges, deletion of other branches — SHALL never be auto-decided at any autonomy level.

#### Scenario: PR creation is never auto-decided

- **WHEN** the pipeline reaches a step that would create a PR, merge, or delete another branch, at any autonomy level including `auto`
- **THEN** the action SHALL require a human decision

### Requirement: Never-cut invariants

At every autonomy level: (1) an open BLOCKER at a gate SHALL always produce a human gate; no rule SHALL auto-answer or auto-override a BLOCKER. (2) Budget or round-cap exceedance SHALL always gate. (3) Leaving-the-branch actions SHALL always be human. (4) Auto-decided gates SHALL still write `gate-<n>.md` and consume a gate version so they remain hash/audit anchors; the gate-file grammar SHALL gain only an optional `decided-by:` line, and the write-then-parse self-check SHALL cover it; hand-editing and flag paths SHALL be unaffected. (5) `events.ndjson` SHALL remain append-only and replay-sufficient.

#### Scenario: Open BLOCKER always gates

- **WHEN** any gate situation includes an open BLOCKER finding, at any autonomy level
- **THEN** the pipeline SHALL present a human gate and no rule SHALL auto-decide it

#### Scenario: Auto-decided gate file parses under extended grammar

- **WHEN** a `gate-<n>.md` written by an auto-decision is parsed
- **THEN** it SHALL parse under the existing grammar plus the optional `decided-by:` line, and the write-then-parse self-check SHALL pass

### Requirement: auto_decision event

`events.ndjson` SHALL gain one new L2 event type `auto_decision` carrying `{ rule, decision, evidenceDigest, gateVersion }`. The log SHALL remain append-only, and replaying `events.ndjson` alone SHALL rebuild all auto-decision previews.

#### Scenario: Replay rebuilds previews from the log alone

- **WHEN** `events.ndjson` from a run is replayed without any other run artifacts
- **THEN** every auto-decision preview SHALL be reconstructible from the `auto_decision` events

### Requirement: Auto level dead-man deadline

At level `auto`, an optional dead-man deadline (`--auto-deadline <minutes>`, default off) SHALL cause a gated decision to auto-proceed under policy if it remains unvetoed before the deadline, accompanied by a terminal bell or notification line. The deadline SHALL be persisted in run state when the gate is presented, and SHALL be evaluated by a foreground waiter that reloads run state from disk before acting, treats a gate settled by any other process as done, honors a hand-edited gate file by settling it through the normal resume path, and consumes queued steering directives during the wait (rename-on-consume, same protocol as round-boundary consumption), translating a landing `extend` to the extend outcome at an early gate and skipping it with a warning at a final gate. The persisted deadline fields SHALL be cleared on any settle and on `gate reopen`, and SHALL be overwritten (when configured) or cleared (when not) at every gate presentation, so no stale deadline survives its gate. Before any expiry write the waiter SHALL claim the gate via an exclusive-create claim file so two concurrent waiters cannot double-settle. The waiter SHALL be the default only for non-TTY flagless `gate resume` on a deadline-pending gate; on a TTY the flagless path SHALL still offer the interactive session, and a `--no-wait` opt-out SHALL exist. Re-arm consumption SHALL be persisted in run state so a restarted waiter can distinguish a first expiry from a second. If no rule's conservative branch applies at expiry, the gate SHALL stay pending and the deadline SHALL re-arm at most once; abort SHALL never be auto-chosen. After-the-fact veto SHALL remain available via `sdd-runner gate reopen`, which re-presents a settled gate so the existing veto/abort mechanics apply.

#### Scenario: Deadline auto-proceeds an unvetoed gate

- **WHEN** a run at `auto` with `--auto-deadline 10` presents a gated decision and no veto arrives within 10 minutes
- **THEN** the decision SHALL auto-proceed under policy if a rule's conservative branch applies, or stay pending with the deadline re-armed once if none does, and in either case emit a terminal bell or notification line

#### Scenario: Gate settled externally before expiry

- **WHEN** a gated decision with a pending deadline is settled by another `gate resume` invocation before the deadline passes
- **THEN** the deadline waiter SHALL observe the settlement and exit without auto-proceeding

#### Scenario: Deadline off by default

- **WHEN** a run at `auto` starts without `--auto-deadline`
- **THEN** gated decisions SHALL wait for the human indefinitely, exactly as blocking gates do today

### Requirement: Audit verb and reconsider list

`sdd-runner audit <runId>` SHALL walk a run's auto-decisions and output a reconsider list: for each decision, the rule, the evidence digest, and a copy-pasteable overturn command. The reconsider list SHALL include only real decisions (`decision` of `approve`, `extend`, or `accept-items`); observe-mode `preview` records and undecidable `gate`/`none` records SHALL be excluded. Because an auto-settled gate has no pending gate entry, the overturn command SHALL use `sdd-runner gate reopen <runId> --gate <n>` (a new verb that re-presents the settled gate version as pending, re-rendered unanswered) followed by the existing `gate resume --confirm-all --veto`/`--abort` mechanics (veto-only is a rejected flag combination, so the veto form pairs `--veto` with `--confirm-all`). Reopen SHALL refuse when a gate is already pending, when the named gate version does not exist or was never settled, or when the named gate is not the latest settled gate of the run. Every decision the ladder could not make SHALL be recorded in a workdir-level policy-debt ledger at gate-decision time (not deferred until `audit` runs), so recurring patterns can be promoted to candidate rules.

#### Scenario: Audit prints runnable overturn commands

- **WHEN** `sdd-runner audit` runs against a run containing auto-decisions
- **THEN** the output SHALL list each decision with its rule, evidence, and an overturn command that can be pasted and executed as-is

#### Scenario: Undecidable decisions are recorded as policy debt

- **WHEN** the ladder fails to decide a gate at `assist` or `auto` and a human decides instead
- **THEN** the decision SHALL be recorded in the policy-debt ledger

### Requirement: Report gains block

`sdd-runner report` SHALL include a gains block sourced from `auto_decision` events: interventions avoided, the number of human gates, estimated wall-time saved, and per-rule counts. Only events with `decision` of `approve` or `extend` that are paired with a subsequent `gate answered` event (i.e., the decision was actually settled, not crash-orphaned) SHALL count as interventions avoided; `accept-items` records (partial pre-check-and-present — a human gate was still presented) SHALL be reported separately as per-rule items auto-accepted and SHALL NOT count; observe-mode `preview` events and undecidable `gate`/`none` records SHALL be excluded from that count.

#### Scenario: Gains block reflects recorded auto-decisions

- **WHEN** a run's `events.ndjson` contains `auto_decision` events for rules R1 and R2
- **THEN** the report gains block SHALL show the interventions avoided per rule id, the total human gates, and an estimated wall-time saved figure

### Requirement: Queued steering

For long runs, `runs/<id>/steer.md` SHALL accept the directives `extend`, `veto <id>=<redirect>`, and `abort`, consumed at the next round boundary. Queued steering SHALL NOT replace blocking gates at `observe` or `assist` — blocking gates remain the default there.

#### Scenario: Steer directive consumed at round boundary

- **WHEN** a `veto <id>=<redirect>` line exists in `runs/<id>/steer.md` while a run is mid-round
- **THEN** the directive SHALL take effect at the next round boundary without requiring the human to sit in a blocking prompt

#### Scenario: Blocking gates unchanged at observe and assist

- **WHEN** a run at `observe` or `assist` reaches a gate
- **THEN** the gate SHALL be presented as a blocking prompt exactly as today, regardless of queued-steering support
