<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines how the autonomous pipeline reaches a complete result: when the review
loop is considered settled, what each gate decision does downstream, and how an
interrupted run resumes — so that every completed run delivers the full artifact
set including the task list.

## ADDED Requirements

### Requirement: Early-gate approval continues the pipeline

When a human approves an early (cap-hit) gate, the pipeline SHALL continue into
task decomposition, atomicity checking, and a final gate instead of finalizing
the run. Approval SHALL mean "the remaining findings are accepted as resolved —
proceed," and no approval path SHALL produce a completed run that lacks a task
list.

#### Scenario: Approval at an early gate proceeds to decomposition

- **WHEN** a human approves an early gate (all boxes checked, blockers answered)
- **THEN** the pipeline runs task decomposition and atomicity checking and then
  presents a final gate, instead of marking the run completed

#### Scenario: No completion path skips the task list

- **WHEN** any run reaches `completed` status
- **THEN** the change directory contains a `tasks.md` produced by the pipeline's
  decomposition stage (or the run was aborted, which is the only non-completing
  exit)

#### Scenario: Final gate after early approval carries the next version

- **WHEN** the final gate is presented following an early-gate approval at
  version `n`
- **THEN** it is written as `gate-<n+1>.md` with the full task-progress digest,
  preserving the versioned audit trail

### Requirement: Severity-based convergence

A review round that reaches the round cap with zero open BLOCKER findings and
zero open MATERIAL findings — nitpicks only, each resolved or dismissed — SHALL
be treated as converged and SHALL flow into decomposition without presenting an
early gate. A cap-hit round with any open BLOCKER or MATERIAL finding SHALL still
present an early gate for human sign-off.

#### Scenario: Nitpick-only cap-hit converges without a gate

- **WHEN** the review loop reaches its round cap and every open finding is a
  resolved or dismissed nitpick
- **THEN** the pipeline proceeds directly to decomposition as if the loop had
  converged on a clean round

#### Scenario: Open material finding at cap still gates

- **WHEN** the review loop reaches its round cap with at least one open MATERIAL
  finding
- **THEN** an early gate is presented and the pipeline waits for a human decision

### Requirement: Resume covers post-review stages

A run interrupted after the review stage — during decomposition, atomicity
checking, or a pending final gate — SHALL be resumable, re-entering at the
interrupted stage rather than failing. Resuming a run with a pending gate SHALL
direct the operator to the gate flow.

#### Scenario: Interrupted decomposition resumes

- **WHEN** a run stopped during decomposition or atomicity checking is resumed
- **THEN** the pipeline re-enters at the interrupted stage and continues toward
  the final gate

#### Scenario: Resume on a gate-pending run points at the gate

- **WHEN** `resume` is invoked for a run whose gate is pending
- **THEN** the operator is told the run awaits a gate decision and given the
  exact gate command with the run id

### Requirement: Gate decisions disclose their downstream effects

Every gate presentation SHALL state, next to each available decision, what the
pipeline does next if that decision is taken — including that approval at an
early gate continues to decomposition, atomicity checking, and a final gate.

#### Scenario: Early gate explains approval

- **WHEN** an early gate is presented
- **THEN** its text states that approving continues the pipeline to task
  decomposition and a final gate, and that extending runs one more review round

#### Scenario: Final gate explains approval

- **WHEN** a final gate is presented
- **THEN** its text states that approving completes the run with the full
  artifact set
