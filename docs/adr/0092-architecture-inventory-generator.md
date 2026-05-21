<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0092: Architecture Inventory Generator with Deletion-Candidate Identification

## Status

Accepted

## Date

2026-05-11

## Context

The papai codebase has grown to a point where architectural understanding is distributed across many directories, workspaces, and historical documents. The repository contains:

- Product features exposed to users (recurring tasks, deferred prompts, identity mapping, etc.)
- Runtime subsystems (message queue, web fetch, file relay)
- Provider integrations (Telegram, Mattermost, Discord; Kaneo, YouTrack)
- Developer workflows (lint, format, test, security)
- Analysis tools (behavior audit, codeindex workspace, review-loop workspace)
- Legacy and experimental variants (archived designs, superseded implementations)
- Cross-cutting concerns (tool registry, capability gating, configuration)

There was no single index that answered "what architectural pieces exist, where they live, and how they relate to each other" in a machine-readable, repeatable form. The risk was that dead or superseded code persisted alongside active implementations, and new contributors had no deterministic way to discover existing subsystems. Manual inventory was unreliable and non-repeatable.

## Decision Drivers

- **Completeness**: Must cover both file-level and feature-level architectural pieces
- **Repeatability**: Must be deterministic and runnable by any contributor
- **Evidence-based**: Must surface signals for deletion candidates without making recommendations
- **High coverage**: Must intentionally over-include and mark ambiguity instead of filtering early
- **Non-destructive**: Must observe and document; deletion decisions remain manual

## Considered Options

### Option 1: Manual Inventory Only

- **Pros**: Simple to start, no tooling needed
- **Cons**: Not repeatable, drifts immediately, cannot leverage code analysis, human error in coverage
- **Verdict**: Rejected — the repository is too large for manual maintenance

### Option 2: File-Only Automated Inventory (e.g., directory tree listing)

- **Pros**: Trivially automated, fast to produce
- **Cons**: Cannot identify feature families that span multiple directories, misses capability-level reasoning, difficult to attach signals about deletion candidacy
- **Verdict**: Rejected — papai behaviors span many files; directory listing is too low-level

### Option 3: Feature-Only Manual Taxonomy

- **Pros**: Captures user-facing behavior, easy to document
- **Cons**: Misses isolated scripts, workspaces, benchmarks, and legacy variants that have no user-facing entry point but may be deletion candidates
- **Verdict**: Rejected — isolation of developer-only and legacy pieces is required for complete analysis

### Option 4: Hybrid Pipeline — Top-Down Seed + Bottom-Up Discovery + Canonical Registry + Signal Collection + Dossier Rendering

- **Pros**: High coverage, deterministic, repeatable, evidence-backed, preserves ambiguity, not destructive
- **Cons**: Higher initial implementation cost, requires maintenance as taxonomy evolves
- **Verdict**: Accepted — matches the need for both completeness and evidence-based reasoning

## Decision

We will implement a **hybrid architecture inventory pipeline** that:

1. Extracts top-down seed pieces from `README.md`, `CLAUDE.md`, `docs/ROADMAP.md`, `package.json`, and a mandatory scope-family list
2. Discovers bottom-up candidates from filesystem layout (`src/`, `client/`, `scripts/`, `tests/`, `codeindex/`, `review-loop/`, archived docs)
3. Merges both into a **canonical registry** with stable identifiers, aliases, and ownership mappings
4. Attaches related assets (tests, docs, scripts, entrypoints) via path-ownership heuristics
5. Collects **non-destructive deletion-candidate signals** backed by codeindex reference analysis and static inspection
6. Renders per-piece dossiers and summary matrices (inventory index, review queue, overlap/orphan/mismatch/test-presence reports)
7. Publishes a complete `docs/architecture/` package plus a machine-readable `inventory.json`

The pipeline is exposed as a root script `inventory:architecture` in `package.json`.

## Rationale

This hybrid approach is the only option that satisfies all decision drivers:

1. **Completeness** — Top-down enumeration captures feature families; bottom-up filesystem traversal captures isolated scripts and variants
2. **Repeatability** — Deterministic classification rules, stable slug identifiers, and scripted execution
3. **Evidence-based** — Every signal cites an observation: missing tests, missing entrypoints, historical-only docs, lightly referenced code, unsurfaced provider capabilities
4. **High coverage** — Ambiguous pieces are included with `unclear` status and noted for manual review
5. **Non-destructive** — No piece is labeled "safe to delete"; instead, each carries signals + review questions

## Consequences

### Positive

- Single canonical inventory of all architectural pieces
- Repeatable `bun inventory:architecture` command regenerates the package
- Evidence-backed signal layer supports informed manual cleanup decisions
- Dossiers serve as onboarding documentation for each subsystem
- Machine-readable `inventory.json` enables future automation (diffing, trend analysis)
- Discovery rules are explicit and testable

