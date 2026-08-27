# sdd-runner-config Specification

## Purpose

Defines the five-key sdd-runner configuration schema and the derivation rules that replace the removed autonomy block, per-role model map, timeouts, and duplicate budget keys, making the config writable from memory.

## Requirements

### Requirement: Five-key strict schema

The configuration file SHALL accept exactly `repoRoot`, `workDir`, `model`, `budget` (USD, default 5), and `deadline` (minutes, optional). Every other key SHALL be rejected at load time with the offending key named in the error, together with its replacement when one exists.

#### Scenario: Minimal valid config

- **WHEN** the config contains only `repoRoot` and `model`
- **THEN** loading succeeds with `workDir` defaulted, `budget` defaulted to 5, and no deadline armed

#### Scenario: Removed key rejected by name

- **WHEN** the config contains `autonomy`, `models`, `timeouts`, or `budgetUsd`
- **THEN** loading fails naming that key and pointing at its replacement (`budget`, the single `model`, compiled timeout constants) or stating none exists

### Requirement: Single autonomy mode

Autonomy SHALL be single-mode with the former `assist` semantics: the decision ladder always evaluates and auto-settles every gate it can decide, and every gate it cannot decide is presented to the human. The per-gate audit records (policy ledger line, preview block, decision event) SHALL be written unconditionally, not level-conditional. The former `auto` level's time-boxed behavior SHALL be provided solely by the optional `deadline` key.

#### Scenario: Decidable gate auto-settles

- **WHEN** a final gate has zero open findings of any severity, all surviving assumptions classified low-blast, and known spend under budget
- **THEN** the gate is auto-approved, its audit records are written, and the pipeline continues without waiting for a human

#### Scenario: Undecidable gate presents

- **WHEN** any blocker is open or spend is unknown
- **THEN** the gate is presented for human decision regardless of any setting

### Requirement: Budget is the sole spend bound

`budget` SHALL be the single ceiling the decision ladder checks: projected-spend-before-extension and the fail-closed cost guard both compare against it. There SHALL be no second cost ceiling and no per-run spend override outside the config file.

#### Scenario: Projected spend over budget gates

- **WHEN** the ladder projects that one more round would reach or exceed `budget`
- **THEN** the gate is presented instead of auto-extended or auto-approved

### Requirement: Extension bounded by trajectory and budget, not count

Automatic review extension SHALL require all of: zero open blockers, at least one open material finding, strictly decreasing open-finding totals over the last two rounds, and projected spend under `budget`. There SHALL be no extension-count limit and no extension-count state.

#### Scenario: Converging loop earns an extension

- **WHEN** the round cap is hit with zero blockers, open material findings, and strictly decreasing totals for two rounds, with projected spend under budget
- **THEN** exactly one more round runs and eligibility is re-evaluated at the next cap hit

#### Scenario: Flat trajectory never auto-extends

- **WHEN** the round cap is hit and open-finding totals are not strictly decreasing
- **THEN** no automatic extension occurs and the gate is presented

### Requirement: Deadline arms a conservative waiter

When `deadline` is set and a gate is presented on a non-interactive stream, the process SHALL wait for a human decision and, at expiry, settle conservatively: approve only what the ladder permits, else extend if eligible, else keep the gate pending. The waiter SHALL re-arm at most once after a landing human decision and SHALL never auto-abort.

#### Scenario: Expiry settles conservatively

- **WHEN** the deadline expires with the gate unanswered and no rule permits approval or extension
- **THEN** the gate stays pending and the run does not abort

#### Scenario: Waiter is derived, not flagged

- **WHEN** a deadline is armed and the stream is non-interactive
- **THEN** the process waits without any wait flag being passed

### Requirement: Existing run state remains resumable

Run-state parsing SHALL tolerate fields written by prior versions. Runs created before this change SHALL resume through the fallback resume path without any migration step.

#### Scenario: Pre-change run resumes

- **WHEN** `sdd <run-id>` targets a run whose state file lacks the new fields
- **THEN** the run resumes at its stage boundary and no migration or rewrite is required

### Requirement: Removed decision flags are rejected

The command surface SHALL reject the removed decision and tuning flags (`--autonomy`, `--auto-deadline`, `--verbosity`, `--confirm-all`, `--veto`, `--extend`, `--abort`, `--wait-deadline`, `--no-wait`) with an error naming, for each, the gate-file grammar or config key that replaces it.

#### Scenario: Removed flag error names the replacement

- **WHEN** `--autonomy auto` is passed
- **THEN** the command fails and the error states that autonomy is single-mode and spend is bounded by the `budget` config key
