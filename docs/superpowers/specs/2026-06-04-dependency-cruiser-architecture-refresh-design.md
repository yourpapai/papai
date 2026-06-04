<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dependency-Cruiser Architecture Refresh Design

**Date:** 2026-06-04
**Status:** Approved (design); pending implementation plan
**Author:** brainstorming session

## 1. Overview

The repository is replacing its deleted custom `scripts/architecture-inventory*.ts`
pipeline with a `dependency-cruiser`-centered architecture reporting system.
The new system must generate a truthful, up-to-date architecture overview for
both humans and LLMs, keep the generated outputs committed in git, and refresh
them through a reviewable automation PR instead of mutating `master` directly.

The design uses `dependency-cruiser` as the canonical dependency collector for
`src/` and `client/`, derives repo-specific architecture summaries from the raw
graph, and publishes a stable artifact set under `docs/architecture/`.
Pushes to `master` regenerate those artifacts only when runtime files or
generation configuration changed. If the generated outputs drift from the
committed baseline, automation updates a single dedicated architecture-refresh
PR containing artifacts only.

## 2. Goals / Non-goals

### Goals

- Generate an always-current architecture snapshot from the actual runtime code.
- Support both human understanding and LLM consumption as first-class use cases.
- Commit generated architecture artifacts to the repository.
- Keep refreshes reviewable by using a dedicated PR instead of direct pushes to
  `master`.
- Cover `src/` and `client/` as the runtime scope.
- Produce split server/client views instead of one mixed top-level graph.
- Keep the output set stable and deterministic enough that refresh PRs remain
  understandable.

### Non-goals

- No coverage for `tests/`, `scripts/`, `review-loop/`, or generated output
  directories in the committed architecture graph.
- No direct commits from automation back to `master`.
- No generator/config changes bundled into the refresh PR; refresh PRs are
  artifacts-only.
- No attempt to preserve or wrap the removed
  `scripts/architecture-inventory*.ts` pipeline.
- No requirement that dependency policy/violation reports be part of the
  initial committed artifact set.

## 3. Current context

The current branch state matters for the design:

- `.github/workflows/ci.yml` already runs on pushes and pull requests to
  `master`.
- `package.json` previously exposed `bun inventory:architecture`, but the old
  `scripts/architecture-inventory*.ts` implementation and its tests have been
  deleted from the worktree.
- The repo has clear runtime subsystem boundaries documented in `CLAUDE.md`
  (`src/chat/`, `src/tools/`, `src/providers/`, `src/mcp/`, `src/settings/`,
  `src/attachments/`, `src/message-queue/`, `src/instances/`, `src/identity/`,
  `src/stats/`, `src/usage/`, and the `client/` surfaces).
- `dependency-cruiser` natively supports raw JSON output plus graph-oriented
  reporters such as `dot`, `archi`, `ddot`, and `mermaid`, which makes it a
  practical base for the replacement pipeline.

## 4. Locked decisions

| #   | Decision                   | Choice                                                                                                           |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Primary optimization       | Balanced output for both humans and LLMs.                                                                        |
| 2   | Publication model          | Commit generated artifacts; do not rely on CI artifacts alone.                                                   |
| 3   | Existing pipeline          | Replace the removed custom inventory pipeline instead of preserving it.                                          |
| 4   | Refresh mechanism          | On relevant `master` pushes, create/update a dedicated architecture-refresh PR instead of direct branch commits. |
| 5   | Refresh PR contents        | Artifacts only.                                                                                                  |
| 6   | Source scope               | `src/` and `client/`.                                                                                            |
| 7   | Human artifact detail      | Top-level architecture plus focused per-area diagrams.                                                           |
| 8   | Machine-readable output    | Keep both raw `dependency-cruiser` JSON and reduced curated JSON.                                                |
| 9   | Focused-area selection     | Fixed curated set, not automatic hotspot selection.                                                              |
| 10  | Server/client presentation | Split views: separate server-runtime architecture and client-focused views.                                      |
| 11  | Client surface scope       | Treat all of `client/` as in-scope runtime UI code, not only `client/settings/`.                                 |
| 12  | Refresh trigger            | Run on pushes to `master`, but only when runtime files or generation config changed.                             |
| 13  | Success criterion          | Balanced: reviewable outputs that are useful to both humans and LLMs.                                            |

## 5. Architecture summary

The new system has one canonical source and two publication layers.

### Canonical source

`dependency-cruiser` generates the full runtime dependency graph for `src/` and
`client/` as raw JSON. This raw output is the authoritative machine snapshot and
the only place where file-level dependency completeness is required.

### Derived machine layer

A repo-local normalizer converts the raw graph into a stable, reduced
architecture model. This reduced JSON is the primary LLM-facing artifact. It
captures named architecture areas, area-to-area edges, focused subgraph
membership, and selected metadata without forcing every consumer to reason over
the entire raw file graph.

