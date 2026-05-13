import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { findIncomingReferences, findSymbolCandidates } from '../../codeindex/src/impact.js'
import { ensureSchema } from '../../codeindex/src/storage/schema.js'

describe('symbol resolution and impact', () => {
  test('returns symbol candidates and module-level importers', () => {
    const db = new Database(':memory:')
    ensureSchema(db)

    db.query(
      `INSERT INTO files (id, file_path, module_key, language, file_hash, parse_status, parse_error, indexed_at) VALUES (1, 'src/helper.ts', 'src/helper', 'ts', 'x', 'indexed', NULL, datetime('now'))`,
    ).run()
    db.query(
      `INSERT INTO symbols (id, file_id, file_path, module_key, symbol_key, local_name, qualified_name, kind, scope_tier, parent_symbol_id, is_exported, export_names, signature_text, doc_text, body_text, identifier_terms, start_line, end_line, start_byte, end_byte) VALUES (1, 1, 'src/helper.ts', 'src/helper', 'src/helper.ts#0-20', 'helper', 'src/helper#helper', 'function_declaration', 'exported', NULL, 1, '["helper"]', 'export function helper()', '', 'export function helper() {}', 'helper', 1, 1, 0, 20)`,
    ).run()
    db.query(
      `INSERT INTO symbol_references (source_symbol_id, source_file_id, target_symbol_id, target_name, target_export_name, target_module_specifier, edge_type, confidence, line_number) VALUES (NULL, 1, 1, 'helper', 'helper', './helper', 'imports', 'resolved', 1)`,
    ).run()

    expect(findSymbolCandidates(db, 'helper', 5)[0]?.qualifiedName).toBe('src/helper#helper')
    expect(findIncomingReferences(db, { qualifiedName: 'src/helper#helper', limit: 10 })[0]?.edgeType).toBe('imports')
  })
})
