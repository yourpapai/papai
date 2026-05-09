import type { Database } from 'bun:sqlite'

import type { RankedSearchResult, SearchResult } from '../types.js'
import { runExactSearch, type SearchFilters } from './exact.js'
import { runFtsSearch } from './fts.js'
import { rerankSearchResults } from './rank.js'

export interface ImpactLookupInput {
  readonly symbolKey?: string
  readonly qualifiedName?: string
  readonly limit: number
}

export interface ImpactResult {
  readonly sourceQualifiedName: string | null
  readonly sourceFilePath: string
  readonly edgeType: string
  readonly confidence: string
  readonly lineNumber: number
}

export const searchSymbols = (
  db: Database,
  input: Readonly<{ query: string; limit: number } & SearchFilters>,
): readonly RankedSearchResult[] => {
  const exactResults = runExactSearch(db, input.query, input.limit, input)
  const ftsResults = runFtsSearch(db, input.query, input.limit, input)
  const deduped: readonly SearchResult[] = [
    ...exactResults,
    ...ftsResults.filter((fts) => !exactResults.some((exact) => exact.symbolKey === fts.symbolKey)),
  ]
  return rerankSearchResults(deduped).slice(0, input.limit)
}

export const findSymbolCandidates = (db: Database, query: string, limit: number): readonly RankedSearchResult[] => {
  const exactResults = runExactSearch(db, query, limit, {})
  if (exactResults.length > 0) {
    return rerankSearchResults(exactResults)
  }
  return searchSymbols(db, { query, limit })
}

export const findIncomingReferences = (db: Database, input: Readonly<ImpactLookupInput>): readonly ImpactResult[] => {
  if (input.symbolKey === undefined && input.qualifiedName === undefined) {
    throw new Error('Either symbolKey or qualifiedName is required')
  }

  const targetRow =
    input.symbolKey === undefined
      ? db
          .query<{ id: number }, [string]>('SELECT id FROM symbols WHERE qualified_name = ?')
          .get(input.qualifiedName ?? '')
      : db.query<{ id: number }, [string]>('SELECT id FROM symbols WHERE symbol_key = ?').get(input.symbolKey)

  if (targetRow === null) {
    return []
  }

  return db
    .query<
      {
        source_qualified_name: string | null
        source_file_path: string
        edge_type: string
        confidence: string
        line_number: number
      },
      [number, number]
    >(
      `SELECT source_symbols.qualified_name AS source_qualified_name,
              source_files.file_path AS source_file_path,
              symbol_references.edge_type,
              symbol_references.confidence,
              symbol_references.line_number
       FROM symbol_references
       JOIN files AS source_files ON source_files.id = symbol_references.source_file_id
       LEFT JOIN symbols AS source_symbols ON source_symbols.id = symbol_references.source_symbol_id
       WHERE symbol_references.target_symbol_id = ?
       ORDER BY symbol_references.confidence = 'resolved' DESC, symbol_references.line_number ASC
       LIMIT ?`,
    )
    .all(targetRow.id, input.limit)
    .map((row) => ({
      sourceQualifiedName: row.source_qualified_name,
      sourceFilePath: row.source_file_path,
      edgeType: row.edge_type,
      confidence: row.confidence,
      lineNumber: row.line_number,
    }))
}
