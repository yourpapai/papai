## Purpose

Defines what the GitHub Actions agent's per-issue token ceiling counts, when it stops a run, and how an issue's carried total behaves when the definition of the count changes — so one `AGENT_MAX_TOKENS` value means the same thing on every model backend.

## ADDED Requirements

### Requirement: The ceiling counts tokens that entered the conversation once

The system SHALL enforce `AGENT_MAX_TOKENS` on the sum of uncached input, output, reasoning, and cache-write tokens, and SHALL exclude cache-read tokens from that sum. The same definition SHALL apply on every model backend, so one configured value bounds every route identically.

Cache reads are the conversation re-sent to the provider on each step of a turn; counting them makes the enforced figure grow with the number of steps rather than with the work done, and makes the same content count once per step.

#### Scenario: A turn's cache reads do not consume the ceiling

- **WHEN** a turn reports 4 uncached input, 155 output, 28,005 cache-write and 61,460 cache-read tokens
- **THEN** the figure enforced against `AGENT_MAX_TOKENS` for that turn SHALL be 28,164
- **AND** the 61,460 cache-read tokens SHALL NOT contribute to it

#### Scenario: Both backends answer the same question

- **WHEN** a run reports the same four token buckets on the claude backend and on the OpenCode backend
- **THEN** both SHALL contribute the same figure to the ceiling

#### Scenario: A bucket the backend never reported spends nothing

- **WHEN** a backend reports no value at all for a cache-write or reasoning bucket, as distinct from reporting zero
- **THEN** the ceiling SHALL treat that bucket as zero and SHALL still return a figure
- **AND** the run SHALL NOT be failed for the missing bucket

### Requirement: Cache reads remain in the reported cost

The system SHALL continue to price cache-read tokens at their own rate and include them in every reported cost figure. Excluding a bucket from the ceiling SHALL NOT exclude it from the price.

#### Scenario: The dollar figure is unchanged by this ceiling definition

- **WHEN** a run reports cache-read tokens and the backend reports its own cost figure
- **THEN** the reported cost SHALL be that backend figure, cache reads included, unchanged from what the same run reported before cache reads left the ceiling

#### Scenario: A repriced run still charges cache reads

- **WHEN** no backend cost figure is available and the run is priced from the model catalogue
- **THEN** cache-read and cache-write tokens SHALL each be priced at their own catalogue rate

### Requirement: A stop that spent nothing does not degrade the cost report

The system SHALL report an issue's total cost as an exact figure when every turn that ran was priced. A run that prompted the model zero times SHALL contribute zero dollars and SHALL NOT mark the issue's total as a lower bound.

The lower-bound marker exists to say that some turn's spend could not be priced. A run that never prompted has no unpriced spend — it has no spend.

#### Scenario: An over-budget stop reports an exact total

- **WHEN** a run is stopped by the ceiling before its first phase prompts the model, and every earlier job on the issue was priced
- **THEN** the run report SHALL state the issue's cost as an exact figure
- **AND** SHALL NOT present it as a minimum or note that some turns were unpriced

#### Scenario: Unrecognized usage still reports a lower bound

- **WHEN** a run prompts the model and the pipeline cannot recognize the usage the backend reported
- **THEN** the issue's cost SHALL be reported as a lower bound, noting that some turns were unpriced

#### Scenario: A mid-cascade stop still counts what the job already spent

- **WHEN** a phase completes and prompts the model, and the ceiling then stops the next phase in the same job
- **THEN** the spend of the completed phase SHALL be added to the issue's carried totals before the run reports

### Requirement: A carried total is never a mix of two counting scales

The system SHALL record which counting scale an issue's carried token total was measured on. When an issue's carried total was measured on a superseded scale, the system SHALL reset that total to zero exactly once, before adding the current job's figure, and SHALL record that the issue is now on the current scale.

An issue's ceiling spans every job it has run, so a total that adds figures from two different definitions is enforceable against neither.

#### Scenario: A pre-existing total is reset once

- **WHEN** a job restores an issue whose carried token total was measured on the superseded scale
- **THEN** the carried total SHALL be treated as zero for this and every later job
- **AND** the issue's recorded scale SHALL become the current one

#### Scenario: A total already on the current scale is preserved

- **WHEN** a job restores an issue already recorded as being on the current scale
- **THEN** its carried token total SHALL be carried forward unchanged

#### Scenario: The reset costs no issue its progress

- **WHEN** an issue's carried token total is reset
- **THEN** its phase, resume point, attempt counts, branch, pull request and cost totals SHALL be unchanged
- **AND** the issue SHALL NOT restart from its first phase

#### Scenario: The reset does not forget money

- **WHEN** an issue's carried token total is reset
- **THEN** its carried cost total SHALL be preserved, because cost was never measured on the superseded scale

### Requirement: The ceiling is checked before each phase, per issue

The system SHALL check the ceiling before starting each phase rather than after, SHALL treat a total equal to the configured ceiling as spent, and SHALL enforce against the issue's total across every job it has run.

#### Scenario: An exactly-spent budget stops the next phase

- **WHEN** an issue's carried total equals `AGENT_MAX_TOKENS` exactly
- **THEN** the next phase SHALL NOT start

#### Scenario: The total spans jobs

- **WHEN** an issue has run several jobs
- **THEN** the figure checked against the ceiling SHALL be every job's contribution summed, not the current job's alone
