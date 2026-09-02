<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## REMOVED Requirements

### Requirement: Single routing verb resolves any target
- **Reason**: The single routing verb was the deleted workspace's CLI grammar, replaced at the R4 cut-over by afk-runner's verb model.
- **Migration**: The `afk-runner-cli` spec ("Verb table and routing") carries start/status/resume/stop/report/runs/analyze and the bare run-directory fold summary.

### Requirement: One routing verb and a loud gate-pending signal
- **Reason**: The routing verb was the deleted workspace's CLI grammar. afk-runner's verb model replaced it at the R4 cut-over.
- **Migration**: The `afk-runner-cli` spec ("Start parks and exits with a loud gate-pending signal") carries the gate-file pointer and copy-pasteable resume line; the transitional `sdd-runner:*` alias family is removed with the workspace.

### Requirement: Start-time flags are limited to the depth override
- **Reason**: The flag surface belonged to the deleted workspace's entry point.
- **Migration**: The `afk-runner-cli` spec ("Verb table and routing") carries `start <taskFile> [--depth S|M|L]`; "Depth override warns what it discards" governs the override's honesty.

### Requirement: Calm stop verb
- **Reason**: The calm-stop path belonged to the deleted workspace's CLI surface.
- **Migration**: The `afk-runner-cli` spec ("Event-sourced stop verb") carries the calm-stop marker honored at the next boundary; `afk-runner-recovery` ("Operator abort and session release") carries the same first-producer semantics.

### Requirement: Run process ownership record
- **Reason**: The ownership record walked the deleted workspace's run storage layout.
- **Migration**: The `afk-runner-cli` spec ("Event-sourced stop verb") decides live versus dead from the holder and releases the session id on abort; `afk-runner-think-half` ("Resume by replay") carries the session ledger the decision reads.

### Requirement: Liveness-aware stop
- **Reason**: The liveness probe answered to the deleted workspace's stop verb.
- **Migration**: The `afk-runner-cli` spec ("Event-sourced stop verb") — calm stop for a live run, event-sourced `run_abort` for a dead one, steer pointer for a gate-pending one.

### Requirement: Completed runs print their report
- **Reason**: The behavior was the deleted workspace's terminal-verb nicety.
- **Migration**: The `afk-runner-tail` spec ("Finals end the run cleanly") — resuming a terminal run prints the report pointer and appends nothing; "Run report" governs the summary itself.

### Requirement: Removed legacy surface fails with guidance
- **Reason**: The guidance pointed operators off the deleted workspace's removed verbs.
- **Migration**: The `afk-runner-cli` spec ("Verb table and routing") — a missing or invalid argument fails with a usage line naming the verb inventory.

### Requirement: Runner-printed guidance names the current routing surface
- **Reason**: The guidance named the deleted workspace's replacement verbs during the cut-over window.
- **Migration**: The `afk-runner-cli` spec's usage lines name the afk verb inventory directly; the transitional alias family dies with the workspace.

### Requirement: Config path override
- **Reason**: The flag configured the deleted workspace's entry point.
- **Migration**: afk-runner resolves its workdir by configuration and convention; no CLI flag surface survives. The `afk-runner-cli` verb table carries the full accepted flag inventory.

### Requirement: Gate reopen
- **Reason**: The reopen path belonged to the deleted workspace's gate session.
- **Migration**: The `afk-runner-gate` spec ("Gate awaiting is machine state") — re-presentation at version n+1 re-arms awaiting with prior answered records visible in folded context.

### Requirement: Interactive session screen on a terminal
- **Reason**: The interactive terminal session dies with the `sdd-runner/` workspace deleted at retirement (R5). afk-runner attends gates through the foreground waiter on `resume`, steer directives, and hand-edited gate files — no terminal front-end exists.
- **Migration**: `afk-runner resume <runId>` attaches the foreground waiter (`afk-runner-gate` spec, "Foreground waiter"); the printed gate-file pointer names the answer surface. A future TUI re-earn is ledger item U8.

### Requirement: Inline session start without a task file
- **Reason**: The inline REPL surface belonged to the deleted workspace's entry point.
- **Migration**: Declined scope: `afk-runner start <taskFile>` requires a task file (the `afk-runner-cli` verb table); conversational steering rides the mid-run steering surface, not a runner REPL.

### Requirement: Task-name session identity
- **Reason**: The naming rule keyed the deleted workspace's run storage layout.
- **Migration**: The `afk-runner-think-half` spec ("Resume by replay") carries the session ledger; `afk-runner-tail` ("Finals end the run cleanly") releases the session id at terminals; `afk-runner-runs` renders identity (session id or legacy change name).

### Requirement: Hand-edited gate file remains supported
- **Reason**: The requirement's home capability is retired with the workspace, but the behavior is not lost — it is re-specified by the afk stack.
- **Migration**: The `afk-runner-cli` spec ("Hand-edited gate file") and the `afk-runner-gate-settle-robustness` spec ("Rendered answers roundtrip their decision", "Settle failures become feedback, never waiter death") carry hand-edit settlement, with stricter stability and parse guarantees than the retired spec stated.
