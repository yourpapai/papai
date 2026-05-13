# Codeindex Search Ergonomics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `codeindex` results more useful to agents by aligning `code_symbol` with exact lookup, improving exact-match previews, surfacing ranking metadata and structured MCP outputs, and updating repo guidance to match the actual tool behavior.

**Architecture:** Keep the first pass schema-light. Reuse existing `symbols.signature_text`, `doc_text`, and `body_text` columns to improve previews instead of adding new tables. Make the search pipeline produce ranked search objects in one place, then have the MCP layer return those results as both text and `structuredContent` with explicit output schemas. Update `CLAUDE.md` only after the tool semantics and output shape are corrected.

**Tech Stack:** Bun, TypeScript, SQLite FTS5, Zod v4, `@modelcontextprotocol/sdk`, Bun test, oxfmt

---

## Validation Summary

- Validated: document `scopeTiers` and `kinds` usage in repo guidance. `codeindex/src/mcp/tools.ts` already exposes both filters, but the root `CLAUDE.md` search protocol never tells agents when to use them.
- Validated: fix `code_symbol` semantics. `codeindex/src/search/index.ts` currently implements `findSymbolCandidates()` by delegating straight to the same broad `searchSymbols()` pipeline used by `code_search`, so the current tool name and description overpromise exactness.
- Validated, refined: improve snippets for exact hits. `SearchResult.snippet` already exists in `codeindex/src/types.ts`, and FTS already fills it in `codeindex/src/search/fts.ts`; the real gap is `codeindex/src/search/exact.ts`, which currently uses `qualifiedName` as the exact-result snippet.
- Validated: MCP supports `structuredContent` and `outputSchema`, and the TypeScript SDK supports both via `registerTool(...)`, so richer machine-readable results are implementable without changing transports.
- Validated, but deferred from the first pass: per-file grouping/dedup mode and a lower global default `limit` are useful ideas, but they are lower priority than fixing exact lookup semantics, preview quality, and tool output structure.
- Rejected for this pass: broadly relaxing the `grep` prohibition in indexed source trees. The repo intentionally wants symbol-first navigation; fix the codeindex ergonomics first, then re-evaluate whether the rule still feels too strict.

## File Structure

| Path                             | Responsibility                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                      | Update the codebase search protocol so agents know when to use `code_symbol`, `code_search`, `code_impact`, `scopeTiers`, and `kinds` |
| `codeindex/CLAUDE.md`            | Add workspace-local expectations for exact symbol lookup, ranking metadata, and MCP structured outputs                                |
| `codeindex/src/types.ts`         | Add shared result types for ranked search results and MCP output payloads                                                             |
| `codeindex/src/search/exact.ts`  | Build exact-match previews from stored source text instead of returning only `qualifiedName`                                          |
| `codeindex/src/search/index.ts`  | Make `findSymbolCandidates()` exact-first and keep broad search behavior in `searchSymbols()`                                         |
| `codeindex/src/search/rank.ts`   | Expose the ranking score used for ordering so MCP responses can include it                                                            |
| `codeindex/src/mcp/tools.ts`     | Add output schemas and shared helper(s) for text + structured tool results                                                            |
| `codeindex/src/mcp/server.ts`    | Register output schemas, improve tool descriptions, and return richer search/symbol payloads                                          |
| `tests/codeindex/search.test.ts` | Cover exact preview text and ranking metadata                                                                                         |
| `tests/codeindex/impact.test.ts` | Cover `findSymbolCandidates()` exact-first behavior                                                                                   |
| `tests/codeindex/mcp.test.ts`    | Cover MCP output shaping and output schema validation                                                                                 |

---

### Task 1: Align Exact Symbol Lookup And Exact-Match Previews

**Files:**