### Derived human layer

A renderer generates Markdown and SVG artifacts for architecture readers. The
top-level server view stays separate from the client-focused views so the
runtime bot architecture does not get visually mixed with operator/UI surfaces.
The focused server diagrams use a fixed curated area set so filenames, paths,
and review expectations stay stable over time.

## 6. Artifact set

The committed output root is `docs/architecture/`.

### 6.1 Canonical raw artifact

- `docs/architecture/raw/dependency-cruiser.json`

This file stores the complete `dependency-cruiser` graph for `src/` and
`client/`.

### 6.2 Reduced machine-readable artifact

- `docs/architecture/architecture-llm.json`

This file is the repo-specific, reduced architecture model derived from the raw
graph. Its schema should be stable, intentionally small, and suitable for LLM
prompts and architecture-aware tooling.

### 6.3 Human overview artifacts

- `docs/architecture/overview.md`
- `docs/architecture/diagrams/server-archi.svg`
- `docs/architecture/diagrams/server-ddot.svg`

`overview.md` explains the main runtime areas and the relationship between the
server runtime and the production client surfaces. The SVG diagrams provide the
top-level server structure.

### 6.4 Focused server-area artifacts

Generate focused diagrams and short companion docs for this fixed curated set:

- `chat`
- `llm-orchestrator`
- `tools`
- `providers/plugins`
- `attachments`
- `message-queue`
- `instances`
- `identity`
- `deferred-prompts`
- `memory/memos`
- `mcp/web`
- `settings/debug`
- `stats/usage`

The exact file layout can be normalized under a directory such as
`docs/architecture/server/`, but the set itself is fixed by design.
`settings/debug` in this server-focused set means the server-side runtime under
`src/settings/` and `src/debug/`, not the `client/` surfaces.

### 6.5 Client artifacts

Generate separate client-focused architecture artifacts under a client-specific
directory such as `docs/architecture/client/`. These views cover in-scope
production client surfaces from `client/`, currently including
`client/settings/`, `client/admin/`, and `client/debug/`, while excluding
obvious non-runtime harness code such as `client/stories/`.

### 6.6 Non-committed or optional artifacts

The initial committed set does not require:

- rule-violation HTML reports,
- exhaustive focused file-level graphs for every folder,
- graph sources like `.dot` as committed artifacts.

Those can exist as transient internal generation steps or CI debugging outputs,
but they are not part of the committed artifact contract.

## 7. Component model

Split the implementation into five responsibilities.

### 7.1 Scope resolver

Responsibilities:

- define included runtime roots (`src/`, `client/`),
- define exclusions (tests, generated docs, likely `client/stories/`),
- expose the file patterns used by CI change detection.

### 7.2 Cruise runner

Responsibilities:

- own `dependency-cruiser` execution,
- own depcruise config wiring,
- write canonical raw JSON,
- optionally emit raw graph descriptions such as `archi` or `ddot` for
  rendering.

This layer should know the CLI and reporter details so the rest of the pipeline
does not.

### 7.3 Architecture normalizer

Responsibilities:

- map files/modules into stable named architecture areas,
- collapse file-level dependencies into area-level relationships,
- compute focused subgraph membership,
- produce `architecture-llm.json`.

This is the repo-specific semantic layer and the most important part to keep
truthful as the codebase evolves.

### 7.4 Artifact renderer

Responsibilities:

- render overview Markdown,
- render top-level server diagrams,
- render focused server-area diagrams,
- render client-focused diagrams/docs,
- keep filenames and directory layout deterministic.

### 7.5 Refresh PR workflow

Responsibilities:

- run on relevant `master` pushes,
- regenerate artifacts,
- detect drift against the committed baseline,
- create or update a single architecture-refresh PR,
- never push directly to `master`.

## 8. Data flow

1. A push lands on `master`.
2. CI path filters decide whether runtime or generation inputs changed.
3. If not, the refresh workflow does nothing.
4. If yes, the cruise runner executes `dependency-cruiser` for `src/` and
   `client/` and writes the raw JSON snapshot.
5. The normalizer reads the raw graph and computes stable architecture areas,
   area edges, focused subgraphs, and reduced LLM-facing data.
6. The renderer writes the committed Markdown and SVG artifacts under
   `docs/architecture/`.
7. The workflow compares generated output against committed files.
8. If there is no drift, the workflow exits successfully with no PR update.
9. If there is drift, automation creates or updates the dedicated
   architecture-refresh PR containing only artifact changes.
10. Humans review and merge that PR to establish the new committed baseline.

Generator logic changes happen separately in normal feature PRs. The refresh PR
is a derived-output lane only.

## 9. Area mapping policy

