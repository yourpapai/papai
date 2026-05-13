import type { Database } from 'bun:sqlite'

import type { ScopeTier, SearchResult } from '../types.js'

export interface SearchFilters {
  readonly kinds?: readonly string[]
  readonly scopeTiers?: readonly ScopeTier[]
  readonly pathPrefix?: string
}

const applyFilters = <T extends Pick<SearchResult, 'filePath' | 'kind' | 'scopeTier'>>(
  results: readonly T[],
  filters: Readonly<SearchFilters>,
): readonly T[] =>
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

const buildSnippet = (bodyText: string, signatureText: string, qualifiedName: string): string => {
  if (bodyText !== '') {
    return bodyText.split('\n').slice(0, 3).join('\n')
  }
  if (signatureText !== '') {
    return signatureText
  }
  return qualifiedName
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
  snippet: buildSnippet(row.body_text, row.signature_text, row.qualified_name),
})

const loadExactResults = (db: Database, query: string, limit: number): readonly SearchResult[] =>
  db
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
        matched_export_name: string | null
        signature_text: string
        body_text: string
      },
      [string, string, string, string, string, number]
    >(
      `SELECT symbols.symbol_key, symbols.qualified_name, symbols.local_name, symbols.kind, symbols.scope_tier,
            symbols.file_path, symbols.start_line, symbols.end_line, symbols.export_names,
            symbols.signature_text, symbols.body_text,
            module_exports.export_name AS matched_export_name
     FROM symbols
     LEFT JOIN module_exports ON module_exports.symbol_id = symbols.id AND module_exports.export_name = ?
     WHERE symbols.local_name = ?
        OR symbols.qualified_name = ?
        OR module_exports.export_name = ?
        OR symbols.file_path LIKE ?
     LIMIT ?`,
    )
    .all(query, query, query, query, `${query}%`, limit)
    .map((row) => mapExactRow(row, query))

export const runExactSearch = (
  db: Database,
  query: string,
  limit: number,
  filters: Readonly<SearchFilters>,
): readonly SearchResult[] => applyFilters(loadExactResults(db, query, limit), filters)