### Negative

- Taxonomy must be maintained as new piece types emerge
- Signal heuristics produce false positives (mitigated by explicit evidence + manual review)
- File-structure divergence from plan (discovery module split into 4 sub-modules) requires slightly more context to navigate

### Risks

- **Risk**: Taxonomy becomes stale as new architectural patterns emerge
  - **Mitigation**: Tests enforce expected values; taxonomy updates are explicit
- **Risk**: Signal collection generates too many false positives
  - **Mitigation**: Every signal cites evidence; review queue includes ambiguity ordering; manual review is required for any deletion
- **Risk**: Bottom-up discovery over-captures incidental directories
  - **Mitigation**: Ownership mapping requires confidence thresholds; unmatched files remain explicit in the registry

## Implementation

### Modules Created

| Module                                                   | Responsibility                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/architecture-inventory-model.ts`                | Canonical taxonomy (`PieceType`, `PieceStatus`, `SignalName`), record types, mandatory scope families, slug helpers                      |
| `scripts/architecture-inventory-discovery.ts`            | Barrel re-export for discovery sub-modules                                                                                               |
| `scripts/architecture-inventory-discovery-common.ts`     | Shared discovery utilities (`uniqueCandidates`, `makeCandidate`, extraction helpers)                                                     |
| `scripts/architecture-inventory-discovery-top-down.ts`   | Extract pieces from `README.md`, `CLAUDE.md`, `ROADMAP.md`, `package.json`                                                               |
| `scripts/architecture-inventory-discovery-filesystem.ts` | Discover pieces from filesystem layout (`src/`, `client/`, `scripts/`, `tests/`, archived docs)                                          |
| `scripts/architecture-inventory-registry.ts`             | Canonical registry normalization, merge/split rules, asset ownership attachment, manual review question generation                       |
| `scripts/architecture-inventory-signals.ts`              | Codeindex-backed reference summary loading (`bun:sqlite`), per-piece signal generation (15 signal types)                                 |
| `scripts/architecture-inventory-report.ts`               | Markdown and JSON rendering: inventory index, review queue, overlap/orphan/mismatch/ test-presence matrices, per-piece dossiers          |
| `scripts/architecture-inventory-cli-support.ts`          | CLI argument parsing, dependency injection boundary                                                                                      |
| `scripts/architecture-inventory.ts`                      | Orchestration entrypoint: reads docs, optional codeindex reindex, builds registry, collects signals, writes `docs/architecture/` package |

### Tests Created

| Test File                                                | Coverage                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `tests/scripts/architecture-inventory-discovery.test.ts` | Taxonomy, top-down extraction, bottom-up discovery                                    |
| `tests/scripts/architecture-inventory-registry.test.ts`  | Registry merging, ownership attachment, alias/token handling, review questions        |
| `tests/scripts/architecture-inventory-signals.test.ts`   | Codeindex summary loading, signal collection, capability-vs-tool family detection     |
| `tests/scripts/architecture-inventory-report.test.ts`    | Dossier rendering, review queue ordering, output file set building                    |
| `tests/scripts/architecture-inventory.test.ts`           | CLI argument parsing, DI orchestration, absolute-output-dir handling, input filtering |

### Package Script

Added to `package.json`:

```json
"inventory:architecture": "bun scripts/architecture-inventory.ts"
```

### Output Structure

Generated under `docs/architecture/`:

```
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

### Deviation from Plan

The plan specified a single `scripts/architecture-inventory-discovery.ts` file. During implementation, discovery was split into:

- `scripts/architecture-inventory-discovery-common.ts`
- `scripts/architecture-inventory-discovery-top-down.ts`
- `scripts/architecture-inventory-discovery-filesystem.ts`
- `scripts/architecture-inventory-cli-support.ts`

The barrel module `scripts/architecture-inventory-discovery.ts` preserves the same public interface. This improves maintainability but is a structural deviation from the plan's file structure.

## Alternatives Considered

See Options 1-3 above under "Considered Options".

## Related Decisions

- ADR-0083: Enrich Codeindex Search Ergonomics for Agents — The inventory pipeline leverages codeindex as an external analysis dependency
- `docs/superpowers/specs/2026-05-11-architecture-inventory-and-deletion-candidate-identification-design.md` — Design specification (archived after acceptance)
- `docs/superpowers/plans/2026-05-11-architecture-inventory-implementation.md` — Implementation plan (archived after acceptance)

## References

- Implementation: `scripts/architecture-inventory*.ts`
- Tests: `tests/scripts/architecture-inventory-*.test.ts`
- Spec: `docs/archive/2026-05-11-architecture-inventory-and-deletion-candidate-identification-design.md`
- Plan: `docs/archive/2026-05-11-architecture-inventory-implementation.md`
