# test-consolidation-speed-evidence Specification

## Purpose

Defines the benchmark that measures whether consolidating per-value test cases into grouped assertion matrices makes the suite faster, and by how much — so the rollout decision deferred by the `tests-consolidation` pilot rests on measured per-hook-class costs projected against the audited population, not on assumptions.

## ADDED Requirements

### Requirement: Paired benchmark measures per-case marginal cost by hook class

The repository SHALL provide a benchmark that measures, for each hook class it covers (at minimum: no hooks, a cheap `beforeEach`, database-fixture setup, and mock-heavy setup), the marginal in-test cost of one per-value test case versus the same assertions executed as one row of a grouped test. Both arms of each pairing SHALL be identical in assertions, imports, and fixture work: the only difference SHALL be the case structure (N separate cases with the class's per-case hooks versus one grouped case whose rows execute under the hook paid once). The benchmark SHALL run both arms on the same test runner the suite uses, repeat each pairing enough times to report a median and inter-quartile range, and persist the per-class results as a report artifact.

#### Scenario: Pure-function class shows the runner-only floor

- **WHEN** the benchmark measures the no-hook class
- **THEN** the reported per-case marginal cost is the runner's bookkeeping floor, directly comparable with the pilot's measured ~0.16 ms/case figure

#### Scenario: Hook classes show their amortization value

- **WHEN** the benchmark measures a hook-bearing class (database setup or mock-heavy)
- **THEN** the reported per-case marginal cost reflects what one grouped row saves versus one hooked per-value case, as median ± IQR over repeats

#### Scenario: Arms differ only in case structure

- **WHEN** a pairing's two generated files are inspected
- **THEN** they contain the same assertions over the same fixture inputs, and differ only in whether each input is its own runner case or a row of one grouped case

### Requirement: Benchmark is read-only with respect to the suite

The benchmark SHALL NOT modify any real test file, runner configuration, or gate, and its generated files SHALL NOT be discovered by the default test run. Its execution SHALL have no effect on any test verdict.

#### Scenario: Generated files stay out of discovery

- **WHEN** the benchmark generates its paired files
- **THEN** they live under an ignored path that default `bun test` discovery and the audit's scan set exclude, and a full suite run reports the same case count as before the benchmark ran

#### Scenario: Suite and gates are untouched

- **WHEN** the benchmark runs
- **THEN** no test file, runner configuration, or gate threshold changes and no test verdict changes

### Requirement: Population projection states its eligibility assumptions

The repository SHALL provide a projection that combines the benchmark's per-class costs with the fragmentation audit's population counts to estimate the suite-level time consolidation could save, and SHALL state the eligibility assumptions behind that estimate. The projection SHALL report, per hook class: the count of candidate cases (from audit data joined with hook-presence detection over the scan set), the assumed eligible fraction, and the resulting seconds estimate against the suite's serial in-test time. Assumed eligibility SHALL be conservative and explicit — it SHALL NOT count cases whose per-case isolation is load-bearing (fresh-state-per-case, module-mock-per-case, timing-dependent) as eligible without saying so.

#### Scenario: Decision number is reproducible

- **WHEN** the projection runs after a benchmark and an audit over the same tree
- **THEN** it reports per-class candidate counts, eligibility fractions, estimated seconds saved, and the share of the suite's serial in-test time that represents — recomputable from the persisted benchmark and audit artifacts

#### Scenario: Ineligible populations are named, not folded in

- **WHEN** a hook-bearing population cannot be assessed as groupable from static signals alone
- **THEN** the projection reports it as requiring per-file eligibility review rather than counting it as eligible savings
