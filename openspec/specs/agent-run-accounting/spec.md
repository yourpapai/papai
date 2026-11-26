# agent-run-accounting Specification

## Purpose

Prices each agent run under the catalogue key of the backend that actually ran it, reports spend in US dollars off a fixed pricing ladder, marks an unpriceable run as unpriced rather than zero, and reports subscription rate-limit standing — without failing the work it reports on or exposing secrets.

## Requirements

### Requirement: A run is priced under the catalogue key of the backend that ran it

The model reference a run is priced and logged under SHALL name the provider that
actually served the run's model turns, and SHALL name the model by the same id
the backend was invoked with. A run on the Claude CLI backend SHALL be priced
under the Anthropic catalogue, whatever provider id the gateway route's
configuration names; a run on the OpenCode backend SHALL keep being priced under
the configured gateway catalogue id, which is the key its own model resolution
already uses.

This applies to the catalogue rung and to the log line that records which rung
answered. It does not reorder the ladder: a backend that states its own cost
still outranks the catalogue.

#### Scenario: A claude-backend run whose configuration names a gateway catalogue

- **WHEN** a run on the Claude CLI backend is priced, and the configuration
  carries a gateway catalogue provider id left over from the other route
- **THEN** the run is priced and logged under the Anthropic catalogue, and that
  gateway id appears in neither the pricing lookup nor the log line

#### Scenario: A model named with a provider prefix

- **WHEN** a claude-backend run's configured model is spelled `<provider>/<model>`
  — the form this route accepts and strips before invoking the CLI
- **THEN** it is priced under the same stripped model id the CLI was invoked
  with, and not under a reference that concatenates two provider names

#### Scenario: The stripped model id has a catalogue row

- **WHEN** a claude-backend run's counts are priced and the Anthropic catalogue
  carries a row for that model id
- **THEN** the run is priced from that row's own rates, not from a figure
  averaged across other providers publishing a model of the same name

#### Scenario: An opencode-backend run is unaffected

- **WHEN** a run on the OpenCode backend is priced
- **THEN** it is priced and logged under the configured gateway catalogue
  provider id exactly as before

#### Scenario: The backend's own figure still wins

- **WHEN** a claude-backend run's backend states a non-zero cost
- **THEN** that figure is the run's cost, the catalogue is not consulted, and
  the log line names the reference this requirement pins

#### Scenario: The reference is a name, not a credential

- **WHEN** the reference is written to the run log on a public repository
- **THEN** it carries the provider id and the model id only, and no part of any
  Anthropic or gateway credential

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
SHALL report that standing: the window, how much of it remains, its status, when
it resets, and whether overage is in play. The report SHALL cover every window
the provider reported, and no other.

#### Scenario: The provider reports one window

- **WHEN** a subscription-credentialed run's provider reports a five-hour window
  that is allowed and resets at a stated time
- **THEN** the summary detail reports that window, its remaining share, its
  status and its reset time

#### Scenario: The provider reports both a five-hour and a weekly window

- **WHEN** a run's provider reports a five-hour window and a seven-day window,
  each with its own consumed share and reset time
- **THEN** the summary detail reports a row for each, with that window's own
  remaining share and reset time

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

### Requirement: Remaining quota is reported as a percentage, derived from the stated consumed share

For each reported window whose consumed share the provider states, the summary
detail SHALL report the remaining quota as a percentage — the complement of the
consumed share. It SHALL NOT be inferred, estimated, or derived from a reset
timestamp, from elapsed time within the window, or from any other window's
figure. A window whose consumed share the provider does not state SHALL be
reported without a remaining figure rather than omitted.

#### Scenario: A five-hour window with a stated consumed share

- **WHEN** the provider states that 23.5% of the five-hour window is consumed
- **THEN** the summary detail reports 76.5% remaining for that window

#### Scenario: A weekly window with a stated consumed share

- **WHEN** the provider states that 41.2% of the seven-day window is consumed
- **THEN** the summary detail reports 58.8% remaining for that window

#### Scenario: A fully consumed window

- **WHEN** the provider states a window's consumed share as 100% or above
- **THEN** the summary detail reports no remaining quota for that window rather
  than a negative percentage

#### Scenario: A window reported without a consumed share

- **WHEN** the provider reports a window's status and reset time but states no
  consumed share for it
- **THEN** the summary detail reports that window's status and reset time and
  reports no remaining percentage for it

#### Scenario: No figure is reconstructed from a timestamp

- **WHEN** a window carries a reset time but no consumed share
- **THEN** no remaining percentage is computed from how much of the window has
  elapsed, from any overage reset time, or from another window's share

#### Scenario: A window the provider never reported

- **WHEN** the provider reports only a five-hour window
- **THEN** no weekly row appears and no weekly figure is inferred

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
