# Codeindex Search Quality Improvements Design

**Date:** 2026-05-14
**Scope:** Improve `codeindex` search quality for exploratory symbol discovery, with emphasis on candidate recall before ranking.
**Primary Goal:** Make `code_search` much more reliable for concept-like, symbol-like, and path-like queries without changing the public MCP tool surface.
**Non-Goal:** Add new languages, redesign the resolver graph, introduce embeddings, or pursue parser-level performance optimization in this phase.

---

## Context

`codeindex` already has a sound Tier 1 architecture:

- exact-first lookup through `code_symbol`
- exploratory lookup through `code_search`
- SQLite FTS5-backed search
- deterministic reranking over exact and FTS candidates
- MCP exposure through `code_search`, `code_symbol`, `code_impact`, and `code_index`

The main weakness is not the overall architecture. It is the first half of the search pipeline: candidate generation.

Current behavior shows several concrete limitations:

1. exact retrieval is narrow
   - `codeindex/src/search/exact.ts` only checks `local_name`, `qualified_name`, exact export names, and a simple `file_path LIKE ?` prefix path match.
2. FTS query shaping is shallow
   - `codeindex/src/search/fts.ts` sanitizes syntax-heavy input, then turns multi-token queries into a broad `OR` query.
   - this avoids parse failures, but it weakens intent and can miss symbol-shaped queries that need normalized variants rather than simple token splitting.
3. indexed search terms are symbol-centric but still sparse for real-world agent queries
   - the FTS table indexes `local_name`, `qualified_name`, `export_names`, `identifier_terms`, `signature_text`, `doc_text`, `body_text`, and `file_path`.
   - it does not give first-class search support to module aliases, canonical module identity, segmented path terms, or additional normalized identifier variants.
4. no staged fallback retrieval exists after exact and FTS
   - if both passes miss, the system only returns an empty result plus generic guidance.
5. diagnostics are too generic
   - empty `code_search` guidance currently suggests broadening terms, but it does not explain whether the query looked like a symbol, path, or concept, nor which retrieval stages failed.

In practice, this means `codeindex` is already decent when the caller knows the exact symbol name, but less reliable when the caller searches with natural concepts, mixed identifier fragments, path-shaped hints, or partially remembered names.

---

## Decision

Introduce a recall-first search pipeline for `code_search` while keeping the current MCP tool names and top-level semantics intact.

The improved pipeline will:

1. classify and normalize the incoming query before retrieval
2. enrich indexed search text with more search-friendly variants
3. run retrieval as staged passes instead of one exact pass plus one broad FTS pass
4. preserve deterministic ranking, but augment it with stage-aware signals
5. produce more actionable miss diagnostics when retrieval still fails

The most important rule for this phase is:

**candidate recall improves first, ranking only improves enough to support the richer candidate set.**

---

## Design Principles

1. **Recall before ranking**
   If the correct symbol never enters the candidate set, better reranking cannot help.
2. **Stable public surface**
   The `code_search` MCP input contract should remain unchanged in this phase.
3. **Deterministic over clever**
   Query shaping, fallbacks, and ranking must be explainable and testable. No embeddings and no opaque model-driven ranking.
4. **Symbol-first stays intact**
   Search remains grounded in symbol records, not generic file chunks.
5. **Cheap fallbacks before expensive ones**
   Retrieval should move from precise indexed paths toward broader heuristics in a controlled order.
6. **Search behavior should be inspectable**
   Misses should reveal what was attempted and what kind of query the system believed it saw.

---

## Current Gaps To Fix

The spec targets four concrete user-visible failures.

### 1. Symbol-shaped queries miss obvious candidates

Examples:

- `buildUserTurnMessages`
- `resolveMattermostUserId`
- `getDrizzleDb()`
- `src/db/drizzle#getDrizzleDb`

These queries may include camelCase, punctuation, qualified-name fragments, or remembered call syntax. Today they rely too heavily on exact equality or broad FTS token matching.

