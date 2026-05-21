<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Architecture Inventory And Deletion Candidate Identification Design

**Date:** 2026-05-11
**Scope:** Define a deterministic, high-coverage workflow for analyzing the papai repository, identifying architectural pieces at both file/module and feature/capability levels, and documenting each piece together with evidence relevant to later deletion review.
**Primary Goal:** Produce a repeatable analysis pipeline that inventories the project comprehensively and surfaces evidence-backed deletion candidates for later manual review.
**Non-Goal:** Decide what should be deleted, recommend removals, or perform any code or documentation cleanup outside the inventory process itself.

---

## Context

The repository is large enough to contain multiple kinds of architectural pieces:

- product features exposed to users
- runtime subsystems that support the bot
- provider integrations
- developer-only workflows and analysis tooling
- benchmarks, audits, and migration scripts
- legacy, alternate, or experimental implementations kept in parallel

Some of these pieces are obvious from current documentation, while others only appear in code, tests, scripts, archived docs, or workspace-level tooling.

The repository already contains several strong signals that can support this work:

- `README.md` describes top-level architecture and feature families
- `CLAUDE.md` documents major modules, available tools, runtime behavior, and workspaces
- `docs/ROADMAP.md` captures planned and historical capability directions
- `docs/archive/`, `docs/user-stories/`, and `docs/superpowers/` contain design and implementation history
- `package.json` exposes scripts for static analysis and architecture-adjacent tooling such as `knip`, `duplicates`, `audit:behavior`, benchmarks, and workspace commands

The user requested a deterministic, clear, and straightforward workflow optimized for high coverage rather than high confidence. This means the workflow should intentionally over-include potential candidates, while preserving enough evidence to allow later manual review to reject false positives safely.

---

## Decision

Use a hybrid evidence pipeline with two synchronized outputs:

1. an architecture inventory of all identified project pieces
2. a deletion-candidate evidence layer attached to those pieces

The workflow starts with top-down architectural enumeration from docs and repository structure, then expands bottom-up from source layout, scripts, tests, and historical artifacts. It normalizes everything into a single canonical registry. Each piece then receives a dossier that records purpose, ownership, activation paths, dependencies, test and doc presence, and non-destructive deletion-candidate signals.

The workflow is intentionally explicit and stage-gated. Every stage has:

- fixed inputs
- required outputs
- deterministic classification rules
- evidence collection rules
- reviewable artifacts

No stage is allowed to collapse directly from "signal" to "deletion decision".

---

## Design Principles

The workflow must follow these rules:

1. **Inventory before judgment**
   Every candidate must be identified as an architectural piece before any obsolescence or redundancy signal is attached.
2. **Features and files are different units**
   File-level inventory alone is insufficient because many project behaviors are implemented across multiple directories. Feature/capability-level inventory alone is insufficient because code often contains isolated scripts or alternate implementations that are not visible as user-facing features.
3. **One canonical registry**
   There must be a single inventory that merges docs, code, tests, scripts, and historical references.
4. **High coverage by design**
   Ambiguous cases must be included and marked as `unclear` instead of filtered out early.
5. **Evidence, not inference**
   Every deletion-candidate signal must be traceable to a specific observation such as missing runtime references, overlapping implementations, missing tests, or docs/code mismatch.
6. **Runtime reachability outweighs historical docs**
   Old docs may explain why a thing existed, but runtime entrypoints and current wiring are stronger evidence for current relevance.
7. **No silent merging of variants**
   If two implementations appear to solve the same problem, they must be documented as separate variants under the same parent capability until manual review resolves them.

---

## Canonical Taxonomy

Every discovered piece must be classified as exactly one primary type.

### Piece Types

- `runtime-subsystem`
  Core code that participates in main application runtime behavior.
- `product-feature`
  User-visible behavior or capability exposed through chat, scheduling, memory, or similar flows.
- `integration-provider`
  Provider-specific or platform-specific integration surfaces.
- `developer-workflow`
  Tooling or workflows used by contributors to verify, build, release, lint, test, or maintain the repository.
- `analysis-tool`
  Specialized internal tooling used to inspect, benchmark, audit, or study the system rather than run the product itself.
- `experimental-or-legacy-variant`
  A parallel, alternate, superseded, or historical implementation kept in the tree.
- `cross-cutting-concept`
  A concern spanning multiple pieces, such as capability gating, configuration, or storage context rules.

### Piece Statuses

Every piece must also receive exactly one status:

- `active`
- `experimental`
- `legacy`
- `unclear`

