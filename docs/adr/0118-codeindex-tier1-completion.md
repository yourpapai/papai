<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0118: Codeindex Tier 1 Implementation Completion — Extraction to Standalone Repository

## Status

Accepted

## Context

The `codeindex` project was originally specified in `docs/superpowers/specs/2026-04-14-codeindex-tier1-design.md` as a **nested Bun workspace** under `codeindex/` inside the papai monorepo. The accompanying implementation plan (`docs/superpowers/plans/2026-04-14-codeindex-tier1-implementation.md`) contained 14 tasks covering workspace scaffolding, parser loading, SQLite schema, symbol extraction, reference resolution, search ranking, MCP tooling, CLI commands, incremental reindexing, TDD hook wiring, and root quality-gate integration.

During implementation, the workspace model was abandoned in favor of extracting `codeindex` into an **independent standalone Bun/TypeScript repository** outside the papai monorepo. ADR-0089 records the portability decision itself; this ADR records what was built, what changed, and what remains.

## Decision Drivers

- **Implementation completeness**: Verify whether the full Tier 1 spec was realized, regardless of where the code lives.
- **Decision traceability**: The extraction created a gap between the original plan (nested workspace) and the final artifact (standalone repo). Future readers need a single place that maps plan tasks to actual outcomes.
- **Forward visibility**: The Tier 1 spec explicitly scoped out decorators, declaration files, embeddings, and graph operations. These need to be discoverable as future work.

## Considered Options

### Option 1: Archive the plan without a completion ADR

- **Pros**: Minimal ceremony.
- **Cons**: Leaves no authoritative record of what was actually built, what deviated, and what was intentionally skipped. Future searches would have to reconstruct history from scattered commits.

**Rejected.**

### Option 2: Write a completion ADR that captures the delta

- **Pros**: Single source of truth for implementation status, deviations, and remaining layers.
- **Cons**: One-time documentation cost.

**Chosen.**

## Decision

Write ADR-0118 as the canonical completion record for `codeindex` Tier 1. Move the original spec and plan to `docs/archive/`. Capture future tiers in `docs/superpowers/notes/`.

## Rationale

The original plan is too large and prescriptive about a workspace layout that no longer exists. Archiving both the spec and the plan acknowledges their historical role, while the ADR provides the current-state summary. Future developers do not need to read a 107KB plan file to understand what exists.

## Consequences

### Positive

- Clear traceability from 14-task plan → actual implementation
- Future tiers/layers are documented in a discoverable location
- Original spec and plan remain accessible in `docs/archive/`

### Negative

- Slight duplication: ADR-0089 covers extraction, ADR-0083 covers search ergonomics, and this ADR covers completion. All three are needed because each captures a different cross-section.

---

## Implementation Status Detail

### Artifacts

The `codeindex` implementation lives at `~/Projects/yourpapai/codeindex` as a standalone Bun project with its own `package.json`, `tsconfig.json`, `bun.lock`, tests, lint config, and `CLAUDE.md`.

- **Source files**: 22 modules in `src/`
- **Test files**: 29 test files across `tests/` (97 pass, 0 fail)
- **Scripts**: `test`, `typecheck`, `lint`, `format:check`, `check`, `start`, `mcp`

### Task-by-Task Completion

| Task | Description                                                            | Status            | Notes                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Workspace scaffolding (`package.json`, `tsconfig.json`, config loader) | ✅ Implemented    | Exists in standalone repo; not in papai workspaces                                                                                                                                                                                        |
| 2    | Parser bootstrapping (tree-sitter WASM)                                | ✅ Implemented    | Uses `tree-sitter-javascript`/`tree-sitter-typescript` packages with `Parser.init({ locateFile })` runtime bootstrap; deviates from plan's `tree-sitter-wasms` recommendation                                                             |
| 3    | File discovery (`.gitignore`, excludes)                                | ✅ Implemented    | `src/indexer/discover.ts` with `ignore` package                                                                                                                                                                                           |
| 4    | SQLite schema, FTS5 triggers, storage helpers                          | ✅ Implemented    | `src/storage/{db,schema,queries}.ts`; includes schema versioning (`SCHEMA_VERSION 1`) not in plan                                                                                                                                         |
| 5    | Module keys, aliases, `tsconfig` paths                                 | ✅ Implemented    | `src/resolver/{module-specifiers,tsconfig-paths}.ts`                                                                                                                                                                                      |
| 6    | Symbol extraction (doc comments, identifier terms)                     | ✅ Implemented    | Enhanced beyond plan: supports `abstract_class_declaration`, `enum_declaration`, `isDefaultExport`, `anonymous default`, `indexLocals`/`indexVariables` filtering                                                                         |
| 7    | Reference candidate extraction                                         | ✅ Implemented    | Enhanced beyond plan: supports reexports, lexical declaration exports, `import_clause` defaults, scope boundaries                                                                                                                         |
| 8    | Reference resolution with confidence scoring                           | ✅ Implemented    | `src/resolver/resolve-references.ts` with `resolved`/`file_resolved`/`name_only`; adds `target_file_id` population                                                                                                                        |
| 9    | Full indexing persistence                                              | ✅ Implemented    | `src/indexer/index-codebase.ts` with hash-based file tracking, alias persistence, symbol linking, module exports, second-pass reference resolution                                                                                        |
| 10   | Exact search, FTS search, ranking                                      | ✅ Implemented    | `src/search/{exact,fts,rank,index}.ts`; adds `sanitizeFtsQuery`, `RankedSearchResult`, `rankScore`                                                                                                                                        |
| 11   | `code_symbol`, `code_impact`, MCP tools                                | ✅ Implemented    | `src/mcp/{server,tools}.ts`; 4 tools: `code_search`, `code_symbol`, `code_impact`, `code_index`                                                                                                                                           |
| 12   | CLI commands, incremental reindexing                                   | ✅ Implemented    | `src/cli.ts`: `index`, `reindex`, `search`, `symbol`, `impact`, `stats`, `mcp`; incremental mode with hash short-circuit + dependent fan-out + deleted-file pruning                                                                       |
| 13   | TDD hooks, agent guidance                                              | ⚠️ Not applicable | `codeindex/CLAUDE.md` exists, but TDD hook wiring into papai was skipped because extraction to standalone repo happened                                                                                                                   |
| 14   | Root quality-gate integration                                          | ⚠️ Not applicable | `codeindex:*` scripts were not added to papai `package.json` or `scripts/check.sh` because extraction to standalone repo happened; `scripts/codeindex-cli.ts` and `scripts/codeindex-cli-support.ts` serve as papai-side wrappers instead |

