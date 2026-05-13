# Codeindex Workspace

## Purpose

`codeindex/` is a standalone Bun workspace for symbol-first TypeScript/JavaScript indexing and MCP-backed code search. It is local developer tooling for agents and maintainers, not a papai runtime dependency.

## Storage

- The default database path is `.codeindex/index.db` relative to the indexed repo root.
- When you run the workspace from `/home/runner/work/papai/papai/codeindex`, that default lands at `codeindex/.codeindex/index.db`.
- SQLite runs in WAL mode via `openDatabase()`, so expect sibling `-wal` and `-shm` files while the database is open.
- The incoming-reference table is named `symbol_references`, not `references`, because `REFERENCES` is a SQLite keyword.

## Scripts

Run workspace commands from the repo root:

- `bun run codeindex:test`
- `bun run codeindex:typecheck`
- `bun run codeindex:lint`
- `bun run codeindex:format:check`

## TDD Hooks

The repo TDD resolver treats `codeindex/src/**` as gateable implementation code and maps it to `tests/codeindex/**`. Keep new codeindex implementation work aligned with the same test-first flow used under `src/`.

## Current Parser Setup

- `web-tree-sitter` bootstraps the parser runtime.
- The workspace currently loads grammar wasm files from `tree-sitter-javascript` and `tree-sitter-typescript`, which ship `.wasm` artifacts compatible with the current runtime.

## Search Semantics

- `code_symbol` is exact-first: returns exact local-name, qualified-name, and export-name matches before falling back to broader FTS search.
- `code_search` is the exploratory entrypoint and returns a mix of exact and FTS hits ranked by scope tier and match quality.
- Search results include a `rankScore` field reflecting the structural ranking (scope tier + match type).
- Exact-match previews come from stored source text (`body_text` / `signature_text`), not just `qualifiedName`.
- MCP tool responses include `structuredContent` alongside text so hosts can consume results without reparsing JSON.
- Empty `code_search` results include a `guidance` string suggesting next steps.
