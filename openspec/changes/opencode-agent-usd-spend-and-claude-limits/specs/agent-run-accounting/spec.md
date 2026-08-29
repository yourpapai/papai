<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# agent-run-accounting

## Purpose

What one coding-agent run reports about its own spend and its model provider's
standing: what the run cost in US dollars, what the issue has cost across every
job it has run, and — where the provider reports one — the state of the
subscription rate-limit window the next run will meet.

## ADDED Requirements

### Requirement: A run reports its cost in US dollars

The run's summary detail SHALL report what the run cost in US dollars and what
the issue has cost across every job it has run, alongside the token figure
already reported. Both figures SHALL be derived from the same accumulated
record, so they cannot disagree.

#### Scenario: A priced run on a fresh issue

- **WHEN** a run is the first job on an issue and its spend can be priced at
  $1.87
- **THEN** the summary detail reports `$1.87` as the run's cost and `$1.87` as
  the issue's cost

#### Scenario: A priced run on an issue that has already spent

- **WHEN** a run costing $1.87 finishes on an issue whose earlier jobs recorded
  $10.53
- **THEN** the summary detail reports `$1.87` for the run and `$12.40` for the
  issue

#### Scenario: The token budget line is unchanged

- **WHEN** any run reports its cost
- **THEN** the token figure, the configured token ceiling and the attempt count
  are reported exactly as before, and the enforced budget remains the token
  ceiling

### Requirement: Cost resolves on a fixed ladder across both backends

Cost SHALL be resolved by the same ordered ladder whichever model backend ran
the work: first the figure the backend itself reported; failing that, the run's
token counts priced against the model catalogue; failing that, unpriced. The
rung that answered SHALL be recorded in the run log.

#### Scenario: The backend reports a cost

- **WHEN** the backend reports a non-zero cost for the session
- **THEN** that figure is the run's cost and the catalogue is not consulted

#### Scenario: The backend reports no cost but the model is in the catalogue

- **WHEN** the backend reports a cost of zero for a session that consumed tokens,
  and the catalogue prices the configured model
- **THEN** the run's cost is the token counts priced against that catalogue entry

#### Scenario: The same arithmetic prices both a run and a pipeline gate

- **WHEN** a set of token counts is priced against a given set of per-token rates
- **THEN** the resulting figure is identical to the one the SDD pipeline's
  repricing produces for those same counts and rates

### Requirement: An unpriceable run reports as unpriced, never as zero

A run whose cost no rung of the ladder can establish SHALL be reported as
unpriced. It SHALL NOT be reported as `$0.00`, and it SHALL NOT contribute a
zero to any total that would then read as a complete figure.

#### Scenario: No rung can price the run

- **WHEN** the backend reports no cost and the catalogue prices neither the
  configured model nor any model of that name under another provider
- **THEN** the run is reported as unpriced rather than as `$0.00`

#### Scenario: An unpriced run inside a priced issue

- **WHEN** one job on an issue is unpriced and the issue's other jobs total
  $12.40
- **THEN** the issue's cost is reported as a floor — at least $12.40 — and states
  that some of the issue's spend could not be priced

#### Scenario: Nothing on the issue has ever been priced

- **WHEN** no job on an issue has ever produced a priceable figure
- **THEN** the cost report is omitted from the summary detail entirely rather
  than reporting zero

#### Scenario: A backend reports token counts it cannot break down

- **WHEN** a backend's usage report omits a token category rather than reporting
  it as zero, so the counts cannot be completely priced
- **THEN** the run is reported as unpriced rather than priced from the
  categories that were reported

### Requirement: Accumulated spend survives across an issue's jobs

Accumulated cost SHALL be carried across every job an issue runs, in the same
way the accumulated token figure is carried, and SHALL be recorded whenever a
job records its token spend — including when the job failed, was refused, or
stopped at a budget ceiling.

#### Scenario: A failing job still records what it spent

- **WHEN** a job prompts the model and then fails
- **THEN** the cost it incurred is recorded against the issue, so the next job
  carries it

#### Scenario: A job that never prompts the model