The focused server diagrams use a fixed curated area set rather than automatic
graph centrality or size heuristics. This is intentional because reviewable docs
benefit more from stable conceptual boundaries than from mathematically changing
hotspot selection.

The normalizer must therefore own a deterministic path-to-area policy. That
policy should:

- resolve every included runtime path into exactly one declared area,
- allow deliberate multi-directory areas such as `providers/plugins`,
- keep server and client areas separate by design,
- fail loudly when new runtime paths appear that are not yet categorized.

Failing on uncategorized runtime paths is preferable to silently shoving new
code into the wrong architecture bucket.

## 10. CI and PR automation

The refresh workflow should be separate from the main validation jobs in
`.github/workflows/ci.yml`, even if both are triggered from the same push. The
refresh workflow needs write-capable PR automation permissions, while the normal
CI pipeline can remain read-oriented.

Required workflow behavior:

- trigger on pushes to `master`,
- limit execution to changes in:
  - `src/**`
  - `client/**`
  - depcruise config files
  - architecture generation config/templates
  - the architecture refresh workflow itself
- reuse a single well-known branch/PR identity for refreshes,
- update the existing refresh PR if one is already open,
- skip PR creation when there is no artifact drift.

The automation should not touch unrelated files and should not mix in generator
code changes, lockfile updates, or workflow rewrites.

## 11. Error handling

### 11.1 Cruise/config failures

Examples:

- invalid depcruise config,
- unsupported parse scenario in the scoped runtime files,
- broken include/exclude configuration.

Behavior:

- fail the workflow,
- do not update the refresh PR,
- surface a concise, stage-specific error.

### 11.2 Normalization failures

Examples:

- uncategorized runtime paths,
- reduced JSON schema generation failure,
- inconsistent area-edge data.

Behavior:

- fail the workflow,
- report the exact paths or semantic mismatch involved,
- require a normal code PR to fix the generator logic before the next refresh.

### 11.3 Rendering failures

Examples:

- required SVG generation failure,
- invalid or empty required focused graph,
- Markdown emission failure.

Behavior:

- fail if any required committed artifact cannot be produced,
- allow only non-committed auxiliary debug outputs to fail without blocking.

### 11.4 PR automation failures

Examples:

- missing token permissions,
- inability to create or update the refresh PR.

Behavior:

- complete generation first,
- then fail the workflow with a clear PR-automation error,
- optionally upload transient debugging outputs for investigation.

### 11.5 Drift handling

- no drift: succeed with no-op output,
- drift present: succeed generation and update the refresh PR,
- existing open refresh PR: update it instead of creating a second PR.

No silent fallback to stale committed artifacts is allowed.

## 12. Testing strategy

### 12.1 Unit tests

Add focused tests for:

- scope inclusion/exclusion,
- path-to-area mapping,
- server/client split behavior,
- reduced JSON schema output,
- focused-area output selection,
- stable filename/path generation.

### 12.2 Snapshot-style artifact tests

Use small fixture graphs or mocked depcruise JSON to assert deterministic output
for:

- `overview.md`,
- `architecture-llm.json`,
- representative focused artifact sets,
- any internal graph description format if it is kept as an intermediate.

### 12.3 Workflow verification

Verify that:

- rerunning generation without source changes yields no diff,
- relevant path filters are correct,
- the automation updates only one dedicated refresh PR,
- the refresh PR contains artifacts only.

### 12.4 Architecture invariants

Add invariant tests asserting that:

- every declared focused area resolves to at least one current path,
- every included runtime path is categorized,
- server and client outputs remain separate,
- fixed focused areas do not disappear silently because of path drift.

## 13. Risks and mitigations

- **Refresh PR churn from unstable artifact layout**
  - Mitigation: deterministic paths, fixed focused area set, reduced committed
    artifact surface.
- **Reduced JSON becomes misleading**
  - Mitigation: treat raw JSON as canonical and add strong mapping/invariant
    tests.
- **New runtime areas appear and go undocumented**
  - Mitigation: fail normalization on uncategorized included paths.
- **Client scope is noisier than `client/settings/` alone**
  - Mitigation: split client views from server views and exclude obvious
    non-production harness code.
- **Automation permissions or branch management get brittle**
  - Mitigation: isolate refresh automation into its own workflow with clear
    branch/PR ownership.

## 14. Implementation notes for the follow-up plan

The implementation plan should sequence work in this order:

1. establish scope/config and local generation command,
2. add canonical raw JSON generation,
3. implement normalization and reduced JSON schema,
4. render overview/server/client artifacts,
5. add deterministic tests and invariants,
6. wire the dedicated architecture-refresh PR workflow,
7. remove stale references such as the old `inventory:architecture` script if
   they still remain in `package.json` or docs.

That order keeps the canonical graph and semantic mapping validated before PR
automation starts publishing derived outputs.
