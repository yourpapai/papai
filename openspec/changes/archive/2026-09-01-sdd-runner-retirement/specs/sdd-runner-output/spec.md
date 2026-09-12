<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## REMOVED Requirements

### Requirement: Frozen non-TTY byte contract
- **Reason**: The contract pinned the deleted workspace's renderer output — bytes nothing produces after retirement. afk-runner's non-TTY surfaces are the fold summary, `report`, and `runs`, each specified by the afk spec stack.
- **Migration**: `afk-runner report <runId>` (the `afk-runner-tail` spec) and `afk-runner runs` (the `afk-runner-runs` spec) are the summary surfaces; their output contracts live in those specs.

### Requirement: Pipeline map stage details
- **Reason**: TUI rendering of the deleted workspace; no successor renders a pipeline map.
- **Migration**: `afk-runner status` names the folded position and parked reason textually. A live view re-earn is ledger item U8.

### Requirement: Slot line details
- **Reason**: TUI rendering of the deleted workspace.
- **Migration**: None — the slot-line grammar has no consumer. U8 re-earns surface rendering if a second attended cycle shows surface discovery costing more than the run.

### Requirement: Status line details
- **Reason**: TUI rendering of the deleted workspace.
- **Migration**: None, as with the other rendering details; the textual status line of afk-runner's verbs is governed by the `afk-runner-cli` and `afk-runner-runs` specs.

### Requirement: Gate trajectory sparkline
- **Reason**: TUI rendering of the deleted workspace.
- **Migration**: The gate trajectory survives as data (gate versions and settles in `events.ndjson`); `report` renders the gains/median-dwell summary textually (`afk-runner-tail` spec, "Run report").

### Requirement: Terminal title
- **Reason**: TUI affordance of the deleted workspace.
- **Migration**: None.
