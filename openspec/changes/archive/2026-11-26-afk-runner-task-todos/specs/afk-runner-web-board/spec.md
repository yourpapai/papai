<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

## MODIFIED Requirements

### Requirement: Run-detail view

Selecting a run SHALL render its detail: the pipeline position, the per-round history with raised and open finding counts, the per-task walk with attempt counts for armed runs and — when the log carries it — each item's text, a live event feed whose task lines carry the event's bounded detail when present (an item's text on started, the recorded tail on failed), per-stage spend accounting, and — for a pending gate — the gate file rendered read-only. The agent todos panel SHALL name any implementer whose spawn completed without emitting todos, alongside its last-snapshot entries. The detail view SHALL offer no action that settles, steers, or mutates the run.

The event feed SHALL be tiered: signal events (stage, round, gate, findings, tasks, spawns, completions, convergence) render one line each with their distinguishing data (tool and argument for tool use, role and model for spawns, finding class and detail, model and usage for completions); agent-activity events (tool use) render collapsed into per-agent strips carrying the agent's live usage ticker, its most recent tool call, its model, and its transcript path; waiter-heartbeat events (`auto_decision` reporting a still-pending decision) SHALL be excluded from the feed before its bound is applied, so a heartbeat flood cannot shrink the feed. The feed's bound SHALL apply to rendered feed content, and earlier events SHALL remain reachable through history pagination. An in-flight agent's strip SHALL collapse into its completion's signal line once the agent finishes.

#### Scenario: Detail shows the gate waiting

- **WHEN** the operator opens a gate-pending run's detail
- **THEN** the rendered gate file's content is shown read-only alongside the resume pointer

#### Scenario: Detail shows round convergence

- **WHEN** the operator opens a run that closed two review rounds
- **THEN** the detail shows both rounds with their raised and open counts

#### Scenario: Signal lines carry their distinguishing data

- **WHEN** the feed renders a spawn, a filed finding, and a completion
- **THEN** each line names its subject — the spawn its role and model, the finding its class and detail, the completion its model and usage — not just its event type

#### Scenario: A heartbeat flood cannot shrink the feed

- **WHEN** a run's log contains thousands of still-pending auto-decision heartbeats between signal events
- **THEN** the feed's bounded window still contains signal events, the heartbeats excluded before the bound is applied

#### Scenario: Walk rows name their items

- **WHEN** the operator opens an armed run whose started events carry item text
- **THEN** each walk row renders the item's identifier with its text, and a run whose events carry no text renders identifier-only rows exactly as before

#### Scenario: Feed task lines carry detail

- **WHEN** the recent-events feed renders a started or failed task event carrying detail
- **THEN** the line includes the bounded detail beside the identifier

#### Scenario: Todos panel names a non-emitting implementer

- **WHEN** an armed run's log carries a `todos_missing` event for an implementer label
- **THEN** the todos panel renders that label with a no-todos-emitted note, without presenting runner-synthesized todo content
