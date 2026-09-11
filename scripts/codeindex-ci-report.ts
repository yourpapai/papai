// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Post-run usage report for the codeindex CI experiment. Reads the query log
// the codeindex MCP server writes (`.codeindex/queries.db`, schema per the
// sibling's `storage/query-log.ts`) read-only — the servers are dead by the
// time this runs — and emits markdown to stdout. The workflow step redirects
// stdout into $GITHUB_STEP_SUMMARY and the job log.

import { Database } from 'bun:sqlite'

/** The canary's fixed query text (the workflow's setup step) — never model usage. */
export const CANARY_QUERY_TEXT = 'kaneoAutoProvision'

/** The experiment ledger on the default branch: revert / read / decide / cleanup. */
export const LEDGER_URL = 'https://github.com/yourpapai/papai/blob/master/docs/operations/codeindex-ci-experiment.md'

interface QueryLogRow {
  readonly tool: string
  readonly query_text: string | null
  readonly hit: number
  readonly latency_ms: number
  readonly error: string | null
}

export interface ToolUsage {
  readonly tool: string
  readonly calls: number
  readonly hits: number
  readonly medianLatencyMs: number
  readonly maxLatencyMs: number
  readonly errors: number
}

export interface TopQuery {
  readonly queryText: string
  readonly count: number
}

export interface UsageReportData {
  readonly tools: readonly ToolUsage[]
  readonly topQueries: readonly TopQuery[]
  readonly canaryCount: number
  readonly reindexRequests: number
}

const median = (sortedAscending: readonly number[]): number => {
  if (sortedAscending.length === 0) {
    return 0
  }
  const middle = Math.floor(sortedAscending.length / 2)
  const lower = sortedAscending[middle - 1]
  const upper = sortedAscending[middle]
  return sortedAscending.length % 2 === 1 ? (upper ?? 0) : ((lower ?? 0) + (upper ?? 0)) / 2
}

// `null` — missing or unopenable log — is a renderable outcome, never a throw:
// the report step runs `if: always()` and must not turn a dead pipeline into a
// red job over telemetry.
const readQueryLogRows = (queriesPath: string): readonly QueryLogRow[] | null => {
  try {
    const db = new Database(queriesPath, { readonly: true })
    try {
      return db.query<QueryLogRow, []>('SELECT tool, query_text, hit, latency_ms, error FROM query_log').all()
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export const summarizeQueryLog = (rows: readonly QueryLogRow[]): UsageReportData => {
  const canaryRows = rows.filter((row) => row.query_text === CANARY_QUERY_TEXT)
  const usage = rows.filter((row) => row.query_text !== CANARY_QUERY_TEXT)

  const tools = [...new Set(usage.map((row) => row.tool))]
    .map((tool): ToolUsage => {
      const toolRows = usage.filter((row) => row.tool === tool)
      const latencies = toolRows.map((row) => row.latency_ms).sort((a, b) => a - b)
      return {
        tool,
        calls: toolRows.length,
        hits: toolRows.filter((row) => row.hit === 1).length,
        medianLatencyMs: median(latencies),
        maxLatencyMs: latencies.length === 0 ? 0 : (latencies[latencies.length - 1] ?? 0),
        errors: toolRows.filter((row) => row.error !== null).length,
      }
    })
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool))

  const counts = new Map<string, number>()
  for (const row of usage) {
    const queryText = row.query_text
    if (queryText !== null) {
      counts.set(queryText, (counts.get(queryText) ?? 0) + 1)
    }
  }
  const topQueries: readonly TopQuery[] = [...counts.entries()]
    .map(([queryText, count]) => ({ queryText, count }))
    .sort((a, b) => b.count - a.count || a.queryText.localeCompare(b.queryText))
    .slice(0, 10)

  return {
    tools,
    topQueries,
    canaryCount: canaryRows.length,
    reindexRequests: usage.filter((row) => row.tool === 'code_index').length,
  }
}

const renderUsageTable = (tools: readonly ToolUsage[]): readonly string[] => {
  if (tools.length === 0) {
    return ['_No model usage recorded for this job._']
  }
  return [
    '| Tool | Calls | Hit rate | Median ms | Max ms | Errors |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...tools.map((tool) => {
      const hitRate = Math.round((tool.hits / tool.calls) * 100)
      return `| ${tool.tool} | ${tool.calls} | ${hitRate}% | ${tool.medianLatencyMs} | ${tool.maxLatencyMs} | ${tool.errors} |`
    }),
  ]
}

const renderTopQueries = (topQueries: readonly TopQuery[]): readonly string[] => {
  if (topQueries.length === 0) {
    return ['_No model query texts recorded._']
  }
  return topQueries.map((query) => `${query.count} × \`${query.queryText}\``)
}

export const renderCodeindexUsageReport = (queriesPath: string): string => {
  const rows = readQueryLogRows(queriesPath)
  if (rows === null) {
    return [
      '## codeindex usage',
      '',
      `_No query log at \`${queriesPath}\` — no usage was recorded, or the file could not be read._`,
      '',
      `Ledger (revert / read / decide / cleanup): ${LEDGER_URL}`,
      '',
    ].join('\n')
  }

  const data = summarizeQueryLog(rows)
  return [
    '## codeindex usage',
    '',
    ...renderUsageTable(data.tools),
    '',
    'Top queries:',
    ...renderTopQueries(data.topQueries),
    '',
    `Canary: ${data.canaryCount} × \`${CANARY_QUERY_TEXT}\` — excluded from the counts above.`,
    `Explicit reindex requests (\`code_index\`): ${data.reindexRequests}`,
    `Ledger (revert / read / decide / cleanup): ${LEDGER_URL}`,
    '',
  ].join('\n')
}

if (import.meta.main) {
  const queriesPath = process.argv[2] ?? '.codeindex/queries.db'
  process.stdout.write(renderCodeindexUsageReport(queriesPath))
}
