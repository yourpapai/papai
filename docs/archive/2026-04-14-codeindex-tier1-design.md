# codeindex: Tier 1 Symbol Index for AI Agents

**Date:** 2026-04-14
**Status:** Proposed
**Scope:** Tier 1 - TypeScript/JavaScript-first symbol index + FTS5 keyword search + MCP server
**Approach:** Symbol-first, TS-aware, resolver-backed search

## Summary

Build a standalone Bun/TypeScript tool called `codeindex` under `codeindex/` at the papai repo root. It will index TypeScript, JavaScript, TSX, and JSX repositories into a local SQLite database optimized for three Tier 1 query classes:

- exact symbol lookup
- concept-to-code lookup without embeddings
- impact and dependency lookup

The index is symbol-first instead of chunk-first. Tree-sitter extracts symbol structure and reference candidates. A project-aware resolver then resolves imports, exports, re-exports, barrel files, default exports, and `tsconfig` path aliases as far as possible without requiring a full TypeScript type-checker pass. Search is powered by SQLite FTS5 plus deterministic structural reranking. The tool is exposed through a local MCP server over stdio for Claude Code, OpenCode, and other MCP hosts.

This design is inspired by tools such as codemogger, llm-tldr, and Lumen, but it is tuned for papai's Bun workflow and local SQLite-friendly developer tooling.

## Why This Revision Exists

The earlier draft was directionally useful, but it had several problems that would hurt a real Tier 1 implementation:

- it described papai's storage stack incorrectly as `drizzle + better-sqlite3`; this repo uses Bun and `bun:sqlite`, with `drizzle-orm/bun-sqlite` for the application database
- it treated generic chunks as the primary unit, which weakens exact lookup, symbol identity, and impact precision
- it described FTS5 ranking using caret-style field boosts instead of SQLite's actual `bm25(...)` ranking model
- it relied on substring matching for impact analysis, which is too fuzzy for the chosen precision target
- it advertised `semantic` and `auto` MCP search modes before embeddings exist, which creates surface area without value

This revision corrects those issues and narrows Tier 1 around the highest-value retrieval path: precise structural search for TS/JS repositories.

## Project Fit

- project lives in `codeindex/` at the papai repo root
- separate `package.json` and `tsconfig.json` so it can be extracted later
- not a papai runtime dependency; it is local developer infrastructure
- SQLite access uses `bun:sqlite` directly for FTS-heavy queries and low-friction local deployment
- embeddings are deferred, but the design leaves a clean migration path to a later Layer 2 using the same local database file

## Goals

- optimize Tier 1 for TypeScript, JavaScript, TSX, and JSX repositories first
- index all named symbols, including nested functions, local functions, and variables
- rank exported and module-level symbols ahead of members and locals by default
- resolve imports and references with project-aware logic instead of raw lexical matching
- improve concept-to-code lookup using identifier normalization and doc comments without embeddings
- provide precise impact results based on resolved symbol identities wherever possible
- support fast incremental reindexing for changed files and their narrow dependency fan-out
- keep MCP responses compact enough for agent workflows

## Non-Goals

- vector embeddings or semantic similarity search
- CFG, DFG, PDG, or full static-analysis layers
- browser visualization or graph UI
- language server protocol support
- full type-checker-backed semantic resolution of every runtime edge
- framework-specific virtual wiring such as dependency injection containers, decorator registries, or generated route maps

## Research Notes

- codemogger is a strong reference for AST-aware semantic units, incremental hashing, and local SQLite-backed code search
- llm-tldr is a strong reference for deeper structural analysis layers, but Tier 1 intentionally stops well before CFG, DFG, and PDG territory
- Lumen is a useful reminder that benchmark discipline matters; its public benchmark claims should be used as motivation for later evaluation design, not as a direct implementation template

Public benchmark numbers and license metadata can be inconsistent across package registries, repo metadata, and mirrored docs. This spec intentionally avoids making architectural decisions that depend on ambiguous third-party metadata.

## Chosen Direction

Tier 1 will be a **TypeScript/JavaScript-first symbol index**, not a generic code chunk store.

The primary storage unit is a symbol record. Search snippets remain useful, but they are derived artifacts attached to symbols, not the core identity model. Impact analysis is driven by resolver-backed symbol references with explicit confidence levels. Unresolved-name fallback exists as a hinting mechanism, not as the primary truth model.

