# figma-codegen-verification Specification

## Purpose

A report-only compare loop that checks generated code against the design it came from: render the implemented component/section via the story infra and pixel-compare it against the Figma-side render, so design-to-code output has an objective conformance signal.

## Requirements

### Requirement: Generated code is compared against the design render

For a mapped component or section with generated code, the verification loop SHALL produce two renders — the implemented component via the existing story shoot infra, and the corresponding Figma frame via the Figma-side render path — and a diff report comparing them.

#### Scenario: Both renders exist

- **WHEN** the implemented component's story renders and the Figma frame export succeeds
- **THEN** the loop produces a diff report with per-region mismatch metrics and paths to both renders

#### Scenario: Baseline missing

- **WHEN** either render cannot be produced (no story for the component, Figma export fails)
- **THEN** the loop reports an explicit skip naming the missing side, not a silent pass

### Requirement: Pass/fail is threshold-based with artifacts

The loop SHALL compare renders using a configurable pixel-diff threshold and SHALL fail with the diff artifact paths when measured difference exceeds the threshold.

#### Scenario: Mismatch beyond threshold

- **WHEN** the pixel diff exceeds the configured threshold
- **THEN** the loop exits with a failure and names the diff image and mismatch metrics

#### Scenario: Difference within threshold

- **WHEN** the pixel diff is within the threshold
- **THEN** the loop reports a pass with the measured value

### Requirement: The loop is report-only

The loop SHALL report findings only; it MUST NOT modify generated code, Figma nodes, or story baselines as part of comparing.

#### Scenario: Differences found

- **WHEN** the compare reports a mismatch
- **THEN** no files are modified and the report is the sole output