- **WHEN** a job settles without ever opening a model session
- **THEN** it records no additional cost and the issue's accumulated figure is
  unchanged

#### Scenario: An issue whose record predates this capability

- **WHEN** a job resumes an issue whose stored record carries no cost figure
- **THEN** the record is read as zero accumulated cost rather than rejected, and
  the issue continues to run

#### Scenario: A job's cost is counted once

- **WHEN** a job cascades through several phases in one run
- **THEN** the issue's accumulated cost increases by that job's total cost once,
  not once per phase

### Requirement: A subscription-credentialed run reports the provider's rate-limit standing

When the run's model credential is a Claude OAuth subscription token and the
provider reported its rate-limit standing during the run, the summary detail
SHALL report that standing: the window, its status, when it resets, and whether
overage is in play. The report SHALL cover every window the provider reported,
and no other.

#### Scenario: The provider reports one window

- **WHEN** a subscription-credentialed run's provider reports a five-hour window
  that is allowed and resets at a stated time
- **THEN** the summary detail reports that window, its status and its reset time

#### Scenario: The provider reports several windows

- **WHEN** a run's provider reports both a five-hour and a longer window
- **THEN** the summary detail reports a row for each

#### Scenario: The provider reports a window more than once

- **WHEN** a run spans several model turns and the provider reports the same
  window on each
- **THEN** the standing reported is the one from the last turn, because that is
  the standing the next run will meet

#### Scenario: Overage is in play

- **WHEN** the provider reports that the run is using overage, or reports an
  overage status and reset of its own
- **THEN** the summary detail reports that fact alongside the window

#### Scenario: A route that reports no standing

- **WHEN** a run uses a credential or backend whose provider reported no
  rate-limit standing
- **THEN** the rate-limit report is omitted from the summary detail entirely

#### Scenario: An unrecognized window name

- **WHEN** the provider reports a window under a name this pipeline has never
  seen
- **THEN** that window is reported as given, and the run is unaffected

### Requirement: No rate-limit figure is reported that the provider did not state

The rate-limit report SHALL contain only facts the provider stated. A remaining
quota, a consumed fraction, or a window the provider did not report SHALL NOT be
inferred, estimated, or derived from a reset timestamp.

#### Scenario: The provider states no remaining quota

- **WHEN** the provider reports a window's status and reset time but no remaining
  quota
- **THEN** the summary detail reports the status and reset time and reports no
  remaining quota

#### Scenario: The provider states a remaining quota

- **WHEN** the provider reports a remaining quota for a window
- **THEN** the summary detail reports that figure as stated

#### Scenario: The provider reports no weekly window

- **WHEN** the provider reports only a five-hour window
- **THEN** no weekly row appears, and no weekly figure is inferred from the
  five-hour window or from any overage reset

### Requirement: Accounting never fails the work it reports on

Reporting cost and rate-limit standing SHALL be best-effort. A catalogue that
cannot be read, a usage report in an unrecognized shape, or a malformed
rate-limit field SHALL degrade that one fact to unknown and SHALL NOT fail the
phase, the run, or any other reported fact.

#### Scenario: The model catalogue is unreachable

- **WHEN** the catalogue cannot be fetched or read while a run is being priced
- **THEN** the run reports as unpriced and completes normally

#### Scenario: A malformed field in a rate-limit report

- **WHEN** the provider's rate-limit report carries a field in an unexpected shape
- **THEN** that field is reported as unknown, the rest of the window is reported,
  and the run is unaffected

#### Scenario: The token ceiling is unaffected by a pricing failure

- **WHEN** cost cannot be established for a run
- **THEN** the token budget is measured, enforced and reported exactly as it
  would have been

### Requirement: The accounting report exposes no secrets

The cost and rate-limit report SHALL carry only names, figures, statuses and
timestamps. It SHALL NOT carry credentials, model prose, tool input or tool
output, on the issue or in the run log.

#### Scenario: A run on a public repository

- **WHEN** the summary detail and the run log are written for a run whose
  credential is a subscription token
- **THEN** neither carries the credential, any part of it, or any model or tool
  content