## Architecture

```text
codeindex/
  src/
    cli.ts                     # CLI entrypoint
    config.ts                  # .codeindex.json loading and validation
    indexer/
      discover.ts              # root walking, gitignore/exclude handling
      parse.ts                 # tree-sitter parse orchestration
      extract-symbols.ts       # symbol extraction + doc comment capture
      extract-references.ts    # import/export/reference candidate extraction
      resolve-references.ts    # TS-aware project resolution
      index-codebase.ts        # full and incremental indexing pipeline
    resolver/
      module-specifiers.ts     # relative paths, index files, extension rules
      tsconfig-paths.ts        # tsconfig baseUrl / paths support
      exports.ts               # export map + re-export traversal
    storage/
      db.ts                    # bun:sqlite connection + pragmas
      schema.ts                # tables, indexes, triggers, migrations
      queries.ts               # search, impact, stats queries
    search/
      exact.ts                 # exact-name and exact-path search pass
      fts.ts                   # FTS5 query construction
      rank.ts                  # deterministic structural reranking
    mcp/
      server.ts                # MCP server wiring over stdio
      tools.ts                 # code_search, code_symbol, code_impact, code_index
  .codeindex.json              # per-project config
  .codeindex/                  # SQLite db, cache, and metadata (gitignored)
```

### Data Flow

```text
Source files
  -> discover
  -> tree-sitter parse
  -> symbol extraction
  -> reference candidate extraction
  -> TS-aware resolution
  -> SQLite tables + FTS5 index
  -> MCP server over stdio
  -> Claude Code / OpenCode / other MCP clients
```

## Data Model

Tier 1 uses five primary tables (`files`, `module_aliases`, `symbols`, `module_exports`, `symbol_references`) plus one FTS5 virtual table (`symbol_fts`).

### `files`

Tracks per-file indexing state and module identity.

```sql
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL UNIQUE,
  module_key TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  parse_status TEXT NOT NULL, -- indexed | parse_failed | unsupported | skipped
  parse_error TEXT,
  indexed_at TEXT NOT NULL
);
```

`module_key` is the canonical repo-relative module identity for the file itself. It is extensionless, but it does not collapse `index.ts` automatically. For example:

- `src/db/drizzle.ts -> src/db/drizzle`
- `src/foo/index.ts -> src/foo/index`

Import-facing aliases such as `src/foo` are tracked separately so the resolver can distinguish canonical file identity from import shorthand.

### `module_aliases`

Maps importable module aliases to concrete files.

```sql
CREATE TABLE module_aliases (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  alias_key TEXT NOT NULL,
  alias_kind TEXT NOT NULL, -- extensionless | index_collapse | tsconfig_path
  precedence INTEGER NOT NULL
);

CREATE INDEX idx_module_aliases_alias_key ON module_aliases(alias_key);
CREATE INDEX idx_module_aliases_file_id ON module_aliases(file_id);
```

This table is what allows the resolver to map imports such as `src/foo`, `@/db/drizzle`, or other path-alias forms onto the correct file without overloading `files.module_key`.

### `symbols`

One row per named symbol occurrence.

```sql
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  module_key TEXT NOT NULL,
  symbol_key TEXT NOT NULL UNIQUE, -- snapshot-scoped identity: <file>#<start_byte>-<end_byte>
  local_name TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope_tier TEXT NOT NULL, -- exported | module | member | local
  parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  is_exported INTEGER NOT NULL,
  export_names TEXT NOT NULL, -- JSON array
  signature_text TEXT NOT NULL,
  doc_text TEXT NOT NULL,
  body_text TEXT NOT NULL,
  identifier_terms TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte INTEGER NOT NULL
);

CREATE INDEX idx_symbols_local_name ON symbols(local_name);
CREATE INDEX idx_symbols_qualified_name ON symbols(qualified_name);
CREATE INDEX idx_symbols_scope_tier ON symbols(scope_tier);
CREATE INDEX idx_symbols_file_id ON symbols(file_id);
CREATE INDEX idx_symbols_parent_symbol_id ON symbols(parent_symbol_id);
```

Design notes:

