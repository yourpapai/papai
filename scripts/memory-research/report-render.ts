// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { validateResearchReport } from './report-validation.js'

export const RESEARCH_MARKDOWN_LICENSE_HEADER_LINES = [
  '<!--',
  'SPDX-License-Identifier: BUSL-1.1',
  'Copyright (c) 2026 Dmitriy Lazarev',
  'Use of this software is governed by the Business Source License 1.1.',
  'See LICENSE in the project root for details.',
  '-->',
  '',
] as const

export const ACTIVE_RECORD_PROXY_BOUNDARY =
  '`as-shipped` is an active-record retrieval/injection proxy, not the deployed papai memory subsystem. Comparisons against it are adapter-to-adapter retrieval comparisons.'

const canonicalizeKeys = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalizeKeys)
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeKeys(child)]),
  )
}

export const stableReportJson = (input: unknown): string =>
  `${JSON.stringify(canonicalizeKeys(validateResearchReport(input)), null, 2)}\n`

const fixed = (value: number): string => value.toFixed(4)

const publicDatasetName = (datasetId: string): string =>
  ({
    longmemeval: 'LongMemEval',
    locomo: 'LoCoMo',
    memoryagentbench: 'MemoryAgentBench',
    membench: 'MemBench',
  })[datasetId] ?? datasetId

export const renderReportMarkdown = (input: unknown): string => {
  const report = validateResearchReport(input)
  const candidateRows = report.candidates.map(({ aggregate, gates, manifest, registration, resources }) =>
    [
      registration.id,
      String(manifest.scale),
      fixed(aggregate.ndcgAtK),
      fixed(aggregate.reciprocalRank),
      fixed(aggregate.latency.p95Ms),
      String(aggregate.leakageCount),
      String(aggregate.erasedHitCount),
      gates.scopeIsolation.state,
      gates.erasure.state,
      String(resources.storedBytes),
    ].join(' | '),
  )
  const publicRows = report.publicDatasets.map(({ datasetId, importStatus, protocolStatus, reason }) =>
    [publicDatasetName(datasetId), importStatus, protocolStatus, reason].join(' | '),
  )
  return [
    ...RESEARCH_MARKDOWN_LICENSE_HEADER_LINES,
    '# Agent memory component results',
    '',
    `Corpus selection: \`${report.selection.selectionSha256}\` (${report.selection.split}, ${report.selection.scenarioIds.length} scenarios).`,
    '',
    ACTIVE_RECORD_PROXY_BOUNDARY,
    '',
    '| Candidate | Scale | nDCG@k | MRR | p95 ms | Leakage | Erased hits | Scope gate | Erasure gate | Stored bytes |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |',
    ...candidateRows.map((row) => `| ${row} |`),
    '',
    '## Public benchmark status',
    '',
    '| Dataset | Import | Official protocol | Reason |',
    '| --- | --- | --- | --- |',
    ...publicRows.map((row) => `| ${row} |`),
    '',
    'These are retrieval-component results. They do not claim answer quality or an official public-benchmark score.',
    '',
  ].join('\n')
}