- Modify: `tests/codeindex/search.test.ts`
- Modify: `tests/codeindex/impact.test.ts`
- Modify: `codeindex/src/search/exact.ts`
- Modify: `codeindex/src/search/index.ts`
- Test: `bun test tests/codeindex/search.test.ts tests/codeindex/impact.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/codeindex/search.test.ts
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { runExactSearch } from '../../codeindex/src/search/exact.js'
import { findSymbolCandidates } from '../../codeindex/src/search/index.js'
import { ensureSchema } from '../../codeindex/src/storage/schema.js'

const seedSymbol = (db: Database, values: { localName: string; qualifiedName: string; bodyText: string }): void => {
  db.run(
    `INSERT INTO files (id, file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at)
     VALUES (1, 'src/helper.ts', 'src/helper', 'ts', 'x', 'indexed', NULL, datetime('now'))`,
  )
  db.run(
    `INSERT INTO symbols (id, file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier,
      parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms,
      start_line, end_line, start_byte, end_byte)
     VALUES (1, 1, 'src/helper.ts', 'src/helper', 'src/helper.ts#0-48', ?, ?, 'function_declaration', 'exported',
      NULL, 1, '["helper"]', 'export function helper()', '', ?, 'helper', 1, 3, 0, 48)`,
    [values.localName, values.qualifiedName, values.bodyText],
  )
}

describe('runExactSearch', () => {
  test('uses stored source text for exact-result previews', () => {
    const db = new Database(':memory:')
    ensureSchema(db)
    seedSymbol(db, {
      localName: 'helper',
      qualifiedName: 'src/helper#helper',
      bodyText: 'export function helper() {\n  return 1\n}',
    })

    const results = runExactSearch(db, 'helper', 5, {})

    expect(results[0]?.snippet).toContain('export function helper()')
    expect(results[0]?.snippet).not.toBe('src/helper#helper')
  })

  test('findSymbolCandidates returns exact matches before broader search results', () => {
    const db = new Database(':memory:')
    ensureSchema(db)
    seedSymbol(db, {
      localName: 'helper',
      qualifiedName: 'src/helper#helper',
      bodyText: 'export function helper() {\n  return 1\n}',
    })
    db.run(
      `INSERT INTO symbols (id, file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier,
        parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms,
        start_line, end_line, start_byte, end_byte)
       VALUES (2, 1, 'src/helper.ts', 'src/helper', 'src/helper.ts#60-120', 'helperFactory', 'src/helper#helperFactory',
        'function_declaration', 'module', NULL, 0, '[]', 'function helperFactory()', '', 'function helperFactory() { return helper }',
        'helper factory', 5, 5, 60, 120)`,
    )

    const results = findSymbolCandidates(db, 'helper', 5)

    expect(results.map((entry) => entry.qualifiedName)).toEqual(['src/helper#helper'])
  })
})

// tests/codeindex/impact.test.ts
test('findSymbolCandidates falls back to broad search only when no exact symbol exists', () => {
  const db = new Database(':memory:')
  ensureSchema(db)

  db.run(
    `INSERT INTO files (id, file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at)
     VALUES (1, 'src/helper.ts', 'src/helper', 'ts', 'x', 'indexed', NULL, datetime('now'))`,
  )
  db.run(
    `INSERT INTO symbols (id, file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier,
      parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms,
      start_line, end_line, start_byte, end_byte)
     VALUES (1, 1, 'src/helper.ts', 'src/helper', 'src/helper.ts#0-40', 'helperFactory', 'src/helper#helperFactory',
      'function_declaration', 'exported', NULL, 1, '["helperFactory"]', 'export function helperFactory()', '',
      'export function helperFactory() { return 1 }', 'helper factory', 1, 1, 0, 40)`,
  )

  const results = findSymbolCandidates(db, 'helper', 5)

  expect(results[0]?.qualifiedName).toBe('src/helper#helperFactory')
})
```

- [ ] **Step 2: Run the focused tests to confirm RED**

Run:

```bash
bun test tests/codeindex/search.test.ts tests/codeindex/impact.test.ts
```

Expected: FAIL because exact search still returns `qualifiedName` as the snippet and `findSymbolCandidates()` still delegates to the broad search pipeline.

- [ ] **Step 3: Implement the minimal exact-first behavior**

