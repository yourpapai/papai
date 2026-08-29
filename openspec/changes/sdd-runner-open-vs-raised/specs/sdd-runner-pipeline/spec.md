# sdd-runner-pipeline delta

## MODIFIED Requirements

### Requirement: Severity-based convergence

A review round SHALL be evaluated over two distinct count sets. The **raised**
set SHALL count every finding the round recorded, by class, and SHALL be the
number reported to the convergence trajectory, the per-round burndown, and the
lens-escalation decision. The **open** set SHALL count only findings that a
human alone can settle: a finding the resolver dismissed; a finding resolved as
assumed with no matching assumption record; and a finding resolved as edited
whose files are byte-identical to the previous round's recorded snapshot. A
finding answered from repository evidence, an assumed finding with its
assumption logged, and an edit that changed files SHALL NOT be open.

A round's verdict SHALL be one of three values. It SHALL be `converged` when the
open set holds nothing above a nitpick and at most three open nitpicks. It SHALL
be `needs-review` when the open set is clean by that test but the round recorded
at least one edit above a nitpick that no reviewer has since seen. It SHALL be
`open` otherwise.

A round reaching the round cap SHALL route by that verdict: `converged` flows
into decomposition without an early gate; `open` presents an early gate for
human sign-off; `needs-review` SHALL run exactly one further review round when
the budget guard permits it, and SHALL then flow into decomposition regardless
of that round's outcome. The further round SHALL NOT be granted more than once
per cap-hit, and SHALL be declined — flowing into decomposition instead — when
the budget guard would refuse the spend.

#### Scenario: Fixed finding no longer blocks convergence

- **WHEN** the review loop reaches its round cap and every finding above a
  nitpick was resolved by an edit that changed files, or answered from
  repository evidence
- **THEN** the round's open set is empty and no early gate is presented

#### Scenario: Nitpick-only cap-hit converges without a gate

- **WHEN** the review loop reaches its round cap and every open finding is a
  resolved or dismissed nitpick
- **THEN** the pipeline proceeds directly to decomposition as if the loop had
  converged on a clean round

#### Scenario: Dismissed material finding at cap still gates

- **WHEN** the review loop reaches its round cap with at least one MATERIAL
  finding the resolver dismissed
- **THEN** an early gate is presented and the pipeline waits for a human decision

#### Scenario: Unreviewed edits buy exactly one verification round

- **WHEN** a cap-hit round's open set is clean but the round recorded an edit
  above a nitpick that no reviewer has seen, and the budget guard permits the
  spend
- **THEN** exactly one further review round runs, and the pipeline then flows
  into decomposition whatever that round records — a second further round is
  never granted for the same cap-hit

#### Scenario: Budget refusal converges instead of extending

- **WHEN** a cap-hit round verdict is `needs-review` and the budget guard would
  refuse the further round
- **THEN** no further round runs and the pipeline flows into decomposition

#### Scenario: An edit that changed nothing is open

- **WHEN** a round records a MATERIAL finding resolved as edited, and the change
  folder's files are byte-identical to the previous round's recorded snapshot
- **THEN** that finding counts as open and the cap-hit presents an early gate

#### Scenario: An assumed finding with no logged assumption is open

- **WHEN** a round records a MATERIAL finding resolved as assumed and no
  assumption in that round carries the finding's id
- **THEN** that finding counts as open

#### Scenario: Pre-change sidecars resume without migration

- **WHEN** a run resumes from sidecars whose assumption records carry no finding
  id at all
- **THEN** an assumed finding is closed when the round logged at least one
  assumption, and the run resumes with no migration step

### Requirement: Resume covers post-review stages

`resume` SHALL re-enter at the interrupted stage, derived from artifacts and the
event log rather than persisted stage pointers. A review loop SHALL count as
settled only when a `converged` verdict was recorded, an early gate was answered
by a human, or the pipeline already entered decomposition. A `needs-review`
verdict SHALL NOT count as settled, so a run interrupted before its verification
round resumes into that round rather than past it.

#### Scenario: Interrupted verification round resumes into review

- **WHEN** a run is interrupted after recording a `needs-review` verdict and
  before its verification round completes
- **THEN** resume re-enters the review stage rather than treating the loop as
  settled

#### Scenario: Converged verdict settles the loop

- **WHEN** a run's last recorded verdict is `converged`
- **THEN** resume treats the review loop as settled and continues past it

## ADDED Requirements

### Requirement: Gate finding rows carry their evidence

Every finding rendered as a checkbox row on a gate SHALL carry the verbatim gap
the reviewer quoted, not the finding's identifier. The gap SHALL be sourced by
joining the round's findings sidecars with its resolutions sidecar, and the join
SHALL include every lens that filed findings in that round, so a run whose
skeptic lens participated does not render identifiers for the skeptic's rows.

Rendered gap text SHALL be reduced to a single line and truncated before it is
written into a gate file, so that the checkbox grammar and the redirect grammar
still parse: a gap containing a newline or a leading redirect marker SHALL NOT
be able to corrupt the parse of the gate it appears on.

#### Scenario: Gate row shows the quoted gap

- **WHEN** an early gate presents an open MATERIAL finding
- **THEN** its checkbox row carries the verbatim gap the reviewer quoted,
  alongside the resolver's outcome

#### Scenario: Skeptic findings render their gaps too

- **WHEN** a gate presents findings from a round in which the skeptic lens also
  filed findings
- **THEN** the skeptic's rows carry their gaps, not their identifiers

#### Scenario: A multi-line gap cannot corrupt the gate grammar

- **WHEN** a finding's quoted gap spans several lines or begins with a redirect
  marker
- **THEN** the rendered row is a single truncated line, and writing then
  re-parsing the gate yields the same decision it was written from

#### Scenario: A missing findings sidecar degrades to the identifier

- **WHEN** a round's findings sidecar cannot be read or does not contain the
  finding
- **THEN** the row renders the identifier as before and the gate is still
  presented