- `symbol_key` is precise enough for one index snapshot and for MCP round-tripping, but it is not promised as a permanent cross-commit identifier
- `qualified_name` is human-friendly and stable enough for disambiguation, for example `src/db/drizzle#getDrizzleDb` or `src/foo#outer>inner`
- `identifier_terms` stores normalized search text such as `task provider resolver get drizzle db storage context id`
- `body_text` is a compact search payload, not necessarily the full symbol body for very large symbols

### `module_exports`

First-class export map for named exports, default exports, namespaces, and re-exports.

```sql
CREATE TABLE module_exports (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  export_name TEXT NOT NULL,
  export_kind TEXT NOT NULL, -- named | default | namespace | reexport
  symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  target_module_specifier TEXT,
  resolved_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL
);

CREATE INDEX idx_module_exports_file_id ON module_exports(file_id);
CREATE INDEX idx_module_exports_export_name ON module_exports(export_name);
CREATE INDEX idx_module_exports_symbol_id ON module_exports(symbol_id);
CREATE INDEX idx_module_exports_resolved_file_id ON module_exports(resolved_file_id);
```

This table is what makes barrel files, aliased exports, and re-export chains queryable without fuzzy heuristics.

### `symbol_references`

Resolver-backed edges between symbols. The table is named `symbol_references` rather than `references` because `REFERENCES` is a reserved constraint keyword in SQLite and unquoted use of it as a table identifier is brittle across SQLite versions and query parsers.

```sql
CREATE TABLE symbol_references (
  id INTEGER PRIMARY KEY,
  source_symbol_id INTEGER REFERENCES symbols(id) ON DELETE CASCADE,
  source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  target_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL,
  target_name TEXT NOT NULL,
  target_export_name TEXT,
  target_module_specifier TEXT,
  edge_type TEXT NOT NULL, -- imports | reexports | calls | extends | implements | references
  confidence TEXT NOT NULL, -- resolved | file_resolved | name_only
  line_number INTEGER NOT NULL
);

CREATE INDEX idx_symbol_references_source_symbol_id ON symbol_references(source_symbol_id);
CREATE INDEX idx_symbol_references_target_symbol_id ON symbol_references(target_symbol_id);
CREATE INDEX idx_symbol_references_target_name ON symbol_references(target_name);
CREATE INDEX idx_symbol_references_edge_type ON symbol_references(edge_type);
CREATE INDEX idx_symbol_references_confidence ON symbol_references(confidence);
```

`confidence` is mandatory. Tier 1 must distinguish exact resolution from fallback hints.

`source_symbol_id` is nullable for file-scoped `imports` and `reexports` edges that do not belong to one enclosing symbol. Those edges are still queryable through `source_file_id` and should be returned as module-level importers.

### `symbol_fts`

FTS5 index over symbol search fields.

```sql
CREATE VIRTUAL TABLE symbol_fts USING fts5(
  local_name,
  qualified_name,
  export_names,
  identifier_terms,
  signature_text,
  doc_text,
  body_text,
  file_path,
  content='symbols',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 1 tokenchars ''_-''',
  prefix='2 3'
);
```

Why this shape:

- `unicode61` is a better default for code than `porter`; stemming helps prose more than identifiers
- identifier normalization happens in application code, not by hoping the tokenizer understands camelCase
- prefix indexes improve short identifier-prefix queries without requiring trigram-style indexing

Trigger shape should follow SQLite external-content-table guidance and include insert, update, and delete synchronization triggers.

## Indexing Pipeline

Indexing is a multi-stage pipeline.

### 1. Discover

- walk configured roots from `.codeindex.json`
- honor `.gitignore` and explicit exclude globs
- skip generated, vendor, build, and coverage trees by default
- detect language from file extension

Tier 1 supported languages:

- `.ts`
- `.tsx`
- `.js`
- `.jsx`

### 2. Parse

- parse with tree-sitter
- capture parse failures without aborting the full run
- store `parse_status` per file

Tier 1 parser choice is tree-sitter because it provides stable syntax trees across TS/JS variants and does not require full compiler involvement just to extract structure.

### 3. Module Analysis

Extract per-file module metadata before symbol resolution:

- import specifiers
- export declarations
- re-exports
- default export shape
- canonical module identity
- import-facing module aliases
- `tsconfig` `baseUrl` and `paths` rules
- index-file module collapsing such as `foo/index.ts -> foo`

Tier 1 may use TypeScript's module-resolution rules or an equivalent compatibility layer for path and extension resolution, but it does not require the full type checker.

### 4. Symbol Extraction

