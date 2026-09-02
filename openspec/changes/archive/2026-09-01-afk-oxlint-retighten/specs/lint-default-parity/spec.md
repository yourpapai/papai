<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## ADDED Requirements

### Requirement: Shared lint configuration grants no workspace-scoped relaxations

The repository's oxlint configuration SHALL NOT contain `overrides` blocks that weaken rule severity or disable rules for paths under `afk-runner/` or `tests/afk-runner/`. The pre-existing test-wide overrides (e.g. the `tests/**/*.ts` block) SHALL remain untouched.

#### Scenario: Lint runs at repo defaults over the afk-runner workspace

- **WHEN** `bun run lint` runs with the repository's shared oxlint configuration
- **THEN** it passes with zero diagnostics, with type-aware rules (including `typescript/no-unsafe-type-assertion` and the `no-unsafe-*` family) active at their default severity for every file under `afk-runner/src/**` and `tests/afk-runner/**`

#### Scenario: A new unsafe type assertion appears in afk-runner source

- **WHEN** a file under `afk-runner/src/**` adds a narrowing type assertion (e.g. `value as NarrowerType`)
- **THEN** lint reports it as an error, because no per-path exception suppresses `typescript/no-unsafe-type-assertion` there

### Requirement: Persisted-artifact reads in afk-runner tests are schema-validated

Test files under `tests/afk-runner/` that read persisted run artifacts (`state.json`, gate sidecars) SHALL parse the raw JSON through the corresponding exported zod schema (or a schema-derived type-safe reader) rather than assigning `JSON.parse` output to typed variables. The assertions and observable test semantics SHALL be unchanged from before the tightening.

#### Scenario: A test reads the persisted run memo

- **WHEN** a `tests/afk-runner/**` test reads a run's `state.json` and asserts on fields such as `status` or `gate`
- **THEN** the raw text is parsed via the run-state schema, so the asserted values are statically typed and lint's unsafe-assignment/unsafe-member-access rules stay active

#### Scenario: The tightening changes no test outcome

- **WHEN** the full afk-runner test suite runs after the parse sites are converted
- **THEN** every test that passed before the tightening passes after it with identical assertions, and the golden-replay parity harness over the fixture corpus stays green

### Requirement: The kernel machine declares its types without assertion witnesses

The afk-runner kernel's XState `setup` registry SHALL be typed through the type parameter surface (explicit generic arguments) rather than runtime assertion witnesses in the `types` field, so the source contains no `{} as T` assertions. The machine's static types and runtime behavior SHALL be unchanged: the typed registry, the fold, and the parity corpus behave identically.

#### Scenario: The kernel machine compiles and folds identically after the re-spelling

- **WHEN** `bun run typecheck` and the kernel/parity test suites run after the `setup` call is re-spelled with explicit type parameters
- **THEN** typecheck passes with no new errors and the parity harness reports zero divergences over the full fixture corpus
