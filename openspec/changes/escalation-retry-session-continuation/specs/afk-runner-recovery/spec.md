<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## MODIFIED Requirements

### Requirement: Retry budget with immediate re-run

The runner SHALL bound free retries per stage by a compiled constant budget over consecutive declared failures (exhausted and infra counted; precondition escalates immediately). Under budget the loop SHALL re-run the stage's bracket immediately through the existing re-entry mechanics without human involvement; at or over budget it SHALL present an escalation gate instead. The budget SHALL be enforced identically by the live loop and by resume derivation through one pure check over the folded context, so a process death between failure and escalation presents the same gate on resume. A same-process re-run whose (label, round) has a latest in-flight ledger entry with status `killed` SHALL continue that entry's opencode session (the continuation spawn path the cross-process resume uses) instead of rebuilding from a fresh session; with no in-flight `killed` entry the re-run SHALL spawn fresh.

#### Scenario: Under-budget retry is automatic

- **WHEN** a stage declares its first failure and the budget is not spent
- **THEN** the loop re-runs the same stage's work in the same process and the run keeps driving

#### Scenario: Resume counts prior failures

- **WHEN** a run whose log already carries N stage_failed events for the active stage is resumed and fails again past the budget
- **THEN** resume presents the escalation gate rather than re-entering work

#### Scenario: Retry continues the killed session

- **WHEN** a stage's spawn dies mid-flight (ledger entry settled `killed`) and the stage re-runs in the same process — watchdog retry, under-budget re-run, or escalation-approve re-entry
- **THEN** the retrying spawn continues the killed entry's opencode session id (continuation prompt, same session in the ledger) rather than minting a fresh session

#### Scenario: No killed entry spawns fresh

- **WHEN** a stage re-runs with no in-flight `killed` ledger entry for its (label, round)
- **THEN** the re-run spawns a fresh session, unchanged from the pre-change behavior
