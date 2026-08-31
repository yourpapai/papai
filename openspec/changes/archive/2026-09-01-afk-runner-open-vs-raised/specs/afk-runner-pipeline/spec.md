# afk-runner-pipeline Delta

## MODIFIED Requirements

### Requirement: Severity-based convergence

Each review round SHALL count two distinct sets of findings: **raised** —
every finding the reviewers filed, tallied by final class — and **open** — the
subset that still needs a human. A resolution SHALL be open when it was
dismissed; when it claims `assumed` and no assumption record in the round
carries its finding id while at least one record does carry a finding id; or
when it claims `edited` and the round's artifact hash snapshot is unchanged
from the prior round's. A resolution SHALL read closed when it is
`evidence-answered`; when its `assumed` claim is backed by an assumption
record carrying its finding id; when its `edited` claim moved the artifact
hashes; when a round-1 `edited` claim has no prior snapshot to compare; and —
as the pre-change sidecar fallback — when it claims `assumed` in a round whose
assumption records carry no finding ids at all.

The round's verdict SHALL be three-valued: `converged` when nothing above a
nitpick is open and at most three nitpicks are open; `open` when any BLOCKER
or MATERIAL finding is open; and `needs-review` when the open set passes the
converged test but the round recorded an edit above a nitpick that no
reviewer has seen.

Cap-hit routing SHALL read the open set: a round at its cap with zero open
BLOCKER and zero open MATERIAL findings SHALL be treated as converged and
SHALL flow into the tail without presenting an early gate, whatever was
raised; a round at its cap with any open BLOCKER or MATERIAL finding SHALL
present an early gate for human sign-off.

#### Scenario: Fully fixed material finding converges without a gate

- **WHEN** the review loop reaches its round cap with a MATERIAL finding whose resolution claims `edited` and whose round moved the artifact hashes
- **THEN** the pipeline proceeds directly to the tail without a gate

#### Scenario: Open material finding at cap still gates

- **WHEN** the review loop reaches its round cap with at least one open MATERIAL finding — one the resolver dismissed, left unbacked by an assumption record, or claimed as edited without moving the hashes
- **THEN** an early gate is presented and the pipeline waits for a human decision

#### Scenario: Unbacked assumed claim stays open

- **WHEN** a round's resolution claims `assumed`, some assumption record in the round carries a finding id, and none carries this resolution's finding id
- **THEN** the finding counts as open and an above-nitpick one still gates at cap

#### Scenario: Nitpick-only cap-hit converges without a gate

- **WHEN** the review loop reaches its round cap and every open finding is a nitpick, at most three of them
- **THEN** the pipeline proceeds directly to the tail without a gate

## ADDED Requirements

### Requirement: Verification round at a needs-review cap

A cap-hit whose verdict is `needs-review` SHALL run exactly one further
review round when the budget guard allows it, and SHALL then settle review
whatever that round records: no second verification round SHALL be bought for
the same cap-hit, and an open BLOCKER or MATERIAL finding recorded by the
verification round SHALL still present the early gate — a spent round does not
waive the human's call. The budget guard SHALL follow the R4 metered
semantics: an unknown cumulative cost refuses the round only on a metered
run, and a null cost ceiling never refuses. When the guard refuses, the run
SHALL continue to the tail without spending the round and without appending
an auto-decision for the refusal; the final gate presents the unreviewed
edits to a human either way.

Resume SHALL not skip a pending verification round: a `needs-review` verdict
SHALL leave review unsettled until a later round's verdict is recorded, and a
run interrupted during the verification round SHALL re-enter it.

#### Scenario: Needs-review buys exactly one round

- **WHEN** a round at its cap returns `needs-review` and projected spend is within budget
- **THEN** exactly one further review round runs, and the pipeline then continues to the tail or presents the early gate according to that round's open set

#### Scenario: A second needs-review does not buy another

- **WHEN** the verification round itself returns `needs-review`
- **THEN** no further verification round is bought and review settles into the tail

#### Scenario: Open material from the verification round still gates

- **WHEN** the verification round records an open MATERIAL finding
- **THEN** the early gate is presented for it

#### Scenario: Over-budget refusal flows to the tail

- **WHEN** a `needs-review` cap-hit's projected spend is at or over the configured numeric ceiling, or the run is metered with unknown cost
- **THEN** no verification round is spent, the run continues to the tail, and no auto-decision event is appended for the refusal

#### Scenario: Interrupted verification round re-enters

- **WHEN** a run is interrupted during its verification round and resumed
- **THEN** the verification round re-runs and review does not settle until its verdict is recorded

### Requirement: Per-round artifact hash snapshots

Each review round close SHALL record a hash snapshot of the change folder's
agent artifacts — over the same file set the gate's presentation hashes
cover — keyed by round in the run's sidecars, so an `edited` resolution's
claim is checkable against what actually moved. Snapshots SHALL exclude the
files the runner itself regenerates every round, so a round that changed no
source artifact produces a snapshot equal to the previous round's. A missing
prior snapshot SHALL be tolerated.

#### Scenario: Round close writes its snapshot

- **WHEN** a review round closes
- **THEN** a per-round hash snapshot over the gate's artifact set is recorded in the run's sidecars

#### Scenario: Unchanged artifacts produce an equal snapshot

- **WHEN** a round closes without changing any agent artifact
- **THEN** its snapshot equals the prior round's snapshot

#### Scenario: Regenerated files never mark a round changed

- **WHEN** a round closes having changed only the files the runner regenerates every round
- **THEN** the round's snapshot shows no change and an `edited` claim in that round reads open

### Requirement: Gate rows carry the verbatim gap

Early-gate finding rows SHALL carry the reviewer's verbatim gap, joined from
the round's findings sidecars with both lenses merged, and SHALL degrade to
the finding identifier when a sidecar is missing or malformed. Free text
rendered into a gate file SHALL be sanitized for the file's line-oriented
decision grammar — collapsed to a single line, leading redirect markers
stripped, truncated at a fixed width — and the gate-file writer SHALL flatten
every free-text field it writes, so a gate file parsed back reproduces the
answers it was rendered from whatever prose the reviewers produced.

#### Scenario: Row carries the joined gap

- **WHEN** an early gate renders a finding row for a finding present in the round's findings sidecars
- **THEN** the row carries the finding's verbatim gap rather than its identifier

#### Scenario: Missing sidecar degrades to the identifier

- **WHEN** the round's findings sidecar is missing or malformed
- **THEN** the row degrades to the finding identifier and the gate still renders

#### Scenario: Multi-line gap renders as one sanitized line

- **WHEN** a finding's gap contains newlines or begins with a redirect marker
- **THEN** the rendered row carries it collapsed, stripped, and truncated so it cannot parse as a decision directive

#### Scenario: Written gate files parse back

- **WHEN** a gate file is written from answers whose free-text fields carry multi-line text containing decision directives
- **THEN** parsing the file reproduces the same answers
