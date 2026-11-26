<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Gives afk-runner an agent-spawn backend it owns outright — the opencode CLI as the sole agent plane with role-to-model resolution on that plane, and a pinned in-tree boundary under which the runner's source and tests import nothing from outside the runner's trees (the source root and the test root together — after the split, the repository containing both) — so the runner is self-contained ahead of the repository split.

## ADDED Requirements

### Requirement: Opencode is the sole agent backend

Every stage-agent spawn the runner composes SHALL invoke the opencode CLI. The backend SHALL expose no alternate agent plane: no spawn SHALL invoke the claude CLI, no per-role backend-selection knob SHALL exist on the runner's backend surface, and no Anthropic credential spelling SHALL be read, required, or refused for backend selection. Provider breadth beyond the opencode plane is not the runner's to provide: a model the operator names resolves, or fails, at the opencode plane alone.

#### Scenario: Every stage role spawns through opencode

- **WHEN** a run spawns any stage agent — drafter, reviewer, skeptic, resolver, estimator, decomposer, atomicity, planner, or implementer
- **THEN** the spawned child process is an opencode CLI invocation, and no child process of the run invokes the claude CLI

#### Scenario: Claude credential spellings do not participate

- **WHEN** the invoking environment carries one or both Anthropic credential spellings
- **THEN** the run neither reads them for backend selection nor refuses on them — argv and every runner-authored environment entry are identical to an environment without them, and no credential value is logged; where the runner composes no replacement environment the child inherits the invoking environment verbatim, so ambient spellings may ride to the opencode plane's own authentication, never to a claude backend

#### Scenario: A claude-API model name has no silent route

- **WHEN** the resolved model configuration names a claude-API model string directly
- **THEN** the runner neither translates the id nor falls back to another plane: the string reaches the spawned opencode process unmodified, and the spawn's success or failure is that plane's model resolution surfaced through the runner's existing spawn-failure path

### Requirement: Role-to-model resolution stays on the opencode plane

For every agent role, the runner SHALL resolve the spawn's model as one opencode model string derived from the run's resolved model configuration — the launch-configuration ladder's `model` key. The resolved string SHALL pass to the spawn unmodified: the runner SHALL NOT strip provider prefixes, rewrite model ids, or keep a per-CLI model mapping. When the ladder supplies no model, every role SHALL resolve to the compiled default model, `opencode`.

#### Scenario: The compiled default serves every role

- **WHEN** the launch-configuration ladder supplies no model — no config-file key and no environment entry
- **THEN** every agent role's spawn carries the compiled default model `opencode`

#### Scenario: A configured model passes through unmodified

- **WHEN** the ladder resolves a model string
- **THEN** every agent role's spawn carries exactly that string, with no runner-side rewriting for any CLI

#### Scenario: No role resolves to a claude-API-only spelling

- **WHEN** the runner resolves the model for each of its agent roles
- **THEN** each role resolves to a string the opencode plane interprets — no role's resolution produces a claude-API-only model through runner-side mapping

### Requirement: Runner trees import nothing outside their union

Nothing under the runner's source root or the runner's test root SHALL import a module from outside the runner's trees — the union of the two roots (after the repository split, the repository containing both): imports within the union, including test-root files reaching each other and the runner's source, are inside the fence. A guard in the runner's own test suite SHALL scan both roots and SHALL fail, naming each offending file and import specifier, when a relative import resolves to a path escaping that union. `node:`-prefixed builtins and bare package specifiers SHALL be allowed. The guard's scope SHALL be the runner's trees alone: papai's own workspaces — including the sources the backend was copied from — are outside it and keep their own import structure, tests, and operator surface, backend knobs included.

#### Scenario: An upward relative import fails the guard

- **WHEN** a file under the runner's source root or the runner's test root imports through a relative path that escapes the union of the runner's two roots into papai's other trees
- **THEN** the guard fails naming that file and import specifier

#### Scenario: Allowed specifiers pass the guard

- **WHEN** guarded files import `node:`-prefixed builtins or bare package specifiers
- **THEN** the guard raises no failure for those imports

#### Scenario: Papai's own trees stay outside the guard

- **WHEN** papai's own review-loop or mutation-improve sources import within papai
- **THEN** no guard governed by this capability fails, and those tools behave exactly as before the runner owned its copy — the copy is one-way

### Requirement: The runner declares its own dependencies

Every bare package specifier the runner's source imports SHALL be declared in the runner's own package manifest, so the runner's tree installs and runs without a sibling workspace supplying dependencies.

#### Scenario: Every bare import is the runner's own declaration

- **WHEN** the runner's source imports a bare package specifier
- **THEN** that specifier is declared in the runner's package manifest

#### Scenario: The tree stands alone

- **WHEN** the runner's tree is installed without papai's other workspaces beside it
- **THEN** every import resolves and the runner's test suite runs

### Requirement: Owning the backend changes no observable spawn behavior

Replacing the borrowed agent-spawn implementation with the runner-owned copy SHALL change no observable behavior of the runner on the opencode route: recorded real-run transcripts SHALL replay to identical folds, reports, and usage totals; usage, cost, and cache-token accounting SHALL keep their field shapes; and spawn-recovery behavior — the once-per-stall retry that continues the captured session id — SHALL operate exactly as before the copy.

#### Scenario: Golden transcripts stay green

- **WHEN** the recorded real-run fixtures captured from live opencode runs before the change are replayed through the post-change runner
- **THEN** their folds, reports, and usage totals are identical to their pre-change replay

#### Scenario: A previously working configuration keeps working

- **WHEN** a run launches with the same launch configuration that worked before the change — the compiled default or a named opencode-resolvable model
- **THEN** its spawn walk, accounting, recovery, and completion behavior are unchanged
