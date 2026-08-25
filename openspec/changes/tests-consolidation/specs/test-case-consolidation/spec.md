# test-case-consolidation Specification

## Purpose

Defines when the unit-test suite's per-value cases may be merged into grouped assertion-matrix tests, so suite fragmentation can be reduced without losing assertions, failure attribution, isolation guarantees, or gate strength.

## ADDED Requirements

### Requirement: Assertion preservation

Consolidating cases SHALL preserve every assertion of every merged case. Each merged case's inputs, expected values, and matcher strength SHALL survive verbatim: consolidation SHALL NOT drop a case (including boundary, negative, and fallback cases), SHALL NOT weaken a matcher (exact to partial, strict to loose, field-listing to shape), and SHALL NOT remove or coarsen expected-value detail to make grouping convenient. A consolidation that drops any merged case's assertion, or changes any merged case's expected value, is non-compliant. Preservation is evidenced by a row-by-row accounting of the merged cases (every former case's input and expected pair surviving as a row) and an explicit mutation re-measure of the covered sources — not by the fragmentation audit's textual matcher-call count, which decreases by construction when N per-case call sites become rows executed through one shared callback.

#### Scenario: Grouping keeps every assertion

- **WHEN** the per-value cases of one fixture are merged into a single grouped test
- **THEN** every former case's input and expected pair appears as a row of the group, and each row's matcher checks at least the fields the merged case checked before, with at least the same strength

#### Scenario: Matcher weakening is non-compliant

- **WHEN** a merged case replaces an exact-equality assertion with a partial-match or shape assertion, or drops an expected field
- **THEN** the consolidation violates this capability even though the suite still passes

#### Scenario: Boundary and fallback cases survive

- **WHEN** the pre-consolidation file includes boundary cases (limit lengths, empty or whitespace-only input, non-record input) or fallback-path cases
- **THEN** the grouped form includes those same cases with unchanged expected values

### Requirement: A grouped test registers as one runner case

A grouped test SHALL register with the test runner as exactly one test case. Parameterized row generators do not satisfy this: a mechanism that makes the runner count each row as its own case is not consolidation under this capability.

#### Scenario: Case count drops while assertions persist

- **WHEN** a file's per-value cases are consolidated
- **THEN** the runner's case count for that file decreases while every merged case's assertions survive as rows of the grouped test

#### Scenario: Row generators are not consolidation

- **WHEN** a rewrite expresses the matrix so the runner reports each row as its own passing or failing case
- **THEN** the rewrite has not consolidated under this capability and its case-count reduction does not count

### Requirement: Per-case failure identification

Every case merged into a grouped test SHALL carry a label that identifies it in the failure output. When an assertion inside a grouped test fails, the failure SHALL present that label together with the failing case's input and/or expected value, so a reader of the failure output attributes it to exactly one case without further debugging. The label SHALL be stable across runs for the same case.

#### Scenario: Failure names the failing case

- **WHEN** one case in a group fails
- **THEN** the failure output contains that case's label and its input/expected pair, distinguishing it from the group's other cases

#### Scenario: Later-case failure is not misattributed

- **WHEN** every case before case k passes and case k fails
- **THEN** the failure identifies case k specifically, not the first case and not the group as a whole

#### Scenario: Fully passing group reports once

- **WHEN** every case in a group passes
- **THEN** the grouped test reports as a single passing case with no per-case noise

### Requirement: Grouping eligibility

Grouping SHALL be applied only among cases that share one fixture — the same unit under test under one fixed setup — and whose assertions are order-independent: no case's expected value depends on another case having executed first, and no case's execution mutates fixture state a sibling case observes. Cases whose per-case isolation is load-bearing SHALL remain separate: cases requiring distinct setup or teardown to be meaningful (fresh database state, distinct module mocks, module-evaluation-order dependence), and timing-dependent assertions (fixed wall-clock waits, polling bounds). The presence of ineligible cases in a suite SHALL NOT block grouping of that suite's other cases that do satisfy the conditions above.

#### Scenario: Pure-function matrix is eligible

- **WHEN** multiple cases invoke the same pure function with different inputs and compare exact outputs
- **THEN** those cases are eligible for grouping into one test

#### Scenario: Distinct per-case fixtures stay separate

- **WHEN** two cases require different mocked module state or different database content for their assertions to be meaningful
- **THEN** they remain separate test cases

#### Scenario: Order-dependent assertions stay separate

- **WHEN** a case asserts state produced as a side effect of an earlier case's execution
- **THEN** grouping does not merge it into the same test as that earlier case

