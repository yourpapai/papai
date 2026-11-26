<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Purpose

Lets a maintainer steer the GitHub Actions coding agent through command arguments and a `/sync` command: notes attached to `/retry` and `/continue` reach the resumed model turn as guidance, and `/sync` merges the base branch into a delivered agent branch so a pull request that fell behind the base can be repaired by the machine instead of a local checkout.

## ADDED Requirements

### Requirement: Command arguments on resume commands reach the resumed turn

`/retry` and `/continue` SHALL accept a free-text argument, and when one is present the pipeline SHALL include it in the prompt of the handler the command resumes, enveloped under the same untrusted-text rules as issue and comment bodies and framed as guidance — the plan and change folder remain the source of truth, and `/changes` remains the re-planning channel.

#### Scenario: Retry with a note

- **WHEN** a maintainer replies `/retry pull master and resolve the conflicts first` on an issue parked in `FAILED`
- **THEN** the resumed handler's prompt SHALL carry the note "pull master and resolve the conflicts first" as enveloped maintainer guidance, and the run SHALL otherwise behave exactly as `/retry` without a note

#### Scenario: Continue with a note

- **WHEN** a maintainer replies `/continue start from the failing test, not the whole file` on an issue parked in `INCOMPLETE`
- **THEN** the continuation handler's prompt SHALL carry that note as enveloped maintainer guidance

#### Scenario: Notes are not persisted state

- **WHEN** a resumed run consumes a maintainer note
- **THEN** no state block, handoff block or other persisted artefact SHALL record the note; its lifetime is the prompt it rode in

#### Scenario: Argument-less commands are unchanged

- **WHEN** a maintainer replies `/retry` or `/continue` with no argument
- **THEN** behavior SHALL be identical to the current signal-only commands

### Requirement: `/sync` is a non-moving side operation

The system SHALL provide a `/sync` command that merges the base branch into the agent branch and pushes, accepted in any state whose pull-request number is set and refused as a wrong command otherwise. A `/sync` run SHALL NOT move the phase, spend an attempt, alter `resumeFrom`, or change any per-pull-request budget, whether it succeeds or fails.

#### Scenario: Accepted wherever a pull request exists

- **WHEN** `/sync` is typed on the pull request of an issue whose state carries a pull-request number — including `COMPLETE`, `FAILED`, `INCOMPLETE` and the review phases
- **THEN** the sync operation SHALL run without consulting the transition table

#### Scenario: Refused without a pull request

- **WHEN** `/sync` is typed on an issue whose state carries no pull-request number
- **THEN** the command SHALL be refused with the wrong-command refusal that lists the commands that do apply

#### Scenario: State is untouched by every outcome

- **WHEN** a `/sync` run ends — merged, conflicted, repaired, refused or failed
- **THEN** the persisted state SHALL be byte-identical in `phase`, `attempts`, `resumeFrom`, `ciAttempts`, `reviewAttempts` and `prNumber` to the state the run started from, except for the running token total

### Requirement: Clean merge completes without a model turn

When the base branch merges into the agent branch without conflict, the system SHALL push the merge commit and report it, spending no model turn.

#### Scenario: Branch behind base

- **WHEN** `/sync` runs and `git merge origin/<base>` succeeds cleanly
- **THEN** the merge commit SHALL be pushed to the agent branch and one reply comment SHALL report how many commits were merged and from which branch, and no model turn SHALL have been paid

#### Scenario: Branch already current

- **WHEN** `/sync` runs and the agent branch already contains the base branch
- **THEN** the system SHALL report that the branch is up to date, push nothing, and spend no model turn

### Requirement: Conflicted merge is repaired in bounded rounds, never a park

When the merge conflicts, the system SHALL attempt repair in bounded model turns: each repair prompt SHALL name the conflicted paths and carry the conflict markers, the model SHALL be forbidden from running git, and the pipeline itself SHALL complete the merge and push. On success it SHALL report the resolution; on exhaustion it SHALL leave the tree clean of the merge, report the failure and the human remedy, and change no state.

#### Scenario: Conflict resolved and pushed

- **WHEN** a `/sync` merge conflicts and a repair turn removes all markers
- **THEN** the pipeline SHALL complete the merge itself, push it, and report the resolution — the model's turn SHALL NOT have been allowed to run git

#### Scenario: Repair rounds exhausted

- **WHEN** every repair round ends with markers still present
- **THEN** the merge SHALL be aborted leaving a clean tree, the reply SHALL name the failure and the remedy (a human merging via the code host's update-branch control), and the persisted state SHALL be unchanged

#### Scenario: Over budget before the repair turn

- **WHEN** a `/sync` merge conflicts and the issue is at its token ceiling
- **THEN** no repair turn SHALL start; the reply SHALL name the ceiling and the human remedy, and the persisted state SHALL be unchanged

### Requirement: Merged base content is preserved verbatim

A `/sync` merge SHALL be treated as base's own already-reviewed content, not as an agent-authored change set: change-set size caps and protected-path dropping SHALL NOT apply to it.

#### Scenario: Base's workflow edits survive the sync

- **WHEN** the base branch moved a file under `.github/workflows/` and `/sync` merges cleanly
- **THEN** the pushed merge commit SHALL carry that file's base version, and no staging step SHALL have dropped or altered it

### Requirement: Push refusal names the human remedy

When the code host refuses the sync push — including the refusal a merge carrying base's own workflow changes triggers — the reply SHALL be a translated notice naming the cause and the human fallback (the code host's own update-branch control), not the raw API error.

#### Scenario: Workflows-permission refusal

- **WHEN** `/sync` completes a merge that carries base's workflow changes and the push is refused
- **THEN** the reply SHALL name that the token may not push workflow changes and that a maintainer performing the same merge through the code host's update-branch control is the remedy

### Requirement: Sync replies carry no record and account for spend

A `/sync` run's reply SHALL be a plain comment on the surface the command was typed on, carrying no state block; any model turn it paid SHALL be recorded by rewriting the running token total of the newest state block in place.

#### Scenario: Reply is not a record

- **WHEN** a `/sync` run posts its reply
- **THEN** the comment SHALL carry no state block, and the newest existing state block SHALL have been rewritten in place only if a model turn changed the running token total