Status assignment rules:

- `active` if there is current runtime, workflow, or verified maintenance usage
- `experimental` if the piece exists in code or scripts but is clearly trial, benchmark, audit, or branch-specific exploration
- `legacy` if the piece is explicitly archived, superseded, or retained only as an old variant
- `unclear` if signals conflict or evidence is incomplete

---

## Repository-Specific Scope Model

The first full inventory pass must explicitly enumerate these top-level families because the repository already declares them in current docs and structure:

- bot runtime and startup
- chat provider adapters
- task provider adapters
- tool registry and capability gating
- conversation history, memory, and context storage
- identity mapping
- group settings and configuration flows
- message queue
- file relay
- web fetch
- recurring tasks
- deferred prompts
- debug server and dashboard client
- `codeindex` workspace
- `review-loop` workspace
- benchmark scripts
- behavior-audit scripts
- release, deploy, and verification workflows
- archived or alternate behavior implementations
- provider capabilities not surfaced at tool level

This list is a mandatory starting seed, not the complete inventory.

---

## Workflow Overview

The workflow has 10 stages:

1. establish inventory rules
2. create the top-down seed list
3. create the bottom-up discovery list
4. normalize into the canonical registry
5. map code ownership and boundaries
6. map activation and dependency relationships
7. collect non-destructive deletion-candidate signals
8. generate per-piece dossiers
9. generate review queues and summary matrices
10. publish the architecture inventory package

Each stage is described below with required inputs, actions, outputs, and completion rules.

---

## Stage 1: Establish Inventory Rules

### Inputs

- this workflow document
- current repository structure
- current documentation conventions under `docs/`

### Actions

1. Create the canonical taxonomy from the definitions above.
2. Define the required fields for every piece record.
3. Define deterministic inclusion rules for files, directories, scripts, features, and variants.
4. Define deterministic status assignment rules.
5. Define deterministic signal definitions for later candidate identification.

### Required Piece Record Fields

Every piece in the registry must contain at least:

- `piece_id`
- `name`
- `type`
- `status`
- `summary`
- `primary_paths`
- `secondary_paths`
- `entrypoints`
- `related_tests`
- `related_docs`
- `related_scripts`
- `config_or_env_dependencies`
- `runtime_dependencies`
- `dependents`
- `signals`
- `manual_review_questions`

### Deterministic Inclusion Rules

- A top-level directory with a coherent purpose becomes a candidate piece.
- A `src/` subsystem directory with a coherent purpose becomes a candidate piece.
- A standalone source file in `src/` with a unique responsibility becomes a candidate piece or sub-piece.
- A named script in `package.json` becomes a candidate piece if it is not merely a thin alias to another command.
- A capability described in user-facing docs becomes a candidate piece even if implemented across many files.
- A repeated concept appearing in code, tests, and docs becomes a candidate piece even if no single directory owns it.
- Multiple implementations for the same responsibility become separate variant pieces under one parent conceptual grouping.

### Outputs

- canonical taxonomy definition
- piece record schema
- inclusion rule set
- signal rule set definition

### Completion Rule

Stage 1 is complete only when the schema and classification rules can be applied without ad hoc exceptions.

---

## Stage 2: Create The Top-Down Seed List

### Inputs

- `README.md`
- `CLAUDE.md`
- `docs/ROADMAP.md`
- `docs/user-stories/**`
- current workspace names in `package.json`
- current script names in `package.json`

### Actions

1. Extract every named architecture component from `README.md` architecture and feature sections.
2. Extract every named main module, subsystem, workspace, and tool family from `CLAUDE.md`.
3. Extract every planned or active capability family from `docs/ROADMAP.md`.
4. Extract every workspace from `package.json`.
5. Extract every meaningful script family from `package.json`.
6. Add the mandatory repository-specific scope families from this design.

### Output Rules

- Every extracted item becomes a provisional piece record.
- Provisional records may have empty paths initially.
- If the same named concept appears in multiple sources, preserve all source references instead of deduplicating immediately.

### Outputs

- top-down provisional piece list
- source citation list showing where each piece was declared

### Completion Rule

Stage 2 is complete only when every named subsystem, feature family, provider family, workspace, and major workflow exposed by current docs and scripts appears at least once in the provisional list.

---

## Stage 3: Create The Bottom-Up Discovery List

### Inputs

- repository filesystem layout
- source directories
- script files
- tests directories
- historical docs directories

### Actions

