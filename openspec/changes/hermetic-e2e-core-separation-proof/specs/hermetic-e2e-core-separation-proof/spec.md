<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the frozen-harness proof that the `plugin-core-separation` refactor
preserves observable behavior, and the symmetric module lifecycle contract
(activation/cleanup, runtime ownership, capability ids) that the proof
requires to hold under repeated runs.

## ADDED Requirements

### Requirement: Reproducible baseline

The proof SHALL name an explicit master `BASELINE_SHA`, rebase the branch
onto it, and treat `tests/stories` as frozen — any branch edit to the
harness invalidates the proof.

#### Scenario: Harness drift

- **WHEN** `git diff $BASELINE_SHA -- tests/stories` is non-empty on the
  branch
- **THEN** the proof is void until the harness matches the baseline

### Requirement: Symmetric module lifecycle

Trusted-module activation SHALL support cleanups run once in reverse
activation order via a `stop()` result, clear registries on stop, roll back
partial activations, and reset the operator-allowlist and membership-store
ports.

#### Scenario: Failed activation

- **WHEN** the second module's `onActivate` throws
- **THEN** the first module's cleanup runs and no module remains registered

#### Scenario: Repeated start/stop

- **WHEN** the runtime starts and stops modules twice in one process
- **THEN** each stop runs every cleanup exactly once in reverse order and
  re-activation starts from a clean registry

### Requirement: Runtime owns modules

`PapaiRuntime` SHALL start trusted modules before plugins and stop them in
reverse order; `src/index.ts` SHALL NOT call `loadTrustedModules()`
directly.

#### Scenario: Startup ordering

- **WHEN** the application boots
- **THEN** module activation completes before plugin loading begins, and
  shutdown reverses the order

### Requirement: Coding-module capability ids

Coding-module tools SHALL carry `coding-session.*` capability ids
registered through the `ToolCapabilityCatalog`, and duplicate ids SHALL
fail fast.

#### Scenario: Duplicate registration

- **WHEN** two module tools resolve to the same capability id
- **THEN** tool-set construction fails with the colliding id named

### Requirement: Behavior parity via compat suite

The branch SHALL pass `test:stories:compat` (default, `--seed 41021`,
`--rerun-each 10`) against the baseline, plus `build:client`, `bun test`,
`test:client`, and `check:full`, and CI SHALL run the compat invocation
with the PR base SHA as `BASE_REF`.

#### Scenario: Seed stability

- **WHEN** the compat suite runs with `--seed 41021 --rerun-each 10`
- **THEN** every rerun produces the same manifest hash as the baseline
