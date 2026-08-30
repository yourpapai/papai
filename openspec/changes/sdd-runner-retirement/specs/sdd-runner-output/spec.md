<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## REMOVED Requirements

### Requirement: Frozen non-TTY byte contract
- **Reason**: The contract pinned the deleted workspace's renderer output — bytes nothing produces after retirement. afk-runner's non-TTY surfaces are the fold summary, `report`, and `runs`, each specified by the afk delta stack.
- **Migration**: `afk-runner report <runId>` (the `afk-runner-tail` delta) and `afk-runner runs` (the `afk-runner-runs` delta) are the summary surfaces; their output contracts live in those unarchived deltas.

### Requirement: Pipeline map stage details
- **Reason**: TUI rendering of the deleted workspace; no successor renders a pipeline map.
- **Migration**: `afk-runner status` names the folded position and parked reason textually. A live view re-earn is ledger item U8.

### Requirement: Slot line details
- **Reason**: TUI rendering of the deleted workspace.
- **Migration**: None — the slot-line grammar has no consumer. U8 re-earns surface rendering if a second attended cycle shows surface discovery costing more than the run.

### Requirement: Status line details
- **Reason**: TUI rendering of the deleted workspace.
- **Migration**: None, as with the other rendering details; the textual status line of afk-runner's verbs is governed by the afk deltas.

### Requirement: Gate trajectory sparkline
- **Reason**: TUI rendering of the deleted workspace.
- **Migration**: The gate trajectory survives as data (gate versions and settles in `events.ndjson`); `report` renders the gains/median-dwell summary textually.

### Requirement: Terminal title
- **Reason**: TUI affordance of the deleted workspace.
- **Migration**: None.

### Requirement: Quiet verbosity
- **Reason**: Verbosity flags belonged to the deleted entry point's flag surface.
- **Migration**: afk-runner's verbs print one summary each; there is no verbosity ladder to quiet. Operators pipe or redirect as with any CLI.

### Requirement: Interactive gate-session front-end
- **Reason**: The interactive front-end dies with the workspace. C7's attended proof established the surviving attendance protocol: raw gate files, steer directives, and the resume waiter.
- **Migration**: `afk-runner resume <runId>` plus the gate-file answer surface; TUI re-earn is U8.

### Requirement: Watch verb
- **Reason**: The verb watched the deleted workspace's live event stream.
- **Migration**: `afk-runner status <runId>` is the passive re-poll; the events log is append-only ndjson any `tail -f` watches directly.
