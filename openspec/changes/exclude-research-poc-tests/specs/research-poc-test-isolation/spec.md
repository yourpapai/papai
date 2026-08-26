# research-poc-test-isolation Specification

## Purpose

Keeps the analytics-metrics research PoC's self-check tests runnable without taxing every default test run: the default lane SHALL NOT discover them, an explicit command SHALL run them, and exclusion SHALL NOT remove any product-test coverage or assertion.

## ADDED Requirements

### Requirement: Default test discovery excludes research PoC tests

The default `bun test` run SHALL NOT discover or execute test files under `docs/`. The exclusion SHALL cover the entire `docs/` tree, not a per-file list, so future research artifacts do not re-enter the default lane by filename accident.

#### Scenario: Full default run reports no poc cases

- **WHEN** the default test run executes over the repository
- **THEN** no file under `docs/research/analytics-metrics/poc/` appears in its report, and the run's case count equals the previous default run's count minus exactly the poc cases (53 across 16 files, measured 2026-08-26)

#### Scenario: Coverage floor is unaffected

- **WHEN** the coverage-gated run executes after the exclusion
- **THEN** the coverage denominator and floor check behave as before, because the excluded files import no production code

### Requirement: PoC self-checks stay runnable on demand

The repository SHALL provide a single script command that executes the research PoC's self-check tests via explicit paths, succeeding when they pass and failing when they do not.

#### Scenario: Explicit run executes every poc self-check

- **WHEN** a developer runs the research self-check command
- **THEN** all 16 poc test files execute, and the command's exit code reflects their verdict

### Requirement: Product tests do not depend on poc discovery

Tests outside `docs/` that import PoC **source** modules (not test files) SHALL continue to run in the default lane unchanged; the exclusion mechanism SHALL NOT affect module imports, only test discovery.

#### Scenario: Taxonomy parity test still runs

- **WHEN** the default test run executes after the exclusion
- **THEN** the test importing `poc/intent/taxonomy.js` still runs and passes, proving discovery exclusion left import resolution untouched