1. Enumerate top-level directories and classify their broad purpose.
2. Enumerate `src/` subsystem directories and identify bounded responsibilities.
3. Enumerate standalone files in `src/` that are architectural entrypoints or coordination modules.
4. Enumerate `client/` domains, especially debug surfaces.
5. Enumerate `scripts/` files and cluster them by purpose.
6. Enumerate `tests/` domains and map them to implied features or subsystems.
7. Enumerate `codeindex/` and `review-loop/` as full workspaces with internal subsystems.
8. Enumerate historical documents under `docs/archive/` and `docs/superpowers/remaining/` to discover alternate, legacy, or incomplete implementations.

### Discovery Rules

- Each cohesive directory becomes a candidate piece.
- Each script with a distinct operational purpose becomes a candidate piece.
- Each cluster of tests targeting a specific domain becomes supporting evidence for a piece or a new provisional piece if none exists yet.
- Archived docs do not prove current activity, but they do create or reinforce `experimental`, `legacy`, or `unclear` provisional pieces.

### Outputs

- bottom-up provisional piece list
- path-to-provisional-piece mapping

### Completion Rule

Stage 3 is complete only when every top-level directory, every first-order `src/` subsystem, every named script family, and every workspace has been either mapped to a provisional piece or explicitly marked out of scope as non-architectural support material.

---

## Stage 4: Normalize Into The Canonical Registry

### Inputs

- top-down provisional list
- bottom-up provisional list

### Actions

1. Merge records representing the same architectural piece.
2. Preserve aliases when different sources use different names.
3. Split records that were incorrectly merged due to broad naming.
4. Create parent-child relationships where one conceptual feature contains multiple variants or subsystems.
5. Assign each piece a stable `piece_id`.
6. Assign preliminary type and status.

### Merge Rules

- Merge only when purpose, boundaries, and ownership clearly align.
- Do not merge two records solely because they mention the same business topic.
- If two records may be alternatives, create sibling pieces and mark them as variants.
- If evidence conflicts, keep the piece separate and mark status `unclear`.

### Outputs

- canonical architecture registry
- alias map
- parent-child map for grouped capabilities and variants

### Completion Rule

Stage 4 is complete only when every provisional record has been merged, split, or retained as a distinct canonical piece with no orphan provisional rows remaining.

---

## Stage 5: Map Code Ownership And Boundaries

### Inputs

- canonical registry
- source tree
- script tree
- tests tree
- docs tree

### Actions

1. Assign primary owned paths to each piece.
2. Assign secondary supporting paths where shared support code is involved.
3. Identify source entrypoints for each piece.
4. Identify test coverage paths for each piece.
5. Identify documentation coverage paths for each piece.
6. Identify script entrypoints for each piece.

### Ownership Rules

- Every architectural file should map to at least one piece.
- A file may belong to multiple pieces, but exactly one must be marked as the primary owner.
- Shared infrastructure files should be attached to a `cross-cutting-concept` or shared subsystem rather than copied blindly into unrelated pieces.
- If a file cannot be placed confidently, create an `unclear` mapping note rather than omitting it.

### Outputs

- file-to-piece ownership map
- piece-to-path map
- test-to-piece map
- doc-to-piece map
- script-to-piece map

### Completion Rule

Stage 5 is complete only when all architectural source paths, all named scripts, and all domain-specific test areas have an explicit mapping.

---

## Stage 6: Map Activation And Dependency Relationships

### Inputs

- canonical registry
- code references
- scripts
- docs
- config and environment requirements

### Actions

1. Identify runtime entrypoints that activate each piece.
2. Identify scripts that invoke each piece.
3. Identify config keys and environment variables gating each piece.
4. Identify imports, calls, registry registrations, and factory wiring that connect pieces.
5. Identify dependents and upstream dependencies.
6. Identify docs that describe how a piece is activated or used.

### Relationship Categories

- `runtime-activates`
- `script-activates`
- `depends-on`
- `used-by`
- `documented-by`
- `tested-by`
- `gated-by-config`

### Outputs

- activation graph
- dependency graph
- documentation graph
- config/env dependency map

### Completion Rule

Stage 6 is complete only when each canonical piece has at least one of the following explicitly documented: activation path, dependent path, or unresolved note explaining why none could be confirmed.

---

## Stage 7: Collect Deletion-Candidate Signals

### Inputs

- canonical registry
- ownership maps
- relationship maps
- static analysis outputs
- historical documentation outputs

### Actions

Collect signals for each piece without making recommendations. Signals should be binary where possible, or enumerated as explicit observations.

