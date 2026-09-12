## MODIFIED Requirements

### Requirement: Deterministic report content

`report <runId>` SHALL render, in stable field order, the run's facts, the
gains block, and the commit list, as plain text. On a run with execution
events the facts SHALL include the task progress (done versus total), the
verify outcomes, and the release gate's version and outcome. The same run
state SHALL always render the same bytes, and `--pr` SHALL render the PR-body
variant of the same content.

#### Scenario: Same run, same bytes

- **WHEN** `report <runId>` is invoked twice over an unchanged run
- **THEN** both invocations print identical bytes

#### Scenario: PR variant

- **WHEN** `report <runId> --pr` is invoked
- **THEN** the PR-body variant of the same facts, gains, and commits is printed

#### Scenario: Execution facts render

- **WHEN** a completed execution-armed run's report is printed
- **THEN** the facts include tasks done versus total, the verify outcomes, and the release gate's version and outcome

### Requirement: Honest memo on every park

Every park SHALL write the derived run memo reflecting the folded log:
terminal runs record `completed` or `aborted`, and a run that aborted at an
escalation gate SHALL record `failed`. On a run with task events the memo
SHALL carry a tasks projection matching the folded task records; memos of runs
without task events SHALL omit the projection and parse unchanged. A memo
that does not match the fold SHALL be discarded and re-derived rather than
trusted.

#### Scenario: Abort-at-escalation records failed

- **WHEN** a run aborts at an escalation gate
- **THEN** its memo records the `failed` status

#### Scenario: Stale memo re-derives

- **WHEN** a run boots and finds a memo that disagrees with the folded log
- **THEN** the memo is discarded and re-derived from the log

#### Scenario: Execution memo carries task progress

- **WHEN** a run parked mid-execution writes its memo
- **THEN** the memo's tasks projection matches the folded task records exactly
