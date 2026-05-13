import type { Database } from 'bun:sqlite'

import type { SearchResult } from '../types.js'
import type { SearchFilters } from './exact.js'

const applyFilters = (results: readonly SearchResult[], filters: Readonly<SearchFilters>): readonly SearchResult[] =>
  results.filter((result) => {
    if (filters.kinds !== undefined && !filters.kinds.includes(result.kind)) {
      return false
    }
    if (filters.scopeTiers !== undefined && !filters.scopeTiers.includes(result.scopeTier)) {
      return false
    }
    if (filters.pathPrefix !== undefined && !result.filePath.startsWith(filters.pathPrefix)) {
      return false
    }
    return true
  })

const parseExportNames = (value: string): readonly string[] => {
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : []
}

// FTS5 MATCH treats ", (, ), *, ^ as syntax; Bun's SQLite also rejects / and #
// as query tokens, so strip them all so raw symbol/path inputs like
// getDrizzleDb() or src/db/drizzle#name never cause parse errors.
const sanitizeFtsQuery = (query: string): string => {
  const tokens = query
    .replace(/["()^*/#]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
  if (tokens.length <= 1) return tokens.join(' ')
  return tokens.join(' OR ')
}

const loadFtsResults = (db: Database, query: string, limit: number): readonly SearchResult[] => {
  const safe = sanitizeFtsQuery(query)
  if (safe.length === 0) return []
  return db
    .query<
      {
        symbol_key: string
        qualified_name: string
        local_name: string
        kind: string
        scope_tier: SearchResult['scopeTier']
        file_path: string
        start_line: number
        end_line: number
        export_names: string
        snippet: string
      },
      [string, number]
    >(
      `SELECT symbols.symbol_key, symbols.qualified_name, symbols.local_name, symbols.kind, symbols.scope_tier,
            symbols.file_path, symbols.start_line, symbols.end_line, symbols.export_names,
            snippet(symbol_fts, 5, '[', ']', '...', 12) AS snippet
     FROM symbol_fts
     JOIN symbols ON symbols.id = symbol_fts.rowid
     WHERE symbol_fts MATCH ?
     ORDER BY bm25(symbol_fts, 10.0, 9.0, 8.0, 7.0, 6.0, 5.0, 2.0, 1.0)
     LIMIT ?`,
    )
    .all(safe, limit)
    .map((row) => ({
      symbolKey: row.symbol_key,
      qualifiedName: row.qualified_name,
      localName: row.local_name,
      kind: row.kind,
      scopeTier: row.scope_tier,
      filePath: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      exportNames: parseExportNames(row.export_names),
      matchReason: 'fts identifier_terms/doc_text/body_text',
      confidence: 'resolved',
      snippet: row.snippet,
    }))
}

export const runFtsSearch = (
  db: Database,
  query: string,
  limit: number,
  filters: Readonly<SearchFilters>,
): readonly SearchResult[] => applyFilters(loadFtsResults(db, query, limit), filters)
