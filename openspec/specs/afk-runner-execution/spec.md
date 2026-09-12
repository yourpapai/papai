# afk-runner-execution Specification

## Purpose

Brings the execution half onto the afk-runner graph — implement, verify, and release states that execute an approved `tasks.md` inside one run: sequential per-task implementer spawns under the repo's write protections, a bounded fix loop against the repository's own gates, and a release gate whose approval is the run's completion — so an execution-armed run ends with the work implemented, verified, and committed rather than planned-only.

## Requirements

### Requirement: Execution arming is log truth

`start` invoked with the execution flag SHALL append exactly one execution-armed fact event before intake work runs; a run started without the flag SHALL append none. Execution-armedness SHALL be derived by folding the log alone — never from the memo or a config read at decision time — and logs written before this capability SHALL fold as unarmed. On an armed run, approving the final gate SHALL move the run into the implement state; on an unarmed run the same approval SHALL complete the run exactly as before.

#### Scenario: Armed run approves into execution

- **WHEN** an execution-armed run's final gate settles approve
- **THEN** the machine enters the implement state and does not reach completed

#### Scenario: Unarmed run approves to completion

- **WHEN** a run started without the execution flag settles its final gate approve
- **THEN** the run completes on the answered event exactly as a pre-change run does, with no execution-stage events in the log

#### Scenario: The flag is parsed or rejected loudly

- **WHEN** `start` is invoked with the execution flag
- **THEN** the argument parsing accepts it, and the run's log opens with the armed event before any stage work

### Requirement: Sequential task walk in implement

The implement state SHALL walk the change folder's `tasks.md` items sequentially — one implementer agent spawn per unchecked item, in file order — and SHALL skip items whose completion the folded log already records. Each item's walk SHALL record task-shaped fact events (started, and done or failed) carrying the item's identifier, so progress, per-item attempt counts, and resume skip-forward derive from the log alone. On completing an item's work the run SHALL keep the item's checked state and the work in the same commit, so the change folder never claims work the tree lacks.

#### Scenario: One spawn per item in file order

- **WHEN** implement runs over a tasks.md with three unchecked items
- **THEN** three sequential implementer spawns occur, each recorded by started and done task events, and no two items are in flight at once

#### Scenario: Resume skips recorded items

- **WHEN** a run is interrupted after two items record done and is resumed
- **THEN** implement re-enters and spawns only for the remaining items

#### Scenario: Checkbox and work land together

- **WHEN** an item's implementation completes and is committed
- **THEN** the same commit carries the item's checked tasks.md line

### Requirement: Implementer writes are guarded to the repo

The implementer spawn seam SHALL guard the working tree with an explicitly widened write set: newly dirtied paths anywhere in the repository SHALL pass, except paths under another change's folder under `openspec/changes/`, which SHALL fail the spawn naming the offending paths and the protection. The think-half guard remains unchanged for every other spawn seam.

#### Scenario: Source-tree writes pass

- **WHEN** an implementer dirties source files and its own change folder
- **THEN** the spawn completes without a guard failure

#### Scenario: Sibling change folder still fails

- **WHEN** an implementer dirties a path under another change's folder
- **THEN** the spawn fails naming the path, and the failure is declared through the existing failure taxonomy

### Requirement: Verify boundary with a bounded fix loop

The verify state SHALL run the repository's own gate set (typecheck, lint, tests) as compiled constants at the execution boundary. A failing check SHALL be a normal outcome that routes the run back into implement carrying the failure output as fix context — not a declared failure — so a deterministically red suite is never blind-retried. Per-item fix attempts SHALL be bounded by a compiled constant derived from the folded task events: when an item's attempts exceed the bound, implement SHALL declare exhaustion through the existing failure taxonomy, and the existing per-stage budget and escalation gate SHALL govern retry and operator escalation without new semantics.

#### Scenario: Red verify routes back to implement

- **WHEN** the verify gate set fails
- **THEN** the run re-enters implement with the failing output available as fix context and no escalation gate is presented for the red suite alone

