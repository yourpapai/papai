# story-coverage-floor-qualification Specification

## Purpose

Defines how the Tier 0 story coverage floor is recorded against the tree it
measures, and the immutable qualification baseline that `test:stories:compat`
measures refactor branches against.

## Requirements

### Requirement: The floor describes the tree it was measured on

The floor in `scripts/story/coverage-floor.json` SHALL be a recorded
measurement of the current scope, derived with the ratchet's epsilon
convention (`floor((measured - 0.005) * 100) / 100`). It SHALL be raised
automatically by `bun coverage:ratchet:stories` from a green run, and MAY be
re-recorded downward only by an explicit, reviewed edit that states the
measured scope. `meanMetric` aggregation and `story-scope.ts` membership SHALL
NOT be changed to move the number.

#### Scenario: Scope grows faster than coverage

- **WHEN** the scoped file count grows materially since the floor was recorded
  and the mean falls below it
- **THEN** the floor is re-recorded at the measured value with the scope size
  stated, rather than the metric being reweighted or the scope narrowed

#### Scenario: Ratchet cannot lower

- **WHEN** `bun coverage:ratchet:stories` runs against a measurement below the
  current floor
- **THEN** `nextFloor` leaves the floor unchanged, so any reduction is a
  deliberate committed edit and never a silent side effect of a script

#### Scenario: Gate below floor

- **WHEN** `bun test:stories:coverage` measures below either floor
- **THEN** it exits non-zero and prints the per-file uncovered diagnostics

### Requirement: Coverage is bought with contracts, not with loads

A story added to raise the floor SHALL assert one user-visible result and one
durable system result, and SHALL NOT use retries to stabilise evidence. A story
whose only effect is to import a module so it stops counting as 0% SHALL NOT be
used to move the metric.

#### Scenario: Denied action

- **WHEN** a story covers a rejection branch
- **THEN** it asserts both the user-visible reply and that the affected store
  gained no row

#### Scenario: Load-only story

- **WHEN** a proposed story reaches a module without asserting a behavior of it
- **THEN** it does not qualify as coverage, and the module stays counted at 0%

### Requirement: Recorded qualification baseline

The roadmap design doc SHALL carry a literal `baselineSha`, the frozen
`treeHash` read from `reports/stories/manifest.json`, and the list of verified
commands. Shell variable names SHALL NOT remain in the rendered document.

#### Scenario: Baseline recorded

- **WHEN** the foundation verifies green on a commit
- **THEN** that commit's SHA and manifest tree hash are written as literals in
  the same commit that records them

#### Scenario: Baseline is immutable

- **WHEN** a later change edits a frozen story input
  (`tests/stories/**`, `scripts/story/**`, `bunfig.toml`, `tests/setup.ts`,
  `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`)
- **THEN** the recorded baseline no longer qualifies and a new baseline must be
  recorded before any refactor branch claims compatibility

### Requirement: Compatibility proven against the baseline

Both `BASE_REF=<baselineSha> bun test:stories:compat --manifest-only` and the
full `BASE_REF=<baselineSha> bun test:stories:compat` SHALL exit zero on the
recorded baseline commit.

#### Scenario: Compat run

- **WHEN** either compat command runs with the recorded `BASE_REF`
- **THEN** it exits zero and the full run executes the frozen suite from its
  immutable session

### Requirement: Ledger entries are evidence-bearing

A documented behavior SHALL qualify only through a ledger entry backed by an
executable record. `blocked:missing-implementation` and `retired` entries SHALL
NOT count as evidence, and a `partial` record SHALL NOT qualify a global
production refactor.

Evidence SHALL be attributed to the specific required dimension it proves. A
ledger entry SHALL NOT record a scenario that proves none of the behavior's
required dimensions, and the set of dimensions a behavior requires SHALL be
exactly the union of the dimensions it proves and the dimensions it declares
open — a behavior SHALL NOT require a dimension that is neither.

#### Scenario: Blocked entry offered as evidence

- **WHEN** a behavior's only ledger entry is `blocked:missing-implementation`
- **THEN** the behavior counts as uncovered

#### Scenario: Citation that proves no required dimension

- **WHEN** an entry records evidence
- **THEN** that evidence is attributed to one of the behavior's required
  dimensions by construction; the ledger cannot express an unattributed
  citation, and a relationship that proves no required dimension may be stated
  in the entry's rationale prose instead

#### Scenario: Required dimension neither proven nor open

- **WHEN** an entry declares what it requires
- **THEN** the required set is derived as the union of the proven and open
  sets, so a required dimension that is neither cannot be expressed

### Requirement: A tier claim is made per dimension

A ledger entry SHALL declare a proving tier for each dimension it proves, and
the catalog proving tier of every scenario cited for a dimension SHALL equal
the tier that dimension declares. A behavior MAY declare different tiers for
different dimensions, so that each dimension is proven at the cheapest tier
that can exercise its regression boundary.

#### Scenario: Scenario cited at the wrong tier

- **WHEN** a dimension declares tier T and cites a scenario the catalog records
  at a different tier
- **THEN** the ledger is rejected, naming the dimension, the declared tier, and
  the tier the scenario actually runs at

#### Scenario: One behavior proven across two tiers

- **WHEN** a behavior proves one dimension at a tier that can observe a real
  external boundary and another dimension at a cheaper hermetic tier
- **THEN** the ledger accepts both claims, and each dimension is validated
  against its own declared tier

#### Scenario: Dimension proven with no scenario

- **WHEN** an entry declares a dimension proven but cites no scenario for it
- **THEN** the ledger is rejected, naming the behavior and the dimension

### Requirement: An open dimension declares a planned tier that is not evidence

An entry SHALL record, for each dimension it leaves open, the tier at which
that dimension is expected to be proven. A planned tier SHALL NOT carry
scenario references and SHALL NOT count as coverage: a behavior with any open
dimension SHALL remain unqualified for a global production refactor regardless
of the tiers it plans.

#### Scenario: Planned tier offered as coverage

- **WHEN** a `partial` entry declares a planned tier for every open dimension
- **THEN** the behavior is still reported as unqualified

#### Scenario: Open dimension carrying scenario references

- **WHEN** an entry records an open dimension
- **THEN** it records a planned tier and nothing else; the ledger cannot
  express scenario references on an open dimension

#### Scenario: Every dimension proven

- **WHEN** an entry's open set becomes empty because each dimension is proven
  at its declared tier
- **THEN** the behavior is reported as qualified and no longer appears in the
  unqualified set
