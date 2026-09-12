# review-loop-deletion-findings Specification

## Purpose

Defines what the review loop may report as over-engineering in the code under review —
the bounded set of kinds, the evidence such a finding must carry, and the order in which
those findings are fixed relative to defects.

## Requirements

### Requirement: The reviewer may report a bounded set of over-engineering kinds

The review loop SHALL admit findings that code is more than it needs to be, restricted to
a closed set: code with no reason to exist, a hand-rolled reimplementation of the standard
library, a dependency or hand-rolled code doing what the platform provides natively, an
abstraction with a single implementation, and the same logic expressible in materially
fewer lines. The set SHALL be closed: a finding that fits none of these is not a cleanup.

#### Scenario: Reviewer finds an abstraction with one implementation

- **WHEN** the reviewer finds an interface, factory, or configuration layer with exactly
  one implementation and no second caller
- **THEN** it may report it as a cleanup finding
- **AND** the finding names which of the admitted kinds it is

#### Scenario: Reviewer dislikes the code but cannot name a kind

- **WHEN** the reviewer would report code as "correct but I would write it differently"
- **THEN** it does not report it
- **AND** the existing exclusion of style and naming preferences is unchanged

### Requirement: A cleanup finding names what replaces the code it cuts

The review loop SHALL require every cleanup finding to state what stands in place of the
removed code — a named standard-library function, a named platform feature, an existing
helper in this codebase, a shorter form of the same logic, or nothing at all for code that
is simply unused. A cleanup finding that cannot name its replacement SHALL NOT be reported.

#### Scenario: Reviewer reports a hand-rolled utility

- **WHEN** the reviewer reports that code reimplements something already available
- **THEN** the finding names the specific function or feature that replaces it

#### Scenario: Reviewer reports unused code

- **WHEN** the reviewer reports code that nothing reaches
- **THEN** the finding states that nothing replaces it
- **AND** that is a complete answer, not a missing one

#### Scenario: Reviewer cannot name a replacement

- **WHEN** the reviewer believes code is over-built but can name no replacement
- **THEN** it omits the finding rather than reporting it without one

### Requirement: Every issue records whether it is a defect or a cleanup

The review loop SHALL record on each issue which of the two kinds it is. The reviewer
SHALL set it; the fixer SHALL NOT change it. An issue restored from a ledger written
before this distinction existed SHALL load and SHALL be treated as a defect.

#### Scenario: Ledger written before the kind existed is resumed

- **WHEN** a run resumes from a ledger whose issues carry no kind
- **THEN** the ledger loads without error
- **AND** every issue in it is treated as a defect

#### Scenario: Fixer returns a result disagreeing about the kind

- **WHEN** a fixer result asserts a different kind than the reviewer recorded
- **THEN** the recorded kind is unchanged

### Requirement: Defects are dispatched before cleanups

The review loop SHALL dispatch every actionable defect before any cleanup. Within each of
the two groups, the existing exposure ordering SHALL be preserved unchanged.

#### Scenario: A cleanup cites a caller and a defect does not

- **WHEN** a round holds a cleanup whose exposure cites a caller and a defect whose
  exposure is none
- **THEN** the defect is dispatched first

#### Scenario: Two cleanups differ only in exposure

- **WHEN** a round holds two cleanups, one citing a caller and one reporting none
- **THEN** the one citing a caller is dispatched first

#### Scenario: A run stops before its queue is empty

- **WHEN** a run reaches its stop budget with issues still pending
- **THEN** the issues left unfixed are cleanups before defects

### Requirement: A cleanup is never graded above medium severity

The review loop SHALL cap the severity of a cleanup finding at medium. Severity grades
what happens if the code is reached, and code that is merely more than it needs to be does
not lose data, breach security, or crash.

#### Scenario: Reviewer grades a cleanup as critical

- **WHEN** the reviewer reports a cleanup at a severity above medium
- **THEN** the recorded severity is medium

#### Scenario: Code is both over-built and defective

- **WHEN** code contains a genuine defect and is also over-built
- **THEN** the defect is reportable at its own severity as a defect finding
- **AND** the cap applies only to the cleanup finding

### Requirement: Cleanups are counted separately in the run's record

The review loop SHALL report cleanup and defect counts separately in the run summary and
run metrics, so the effect of admitting cleanups can be read after the fact. The counts
SHALL NOT gate a merge, change a verdict, or consume any part of the retry budget.

#### Scenario: A run fixes both kinds

- **WHEN** a run closes both defect and cleanup issues
- **THEN** the summary and metrics report each kind's count separately

#### Scenario: A run admits no cleanups

- **WHEN** a run's reviewer reports no cleanup findings
- **THEN** the run behaves exactly as it did before cleanups were admitted
