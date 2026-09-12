<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

## MODIFIED Requirements

### Requirement: Run-detail view

Selecting a run SHALL render its detail: the pipeline position, the per-round history with raised and open finding counts, the per-task walk with attempt counts and — when the log carries it — each item's text, a bounded recent-events feed whose task lines carry the event's bounded detail when present (an item's text on started, the recorded tail on failed), and — for a pending gate — the gate file rendered read-only. The agent todos panel SHALL name any implementer whose spawn completed without emitting todos, alongside its last-snapshot entries. The detail view SHALL offer no action that settles, steers, or mutates the run.

#### Scenario: Detail shows the gate waiting

- **WHEN** the operator opens a gate-pending run's detail
- **THEN** the rendered gate file's content is shown read-only alongside the resume pointer

#### Scenario: Detail shows round convergence

- **WHEN** the operator opens a run that closed two review rounds
- **THEN** the detail shows both rounds with their raised and open counts

#### Scenario: Walk rows name their items

- **WHEN** the operator opens an armed run whose started events carry item text
- **THEN** each walk row renders the item's identifier with its text, and a run whose events carry no text renders identifier-only rows exactly as before

#### Scenario: Feed task lines carry detail

- **WHEN** the recent-events feed renders a started or failed task event carrying detail
- **THEN** the line includes the bounded detail beside the identifier

#### Scenario: Todos panel names a non-emitting implementer

- **WHEN** an armed run's log carries a `todos_missing` event for an implementer label
- **THEN** the todos panel renders that label with a no-todos-emitted note, without presenting runner-synthesized todo content
