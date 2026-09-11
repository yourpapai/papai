// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CANARY_QUERY_TEXT, LEDGER_URL, renderCodeindexUsageReport } from '../../scripts/codeindex-ci-report.js'

interface InsertInput {
  readonly tool: string
  readonly queryText: string | null
  readonly hit: boolean
  readonly latencyMs: number
  readonly error?: string
}

const createQueriesDb = (dir: string, rows: readonly InsertInput[]): string => {
  const queriesPath = path.join(dir, 'queries.db')
  const db = new Database(queriesPath)
  db.run(`CREATE TABLE query_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    tool TEXT NOT NULL,
    query_text TEXT,
    filters_json TEXT,
    result_count INTEGER NOT NULL,
    hit INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    top_qualified_names TEXT NOT NULL,
    error TEXT
  )`)
  const insert = db.prepare(
    `INSERT INTO query_log (timestamp, tool, query_text, filters_json, result_count, hit, latency_ms, top_qualified_names, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const row of rows) {
    insert.run(
      '2026-09-10T00:00:00.000Z',
      row.tool,
      row.queryText,
      null,
      row.hit ? 3 : 0,
      row.hit ? 1 : 0,
      row.latencyMs,
      '[]',
      row.error ?? null,
    )
  }
  db.close()
  return queriesPath
}

const withTempDir = (run: (dir: string) => void): void => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codeindex-ci-report-'))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// code_symbol: 4 hits (10, 20, 30, 100 ms), 1 miss (5 ms), 1 error (7 ms) — the
// canary's 2 extra rows below must not reach these counts. Median of
// [5, 7, 10, 20, 30, 100] is 15 (average of the middle pair).
const mainFixture: readonly InsertInput[] = [
  { tool: 'code_symbol', queryText: 'ChatRouter', hit: true, latencyMs: 10 },
  { tool: 'code_symbol', queryText: 'ChatRouter', hit: true, latencyMs: 20 },
  { tool: 'code_symbol', queryText: 'ChatRouter', hit: true, latencyMs: 30 },
  { tool: 'code_symbol', queryText: 'a01', hit: true, latencyMs: 100 },
  { tool: 'code_symbol', queryText: 'a02', hit: false, latencyMs: 5 },
  { tool: 'code_symbol', queryText: 'a03', hit: false, latencyMs: 7, error: 'database is locked' },
  { tool: 'code_search', queryText: 'scope model', hit: true, latencyMs: 8 },
  { tool: 'code_search', queryText: 'scope model', hit: true, latencyMs: 12 },
  { tool: 'code_search', queryText: 'a04', hit: false, latencyMs: 4 },
  { tool: 'code_impact', queryText: 'src/chat/context-scope#scopeModel', hit: true, latencyMs: 50 },
  { tool: 'code_symbol', queryText: CANARY_QUERY_TEXT, hit: true, latencyMs: 3 },
  { tool: 'code_symbol', queryText: CANARY_QUERY_TEXT, hit: true, latencyMs: 3 },
  { tool: 'code_index', queryText: null, hit: true, latencyMs: 200 },
  ...['a05', 'a06', 'a07', 'a08', 'a09', 'a10', 'a11'].map((queryText): InsertInput => ({
    tool: 'code_search',
    queryText,
    hit: false,
    latencyMs: 6,
  })),
]

describe('codeindex-ci-report', () => {
  test('exposes the canary text and the default-branch ledger URL', () => {
    expect(CANARY_QUERY_TEXT).toBe('kaneoAutoProvision')
    expect(LEDGER_URL).toBe('https://github.com/yourpapai/papai/blob/master/docs/operations/codeindex-ci-experiment.md')
  })

  test('aggregates per-tool usage with canary rows excluded', () => {
    withTempDir((dir) => {
      const report = renderCodeindexUsageReport(createQueriesDb(dir, mainFixture))

      expect(report).toContain('| code_symbol | 6 | 67% | 15 | 100 | 1 |')
      expect(report).toContain('| code_search | 10 | 20% | 6 | 12 | 0 |')
      expect(report).toContain('| code_impact | 1 | 100% | 50 | 50 | 0 |')
      expect(report).toContain('| code_index | 1 | 100% | 200 | 200 | 0 |')
    })
  })

  test('reports the canary on its own line and the explicit reindex count', () => {
    withTempDir((dir) => {
      const report = renderCodeindexUsageReport(createQueriesDb(dir, mainFixture))

      expect(report).toContain(`Canary: 2 × \`${CANARY_QUERY_TEXT}\``)
      expect(report).toContain('Explicit reindex requests (`code_index`): 1')
    })
  })

  test('truncates the top-query list at ten and orders it by frequency', () => {
    withTempDir((dir) => {
      const report = renderCodeindexUsageReport(createQueriesDb(dir, mainFixture))

      expect(report).toContain('3 × `ChatRouter`')
      expect(report).toContain('2 × `scope model`')
      expect(report).toContain('1 × `a01`')
      expect(report).toContain('1 × `a08`')
      expect(report).not.toContain('`a09`')
      expect(report).not.toContain('`a10`')
      expect(report).not.toContain('`a11`')
    })
  })

  test('links the experiment ledger', () => {
    withTempDir((dir) => {
      const report = renderCodeindexUsageReport(createQueriesDb(dir, mainFixture))

      expect(report).toContain(LEDGER_URL)
    })
  })

  test('renders a zero-usage report for an empty log', () => {
    withTempDir((dir) => {
      const report = renderCodeindexUsageReport(createQueriesDb(dir, []))

      expect(report).toContain('No model usage recorded')
      expect(report).toContain(`Canary: 0 × \`${CANARY_QUERY_TEXT}\``)
      expect(report).toContain('Explicit reindex requests (`code_index`): 0')
      expect(report).toContain(LEDGER_URL)
    })
  })

  test('renders an empty-report line naming the path for a missing or unopenable log', () => {
    withTempDir((dir) => {
      const absent = path.join(dir, 'absent.db')
      const missingReport = renderCodeindexUsageReport(absent)
      expect(missingReport).toContain(absent)
      expect(missingReport).toContain('No query log')
      expect(missingReport).toContain(LEDGER_URL)

      const corrupt = path.join(dir, 'corrupt.db')
      writeFileSync(corrupt, 'not a database at all')
      const corruptReport = renderCodeindexUsageReport(corrupt)
      expect(corruptReport).toContain(corrupt)
      expect(corruptReport).toContain('No query log')
    })
  })

  test('reads the log without modifying it', () => {
    withTempDir((dir) => {
      const queriesPath = createQueriesDb(dir, mainFixture)
      const before = readFileSync(queriesPath)
      const mtimeBefore = statSync(queriesPath).mtimeMs

      renderCodeindexUsageReport(queriesPath)

      expect(readFileSync(queriesPath)).toEqual(before)
      expect(statSync(queriesPath).mtimeMs).toBe(mtimeBefore)
    })
  })
})