### 2. Concept queries underperform

Examples:

- `mattermost user identity`
- `attachment relay`
- `task provider resolver`

These depend on the quality of `identifier_terms`, `doc_text`, and `body_text`, but the current term set is not rich enough to consistently bridge concept phrasing to symbols.

### 3. Path-like hints are not fully exploited

Examples:

- `src/chat/mattermost`
- `attachments index`
- `resolver module specifiers`

The current exact path lookup is only a simple file path prefix. It does not take advantage of canonical module keys, alias forms, or segmented path tokens.

### 4. Miss behavior is opaque

When no results are found, the user does not learn whether the system:

- interpreted the query as a symbol lookup
- stripped important punctuation
- found weak candidates but filtered them out
- failed because the indexed terms were too sparse

---

## Proposed Architecture

The improved search flow should look like this:

```text
raw query
  -> query classification
  -> query normalization + variant generation
  -> staged candidate retrieval
     1. exact direct match
     2. normalized exact/alias/path match
     3. structured FTS retrieval
     4. constrained fallback substring retrieval
  -> deterministic reranking with stage-aware boosts
  -> result truncation
  -> guidance / diagnostics when needed
```

This remains a search subsystem change. It does not require a new MCP tool or a new storage engine.

---

## Query Classification And Normalization

Add a small query-analysis module ahead of retrieval.

Suggested file:

- `codeindex/src/search/query-shaping.ts`

Its job is to convert one raw query into a structured form that later stages can use consistently.

### Query Classes

The classifier should assign one primary class:

- `symbol_like`
  - mostly identifier-shaped tokens
  - examples: `buildUserTurnMessages`, `resolve_user`, `getDrizzleDb()`
- `qualified_like`
  - includes `#`, `>`, path separators, or module-like prefixes
  - examples: `src/db/drizzle#getDrizzleDb`, `src/foo#outer>inner`
- `path_like`
  - mostly file/module path hints
  - examples: `src/chat/mattermost`, `attachments/index`
- `concept_like`
  - ordinary word phrases
  - examples: `mattermost user identity`
- `mixed`
  - combination of concept text and identifier/path fragments

The classifier should not attempt machine-learning-style intent inference. Simple deterministic heuristics are enough.

### Normalized Variants

For each query, generate reusable variants such as:

- raw text
- stripped punctuation form
- identifier-fragment form
- camelCase / PascalCase split terms
- underscore and dash split terms
- exact phrase token list
- path segments
- module-style form with `#` and `>` preserved separately

Example:

`getDrizzleDb()` should yield variants close to:

- `getDrizzleDb`
- `get drizzle db`
- `drizzle db`

Example:

`src/db/drizzle#getDrizzleDb` should yield variants close to:

- module key: `src/db/drizzle`
- symbol fragment: `getDrizzleDb`
- combined search terms: `src db drizzle get drizzle db`

This normalization layer is the main bridge between user phrasing and deterministic retrieval.

---

## Indexed Term Enrichment

Current FTS storage is close to sufficient, but it needs richer search-oriented text.

### New Searchable Data To Add

Augment symbol search records with the following derived fields:

1. `module_terms`
   - normalized tokens from `module_key`
   - example: `src db drizzle`
2. `path_terms`
   - normalized tokens from `file_path`
   - similar to `module_terms`, but preserves file-name distinctions
3. `alias_terms`
   - normalized tokens from `module_aliases.alias_key`
   - useful for `tsconfig` path aliases and index-collapse forms
4. `export_terms`
   - normalized export-name variants beyond raw JSON `export_names`
5. richer `identifier_terms`
   - preserve current behavior, but improve splitting and deduplication for camelCase, acronyms, numbers, and repeated fragments

### Storage Strategy

Do not create a separate search engine or detached secondary index in this phase.

Use this storage approach:

1. add derived text columns to `symbols`
2. include those columns in `symbol_fts`
3. populate alias-derived search text during indexing so runtime search stays row-local and query-simple