### Mandatory Signal Set

- `no-current-runtime-entrypoint`
- `no-current-script-entrypoint`
- `no-tests-found`
- `no-current-docs-found`
- `docs-code-mismatch`
- `historical-docs-only`
- `overlapping-implementation-detected`
- `provider-capability-not-surfaced`
- `script-only-existence`
- `benchmark-only-existence`
- `audit-only-existence`
- `declared-but-not-wired`
- `wired-but-lightly-referenced`
- `variant-with-same-purpose`
- `status-unclear`

### Recommended Evidence Sources

- structural reference analysis via code indexing
- `bun knip`
- `bun duplicates`
- script inventory from `package.json`
- benchmark and audit script families
- archived docs and spec history
- test directory presence
- runtime wiring from startup and registry modules

### Signal Recording Rules

- Every signal must cite the underlying observation.
- A signal must not be converted into a verdict such as "safe to delete".
- Multiple weak signals should be preserved separately rather than summarized away.
- Conflicting signals must both remain visible.

### Outputs

- per-piece signal list
- signal evidence table

### Completion Rule

Stage 7 is complete only when every canonical piece has either at least one recorded signal or an explicit `no concerning signals currently observed` marker.

---

## Stage 8: Generate Per-Piece Dossiers

### Inputs

- canonical registry
- ownership maps
- relationship maps
- signal evidence table

### Actions

Create one dossier per architectural piece.

### Required Dossier Template

Each dossier must contain these sections in this order:

1. `Name`
2. `Type`
3. `Status`
4. `Summary`
5. `Why It Exists`
6. `Primary Paths`
7. `Secondary Paths`
8. `Entrypoints And Activation`
9. `Runtime And Config Dependencies`
10. `Related Tests`
11. `Related Docs`
12. `Dependents And Consumers`
13. `Variants Or Overlapping Pieces`
14. `Deletion-Candidate Signals`
15. `Open Questions For Manual Review`

### Dossier Writing Rules

- Use facts and direct repository references.
- Avoid deletion advice.
- Distinguish clearly between observed facts and unresolved interpretation.
- If the piece is broad, explain its internal substructure briefly.
- If the piece is a variant, link to the parent capability and sibling variants.

### Outputs

- one dossier file per canonical piece

### Completion Rule

Stage 8 is complete only when every piece in the registry has a corresponding dossier file.

---

## Stage 9: Generate Review Queues And Summary Matrices

### Inputs

- canonical registry
- dossier set
- signal evidence table

### Actions

Create summary artifacts that help humans review high-coverage candidates efficiently.

### Required Summary Views

1. **Architecture Catalog**
   One table listing all pieces with type, status, primary paths, and dossier link.
2. **Candidate Review Queue**
   One table sorted by signal density or ambiguity, intended for later manual review.
3. **Overlap Matrix**
   Pairs or groups of pieces that appear to serve the same or adjacent responsibilities.
4. **Orphan Matrix**
   Pieces with no clear runtime or workflow activation.
5. **Docs-Code Mismatch Report**
   Pieces whose documented existence and actual wiring diverge.
6. **Test Presence Report**
   Pieces grouped by test presence or absence.

### Queue Ordering Rules

For high coverage, prioritize review order by these factors:

1. `status-unclear`
2. overlapping implementations
3. historical docs without confirmed current activation
4. script-only, benchmark-only, or audit-only existence
5. no tests and no current docs together
6. declared but not wired

### Outputs

- architecture catalog
- candidate review queue
- overlap matrix
- orphan matrix
- docs-code mismatch report
- test presence report

### Completion Rule

Stage 9 is complete only when the summary artifacts together allow a reviewer to start from the highest-risk ambiguity areas without reopening raw analysis.

---

## Stage 10: Publish The Architecture Inventory Package

### Required Output Structure

The workflow should publish a documentation package under a dedicated architecture location.

Recommended structure:

```text
docs/architecture/
  inventory.md
  inventory.json
  candidate-review-queue.md
  overlap-matrix.md
  orphan-matrix.md
  docs-code-mismatch.md
  test-presence-report.md
  pieces/
    <piece-id>.md
```

### File Roles

- `inventory.md`
  Human-readable index of all pieces and the taxonomy.
- `inventory.json`
  Machine-readable registry for repeatable updates and diffing.
- `candidate-review-queue.md`
  Ordered review list for later human analysis.
- `overlap-matrix.md`
  Candidate overlaps and variant groups.
- `orphan-matrix.md`
  Pieces lacking clear activation.
