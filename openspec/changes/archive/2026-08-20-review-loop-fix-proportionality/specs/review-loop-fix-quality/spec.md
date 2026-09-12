<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the instruction contract the review loop gives a fixer — how small a fix must be, what
it must leave behind, and what it must not author — together with the advisory signal the
orchestrator records to show whether that contract is being honoured.

## ADDED Requirements

### Requirement: Fix instructions demand the minimum viable change

The review loop SHALL instruct a fixer to establish, after it understands the problem and
before it writes code, that the change must exist, that nothing already in the codebase covers
it, and that no smaller form of it works.

#### Scenario: Issue dispatched to a fixer

- **WHEN** the loop dispatches an issue for fixing
- **THEN** the fix instruction requires the fixer to apply that ladder before writing new code
- **AND** the ladder is stated as applying after comprehension, never as a reason to read less

#### Scenario: Fixer retried after a build failure or inspector rejection

- **WHEN** the loop re-dispatches an issue on its second and final attempt
- **THEN** the retry instruction carries the same minimality requirement as the first attempt

### Requirement: Non-trivial fixes leave a runnable check behind

The review loop SHALL require that a fix introducing non-trivial logic leaves at least one
runnable check in the tree, located by the repository's own implementation-to-test path
mapping rather than by a rule private to the loop.

#### Scenario: Fix introduces non-trivial logic

- **WHEN** a fixer resolves an issue by adding or changing non-trivial logic
- **THEN** the fix instruction requires a runnable check to remain in the tree afterwards
- **AND** transiently reproducing the defect without leaving a check does not satisfy it

### Requirement: Fixers do not author architecture documentation

The review loop SHALL forbid a fixer from writing architecture prose, extending the existing
prohibition on editing the plan or spec. A documentation gap SHALL be reported rather than
filled, because a later fix in the same run can invalidate prose an earlier fix wrote and no
actor in the loop compares two fixes.

#### Scenario: Fixer finds documentation that does not match the code

- **WHEN** a fixer determines that an architecture document is inaccurate or incomplete
- **THEN** it reports the gap in its result reasoning
- **AND** it does not edit the document

### Requirement: The coverage signal is recorded and advisory

The review loop SHALL record, for each accepted fix, whether that fix's diff touched a test
path, and SHALL surface it in the run summary and run metrics. The signal SHALL NOT block a
merge, change a verdict, or consume any part of the retry budget.

#### Scenario: Accepted fix touched no test path

- **WHEN** a fix is accepted and its diff touched no test path
- **THEN** the fix is still committed and merged
- **AND** the retry budget for that issue is unchanged
- **AND** the run summary and metrics report that no test path was touched

#### Scenario: Signal cannot be computed

- **WHEN** the underlying diff measurement is unavailable or fails
- **THEN** the run continues and the fix is unaffected
- **AND** the absence is reported rather than recorded as a satisfied check