```typescript
// codeindex/src/search/exact.ts
const buildExactSnippet = (signatureText: string, bodyText: string, qualifiedName: string): string => {
  const preview = bodyText.trim() || signatureText.trim() || qualifiedName
  return preview.split('\n').slice(0, 3).join('\n')
}

const mapExactRow = (
  row: {
    symbol_key: string
    qualified_name: string
    local_name: string
    kind: string
    scope_tier: SearchResult['scopeTier']
    file_path: string
    start_line: number
    end_line: number
    export_names: string
    matched_export_name: string | null
    signature_text: string
    body_text: string
  },
  query: string,
): SearchResult => ({
  symbolKey: row.symbol_key,
  qualifiedName: row.qualified_name,
  localName: row.local_name,
  kind: row.kind,
  scopeTier: row.scope_tier,
  filePath: row.file_path,
  startLine: row.start_line,
  endLine: row.end_line,
  exportNames: parseExportNames(row.export_names),
  matchReason:
    row.matched_export_name === query
      ? 'exact export_names'
      : row.qualified_name === query
        ? 'exact qualified_name'
        : row.local_name === query
          ? 'exact local_name'
          : 'exact file_path',
  confidence: 'exact',
  snippet: buildExactSnippet(row.signature_text, row.body_text, row.qualified_name),
})

// include signature_text and body_text in the SELECT list used by loadExactResults()

// codeindex/src/search/index.ts
export const findSymbolCandidates = (db: Database, query: string, limit: number): readonly SearchResult[] => {
  const exactResults = runExactSearch(db, query, limit, {})
  if (exactResults.length > 0) return exactResults
  return searchSymbols(db, { query, limit })
}
```

- [ ] **Step 4: Run the focused tests to confirm GREEN**

Run:

```bash
bun test tests/codeindex/search.test.ts tests/codeindex/impact.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the exact-lookup fix**

```bash
git add tests/codeindex/search.test.ts tests/codeindex/impact.test.ts codeindex/src/search/exact.ts codeindex/src/search/index.ts
git commit -m "fix: align code symbol lookup with exact matches"
```

---

### Task 2: Surface Ranking Metadata And Structured MCP Outputs

**Files:**

- Modify: `tests/codeindex/search.test.ts`
- Modify: `tests/codeindex/mcp.test.ts`
- Modify: `codeindex/src/types.ts`
- Modify: `codeindex/src/search/rank.ts`
- Modify: `codeindex/src/search/index.ts`
- Modify: `codeindex/src/mcp/tools.ts`
- Modify: `codeindex/src/mcp/server.ts`
- Test: `bun test tests/codeindex/search.test.ts tests/codeindex/mcp.test.ts`

- [ ] **Step 1: Write the failing tests for ranking metadata and MCP output shaping**

```typescript
// tests/codeindex/search.test.ts
import { rerankSearchResults, scoreSearchResult } from '../../codeindex/src/search/rank.js'

test('scoreSearchResult exposes the same preference used by rerankSearchResults', () => {
  const exported = {
    symbolKey: 'b',
    qualifiedName: 'src/bar#helper',
    localName: 'helper',
    kind: 'function_declaration',
    scopeTier: 'exported',
    filePath: 'src/bar.ts',
    startLine: 1,
    endLine: 1,
    exportNames: ['helper'],
    matchReason: 'exact export_names',
    confidence: 'resolved',
    snippet: 'export function helper() {}',
  } as const
  const local = {
    symbolKey: 'a',
    qualifiedName: 'src/foo#helper',
    localName: 'helper',
    kind: 'function_declaration',
    scopeTier: 'local',
    filePath: 'src/foo.ts',
    startLine: 1,
    endLine: 1,
    exportNames: [],
    matchReason: 'exact local_name',
    confidence: 'resolved',
    snippet: 'function helper() {}',
  } as const

  expect(scoreSearchResult(exported)).toBeGreaterThan(scoreSearchResult(local))
  expect(rerankSearchResults([local, exported])[0]?.rankScore).toBe(scoreSearchResult(exported))
})

// tests/codeindex/mcp.test.ts
import { z } from 'zod'