#### Scenario: Timing-dependent assertions are excluded

- **WHEN** a suite's assertions rely on fixed wall-clock waits or polling bounds
- **THEN** grouping is not applied to those assertions

### Requirement: Lane exclusions

Grouping SHALL be confined to the in-process unit-test lane. The hermetic story lane and its harness, the E2E suites, the client and visual suites, the operational suite, and the smoke/platform-adapter lanes SHALL NOT have their scenarios consolidated; their per-scenario structure is contractual (manifest scenario identity, catalog claims, per-scenario isolation).

#### Scenario: Story lane structure is untouched

- **WHEN** consolidation is applied anywhere in the suite
- **THEN** no story-lane scenario or harness file changes its case structure

#### Scenario: Non-unit lanes keep one case per scenario

- **WHEN** consolidation is applied anywhere in the suite
- **THEN** E2E, client, visual, operational, smoke, and platform-adapter suites keep one runner case per scenario

### Requirement: Fragmentation audit

The repository SHALL provide a fragmentation audit that measures, for each unit-test file, its test-case count (including the runner cases generated by `test.each`/`it.each` row generators), its assertion count, and the share of cases that wrap at most one assertion, and persists these measurements as a report artifact. The audit SHALL be read-only with respect to the suite: it SHALL NOT modify test files, runner configuration, or any gate, and SHALL NOT alter any test verdict.

#### Scenario: Per-file report is persisted

- **WHEN** the audit runs over the unit-test suite
- **THEN** a report artifact records, for each audited file, the case count, assertion count, and single-assertion share

#### Scenario: Consolidation is visible in the audit

- **WHEN** a file consolidated under this capability is re-audited
- **THEN** its case count and single-assertion share decrease (its textual matcher-call count also decreases by construction — one shared callback executes per row — which is the expected fragmentation signal, not evidence of lost assertions)

#### Scenario: Audit leaves the suite untouched

- **WHEN** the audit runs
- **THEN** no test file, runner configuration, or gate threshold is modified and no test verdict changes

### Requirement: Rollout beyond the pilot is evidence-gated

Consolidation beyond this change's pilot files SHALL be justified by per-file evidence: a change that merges cases in additional files SHALL include audit measurements for those files showing the achieved case-count reduction, plus a row-by-row accounting demonstrating that every merged case's input and expected pair survived the rewrite, with every source the merged test files cover re-measured, clearing its existing baseline entry where one exists; a first-touch source with no entry has its score recorded to seed a future baseline, without exemption from the re-measure. Blanket rewrites of stable legacy suites SHALL NOT proceed without that per-file evidence.

#### Scenario: Follow-on change cites fresh audit numbers

- **WHEN** a later change consolidates files outside the pilot
- **THEN** that change carries before/after audit measurements for exactly those files

#### Scenario: Assertion-losing rewrite is non-compliant

- **WHEN** a change merges cases in some file without a row-by-row accounting demonstrating that every merged case's input and expected pair survived, or merges non-pilot files without audit evidence
- **THEN** the change violates this capability

### Requirement: Gates are not weakened to absorb consolidation

Consolidation SHALL NOT weaken any quality gate. The aggregate coverage floor, the per-file mutation baselines, and the story-lane coverage floor SHALL NOT be lowered as part of, or as a consequence of, a consolidation change. A consolidated suite SHALL clear the same floors and baselines it cleared before consolidation; because test edits change mutation fingerprints, every source a consolidated test file covers SHALL be re-measured rather than exempted. The changed-file mutation gate does not by itself provide this re-measure on a tests-only branch diff — it selects implementation files from the branch diff — so a consolidation change SHALL perform the re-measure explicitly (for example via per-file paired runs) and record each score against the existing baselines, clearing its entry where one exists; a first-touch source with no entry has its score recorded to seed a future baseline, without exemption from the re-measure.

#### Scenario: Coverage floor holds unchanged

- **WHEN** a full coverage run includes consolidated files
- **THEN** measured coverage clears the committed floor and the floor is not lowered

#### Scenario: Covered sources are re-measured and still bind

- **WHEN** a change consolidates a test file
- **THEN** every source that test file covers is re-measured — explicitly (for example via a per-file paired run), since a tests-only branch diff selects no changed-file mutation target — and each re-measured score clears its existing baseline entry without any baseline adjustment where an entry exists; a first-touch source with no entry has its score recorded to seed a future baseline, without exemption from the re-measure
