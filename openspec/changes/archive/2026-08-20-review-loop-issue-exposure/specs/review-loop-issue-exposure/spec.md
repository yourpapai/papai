<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines exposure on a review-loop issue: a cited caller rather than a self-assigned grade, the
fixer's independent restatement of it, and the advisory ordering and reporting derived from
both — recorded so a later change can decide, on evidence, whether exposure may ever gate.

## ADDED Requirements

### Requirement: A reviewer issue carries a cited caller, not a grade

The review loop SHALL require the reviewer to report, for every issue, either a citation of a
caller that reaches the implicated code — file, line, and the quoted line — or an explicit
statement that it found none. The citation is an artifact of the reading the reviewer already
performs, in the same shape as the existing evidence rule, and SHALL NOT be a self-assigned
importance rating.

#### Scenario: Reviewer reports an issue in code with a caller

- **WHEN** the reviewer reports an issue and finds a caller reaching that code
- **THEN** the issue carries the citing file, line, and quoted line

#### Scenario: Reviewer finds no caller

- **WHEN** the reviewer can find no caller reaching the implicated code
- **THEN** the issue explicitly states that none was found
- **AND** silence is not accepted in place of that statement

### Requirement: Exposure never gates admission

Exposure SHALL NOT block an issue from being fixed, alter a verdict, or consume any part of the
retry budget. An issue with no cited caller is admitted on the same terms as any other.

#### Scenario: Issue with no cited caller reaches the round

- **WHEN** a pending issue reports that no caller was found
- **THEN** it is still dispatched for fixing
- **AND** its retry budget and terminal statuses are unchanged

### Requirement: Exposure orders dispatch

The review loop SHALL dispatch pending issues carrying a cited caller before those reporting
none. Ordering SHALL be stable: issues that cannot be separated by exposure keep their existing
relative order.

#### Scenario: Round mixes cited and uncited issues

- **WHEN** a round has pending issues both with and without a cited caller
- **THEN** those with a cited caller are dispatched first

#### Scenario: Exposure does not separate two issues

- **WHEN** two pending issues report the same exposure, or neither reports any
- **THEN** their existing relative order is preserved

### Requirement: The fixer restates exposure independently

The review loop SHALL require the fixer, which has already read the code, to report its own
exposure assessment alongside its verdict, independently of the reviewer's. Disagreement
between the two SHALL be recorded rather than resolved, and SHALL NOT change the fix outcome.

#### Scenario: Fixer returns a result

- **WHEN** a fixer returns a result for an issue
- **THEN** it carries the fixer's own exposure assessment

#### Scenario: Reviewer and fixer disagree about exposure

- **WHEN** the fixer's assessment differs from the reviewer's
- **THEN** the divergence is recorded in the run trace and counted in the round's metrics
- **AND** the fix is accepted or rejected exactly as it would have been otherwise

### Requirement: Exposure evidence survives the run

The review loop SHALL report the exposure distribution and the reviewer-versus-fixer divergence
count in the run summary and run metrics, so a later change can decide on evidence whether
exposure may gate.

#### Scenario: Run completes or is stopped

- **WHEN** a run finishes, including a run stopped by its budget or a signal
- **THEN** the summary and metrics carry the exposure distribution and divergence count

#### Scenario: Run resumes from state written before this capability

- **WHEN** a run resumes from persisted state that carries no exposure
- **THEN** the missing exposure is treated as unknown and the run continues
- **AND** unknown is not counted as a divergence