This choice keeps retrieval on one primary symbol row model and avoids runtime join-heavy query construction.

### Why This Helps

This enrichment directly addresses recall gaps for:

- path and module hints
- alias-based imports
- concept phrasing that overlaps path or export vocabulary
- partially remembered identifiers

---

## Staged Candidate Retrieval

Replace the current two-pass retrieval model with a staged pipeline.

Suggested module structure:

- `codeindex/src/search/exact.ts`
- `codeindex/src/search/fts.ts`
- `codeindex/src/search/fallback.ts`
- `codeindex/src/search/query-shaping.ts`
- `codeindex/src/search/index.ts`

### Stage 1: Direct Exact Match

Retain the existing exact behavior as the first pass for:

- `local_name`
- `qualified_name`
- exact export name
- file path prefix

This preserves today’s best-case exact performance.

### Stage 2: Normalized Exact Match

Add a second exact-style pass over normalized variants and extra indexed fields:

- normalized module key equality or prefix match
- normalized alias equality or prefix match
- exact token-preserving symbol variants without punctuation noise
- file-name stem and module stem equality

This stage is especially important for queries such as:

- `getDrizzleDb()`
- `src/db/drizzle`
- `@/db/drizzle`

### Stage 3: Structured FTS Retrieval

Replace the current one-size-fits-all FTS query building with query-class-aware FTS construction.

Examples:

- `concept_like`
  - prefer AND-like phrase retention first
  - relax to broader token combinations only if needed
- `symbol_like`
  - prefer identifier split terms with tighter matching
- `path_like`
  - prefer module/path-derived fields more heavily
- `mixed`
  - combine identifier and concept terms, but do not flatten immediately into one broad OR query

The important change is not exotic FTS syntax. It is using a more intentional sequence of FTS attempts.

### Stage 4: Constrained Fallback Retrieval

If the earlier indexed passes still underperform, add one last low-cost SQL fallback over limited text columns using controlled substring matching.

This fallback should be constrained to a small candidate window and should search only search-oriented text such as:

- `qualified_name`
- `local_name`
- `module_terms`
- `alias_terms`
- `identifier_terms`

It should not become a full file-content grep clone. Its purpose is to rescue near-miss structured queries, not to replace FTS.

### Deduplication

All stages should dedupe by `symbolKey`, preserving the strongest match metadata for each symbol.

---

## Ranking Changes

Ranking changes in this phase should be modest and deterministic.

### New Ranking Inputs

Add reranking signals for:

- retrieval stage
  - direct exact > normalized exact > structured FTS > fallback
- query class compatibility
  - path-like queries should prefer strong path/module hits
  - symbol-like queries should prefer identifier and qualified-name hits
- export relevance
  - exported and module-level symbols still rank above members and locals by default
- path proximity
  - if the query contains path/module hints, exact or prefix-aligned module matches should rise

### Deliberately Out Of Scope

Do not add repository-level importance scoring, PageRank-like authority, or usage-frequency ranking in this phase. Those are valid future ideas, but they are not required to make search materially better for agents now.

---

## Miss Diagnostics And Guidance

The current empty-result guidance is too generic.

Improve diagnostics so that empty or weak-result cases can explain:

- the detected query class
- the normalized form used for search
- which retrieval stages ran
- the recommended next adjustment

Examples:

- for `symbol_like` miss:
  - suggest `code_symbol` if the user appears to know the exact symbol name
- for `path_like` miss:
  - suggest narrowing `pathPrefix` or retrying with canonical repo-relative path segments
- for `concept_like` miss:
  - suggest broader noun phrases or fewer tokens

### MCP Surface Constraint

Do not introduce a new MCP tool for diagnostics in this phase.

Instead:

- keep using the current `guidance` field on empty `code_search` responses
- keep CLI command names and response shape unchanged in this phase
- keep the search API contract stable for agent consumers

---

## Schema And Storage Changes

This design requires a schema version bump.

Expected storage changes:

