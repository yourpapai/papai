# Delta Spec: agent-ci-repair

## Purpose

Turns a red CI run on the agent's own pull request into either a pushed fix or
a maintainer-ready explanation, by diagnosing the actual failed jobs and logs
of that run rather than a preconfigured local check list.

## ADDED Requirements

### Requirement: Fix scope is derived from the red run

A CI-fix round SHALL discover what failed by reading the red run's failed jobs
and their logs through the Actions API. It SHALL NOT depend on any
repository-configured list of local checks; no configuration SHALL be required
for CI fixing to operate.

#### Scenario: Failure outside the default check set

- **WHEN** a red run fails on a check the repository runs in CI but that no
  static local default would name (for example a mutation-score ratchet)
- **THEN** the fix round diagnoses that check's failure from the run's jobs and
  logs, and the round's repair work addresses it

#### Scenario: Red run with no failed job

- **WHEN** a red run reports failure but exposes no failed job (for example a
  startup error or a cancelled runner)
- **THEN** the round reports a needs-human outcome naming the run and saying no
  failed job could be found, rather than claiming the checks passed

### Requirement: Reproducible failures are fixed against a local run

WHEN the failed step's command can be derived from the repository's own CI
configuration, the fixer SHALL run that command locally and repair until it
passes or the round budget is exhausted. A round that claims green SHALL have
observed the derived command pass locally.

#### Scenario: Derived command reproduces the failure

- **WHEN** the locally run derived command fails with output consistent with
  the CI log
- **THEN** repair proceeds against the local failure until it passes or rounds
  are exhausted

#### Scenario: Derived command passes locally

- **WHEN** the derived command passes locally while CI reported it red
- **THEN** the round does not report success for the branch; it treats the
  failure as not locally reproducible and proceeds under the log-based or
  needs-human paths

### Requirement: Non-reproducible failures may be fixed from logs

WHEN the failure cannot be reproduced on the fixer's runner, the fixer SHALL be
permitted to repair from log analysis alone, provided the resulting fix is
pushed with a report stating it was verified against the log rather than a
local run.

#### Scenario: Log justifies a code fix

- **WHEN** the CI log identifies a defect the fixer can correct without
  reproducing the failure locally
- **THEN** the fix is committed and pushed, and the report says it rests on log
  analysis

### Requirement: Needs-human outcomes are reported, not retried blind

WHEN the fixer judges a failure outside its reach — including repository or
organisation settings, missing secrets, infrastructure faults, and decisions
that belong to a maintainer — it SHALL attempt no fix and SHALL report which
job failed, why the agent cannot fix it, and what the human can do. The report
SHALL be specific enough that a maintainer need not open the Actions log to
know what category of problem occurred.

#### Scenario: Failure requires a human

- **WHEN** the diagnosis concludes the remedy is outside the agent's reach
- **THEN** the round posts a needs-human report naming the failed job, the
  reason, and the remedy, and pushes nothing

#### Scenario: Budget accounting for a needs-human round

- **WHEN** a needs-human round completes
- **THEN** it consumes one CI-fix attempt like any other round, and later red
  runs of the same pull request continue to be bounded by the CI-fix budget

### Requirement: Round reports distinguish every outcome

Each round's report SHALL say which of these the round came to: a verified fix
pushed, a log-based fix pushed, nothing pushed because nothing changed,
nothing pushed because the fix exists but cannot be pushed, or needs human —
and a green local verdict on a round that pushed nothing SHALL be scoped to
the job, never to the branch.

#### Scenario: Nothing changed

- **WHEN** a round's diagnosis and repair produce no working-tree change
- **THEN** the report says nothing was pushed because nothing changed, and
  names what the round actually diagnosed

### Requirement: CI logs are untrusted input

Job names, step names and log text from a red run SHALL be treated as
untrusted: redacted at the API boundary, enveloped before entering any model
prompt, and never interpolated into a command line. Locally executed
reproduction commands SHALL come from the repository's own CI configuration,
not from log text.

#### Scenario: Log content cannot reach a command line

- **WHEN** a CI log contains text shaped like shell input
- **THEN** no command executed by the fixer is constructed from that text

### Requirement: The red run is addressable without scraping

The red-CI trigger SHALL carry the run's identity as structured data, so the
failed jobs and logs are fetched by id and the run's URL is never parsed to
recover one.

#### Scenario: Trigger carries the run id

- **WHEN** a red run enters the pipeline
- **THEN** the fix round addresses that run's jobs and logs through its id
