## Purpose

Defines when the opencode-agent pipeline must refuse to run a job on an agent
branch because the base-branch dependency install cannot serve it, what it must
let through, and what the refusal must tell the maintainer. The guard exists
because the workflow installs dependencies from the base checkout and never
reinstalls after switching onto the agent branch, so a branch whose install
state diverged from base runs every check against a `node_modules` that cannot
serve it.

## ADDED Requirements

### Requirement: Refuse only install-state divergence

The pipeline MUST refuse to run a phase on an agent branch when the branch's
dependency install state diverges from the base branch, and MUST NOT refuse
when manifest edits cannot change what the base install put into
`node_modules`. Divergence exists when:

- the lockfile (`bun.lock`) differs from the base branch in any way, or
- any `package.json` in the tree differs from the base branch in a
  install-relevant top-level field: `dependencies`, `devDependencies`,
  `optionalDependencies`, `peerDependencies`, `resolutions`, `overrides`,
  `workspaces`, `trustedDependencies`, `patchedDependencies`.

Edits to other manifest content — including `scripts`, `name`, `version`, or
custom fields — MUST be allowed through with no refusal.

#### Scenario: scripts-only manifest edit passes

- **WHEN** an agent branch's only manifest change is an edit to a command
  string under `scripts` in a `package.json` (as in issue #360's
  `check:verbose` change) and `bun.lock` is unchanged
- **THEN** the phase runs on the branch with no dependency-drift refusal

#### Scenario: dependency field edit refuses

- **WHEN** an agent branch adds, removes, or changes a range in
  `devDependencies` in any `package.json` relative to the base branch
- **THEN** the phase is refused before any model turn or check runs, with the
  dependency-drift failure

#### Scenario: lockfile edit refuses

- **WHEN** an agent branch's `bun.lock` differs from the base branch's by even
  an unrelated formatting change
- **THEN** the phase is refused with the dependency-drift failure

### Requirement: Compare by content, conservatively

The drift decision MUST be made by comparing the install-relevant fields of
each changed manifest between the base-branch version and the branch version,
not by file path alone. Unknown shapes fail closed:

- a manifest that cannot be parsed as JSON on either side counts as drifted;
- a manifest that exists on only one side counts as drifted when the existing
  side carries any install-relevant field (a one-sided manifest with none of
  those fields is not drifted).

#### Scenario: malformed manifest refuses

- **WHEN** a changed `package.json` on either side is not valid JSON
- **THEN** the branch counts as drifted and the refusal names that file

#### Scenario: added workspace with no dependencies passes

- **WHEN** the branch adds a new workspace `package.json` whose only content
  is a `name` field
- **THEN** the branch is not drifted

#### Scenario: added workspace with dependencies refuses

- **WHEN** the branch adds a new workspace `package.json` declaring a
  `dependencies` map
- **THEN** the branch counts as drifted

### Requirement: Refusal names fields and remedies

The dependency-drift refusal MUST report, per file, which install-relevant
fields drifted, and MUST keep pointing at the remedies a plain retry cannot
substitute: merging the base branch in (`/sync` or a hand merge) when the
divergence is backward drift, and maintainer reconciliation when the change
intentionally altered install state. The refusal MUST NOT spend a retry
attempt and MUST NOT invite a bare `/retry`.

#### Scenario: drift report content

- **WHEN** a branch is refused for a `devDependencies` change in the root
  `package.json`
- **THEN** the failure message names `package.json`, names `devDependencies`
  as the drifted field, and names `/sync` and the hand merge as remedies
  without inviting a bare `/retry`

#### Scenario: budget accounting on refusal

- **WHEN** a run is refused for dependency drift
- **THEN** the persisted state keeps its retry-attempt count unchanged and
  parks in the failure phase with the resume point intact
