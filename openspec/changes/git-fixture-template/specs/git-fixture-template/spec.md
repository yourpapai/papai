# git-fixture-template Specification

## Purpose

Defines the shared git fixture helper that makes per-test real git repositories cheap: a per-worker template repository plus filesystem clone-copies, replacing the per-test `git init`/`config`/`add`/`commit` process chain, while keeping every git operation the tests assert on real.

## ADDED Requirements

### Requirement: Template repository is built once per worker

The helper SHALL construct a template repository once per test-worker process, containing: an initialized git repository, a configured commit identity, at least one commit, and `gc.auto=0`. The template SHALL NOT be handed to tests directly; it exists only as the copy source.

#### Scenario: Identity and history are present in every copy

- **WHEN** a test requests a fixture repository and inspects it
- **THEN** `git log` shows the template's initial commit and commits succeed without any per-test identity configuration

#### Scenario: Automatic maintenance does not run during tests

- **WHEN** the copied repositories are exercised by test operations
- **THEN** no `git maintenance`/auto-gc process runs against them, because the template carried `gc.auto=0`

### Requirement: Per-test fixtures are filesystem copies of the template

Requesting a fixture SHALL produce a new repository directory by copying the template (APFS clonefile where the filesystem supports it), and SHALL NOT spawn a `git init`/`config`/`add`/`commit` chain per test. Each copy SHALL be independent — mutations in one test's copy SHALL NOT affect another's.

#### Scenario: Copy cost stays near the filesystem floor

- **WHEN** a fixture is requested
- **THEN** its construction involves no git subprocess (median measured ≤ 5 ms vs 246 ms for the process chain, 2026-08-26 survey)

#### Scenario: Copies are isolated

- **WHEN** two fixtures are requested in the same file and one is mutated (commit, branch, reset)
- **THEN** the other's `HEAD`, branches, and working tree are unchanged

### Requirement: Real-git operations remain real

The helper SHALL NOT intercept, fake, or wrap the git operations tests perform on fixture repositories; in particular worktree creation on a fixture SHALL use the same real `git worktree` path production code uses. Only repository *construction* is a copy.

#### Scenario: Worktrees from copies behave like worktrees from built repos

- **WHEN** a test creates a worktree from a copied fixture and exercises merge/rebase/conflict behavior
- **THEN** outcomes are identical to the same operations on a freshly `git init`-built repository (the pilot's before/after assertion set passes unchanged)

### Requirement: Adoption is per-file with recorded evidence

A test file adopts the helper only alongside recorded before/after numbers from the persisted run report (file in-test time and case count). No blanket conversion; files not yet converted keep their existing recipe.

#### Scenario: Pilot conversion cites its numbers

- **WHEN** the pilot file is converted
- **THEN** the change's task list records its in-test time before and after from the persisted junit report, and its assertions are byte-identical to before the conversion