import { buildStructuredToolResult, CodeSearchOutputSchema } from '../../codeindex/src/mcp/tools.js'

test('buildStructuredToolResult returns text and structured content', () => {
  const output = {
    query: 'helper',
    resultCount: 1,
    results: [
      {
        symbolKey: 'src/helper.ts#0-10',
        qualifiedName: 'src/helper#helper',
        localName: 'helper',
        kind: 'function_declaration',
        scopeTier: 'exported',
        filePath: 'src/helper.ts',
        startLine: 1,
        endLine: 1,
        exportNames: ['helper'],
        matchReason: 'exact export_names',
        confidence: 'exact',
        snippet: 'export function helper() {}',
        rankScore: 900,
      },
    ],
    guidance: undefined,
  }

  const result = buildStructuredToolResult(CodeSearchOutputSchema, output)

  expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify(output) })
  expect(result.structuredContent).toEqual(output)
  expect(CodeSearchOutputSchema.parse(output)).toEqual(output)
})
```

- [ ] **Step 2: Run the focused tests to confirm RED**

Run:

```bash
bun test tests/codeindex/search.test.ts tests/codeindex/mcp.test.ts
```

Expected: FAIL because `scoreSearchResult`, `rankScore`, `CodeSearchOutputSchema`, and `buildStructuredToolResult()` do not exist yet.

- [ ] **Step 3: Implement ranked results and MCP output schemas**

```typescript
// codeindex/src/types.ts
export interface SearchResult {
  readonly symbolKey: string
  readonly qualifiedName: string
  readonly localName: string
  readonly kind: string
  readonly scopeTier: ScopeTier
  readonly filePath: string
  readonly startLine: number
  readonly endLine: number
  readonly exportNames: readonly string[]
  readonly matchReason: string
  readonly confidence: ReferenceConfidence | 'exact'
  readonly snippet: string
}

export interface RankedSearchResult extends SearchResult {
  readonly rankScore: number
}

// codeindex/src/search/rank.ts
export const scoreSearchResult = (result: SearchResult): number =>
  matchScore(result.matchReason) + scopeScore(result.scopeTier)

export const rerankSearchResults = (results: readonly SearchResult[]): readonly RankedSearchResult[] =>
  [...results]
    .map((result) => ({ ...result, rankScore: scoreSearchResult(result) }))
    .sort((left, right) => right.rankScore - left.rankScore)

// codeindex/src/mcp/tools.ts
export const RankedSearchResultSchema = z.object({
  symbolKey: z.string(),
  qualifiedName: z.string(),
  localName: z.string(),
  kind: z.string(),
  scopeTier: z.enum(['exported', 'module', 'member', 'local']),
  filePath: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  exportNames: z.array(z.string()),
  matchReason: z.string(),
  confidence: z.enum(['resolved', 'file_resolved', 'name_only', 'exact']),
  snippet: z.string(),
  rankScore: z.number().int(),
})

export const CodeSearchOutputSchema = z.object({
  query: z.string(),
  resultCount: z.number().int().nonnegative(),
  results: z.array(RankedSearchResultSchema),
  guidance: z.string().optional(),
})

export const buildStructuredToolResult = <T>(schema: z.ZodType<T>, output: T) => {
  const parsed = schema.parse(output)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(parsed) }],
    structuredContent: parsed,
  }
}

// codeindex/src/mcp/server.ts
server.registerTool(
  'code_search',
  {
    description: 'Search indexed symbols for concept and keyword queries',
    inputSchema: CodeSearchInputSchema,
    outputSchema: CodeSearchOutputSchema,
  },
  async ({ query, limit, kinds, scopeTiers, pathPrefix }: CodeSearchInput) => {
    const results = await deps.codeSearch({ query, limit, kinds, scopeTiers, pathPrefix })
    return buildStructuredToolResult(CodeSearchOutputSchema, {
      query,
      resultCount: results.length,
      results,
      guidance:
        results.length === 0
          ? 'No symbol matches. Retry with broader terms, relax scopeTiers, or use code_symbol when you know the exact name.'
          : undefined,
    })
  },
)
```

Add the same pattern for `code_symbol`, `code_impact`, and `code_index` so all codeindex MCP tools have explicit output schemas and return `structuredContent` in addition to text.

- [ ] **Step 4: Run the focused tests to confirm GREEN**

Run:

```bash
bun test tests/codeindex/search.test.ts tests/codeindex/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the broader codeindex verification suite**

