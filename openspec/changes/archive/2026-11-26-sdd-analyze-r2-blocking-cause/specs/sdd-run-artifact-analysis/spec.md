## ADDED Requirements

### Requirement: R2 blocking-cause attribution

For every cap-hit gate state the analysis SHALL attribute one blocking cause, computed from the event log replay joined with the run's cost-knownness: `r2-fired` when an extend auto_decision names R2; `cost-unknown` when the state's presentation carries an R4 gate decision on a cost-unknown run; `over-ceiling` when it carries an R4 gate decision on a cost-known run; `preview` when the state's auto_decision is a preview (rule computed, not permitted to act); `trajectory-blocked` when the R2 trajectory predicate itself fails. The per-run report and the corpus aggregate SHALL surface the cause mix alongside the existing eligibility ratio, and JSON output SHALL carry the per-cause counts. Pre-change runs whose events cannot support attribution SHALL report the metric at reduced coverage with an explicit unknown, never an error.

#### Scenario: Cost-unknown run attributes its eligible states

- **WHEN** the analysis covers a run whose usage is cost-unknown and a cap-hit state was presented with an R4 gate decision despite trajectory eligibility
- **THEN** that state SHALL be counted under `cost-unknown`, and the run's r2 eligibility line SHALL name that cause with its count

#### Scenario: Preview-mode run attributes its decided states

- **WHEN** a cap-hit state's auto_decision records a preview naming R2 on a run where rules were not permitted to act
- **THEN** the state SHALL be counted under `preview`, distinct from `r2-fired`

#### Scenario: Corpus aggregate names the dominant cause

- **WHEN** the corpus report aggregates runs whose cap-hit states carry mixed causes
- **THEN** the aggregate SHALL report the per-cause counts across all cap-hit states, so the dominant blocking cause is readable without per-run forensics

#### Scenario: Era run without attribution support degrades

- **WHEN** a pre-policy-era run's events carry no auto_decision records for a cap-hit state
- **THEN** that state SHALL be attributed from whatever gate presentation exists, and a run with no supporting records at all SHALL report the breakdown as unknown with its reason