- extend `symbols` with search-derived text columns
- extend `symbol_fts` to index the new derived search fields
- rebuild FTS triggers accordingly

Because `codeindex/src/storage/schema.ts` already treats schema bumps as wipe-and-rebuild events, this is acceptable for the current local-developer-tooling model.

This phase should not attempt backward-compatible migration logic.

---

## CLI And MCP Behavior

### CLI

Keep the current commands:

- `index`
- `reindex`
- `search`
- `symbol`
- `impact`
- `stats`
- `mcp`

No new CLI commands are required for the first search-quality phase.

### MCP

Keep the existing MCP tool set unchanged:

- `code_search`
- `code_symbol`
- `code_impact`
- `code_index`

Behavior should improve through better internal retrieval, not through interface churn.

---

## Testing Strategy

This work should be test-first and concentrated around retrieval behavior.

### New Test Areas

1. `tests/codeindex/search/query-shaping.test.ts`
   - query classification
   - normalized variant generation
2. `tests/codeindex/search/exact.test.ts`
   - normalized exact matches
   - alias and module-key matches
3. `tests/codeindex/search/fts.test.ts`
   - query-class-aware FTS construction
   - symbol-like vs concept-like query behavior
4. `tests/codeindex/search/index.test.ts`
   - staged retrieval ordering
   - dedupe behavior
   - fallback rescue behavior
5. `tests/codeindex/mcp/server.test.ts` or `tests/codeindex/mcp.test.ts`
   - enriched guidance on empty results
6. `tests/codeindex/indexer/index-codebase.test.ts`
   - new derived search terms are persisted and searchable

### Required Regression Cases

The suite should include examples for:

- camelCase symbol search
- qualified-name search with `#` and `>`
- path-like search with slashes
- alias-based lookup
- concept-like phrase search
- punctuation-heavy symbol input such as `getDrizzleDb()`
- no-result diagnostics

---

## Rollout Plan

Implement in four ordered slices.

### Slice 1: Query shaping

- add classifier and normalization layer
- keep current storage unchanged
- adapt exact and FTS retrieval to use normalized variants

### Slice 2: Indexed term enrichment

- extend schema and FTS payloads
- reindex support through normal rebuild path
- add tests for new searchable fields

### Slice 3: Staged fallback retrieval

- add constrained fallback queries
- add dedupe and stronger match metadata

### Slice 4: Guidance and ranking polish

- improve guidance text
- add stage-aware reranking signals

This ordering keeps risk low. Early slices already provide visible search improvement before schema expansion and fallback complexity are fully complete.

---

## Risks And Mitigations

### Risk 1: Over-broad recall hurts precision

Mitigation:

- stage retrieval from strict to broad
- preserve deterministic reranking
- cap fallback influence below exact and strong FTS results

### Risk 2: Search logic becomes hard to reason about

Mitigation:

- isolate query shaping, staged retrieval, and ranking into separate modules
- keep tests focused on visible behavior per stage

### Risk 3: Schema enrichment makes indexing heavier

Mitigation:

- store only compact derived term text
- avoid duplicating full symbol bodies beyond existing payloads

### Risk 4: Diagnostics expose too much internal detail for MCP consumers

Mitigation:

- keep detailed diagnostic structures internal
- expose concise, action-oriented `guidance` strings externally

---

## Acceptance Criteria

This design is successful when:

1. `code_search` finds more correct candidates for exploratory and partially remembered queries.
2. symbol-like queries with punctuation or qualified-name fragments no longer fail as often.
3. path-like and alias-like hints reliably produce useful symbol results.
4. empty-result guidance becomes specific enough to suggest a better next query.
5. public MCP search inputs remain unchanged.

---

## Recommended Next Step

After this spec is approved, the implementation plan should follow the same slice order as the rollout plan:

1. query shaping
2. indexed term enrichment
3. staged fallback retrieval
4. guidance and ranking polish

That sequencing matches the actual weakness in the current system: recall first, polish second.
