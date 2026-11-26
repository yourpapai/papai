# check-pipeline Specification

## ADDED Requirements

### Requirement: Root checks cover all workspace code

The root checks — `lint`, `typecheck`, `format:check`, and the default `bun test` sweep — SHALL cover every workspace's source files (`<workspace>/src/**`) and test files (`tests/<workspace>/**`) without any per-workspace entry in the check lists.

#### Scenario: A new workspace is born

- **WHEN** a workspace is added to the root `package.json` `workspaces` list with source under `<workspace>/src` and tests under `tests/<workspace>/`
- **THEN** the root `lint`, `typecheck`, and `format:check` checks already include its files, because none of `.oxlintignore`, `.oxfmtignore`, or the root `tsconfig.json` excludes workspace directories
- **AND** the default test sweep already runs its test files, because `bunfig.toml` `pathIgnorePatterns` does not exclude `tests/<workspace>/`

#### Scenario: A workspace file fails lint

- **WHEN** a file under any `<workspace>/src` or `tests/<workspace>` violates a lint, type, or format rule
- **THEN** full-mode `check.sh` fails and the failure is attributed to the corresponding root check's persisted log under `reports/checks/`, with `file:line` detail

### Requirement: No per-workspace entries in aggregate check lists

`scripts/check.sh` full mode and the `check:verbose` script SHALL NOT contain per-workspace check entries (e.g. `review-loop:*`, `mutation-improve:*`, `sdd-runner:*`, `opencode-agent:*`).

#### Scenario: Full mode composition

- **WHEN** `check.sh` runs in full mode (no `--staged`)
- **THEN** the executed checks are exactly the root checks: `lint`, `typecheck`, `format:check`, `license-headers`, `knip`, `test`, `test:client`, `duplicates`

#### Scenario: The verbose helper composition

- **WHEN** `bun run check:verbose` runs
- **THEN** it invokes only root checks (`lint`, `typecheck`, `format:check`, `knip`, `test`, `duplicates`)

#### Scenario: Workspace tests run exactly once per full run

- **WHEN** full mode runs the `test` check
- **THEN** no concurrently-scheduled check re-runs the same test files in the same full-mode invocation

### Requirement: Workspace-local proxy scripts remain available

Per-workspace proxy scripts in `package.json` (e.g. `review-loop:test`, `mutation-improve:lint`) SHALL remain runnable as local development conveniences, and their composition SHALL NOT be part of any aggregate gate.

#### Scenario: A developer targets one workspace locally

- **WHEN** a developer runs `bun run review-loop:test`
- **THEN** it runs the workspace's test directory (`tests/review-loop`) via the root `bun test` sweep configuration
- **AND** no aggregate check (`check.sh`, `check:verbose`) invokes it as a step