Index all named symbols, including:

- exported and non-exported top-level functions
- classes, interfaces, type aliases, enums, and top-level variables
- class methods and named class properties where meaningful
- object-literal members that act like API surface
- nested and local named functions
- named local variables

Extraction rules:

- capture nearest leading JSDoc, TSDoc, or leading block comment as `doc_text`
- do not index arbitrary inline comments or general string literals in Tier 1
- keep one symbol identity per declaration; do not split a symbol into multiple chunk identities just because it is large
- for very large symbols, clip `body_text` to a bounded search payload and rely on file reads for the full body later

### 5. Reference Candidate Extraction

Collect resolver candidates for:

- imports
- re-exports
- calls
- `extends`
- `implements`
- general named symbol references inside bodies

Tier 1 should prefer one accurate `symbol_references` edge over many overly-specific but unreliable subtypes.

### 6. Resolution

Resolve candidates in descending confidence:

1. exact in-file lexical binding
2. exact module export resolution
3. barrel and re-export traversal
4. `tsconfig` path alias expansion
5. file-level fallback when target file is known but symbol is ambiguous
6. unresolved name-only fallback

The result is always stored with a `confidence` value. Name-only fallback is useful, but it must remain visibly lower-confidence than real symbol resolution.

### 7. Persist

- upsert changed `files`
- replace that file's `symbols`, `module_exports`, and `symbol_references` in a transaction
- update `symbol_fts` through external-content triggers
- mark parse failures explicitly instead of leaving stale rows in place

### Incremental Reindexing

Primary unit: file hash.

When file contents change:

- reparse the changed file
- recompute its module export map
- identify narrow dependent files whose reference resolution may now differ
- rerun reference resolution for that dependent set without reparsing the whole repo

Dependent files include:

- files importing the changed module
- files re-exporting from the changed module
- barrel files affected by changed export maps

This is more precise than full-project rebuilds and more correct than only reparsing the changed file.

## Search Design

Tier 1 search is balanced across exact lookup, concept lookup, and impact workflows.

### Search Inputs

Search should work over:

- `local_name`
- `qualified_name`
- `export_names`
- normalized `identifier_terms`
- `signature_text`
- `doc_text`
- `body_text`
- `file_path`

### Query Normalization

Normalize user queries into multiple forms:

- original query
- quoted exact query when it looks like a symbol or path
- identifier-split terms such as `getDrizzleDb -> get drizzle db`
- path-friendly forms for queries containing `/`, `.`, or `#`

### Two-Pass Retrieval

Tier 1 should use two retrieval passes.

#### Pass 1: exact and structured lookup

Match against:

- exact `local_name`
- exact `qualified_name`
- exact export name
- exact or prefix `file_path`

This pass is what makes direct identifier lookup feel precise.

#### Pass 2: FTS5 keyword search

Use FTS5 for broader lexical search across code-derived text and doc comments.

Ranking should use SQLite `bm25(symbol_fts, ...)` with column weights that strongly prefer symbol-identifying fields over body text. Representative priority order:

- `local_name`
- `qualified_name`
- `export_names`
- `identifier_terms`
- `signature_text`
- `doc_text`
- `body_text`
- `file_path`

### Structural Reranking

After merging exact and FTS candidate sets, apply deterministic reranking.

Higher priority:

- exact export or exact qualified-name hits
- exported symbols
- module-level internal symbols
- resolved cross-file references

Lower priority:

- member-level symbols when a better top-level match exists
- local variables and local nested helpers
- unresolved name-only matches

This is the main mechanism that preserves recall while preventing local variables from overwhelming more useful public results.

### Result Shape

Each search result should include:

- `symbol_key`
- `qualified_name`
- `local_name`
- `kind`
- `scope_tier`
- `file_path`
- `start_line`
- `end_line`
- `export_names`
- `match_reason`
- `confidence`
- compact snippet

Search results should not return full symbol bodies by default.

## Impact Analysis

Impact should be symbol-oriented, not raw-string-oriented.

### `code_symbol`

New Tier 1 tool recommended for identity resolution.

Purpose:

- resolve a human query into one or more candidate symbols
- return disambiguation candidates before expensive impact queries

Examples:

- `TaskProviderResolver`
- `src/db/drizzle.ts#getDrizzleDb`
- `default export from src/foo/bar.ts`

### `code_impact`