#### Scenario: Fix attempts are bounded

- **WHEN** an item's recorded attempts exceed the compiled fix bound and its work still fails verification
- **THEN** implement declares an exhausted failure, the stage budget applies, and budget exhaustion presents the existing escalation gate

#### Scenario: Green verify releases

- **WHEN** the verify gate set passes
- **THEN** the run enters the release state

### Requirement: Release gate ends execution

The release state SHALL present a release-mode gate on the existing gate machinery as its last work act: files first, then the stage entry, presentation, and the always-logging ladder, with no rule auto-deciding it. The gate content SHALL carry the execution digest — tasks done versus total, the verify outcomes, the commits the run made, and spend. Approve SHALL complete the run through the existing all-stages-done edge; a settled veto SHALL re-enter implement applying the redirects; extend SHALL be rejected; abort SHALL abort. The run SHALL NOT push branches, open pull requests, or perform any remote operation — release ends with a locally committed, PR-ready state and a pointer to the passive report.

#### Scenario: Release approval completes

- **WHEN** the release gate settles approve
- **THEN** the machine reaches completed, the memo records completed, and nothing was pushed

#### Scenario: Release veto re-enters implement

- **WHEN** the release gate settles with a veto redirect
- **THEN** the run re-enters implement as fix work carrying the redirect, and re-presents the release gate at the next version when the loop passes verification again

#### Scenario: Extend is rejected at release

- **WHEN** the release gate response carries the extend directive
- **THEN** the settle is rejected naming that extend is not available at a release gate

#### Scenario: No rule auto-decides release

- **WHEN** the release gate is presented
- **THEN** the ladder logs its evaluation and no rung settles the gate

### Requirement: Execution events are additive

The execution vocabulary — the armed fact event, task-shaped events, and the widened stage identifiers and gate mode — SHALL be additive: logs written before this capability, and memos persisted before it, SHALL fold and parse unchanged, with unarmed behavior reproduced exactly. The run memo SHALL carry an optional tasks projection reflecting the folded task records; memos of runs without task events SHALL omit it and parse unchanged.

#### Scenario: Pre-change log folds unarmed

- **WHEN** a historical log is folded by the changed kernel
- **THEN** its states, memo fields, and completion behavior are byte-equivalent to the pre-change fold

#### Scenario: Memo projects task progress

- **WHEN** a run mid-execution parks and writes its memo
- **THEN** the memo carries the tasks projection matching the folded task records

### Requirement: Execution resume and crash windows

Resume SHALL cover the execution states as stage re-entries through the graph's own edges, skipping items whose done the fold records. Crash windows specific to execution SHALL heal on resume: an armed final-gate approval whose answered event never landed SHALL have the owed answer appended; a release presentation interrupted before its presented event SHALL heal exactly as the tail's final-gate window does; a killed implementer spawn SHALL continue its recorded session on re-entry through the existing spawn-seam behavior.

#### Scenario: Crash between approval mover and answer

- **WHEN** a process dies after the implement mover lands but before the gate answered event and the run is resumed
- **THEN** resume appends the owed answered event and the run continues in implement

#### Scenario: Mid-item crash re-enters with continuation

- **WHEN** a process dies while an implementer spawn is in flight and the run is resumed
- **THEN** implement re-enters at the interrupted item and the spawn continues the killed session per the existing recovery behavior

### Requirement: Execution conformance

Synthetic fixtures for the execution shapes — armed approval, task walk, red-verify fix loop, attempt-bound exhaustion, release approval, release veto, and the execution crash windows — SHALL fold kernel-consistently at every event prefix, shall fold to memos matching their persisted state, and the existing prefix-property and resume-equivalence drills SHALL extend to them.

#### Scenario: Execution fixtures fold at every prefix

- **WHEN** the parity harness folds every prefix of every execution fixture
- **THEN** each prefix yields a legal state with a parked or drivable verdict, and deterministic resumes converge to the same terminal and memo as the uninterrupted run
