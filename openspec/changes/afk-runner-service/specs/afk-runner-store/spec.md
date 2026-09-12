<!-- SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details. -->

## Purpose

Central per-project storage for afk-runner run artifacts under the user's home directory: worktrees point at a shared store through the existing five-key config ladder, so runs from many worktrees of one project accumulate in one place that every read surface already knows how to read.

## ADDED Requirements

### Requirement: Absolute workDir relocates bookkeeping

A config file whose `workDir` key holds an absolute path SHALL relocate all run bookkeeping — run directories, event logs, derived memos, gate files, sidecars, session ledgers, and waiter/policy records — to that path. Every verb SHALL resolve runs through the declared workDir exactly as through the default one: run-id resolution, memo reads, event reads, and gate-file paths all key off the declared store.

#### Scenario: A run starts into a declared store

- **WHEN** a worktree's config declares an absolute `workDir` under `~/.afk-runner/projects/` and a run starts
- **THEN** the run directory, event log, and memo are created under the declared store, and nothing is written under `<repoRoot>/.afk-runner/` except the config file itself

#### Scenario: Every verb reads the declared store

- **WHEN** `status`, `resume`, `stop`, `report`, `runs`, `serve`, or `analyze` runs in a worktree whose config declares an absolute `workDir`
- **THEN** each resolves and reports runs from the declared store, with no verb-specific workdir override introduced

### Requirement: The config lookup stays at the repo root

The launch-config lookup candidate SHALL remain `<repoRoot>/.afk-runner/config.json` regardless of where `workDir` points. A config file inside a relocated store SHALL NOT be consulted for launch resolution — a file-declared `workDir` relocates bookkeeping but never the lookup.

#### Scenario: The store's own config file is not a launch surface

- **WHEN** a store directory contains a `config.json` and a worktree whose pointer config targets that store starts a run
- **THEN** launch resolution reads the worktree's own `<repoRoot>/.afk-runner/config.json` and never the store's copy

### Requirement: One store per project, shared by worktrees

Multiple worktrees of one project SHALL be able to point at one store concurrently. Runs started from different worktrees SHALL coexist without interference — run ids are unique by construction — and each run's memo SHALL carry the `repoRoot` of the worktree that started it, so runs in a shared store remain attributable to their worktree.

#### Scenario: Two worktrees share one store

- **WHEN** two worktrees of one repository both point at the same store and each starts a run
- **THEN** both runs appear in `runs` and `serve` over that store, distinguished by their memos' `repoRoot` fields

#### Scenario: Same change name from two worktrees does not collide

- **WHEN** two worktrees pointing at one store each start a run deriving the same change name
- **THEN** both runs keep independent run directories and event logs in the store, and each writes its openspec change folder only in its own repository

### Requirement: Gate interaction at the declared store

A run parked at a gate SHALL present its gate file inside the declared store, and the operator-facing pointer SHALL name that path. Answering a gate by hand-editing that file SHALL settle through the standard settle seam with the same grammar and validation as a worktree-local gate file.

#### Scenario: The pointer names the store path

- **WHEN** a run parks at a gate while its worktree declares an absolute `workDir`
- **THEN** the printed pointer names the gate file's path inside the store, and `resume <runId>` re-enters the run from that store

#### Scenario: A hand edit at the store settles normally

- **WHEN** the operator hand-edits the store's `gate-<v>.md` with a valid decision directive
- **THEN** the run settles through the same render-back, integrity, and mover semantics as a gate file in the default workdir

### Requirement: Rollback returns to local bookkeeping

Removing the pointer config, or restoring the default relative `workDir`, SHALL return the worktree to `<repoRoot>/.afk-runner/` bookkeeping for new runs. Artifacts already written to a store SHALL remain readable and foldable there — read surfaces pointed at the store SHALL keep rendering them unchanged.

#### Scenario: Flipping the config back relocalizes new runs

- **WHEN** a worktree that dogfooded a store deletes its pointer config (or sets `workDir` back to the default) and starts a new run
- **THEN** the new run's bookkeeping lands under `<repoRoot>/.afk-runner/`, and the store is left untouched

#### Scenario: Historical store runs stay readable after rollback

- **WHEN** `runs` or `serve` is pointed at a store after its worktrees rolled back to local bookkeeping
- **THEN** the runs already in the store still list, fold, and render with no migration step