- `docs-code-mismatch.md`
  Divergence between documentation and implementation.
- `test-presence-report.md`
  Coverage presence matrix by piece.
- `pieces/<piece-id>.md`
  Dossier for each piece.

### Completion Rule

Stage 10 is complete only when the inventory package can be reviewed without needing to reconstruct any prior stage manually.

---

## Step-By-Step Operator Checklist

This section restates the workflow as a concrete checklist for execution.

1. Define taxonomy, statuses, and record schema.
2. Extract named pieces from `README.md`, `CLAUDE.md`, `docs/ROADMAP.md`, and `package.json`.
3. Enumerate top-level directories, `src/` subsystems, `client/` areas, scripts, tests, and workspaces.
4. Enumerate historical and archived docs that imply legacy or alternate implementations.
5. Merge both inventories into one canonical registry.
6. Assign stable `piece_id` values.
7. Map primary and secondary paths to each piece.
8. Map tests, docs, scripts, and config/env dependencies to each piece.
9. Map activation paths and dependency relationships.
10. Run architecture-adjacent analysis signals such as indexing, reference mapping, `knip`, and duplicate detection.
11. Record deletion-candidate signals for every piece without making recommendations.
12. Write one dossier per piece.
13. Build the architecture catalog and review queue artifacts.
14. Review for completeness: every piece must have a dossier, every architectural path must have an owner, every signal must cite evidence.
15. Publish the inventory package under `docs/architecture/`.

---

## Recommended Tooling By Stage

The workflow should prefer the repository's existing analysis surfaces where possible.

### Structural Discovery

- current docs under `README.md`, `CLAUDE.md`, and `docs/`
- repository layout inspection
- code indexing for symbol and impact analysis

### Reference And Wiring Analysis

- code index symbol lookup
- code index concept search
- code index impact analysis
- runtime entrypoint tracing from startup and registries

### Static Signals

- `bun knip`
- `bun duplicates`
- script inventory in `package.json`
- benchmark and behavior audit script families

### Historical Signals

- `docs/archive/`
- `docs/superpowers/remaining/`
- older design docs under `docs/superpowers/specs/`

This workflow does not require inventing new analysis categories before using existing repo-local signals.

---

## Dossier Quality Bar

A piece dossier is acceptable only if:

1. it explains what the piece is in one short paragraph
2. it names where the piece lives in code
3. it shows how the piece is activated or why activation is unclear
4. it links to tests and docs when present
5. it lists all currently observed candidate signals without editorializing
6. it ends with manual review questions instead of recommendations

---

## Risks And Failure Modes

### Risk: False Positives From High-Coverage Discovery

Expected and acceptable. Mitigation is not early filtering. Mitigation is preserving evidence and making ambiguity explicit.

### Risk: File-Level Ownership Drift

Shared files may be attached inconsistently. Mitigation is requiring exactly one primary owner and optional secondary owners.

### Risk: Historical Docs Overpower Current Runtime Truth

Mitigation is to keep historical references as evidence only and give stronger weight to current activation and dependency mapping.

### Risk: Variants Accidentally Merged

Mitigation is to split possible alternatives into sibling pieces unless equivalence is proven.

### Risk: Summary Artifacts Hide Raw Evidence

Mitigation is to require each signal in each dossier to cite its observation source.

---

## Success Criteria

This workflow design is successful when:

1. it produces a single canonical inventory across file/module and feature/capability levels
2. it is deterministic enough that two careful operators should produce near-equivalent piece registries
3. it is high coverage by default and keeps ambiguous candidates visible
4. it records evidence for every deletion-candidate signal without turning signals into deletion advice
5. it yields per-piece dossiers and summary artifacts that support later manual review
6. it fits the repository's current structure, documentation style, and existing analysis tooling

---

## Alternatives Considered

### File-Only Inventory

Rejected because many important papai behaviors span multiple files and directories, especially tools, provider integrations, and runtime flows.

### Feature-Only Inventory

Rejected because isolated scripts, workspaces, audits, and parallel implementations can be deletion candidates without being visible as user-facing features.

### Confidence-First Filtering

Rejected because the requested goal is high coverage, with later human review of false positives.

---

## Open Decisions

The workflow design leaves these implementation details open:

- whether the inventory generation is fully manual, semi-automated, or scripted
- the exact machine-readable schema for `inventory.json`
- the exact scoring or sorting formula for the candidate review queue
- whether architecture diagrams should be generated in addition to dossier documents

These are implementation choices and do not change the approved workflow structure.