Run:

```bash
bun run codeindex:test && bun run codeindex:typecheck && bun run codeindex:format:check
```

Expected: PASS.

- [ ] **Step 6: Commit the MCP/result-shaping changes**

```bash
git add tests/codeindex/search.test.ts tests/codeindex/mcp.test.ts codeindex/src/types.ts codeindex/src/search/rank.ts codeindex/src/search/index.ts codeindex/src/mcp/tools.ts codeindex/src/mcp/server.ts
git commit -m "feat: enrich codeindex search results for agents"
```

---

### Task 3: Update Repo Guidance To Match The Tool Surface

**Files:**

- Modify: `CLAUDE.md`
- Modify: `codeindex/CLAUDE.md`
- Test: `bun run codeindex:test && bun run codeindex:typecheck`

- [ ] **Step 1: Update the root search protocol guidance**

```markdown
## Codebase Search Protocol

When working inside this project, prefer the `codeindex` MCP server tools for structural code queries.

### Preferred tool priority

1. **First** — Use `code_symbol` when you know the exact symbol, export name, or qualified name. Start with `limit: 5`.
2. **Next** — Use `code_search` for keyword, concept, and exploratory queries. Start with `scopeTiers: ["exported", "member"]` unless local symbols are intentionally needed.
3. **Then** — Use `code_impact` after selecting a symbol to find callers, references, or dependents.
4. **Finally** — Use `code_index` when the index may be stale.

### Query-shaping tips

- Use `kinds` to narrow noisy results to declarations such as `function_declaration`, `class_declaration`, or `interface_declaration`.
- Use `scopeTiers` to skip local-variable noise.
- Prefer `code_search` for concepts like "API endpoints" or "identity resolution".
- Prefer `code_symbol` for names like `resolveMattermostUserId` or `src/chat/mattermost/index#MattermostChatProvider>resolveUserId`.
```

- [ ] **Step 2: Add workspace-local guidance in `codeindex/CLAUDE.md`**

```markdown
## Search Semantics

- `code_symbol` is exact-first: it should return exact local-name, qualified-name, and export-name matches before falling back to broader search.
- `code_search` is the exploratory search entrypoint and may return a mix of exact and FTS hits.
- Search results should include a meaningful preview snippet. Returning only `qualifiedName` is insufficient when the symbol body is already stored in SQLite.
- MCP tool responses should provide both text content and `structuredContent` so hosts can consume results without reparsing JSON strings.
```

- [ ] **Step 3: Verify docs and code agree**

Run:

```bash
bun run codeindex:test && bun run codeindex:typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit the prompt/documentation updates**

```bash
git add CLAUDE.md codeindex/CLAUDE.md
git commit -m "docs: clarify codeindex search workflow"
```

---

## Deferred Follow-Ups

- Optional `groupByFile` or `dedupeByFile` mode for `code_search`, if real agent traces still show too many same-file variants after the exact-first and ranking work lands.
- Optional default-result-limit review after collecting a few real search transcripts; do not lower the default blindly before measuring whether truncation hurts discovery.
- Revisit the strict `grep` prohibition only after the above codeindex fixes ship and real usage still shows symbol-first navigation is slower than grep for targeted lookups.

## Verification Checklist

- `findSymbolCandidates()` is exact-first and only falls back to broad search when there is no exact candidate.
- Exact-match snippets come from stored source text, not just `qualifiedName`.
- Ranked search results expose the score already used by the reranker.
- MCP search-related tools return `structuredContent` and declare `outputSchema`.
- `CLAUDE.md` tells agents when to use `code_symbol`, `code_search`, `code_impact`, `scopeTiers`, and `kinds`.
- No new database schema migration is introduced unless preview quality cannot be achieved from existing columns.