Primary input should be `symbol_key` or `qualified_name`, not a bare string where possible.

Behavior:

- return incoming edges grouped by `edge_type`
- prefer resolved `target_symbol_id` matches
- include `confidence` on every returned row
- return module-level importers when `source_symbol_id` is null
- when the request is ambiguous, return candidate symbols instead of blending unrelated results

This is the main correction to the earlier draft. Substring matching is acceptable only as an explicitly-labeled fallback, not as the default impact engine.

## MCP Surface

Tier 1 should expose a small and honest tool surface.

### `code_search`

Search indexed symbols.

Parameters:

- `query: string`
- `limit?: number`
- `kinds?: string[]`
- `scopeTiers?: string[]`
- `pathPrefix?: string`

Returns ranked symbol hits with structured metadata.

### `code_symbol`

Resolve a human query to candidate symbols.

Parameters:

- `query: string`
- `limit?: number`

Returns candidate symbol identities with confidence and disambiguation context.

### `code_impact`

Find incoming references for a specific symbol.

Parameters:

- `symbolKey?: string`
- `qualifiedName?: string`
- `limit?: number`

If neither `symbolKey` nor `qualifiedName` is provided, return an input error. If more than one symbol matches the request, return candidates rather than merged results.

### `code_index`

Run full or incremental indexing.

Parameters:

- `path: string`
- `mode?: 'full' | 'incremental'`

Returns indexed file counts, symbol counts, reference counts, parse failures, and elapsed time.

### No Tier 1 `semantic` Mode

Tier 1 should not expose `semantic` or `auto` search modes. Those names should be introduced only when embeddings actually exist.

## Configuration

Example `.codeindex.json`:

```json
{
  "roots": ["src", "client"],
  "exclude": ["node_modules", "dist", ".git", "coverage", "**/*.test.*", "**/*.spec.*"],
  "languages": ["ts", "tsx", "js", "jsx"],
  "dbPath": ".codeindex/index.db",
  "indexLocals": true,
  "indexVariables": true,
  "includeDocComments": true,
  "maxStoredBodyLines": 120,
  "tsconfigPaths": ["tsconfig.json"]
}
```

Key fields:

- `roots`: repo-relative roots to index
- `exclude`: additional glob patterns to skip
- `languages`: enabled file extensions
- `dbPath`: SQLite file path under `.codeindex/`
- `indexLocals`: whether to keep local/nested symbols in the index
- `indexVariables`: whether named variables are first-class symbols
- `includeDocComments`: whether leading doc comments are indexed
- `maxStoredBodyLines`: clip size for `body_text`
- `tsconfigPaths`: `tsconfig` files consulted for path-alias resolution

## CLI

```bash
codeindex index .
codeindex reindex .
codeindex search "auth"
codeindex symbol "TaskProviderResolver"
codeindex impact "src/db/drizzle#getDrizzleDb"
codeindex stats
codeindex mcp
```

## Host Integration

### OpenCode

OpenCode supports local MCP servers via `mcp.<name>.type = "local"` and a command array.

Illustrative config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "codeindex": {
      "type": "local",
      "command": ["bun", "run", "/path/to/codeindex/src/cli.ts", "mcp"],
      "enabled": true
    }
  }
}
```

### Claude Code

Claude Code supports stdio MCP servers either through `.mcp.json` or via the CLI. The lowest-risk onboarding path is the documented CLI command:

```bash
claude mcp add --transport stdio codeindex -- \
  bun run /path/to/codeindex/src/cli.ts mcp
