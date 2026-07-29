// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CandidateDecisionAnalysis, DecisionAnalysis } from './decision-analysis-schema.js'
import { validateDecisionAnalysis } from './decision-analysis-validation.js'
import { ACTIVE_RECORD_PROXY_BOUNDARY, RESEARCH_MARKDOWN_LICENSE_HEADER_LINES } from './report-render.js'

const fixed = (value: number): string => value.toFixed(4)
const ratioText = (value: number | 'infinity'): string => (value === 'infinity' ? '∞' : fixed(value))

const scoreText = (candidate: CandidateDecisionAnalysis): string =>
  candidate.weightedScore.status === 'scored'
    ? candidate.weightedScore.total.toFixed(2)
    : candidate.weightedScore.status

const candidateRow = (candidate: CandidateDecisionAnalysis): string =>
  [
    candidate.candidateId,
    fixed(candidate.primary.ndcgAtK),
    fixed(candidate.sensitivity.ndcgAtK),
    fixed(candidate.primary.relationalTemporalComposite),
    scoreText(candidate),
    candidate.gates.scopeSafety,
    candidate.gates.erasureSafety,
    candidate.gates.selfHosting,
    candidate.storageDecision.status === 'decided' ? candidate.storageDecision.decision : 'blocked',
  ].join(' | ')

const comparisonRow = (comparison: DecisionAnalysis['pairedComparisons'][number]): string =>
  [
    `${comparison.candidateId} − ${comparison.comparatorId}`,
    comparison.statistic,
    fixed(comparison.interval.pointDelta),
    `[${fixed(comparison.interval.lower95)}, ${fixed(comparison.interval.upper95)}]`,
  ].join(' | ')

const graphSection = (analysis: DecisionAnalysis): readonly string[] => {
  if (analysis.graphGate === null) return ['## Graph gate', '', 'Not evaluable.', '']
  const { graphGate } = analysis
  return [
    '## Graph gate',
    '',
    `Result: **${graphGate.pass ? 'pass' : 'fail'}** against \`${graphGate.comparatorId}\`.`,
    '',
    `Ratios — retrieval p95: ${ratioText(graphGate.ratios.retrievalP95)}; ingest/attempt: ${ratioText(graphGate.ratios.ingestCostPerAttempt)}; calls/attempt: ${ratioText(graphGate.ratios.callCostPerAttempt)}; stored bytes: ${ratioText(graphGate.ratios.storedBytes)}.`,
    '',
    `Failed criteria: ${graphGate.failedCriteria.length === 0 ? 'none' : graphGate.failedCriteria.join(', ')}.`,
    '',
  ]
}

const storageSection = (analysis: DecisionAnalysis): readonly string[] => {
  const selected = analysis.selectedStorageDecision
  if (selected === null) return ['## Independent storage decision', '', 'Blocked: no representation was selected.', '']
  const result =
    selected.result.status === 'decided'
      ? `${selected.result.decision}; pooled p95 ${fixed(selected.result.pooledP95Ms)} ms; maximum incremental RSS ${String(selected.result.maxIncrementalRssBytes)} bytes.`
      : `blocked: ${selected.result.errors.join('; ')}`
  return ['## Independent storage decision', '', `For \`${selected.candidateId}\`: ${result}`, '']
}

export const renderDecisionAnalysisMarkdown = (input: unknown): string => {
  const analysis = validateDecisionAnalysis(input)
  return [
    ...RESEARCH_MARKDOWN_LICENSE_HEADER_LINES,
    '# Agent memory component results',
    '',
    `Primary decision scale: 10,000 records per scope; sensitivity scale: 1,000. Representation outcome: **${analysis.representationDecision.outcome}**.`,
    '',
    ACTIVE_RECORD_PROXY_BOUNDARY,
    '',
    '| Candidate | 10k nDCG | 1k nDCG | Rel./temporal | Weighted score | Scope | Erasure | Offline | 100k storage |',
    '| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
    ...analysis.candidates.map((candidate) => `| ${candidateRow(candidate)} |`),
    '',
    '## Paired 95% confidence intervals',
    '',
    '| Comparison | Statistic | Delta | 95% interval |',
    '| --- | --- | ---: | --- |',
    ...analysis.pairedComparisons.map((entry) => `| ${comparisonRow(entry)} |`),
    '',
    ...graphSection(analysis),
    ...storageSection(analysis),
    '## Public benchmark status',
    '',
    '| Dataset | Import | Official protocol | Reason |',
    '| --- | --- | --- | --- |',
    ...analysis.publicDatasets.map(
      ({ datasetId, importStatus, protocolStatus, reason }) =>
        `| ${datasetId} | ${importStatus} | ${protocolStatus} | ${reason} |`,
    ),
    '',
    '## Limitations',
    '',
    ...analysis.limitations.map((limitation) => `- ${limitation}`),
    '',
    'The JSON result remains the validated 10k retrieval-component report. Cross-scale decisions are stored in the hashed decision-analysis sidecar.',
    '',
  ].join('\n')
}
