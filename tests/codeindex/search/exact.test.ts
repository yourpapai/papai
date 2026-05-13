import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { runExactSearch } from '../../../codeindex/src/search/exact.js'
import { ensureSchema } from '../../../codeindex/src/storage/schema.js'

const insertFile = (db: Database, id: number, filePath: string, moduleKey: string): void => {
  db.query(
    `INSERT INTO files (id, file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at) VALUES (?, ?, ?, 'ts', 'x', 'indexed', NULL, datetime('now'))`,
  ).run(id, filePath, moduleKey)
}

const insertSymbol = (
  db: Database,
  opts: {
    id: number
    fileId: number
    filePath: string
    moduleKey: string
    symbolKey: string
    localName: string
    qualifiedName: string
    kind: string
    scopeTier: string
    isExported: number
    exportNames: string
    signatureText: string
    docText: string
    bodyText: string
    identifierTerms: string
    startLine: number
    endLine: number
    startByte: number
    endByte: number
  },
): void => {
  db.query(
    `INSERT INTO symbols (id, file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier, parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms, start_line, end_line, start_byte, end_byte) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.fileId,
    opts.filePath,
    opts.moduleKey,
    opts.symbolKey,
    opts.localName,
    opts.qualifiedName,
    opts.kind,
    opts.scopeTier,
    opts.isExported,
    opts.exportNames,
    opts.signatureText,
    opts.docText,
    opts.bodyText,
    opts.identifierTerms,
    opts.startLine,
    opts.endLine,
    opts.startByte,
    opts.endByte,
  )
}

describe('runExactSearch snippet preview', () => {
  test('uses first 3 lines of body_text for snippet', () => {
    const db = new Database(':memory:')
    ensureSchema(db)
    insertFile(db, 1, 'src/helper.ts', 'src/helper')
    insertSymbol(db, {
      id: 1,
      fileId: 1,
      filePath: 'src/helper.ts',
      moduleKey: 'src/helper',
      symbolKey: 'src/helper.ts#0-50',
      localName: 'helper',
      qualifiedName: 'src/helper#helper',
      kind: 'function_declaration',
      scopeTier: 'exported',
      isExported: 1,
      exportNames: '["helper"]',
      signatureText: 'export function helper()',
      docText: '',
      bodyText: 'line1\nline2\nline3\nline4\nline5',
      identifierTerms: 'helper',
      startLine: 1,
      endLine: 5,
      startByte: 0,
      endByte: 50,
    })

    const results = runExactSearch(db, 'helper', 10, {})
    expect(results).toHaveLength(1)
    const first = results[0]!
    expect(first.snippet).toBe('line1\nline2\nline3')
  })

  test('falls back to signature_text when body_text is empty', () => {
    const db = new Database(':memory:')
    ensureSchema(db)
    insertFile(db, 1, 'src/helper.ts', 'src/helper')
    insertSymbol(db, {
      id: 1,
      fileId: 1,
      filePath: 'src/helper.ts',
      moduleKey: 'src/helper',
      symbolKey: 'src/helper.ts#0-20',
      localName: 'helper',
      qualifiedName: 'src/helper#helper',
      kind: 'function_declaration',
      scopeTier: 'exported',
      isExported: 1,
      exportNames: '["helper"]',
      signatureText: 'export function helper()',
      docText: '',
      bodyText: '',
      identifierTerms: 'helper',
      startLine: 1,
      endLine: 1,
      startByte: 0,
      endByte: 20,
    })

    const results = runExactSearch(db, 'helper', 10, {})
    expect(results).toHaveLength(1)
    const first = results[0]!
    expect(first.snippet).toBe('export function helper()')
  })

  test('falls back to qualified_name when body_text and signature_text are both empty', () => {
    const db = new Database(':memory:')
    ensureSchema(db)
    insertFile(db, 1, 'src/helper.ts', 'src/helper')
    insertSymbol(db, {
      id: 1,
      fileId: 1,
      filePath: 'src/helper.ts',
      moduleKey: 'src/helper',
      symbolKey: 'src/helper.ts#0-20',
      localName: 'helper',
      qualifiedName: 'src/helper#helper',
      kind: 'function_declaration',
      scopeTier: 'exported',
      isExported: 1,
      exportNames: '["helper"]',
      signatureText: '',
      docText: '',
      bodyText: '',
      identifierTerms: 'helper',
      startLine: 1,
      endLine: 1,
      startByte: 0,
      endByte: 20,
    })

    const results = runExactSearch(db, 'helper', 10, {})
    expect(results).toHaveLength(1)
    const first = results[0]!
    expect(first.snippet).toBe('src/helper#helper')
  })
})