```

Implementation should verify the final shared-config format at build time rather than copying older example JSON blindly.

## Error Handling

Tier 1 favors a usable partial index over all-or-nothing failure.

- one file parse failure must not abort the full indexing run
- file status is explicit: `indexed`, `parse_failed`, `unsupported`, or `skipped`
- failed reindex of a changed file must not silently leave stale symbol rows pretending to be current
- unresolved references are stored as lower-confidence edges, not as hard failures
- startup should fail fast if the local SQLite build cannot create the required FTS5 table
- MCP indexing responses should include partial-success counts such as `filesIndexed`, `filesFailed`, and `referencesUnresolved`

Database behavior:

- enable `PRAGMA journal_mode=WAL`
- enable `PRAGMA foreign_keys=ON`
- use transactions for each indexing batch

## Testing

### Parser and Extraction Tests

- TS, JS, TSX, and JSX fixture files
- symbol extraction for exports, members, nested functions, locals, and variables
- doc comment capture behavior

### Resolver Tests

- relative imports
- `index.ts` barrels
- named re-exports
- default exports
- `tsconfig` path aliases

### Search Tests

- exact symbol lookup beats similar locals
- normalized identifier lookup works for camelCase, snake_case, and kebab-case
- concept lookup can find relevant symbols through identifier terms and doc comments

### Impact Tests

- resolved callers/importers are returned with `confidence = resolved`
- ambiguous symbol names trigger disambiguation instead of blended results
- name-only fallback is clearly labeled and ranked lower

### Incremental Reindex Tests

- unchanged files are not reparsed
- changed files replace old symbol rows atomically
- narrow dependency fan-out is updated when export maps change

### MCP Smoke Tests

- server starts over stdio
- tools list correctly
- `code_search`, `code_symbol`, `code_impact`, and `code_index` return valid structured responses

## Acceptance Criteria

Tier 1 is done when all of the following are true on fixture repositories:

- exact symbol lookup returns the intended symbol as the top hit for representative queries
- concept-to-code queries return at least one materially relevant symbol in the top result set without embeddings
- impact queries prefer resolved symbol identities and visibly label fallbacks
- incremental reindex updates changed files and narrow dependents without full rebuilds
- MCP results are compact enough to be usable in agent sessions

## Efficiency Improvements Over The Earlier Draft

- symbol-first indexing instead of chunk-first indexing
- project-aware TS/JS module resolution instead of lexical-only edges
- identifier normalization for concept lookup without embeddings
- scope-aware ranking that keeps locals searchable but lower-priority
- confidence-scored references instead of substring-based impact logic
- two-pass search: exact first, FTS second
- clipped search payloads for very large symbols instead of splitting symbols into artificial chunks
- partial reindex with targeted dependency reconciliation instead of naive file-only updates

## Future Layers

### Layer 2: Embeddings

Future semantic search can be added without rewriting Tier 1 by attaching embeddings to symbols rather than replacing symbol identity.

Candidate additions:

- `symbol_embeddings` table keyed by `symbol_id`
- hybrid ranking that fuses FTS and vector hits
- reuse of papai-style OpenAI-compatible embedding DI patterns where helpful

### Layer 3: Richer Dependency Graph

Future graph work should build on `symbol_references`, not replace it.

Candidate additions:

- multi-hop blast radius queries
- path search between symbols
- execution or ownership overlays
- graph visualization

## Decision Log

| Decision                                             | Rationale                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Symbol-first model over chunk-first model            | Better exact lookup, stronger impact analysis, cleaner future embedding attachment |
| TypeScript/JavaScript-first Tier 1                   | Highest retrieval precision for the immediate use case                             |
| All named symbols indexed                            | Preserves recall for local and nested logic without hiding useful internals        |
| Exported and module-level symbols ranked first       | Prevents locals and variables from flooding results                                |
| Doc comments included, arbitrary comments excluded   | Improves concept lookup without introducing too much noise                         |
| `bun:sqlite` direct usage for codeindex DB           | Simpler for FTS-heavy local tooling than forcing ORM usage                         |
| `unicode61` + identifier normalization over `porter` | Better fit for code tokens and structured identifiers                              |
| `code_symbol` added in Tier 1                        | Improves identity resolution for impact and follow-on workflows                    |
| No Tier 1 `semantic` or `auto` modes                 | Keeps the MCP contract honest until embeddings exist                               |
| Confidence-scored resolver-backed references         | Stronger precision than substring-based reverse lookup                             |

## Implementation Notes For Later Planning

- validate the final MCP SDK package surface at implementation time and use the current official TypeScript MCP server package, not stale snippets; verify version and export layout via `context7` before pinning
- source tree-sitter grammars as **WASM** (for example `tree-sitter-wasms` or `@vscode/tree-sitter-wasm`), not the native `tree-sitter-typescript` / `tree-sitter-javascript` Node bindings; the native packages do not ship the `.wasm` files required by `web-tree-sitter`
- validate final host integration examples against current Claude Code and OpenCode docs before shipping install instructions
- benchmark against representative query fixtures, not just raw indexing speed
- never name a table `references` — it collides with SQLite's reserved `REFERENCES` keyword; use `symbol_references`
