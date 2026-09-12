<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

## MODIFIED Requirements

### Requirement: Sequential task walk in implement

The implement state SHALL walk the change folder's `tasks.md` items sequentially — one implementer agent spawn per unchecked item, in file order — and SHALL skip items whose completion the folded log already records. Each item's walk SHALL record task-shaped fact events (started, and done or failed) carrying the item's identifier, so progress, per-item attempt counts, and resume skip-forward derive from the log alone. A started event SHALL additionally carry the item's `tasks.md` text, collapsed to a single line and bounded in length, in the same optional detail field failed events already carry — so what each task is derives from the log alone, survives later `tasks.md` edits, and no reader consults the change folder to name a walk row. On completing an item's work the run SHALL keep the item's checked state and the work in the same commit, so the change folder never claims work the tree lacks.

#### Scenario: One spawn per item in file order

- **WHEN** implement runs over a tasks.md with three unchecked items
- **THEN** three sequential implementer spawns occur, each recorded by started and done task events, and no two items are in flight at once

#### Scenario: Resume skips recorded items

- **WHEN** a run is interrupted after two items record done and is resumed
- **THEN** implement re-enters and spawns only for the remaining items

#### Scenario: Checkbox and work land together

- **WHEN** an item's implementation completes and is committed
- **THEN** the same commit carries the item's checked tasks.md line

#### Scenario: Started event carries the item's text

- **WHEN** implement starts an item whose checkbox line reads "Fix the chunking fallback"
- **THEN** the started event's detail carries that text as a single bounded line, and the folded task record exposes it as the item's text

#### Scenario: Long item text is bounded

- **WHEN** an item's text exceeds the compiled bound
- **THEN** the started event's detail carries the text truncated at the bound, not the full line

### Requirement: Execution events are additive

The execution vocabulary — the armed fact event, task-shaped events, the started event's item-text detail, the `todos_missing` noise event, and the widened stage identifiers and gate mode — SHALL be additive: logs written before this capability, and memos persisted before it, SHALL fold and parse unchanged, with unarmed behavior reproduced exactly. The run memo SHALL carry an optional tasks projection reflecting the folded task records, each record optionally carrying the item's text; memos of runs without task events SHALL omit it and parse unchanged, and pre-change memos and logs SHALL parse and fold without the text.

#### Scenario: Pre-change log folds unarmed

- **WHEN** a historical log is folded by the changed kernel
- **THEN** its states, memo fields, and completion behavior are byte-equivalent to the pre-change fold

#### Scenario: Memo projects task progress

- **WHEN** a run mid-execution parks and writes its memo
- **THEN** the memo carries the tasks projection matching the folded task records

#### Scenario: Memo projects task text

- **WHEN** a run whose started events carry item text parks and writes its memo
- **THEN** the memo's tasks projection carries each item's text alongside status and attempts, and the same memo parsed without the text field still validates

## ADDED Requirements

### Requirement: Implementer todo mandate and compliance mark

The implementer spawn's prompt for fresh work SHALL instruct the agent to plan the item with the todo tool before editing and to keep the list current as work proceeds; continuation prompts restate the output target only and need not repeat the mandate. When an implementer spawn completes without having emitted any todo snapshot, the engine SHALL append one `todos_missing {agent}` event naming the spawn's label to the run's log. The mark SHALL be tolerated noise — never a failure, never machine state, never a retry cause — and neither the mandate nor the mark SHALL apply to any other stage role.

#### Scenario: Fresh implementer prompt carries the mandate

- **WHEN** the implementer spawn's prompt is built for fresh work
- **THEN** it instructs the agent to plan with the todo tool before editing and keep the list current

#### Scenario: Continuation prompt omits the mandate

- **WHEN** a killed implementer session is continued
- **THEN** the continuation prompt restates the output target without repeating the mandate

#### Scenario: Zero-snapshot spawn is marked

- **WHEN** an implementer spawn completes and no todo snapshot event carries its label
- **THEN** exactly one `todos_missing` event naming that label is appended

#### Scenario: Compliant spawn is not marked

- **WHEN** an implementer spawn completes after emitting at least one todo snapshot
- **THEN** no `todos_missing` event is appended for it

#### Scenario: Other roles are never marked

- **WHEN** a drafter, reviewer, or resolver spawn completes without emitting any todo snapshot
- **THEN** no mandate rides its prompt beyond what it already carried, and no `todos_missing` event is appended

#### Scenario: Killed spawn is not marked as non-compliant

- **WHEN** an implementer spawn is killed mid-run without emitting a todo snapshot
- **THEN** no `todos_missing` event is appended for that attempt