### Additional Features Not in Plan

| Feature                                         | Location                             | Why                                                |
| ----------------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| `target_file_id` in `symbol_references`         | `src/storage/schema.ts`              | Enables JOIN-based impact queries on file deletion |
| Schema versioning with wipe/rebuild             | `src/storage/schema.ts`              | Simpler than migration logic for a local dev tool  |
| File pruning + dependent fan-out                | `src/indexer/index-codebase.ts`      | Handles deleted files between indexing runs        |
| `buildStructuredToolResult` with `outputSchema` | `src/mcp/tools.ts`                   | MCP structured content support                     |
| `guidance` string on empty results              | `src/mcp/server.ts`                  | Agent-actionable diagnostics                       |
| `RankedSearchResult` with `rankScore`           | `src/types.ts`, `src/search/rank.ts` | Observable ranking signal                          |

### Items Intentionally Not Implemented

1. **Nested workspace deployment** — superseded by extraction; see ADR-0089
2. **`tree-sitter-wasms` dependency** — replaced by native packages with custom WASM loading
3. **TDD hook wiring into papai `.hooks/`** — not applicable for standalone repo
4. **Root `codeindex:*` scripts in papai `package.json`** — not applicable for standalone repo

---

## Future Tiers and Layers

The Tier 1 spec's "Future Layers" section identified two forward directions. These are not scheduled work; they are intentionally scoped-out areas.

### Layer 2: Embeddings

- **`symbol_embeddings` table** keyed by `symbol_id`
- Hybrid ranking fusing FTS and vector hits
- Reuse papai-style OpenAI-compatible embedding DI patterns

### Layer 3: Richer Dependency Graph

- Multi-hop blast radius queries (building on `symbol_references`)
- Path search between symbols
- Execution or ownership overlays
- Graph visualization

### Tier 2 Extraction Gaps (Spec-Level, Not Layer-Level)

The Tier 1 spec also scoped out certain TypeScript features as "fixture gaps tracked as follow-up":

- TypeScript decorators (`@Injectable`, etc.)
- Ambient declarations (`declare function`, `declare class`)
- `declare module 'name' { ... }` augmentations
- Standalone `.d.ts` declaration files
- Type-only `export type` / `import type` statements

These parse without throwing (tree-sitter-typescript handles the syntax) but may be skipped, mis-tiered, or under-indexed. A future tier should address these before relying on the index for decorator-heavy code or declaration-file workflows.

---

## Related Decisions

- **ADR-0083**: Enrich codeindex search ergonomics for agents — search quality improvements (`rankScore`, structured content, `guidance`)
- **ADR-0089**: Codeindex portability and test isolation — extraction from nested workspace to standalone repository
- **ADR-0104**: Fix codeindex lint failures — `no-conditional-in-test` remediation in the standalone repo

## References

- Archived spec: `docs/archive/2026-04-14-codeindex-tier1-design.md`
- Archived plan: `docs/archive/2026-04-14-codeindex-tier1-implementation.md`
- Standalone repo: `~/Projects/yourpapai/codeindex` (or sibling `../codeindex` from papai)
- Papai integration wrappers: `scripts/codeindex-cli.ts`, `scripts/codeindex-cli-support.ts`
- Future tiers note: `docs/superpowers/notes/codeindex-future-tiers.md`
- MCP registration: `.mcp.json`
