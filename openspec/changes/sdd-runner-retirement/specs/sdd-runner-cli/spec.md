<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## REMOVED Requirements

### Requirement: Interactive gate session on a terminal
- **Reason**: The `sdd-runner/` workspace is deleted at retirement (R5); the interactive terminal gate session it implemented dies with it. afk-runner attends gates through the foreground waiter on `resume`, steer directives, and hand-edited gate files — no terminal front-end exists.
- **Migration**: `afk-runner resume <runId>` attaches the foreground waiter; the printed gate-file pointer names the answer surface. A future TUI re-earn is ledger item U8.

### Requirement: Non-interactive flag path
- **Reason**: The flag surface belonged to the deleted workspace's entry point. afk-runner's CLI verbs are non-interactive by construction — `start` parks and exits at a gate (the R4 cut-over behavior).
- **Migration**: `afk-runner start <taskFile> [--depth S|M|L]` is the non-interactive entry; the transitional `sdd-runner:start` alias is removed with the whole alias family.

### Requirement: Pending-gate discovery and run-id ergonomics
- **Reason**: The discovery helpers walked the deleted workspace's run storage layout. afk-runner's `status` and the gate-park pointer line cover the operator's need.
- **Migration**: `afk-runner status <runId>` reports the parked reason and gate pointer; a bare run-dir argument still prints the fold summary.

### Requirement: One routing verb and a loud gate-pending signal
- **Reason**: The routing verb was the deleted workspace's CLI grammar. afk-runner's verb model (start/resume/status/stop/report/runs) replaced it at the R4 cut-over.
- **Migration**: `afk-runner:start` and the per-verb usage line; the bare-arg miss error names the replacement verbs (delivered with the cut-over).

### Requirement: Hand-edited gate file remains supported
- **Reason**: The requirement's home capability is retired with the workspace, but the behavior is not lost — it is re-specified by the afk stack.
- **Migration**: The unarchived `afk-runner-gate` ("Settlement through one validated seam") and `afk-runner-gate-settle-robustness` ("Rendered answers roundtrip their decision", "Settle failures become feedback, never waiter death") deltas carry hand-edit settlement, with stricter stability and parse guarantees than the retired spec stated.
