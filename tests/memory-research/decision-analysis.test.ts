// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { candidateVersions, registeredCandidateIds } from '../../scripts/memory-research/candidate-registry.js'
import { buildDecisionAnalysis, validateDecisionAnalysis } from '../../scripts/memory-research/decision-analysis.js'
import type { CandidateDecisionAnalysis, DecisionAnalysis } from '../../scripts/memory-research/decision-analysis.js'
import { expectedLifecycleSteps } from '../../scripts/memory-research/frozen-run-contract.js'
import { scoreQueryResult } from '../../scripts/memory-research/metrics.js'
import {
  parsePublishArgs,
  publishResearchResults,
  releasePublicationReservation,
  reservePublicationOutputs,
} from '../../scripts/memory-research/publish-cli.js'
import type { ResearchReport } from '../../scripts/memory-research/report.js'
import { stableReportJson } from '../../scripts/memory-research/report.js'
import type { ScenarioJobInput, ScenarioJobResult } from '../../scripts/memory-research/runner-contracts.js'
import { runResearchExperiment } from '../../scripts/memory-research/runner.js'
import {
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_SCENARIO_IDS,
  FROZEN_100K_SEED,
  FROZEN_100K_STORED_RECORDS,
  FROZEN_100K_WARMUPS,
} from '../../scripts/memory-research/statistics-storage.js'
import type { CandidateStorageExperiment } from '../../scripts/memory-research/storage-experiment.js'
import { runFrozenStorageReport } from '../../scripts/memory-research/storage-report-runner.js'
import type { FrozenStorageReport } from '../../scripts/memory-research/storage-report.js'
import { stableStorageReportJson } from '../../scripts/memory-research/storage-report.js'
import type { CandidateId, MemoryEvent, MemoryHit, RawQueryResult } from '../../scripts/memory-research/types.js'

const sourcePaths = ['scripts/memory-research/types.ts'] as const
const runtimeMetadata = {
  repository: { revision: 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a', dirty: true },
  runtime: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
  hardware: { cpuModel: 'fixture-cpu', cpuCount: 8, totalMemoryBytes: 16_000_000_000 },
} as const

const evidenceHit = (event: MemoryEvent, rank: number): MemoryHit => ({
  evidenceId: event.evidenceId,
  sourceEventId: event.eventId,
  scope: event.scope,
  score: { lexical: 1, dense: 1, graph: 1, recency: 0, total: 1 },
  rank,
  content: event.content,
  validity: event.validity,
  provenance: { kind: 'canonical', derivedFromEvidenceIds: [] },
})

const rawResult = (
  input: ScenarioJobInput,
  query: ScenarioJobInput['scenario']['queries'][number],
  perfectCandidate: CandidateId,
): RawQueryResult => ({
  status: 'success',
  queryId: query.queryId,
  hits:
    input.candidateId === perfectCandidate
      ? query.expectedEvidenceIds.flatMap((evidenceId, index) => {
          const event = input.scenario.events.find((candidate) => candidate.evidenceId === evidenceId)
          return event === undefined ? [] : [evidenceHit(event, index + 1)]
        })
      : [],
  latencyMs: input.candidateId === 'temporal-graph' ? 2 : 1,
})

const scenarioJob = (input: ScenarioJobInput, perfectCandidate: CandidateId): ScenarioJobResult => {
  const lifecycleTime = input.scenario.events[0]!.ingestTime
  const lifecycle = expectedLifecycleSteps(input.scenario, input.scale).map((step, ordinal) => ({
    ...step,
    ordinal,
    scenarioId: input.scenario.scenarioId,
    occurredAt: lifecycleTime,
  }))
  const queries = input.scenario.queries.map((query) => {
    const result = rawResult(input, query, perfectCandidate)
    return {
      query,
      rawResult: result,
      metrics: scoreQueryResult(query, result),
      diagnostics: { forbiddenHitCount: 0, erasedHitCount: 0 },
    }
  })
  return {
    candidateId: input.candidateId,
    candidateVersion: candidateVersions[input.candidateId],
    workerPid: 12_345,
    scenario: { scenarioId: input.scenario.scenarioId, queries },
    resources: {
      ingestedEventCount: input.scale,
      ingestDurationMs: 100,
      ingestThroughputPerSecond: input.scale * 10,
      retrievalCount: queries.length,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: input.scale * 100,
      incrementalRssBytes: input.scale * 10,
    },
    failures: [],
    lifecycle,
    rebuildProbes: input.scenario.faults.rebuildBeforeQueryIds.map((queryId) => ({
      queryId,
      beforeHitIds: [],
      afterHitIds: [],
      status: 'success',
    })),
  }
}

const componentReport = (scale: 1_000 | 10_000, perfectCandidate: CandidateId): Promise<ResearchReport> =>
  runResearchExperiment(
    {
      split: 'sealed-test',
      candidateIds: registeredCandidateIds,
      scale,
      seed: 20_260_723,
      workspaceRoot: process.cwd(),
      queryTimeoutMs: 5_000,
      workerDeadlineMs: 120_000,
    },
    {
      runtimeMetadata,
      sourcePaths,
      executeJob: (input): Promise<ScenarioJobResult> => Promise.resolve(scenarioJob(input, perfectCandidate)),
    },
  )

const storageExperiments = (): readonly CandidateStorageExperiment[] =>
  registeredCandidateIds.map((candidateId, candidateIndex) => ({
    candidateId,
    jobs: FROZEN_100K_SCENARIO_IDS.map((scenarioId, scenarioIndex) => ({
      candidateId,
      candidateVersion: candidateVersions[candidateId],
      workerPid: 20_000 + candidateIndex * 10 + scenarioIndex,
      scenarioManifestVersion: 'memory-scenario-manifest-v3',
      scenarioManifestSha256: '283044dbd97c119b5b76a639f4f28792e4ff12cc0bdc73e6a81761b083bb12f7',
      run: {
        scenarioId,
        status: 'success' as const,
        freshWorker: true,
        fixturesMaterializedBeforeReset: true,
        primaryScopeStoredRecordCount: FROZEN_100K_STORED_RECORDS,
        recordsOutsidePrimaryScope: 0,
        warmupCount: FROZEN_100K_WARMUPS,
        measuredLatenciesMs: Array.from({ length: FROZEN_100K_MEASURED_RETRIEVALS }, () => 5),
        incrementalRssBytes: 100_000_000,
        absoluteProcessPeakRssBytes: 120_000_000,
        rssCapture: 'current-pre-serialization' as const,
      },
      resources: {
        ingestedEventCount: FROZEN_100K_STORED_RECORDS,
        ingestDurationMs: 1_000,
        ingestThroughputPerSecond: 100_000,
        retrievalCount: FROZEN_100K_WARMUPS + FROZEN_100K_MEASURED_RETRIEVALS,
        modelCallCount: 0,
        extractorCallCount: 0,
        storedBytes: 50_000_000,
        incrementalRssBytes: 100_000_000,
      },
      failure: null,
    })),
  }))

const storageReport = (): Promise<FrozenStorageReport> =>
  runFrozenStorageReport(
    {
      workspaceRoot: process.cwd(),
      seed: FROZEN_100K_SEED,
      queryTimeoutMs: 5_000,
      workerDeadlineMs: 180_000,
    },
    {
      runtimeMetadata,
      sourcePaths,
      executeExperiment: (): Promise<readonly CandidateStorageExperiment[]> => Promise.resolve(storageExperiments()),
    },
  )

const artifact = (path: string, digit: string): Readonly<{ path: string; sha256: string }> => ({
  path,
  sha256: digit.repeat(64),
})

let semanticFixturePromise: Promise<DecisionAnalysis> | undefined

const semanticFixture = (): Promise<DecisionAnalysis> => {
  semanticFixturePromise ??= Promise.all([
    componentReport(10_000, 'temporal-graph'),
    componentReport(1_000, 'as-shipped'),
    storageReport(),
  ]).then(([primaryReport, sensitivityReport, frozenStorageReport]) =>
    buildDecisionAnalysis({
      primaryReport,
      sensitivityReport,
      storageReport: frozenStorageReport,
      artifacts: {
        primary: artifact('sealed-10000/component.json', '1'),
        sensitivity: artifact('sealed-1000/component.json', '2'),
        storage: artifact('storage-100000/storage.json', '3'),
      },
    }),
  )
  return semanticFixturePromise
}

const replaceCandidate = (
  analysis: DecisionAnalysis,
  candidateId: CandidateId,
  transform: (candidate: CandidateDecisionAnalysis) => CandidateDecisionAnalysis,
): DecisionAnalysis => ({
  ...analysis,
  candidates: analysis.candidates.map((candidate) =>
    candidate.candidateId === candidateId ? transform(candidate) : candidate,
  ),
})

const requireScored = (
  candidate: CandidateDecisionAnalysis,
): Extract<CandidateDecisionAnalysis['weightedScore'], { status: 'scored' }> => {
  if (candidate.weightedScore.status !== 'scored') throw new Error('fixture candidate must be scored')
  return candidate.weightedScore
}

const requireDecidedStorage = (
  candidate: CandidateDecisionAnalysis,
): Extract<CandidateDecisionAnalysis['storageDecision'], { status: 'decided' }> => {
  if (candidate.storageDecision.status !== 'decided') throw new Error('fixture storage decision must be decided')
  return candidate.storageDecision
}

const requireGraphGate = (analysis: DecisionAnalysis): NonNullable<DecisionAnalysis['graphGate']> => {
  if (analysis.graphGate === null) throw new Error('fixture graph gate must be present')
  return analysis.graphGate
}

const forgeWeightedTotal = (analysis: DecisionAnalysis): DecisionAnalysis =>
  replaceCandidate(analysis, 'as-shipped', (candidate) => {
    const weightedScore = requireScored(candidate)
    return { ...candidate, weightedScore: { ...weightedScore, total: weightedScore.total + 1 } }
  })

const forgeWeightedComponent = (analysis: DecisionAnalysis): DecisionAnalysis =>
  replaceCandidate(analysis, 'as-shipped', (candidate) => {
    const weightedScore = requireScored(candidate)
    return {
      ...candidate,
      weightedScore: {
        ...weightedScore,
        components: {
          ...weightedScore.components,
          recallAtK: (weightedScore.components['recallAtK'] ?? 0) + 1,
        },
      },
    }
  })

const forgeRebuildSummary = (analysis: DecisionAnalysis): DecisionAnalysis =>
  replaceCandidate(analysis, 'as-shipped', (candidate) => ({
    ...candidate,
    rebuild: { ...candidate.rebuild, agreementRate: candidate.rebuild.agreementRate / 2 },
  }))

const forgeRebuildCount = (analysis: DecisionAnalysis): DecisionAnalysis =>
  replaceCandidate(analysis, 'as-shipped', (candidate) => ({
    ...candidate,
    rebuild: {
      probeCount: candidate.rebuild.probeCount + 1,
      agreementCount: candidate.rebuild.agreementCount + 1,
      agreementRate: 1,
    },
  }))

const forgeStorageChoice = (analysis: DecisionAnalysis): DecisionAnalysis =>
  replaceCandidate(analysis, 'as-shipped', (candidate) => {
    const storage = requireDecidedStorage(candidate)
    const decision = storage.decision === 'keep-sqlite' ? 'open-migration-evaluation' : 'keep-sqlite'
    return { ...candidate, storageDecision: { ...storage, decision } }
  })

const forgeComparisonSet = (analysis: DecisionAnalysis): DecisionAnalysis => ({
  ...analysis,
  pairedComparisons: analysis.pairedComparisons.slice(1),
})

const forgeComparisonPoint = (analysis: DecisionAnalysis): DecisionAnalysis => {
  const comparison = analysis.pairedComparisons[0]!
  return {
    ...analysis,
    pairedComparisons: [
      { ...comparison, interval: { ...comparison.interval, pointDelta: comparison.interval.pointDelta + 0.01 } },
      ...analysis.pairedComparisons.slice(1),
    ],
  }
}

const forgeComparisonInterval = (analysis: DecisionAnalysis): DecisionAnalysis => {
  const comparison = analysis.pairedComparisons[0]!
  return {
    ...analysis,
    pairedComparisons: [
      { ...comparison, interval: { ...comparison.interval, upper95: comparison.interval.upper95 + 0.01 } },
      ...analysis.pairedComparisons.slice(1),
    ],
  }
}

const forgePromotionClosure = (analysis: DecisionAnalysis): DecisionAnalysis => ({
  ...analysis,
  promotions: analysis.promotions.slice(1),
})

const forgePromotionDelta = (analysis: DecisionAnalysis): DecisionAnalysis => {
  const promotion = analysis.promotions[0]!
  return {
    ...analysis,
    promotions: [
      { ...promotion, weightedScoreDelta: promotion.weightedScoreDelta + 1 },
      ...analysis.promotions.slice(1),
    ],
  }
}

const forgeStrongestComparator = (analysis: DecisionAnalysis): DecisionAnalysis => {
  const graphGate = requireGraphGate(analysis)
  const comparatorId = graphGate.comparatorId === 'as-shipped' ? 'corrected-hybrid' : 'as-shipped'
  return {
    ...analysis,
    strongestEligibleNonGraph: comparatorId,
    graphGate: { ...graphGate, comparatorId },
  }
}

const forgeGraphCost = (analysis: DecisionAnalysis): DecisionAnalysis =>
  replaceCandidate(analysis, 'temporal-graph', (candidate) => ({
    ...candidate,
    graphCost: { ...candidate.graphCost, modelCallCount: candidate.graphCost.modelCallCount + 1 },
  }))

const forgeGraphRatio = (analysis: DecisionAnalysis): DecisionAnalysis => {
  const graphGate = requireGraphGate(analysis)
  return {
    ...analysis,
    graphGate: { ...graphGate, ratios: { ...graphGate.ratios, retrievalP95: 'infinity' } },
  }
}

const selectedAsShipped = (analysis: DecisionAnalysis): NonNullable<DecisionAnalysis['selectedStorageDecision']> => {
  const candidate = analysis.candidates.find(({ candidateId }) => candidateId === 'as-shipped')!
  return { candidateId: 'as-shipped', result: candidate.storageDecision }
}

const forgeGraphPass = (analysis: DecisionAnalysis): DecisionAnalysis => {
  const graphGate = requireGraphGate(analysis)
  return {
    ...analysis,
    graphGate: { ...graphGate, pass: false, failedCriteria: ['retrieval-p95'] },
    representationDecision: { outcome: 'retain-shipped-behavior', candidateId: 'as-shipped' },
    selectedStorageDecision: selectedAsShipped(analysis),
  }
}

const forgeRepresentation = (analysis: DecisionAnalysis): DecisionAnalysis => ({
  ...analysis,
  representationDecision: { outcome: 'retain-shipped-behavior', candidateId: 'as-shipped' },
  selectedStorageDecision: selectedAsShipped(analysis),
})

const forgeCorpusDigest = (analysis: DecisionAnalysis): DecisionAnalysis => ({
  ...analysis,
  freeze: { ...analysis.freeze, scenarioManifestSha256: '0'.repeat(64) },
})

const forgePublicDatasetClosure = (analysis: DecisionAnalysis): DecisionAnalysis => ({
  ...analysis,
  publicDatasets: [
    analysis.publicDatasets[0]!,
    { ...analysis.publicDatasets[1]!, datasetId: analysis.publicDatasets[0]!.datasetId },
    ...analysis.publicDatasets.slice(2),
  ],
})

const semanticForgeries = [
  ['weighted score total', forgeWeightedTotal, 'weighted score'],
  ['weighted score components', forgeWeightedComponent, 'weighted score'],
  ['rebuild summary', forgeRebuildSummary, 'rebuild summary'],
  ['rebuild probe count', forgeRebuildCount, 'rebuild probe count'],
  ['storage threshold choice', forgeStorageChoice, 'storage decision'],
  ['paired comparison set', forgeComparisonSet, 'paired comparison set'],
  ['paired comparison point delta', forgeComparisonPoint, 'point delta'],
  ['paired comparison interval closure', forgeComparisonInterval, 'promotion evidence'],
  ['promotion closure', forgePromotionClosure, 'promotion closure'],
  ['promotion weighted delta', forgePromotionDelta, 'promotion evidence'],
  ['strongest comparator', forgeStrongestComparator, 'strongest eligible'],
  ['graph raw cost', forgeGraphCost, 'graph gate'],
  ['graph ratio', forgeGraphRatio, 'graph gate'],
  ['graph pass state', forgeGraphPass, 'graph gate'],
  ['representation decision', forgeRepresentation, 'representation decision'],
  ['frozen corpus digest', forgeCorpusDigest, 'corpus SHA-256'],
  ['public dataset closure', forgePublicDatasetClosure, 'public dataset'],
] as const

describe('memory research decision analysis', () => {
  test('preserves the raw cost evidence needed to recompute the graph gate', async () => {
    const analysis = await semanticFixture()
    const graph = analysis.candidates.find(({ candidateId }) => candidateId === 'temporal-graph')!
    const graphCost = graph.graphCost

    expect(graphCost).toEqual({
      retrievalP95Ms: graph.resources.retrievalP95Ms,
      ingestDurationMs: 18_000,
      attemptedRecordCount: 1_800_000,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: graph.resources.storedBytes,
    })
  })

  test.each(semanticForgeries)('rejects a forged %s', async (_label, forge, expectedError) => {
    const analysis = await semanticFixture()

    expect(() => validateDecisionAnalysis(forge(analysis))).toThrow(expectedError)
  })

  test('publishes the protocol limitations that component benchmarks leave unresolved', async () => {
    const analysis = await semanticFixture()

    expect(analysis.limitations).toContain('Group namespaces are not speaker-conditioned belief tracking.')
    expect(analysis.limitations).toContain(
      'Single-process scale tests do not exercise poisoning, concurrent durability, deferred actions, or million-token reader utilization.',
    )
    expect(analysis.limitations).toContain(
      'Operational crash recovery, migration, backup/restore, and sustained-load tests were not run.',
    )
    expect(analysis.limitations).toContain(
      'Standalone decision-sidecar validation checks internal closure but does not recompute bootstrap intervals from hashed component artifacts.',
    )
    expect(analysis.limitations).toContain(
      'The as-shipped artifact is an active-record retrieval/injection proxy, not the deployed papai subsystem.',
    )
    expect(analysis.limitations).toContain(
      'Context assembly relevance was not scored; only retrieval hits were scored.',
    )
  })

  test('derives the frozen 10k decision while keeping 1k descriptive and storage independent', async () => {
    const [primary, sensitivity, storage] = await Promise.all([
      componentReport(10_000, 'temporal-graph'),
      componentReport(1_000, 'as-shipped'),
      storageReport(),
    ])

    const analysis = buildDecisionAnalysis({
      primaryReport: primary,
      sensitivityReport: sensitivity,
      storageReport: storage,
      artifacts: {
        primary: artifact('sealed-10000/component.json', '1'),
        sensitivity: artifact('sealed-1000/component.json', '2'),
        storage: artifact('storage-100000/storage.json', '3'),
      },
    })

    expect(analysis.representationDecision).toEqual({
      outcome: 'add-derived-temporal-graph',
      candidateId: 'temporal-graph',
    })
    expect(analysis.selectedStorageDecision).toMatchObject({
      candidateId: 'temporal-graph',
      result: { status: 'decided', decision: 'keep-sqlite' },
    })
    expect(analysis.candidates.find(({ candidateId }) => candidateId === 'as-shipped')?.sensitivity.ndcgAtK).toBe(1)
    expect(analysis.candidates.find(({ candidateId }) => candidateId === 'as-shipped')?.primary.ndcgAtK).toBeLessThan(1)
    expect(analysis.graphGate?.pass).toBeTrue()
    expect(validateDecisionAnalysis(analysis)).toEqual(analysis)
    expect(() => validateDecisionAnalysis({ ...analysis, unsupported: true })).toThrow()
  }, 30_000)

  test('rejects cross-run implementation drift before computing a decision', async () => {
    const [primary, sensitivity, storage] = await Promise.all([
      componentReport(10_000, 'temporal-graph'),
      componentReport(1_000, 'as-shipped'),
      storageReport(),
    ])
    const drifted = { ...storage, implementationSha256: '9'.repeat(64) }

    expect(() =>
      buildDecisionAnalysis({
        primaryReport: primary,
        sensitivityReport: sensitivity,
        storageReport: drifted,
        artifacts: {
          primary: artifact('primary.json', '1'),
          sensitivity: artifact('sensitivity.json', '2'),
          storage: artifact('storage.json', '3'),
        },
      }),
    ).toThrow()
  })

  test('publishes hashed analysis, an exact primary copy, and compact Markdown without overwriting', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'papai-memory-publication-'))
    const [primary, sensitivity, storage] = await Promise.all([
      componentReport(10_000, 'temporal-graph'),
      componentReport(1_000, 'as-shipped'),
      storageReport(),
    ])
    const primaryPath = join(outputRoot, 'primary.json')
    const sensitivityPath = join(outputRoot, 'sensitivity.json')
    const storagePath = join(outputRoot, 'storage.json')
    const analysisPath = join(outputRoot, 'decision-analysis.json')
    const resultsPath = join(outputRoot, '04-results.json')
    const markdownPath = join(outputRoot, '04-results.md')
    const primaryBytes = stableReportJson(primary)
    await Promise.all([
      Bun.write(primaryPath, primaryBytes),
      Bun.write(sensitivityPath, stableReportJson(sensitivity)),
      Bun.write(storagePath, stableStorageReportJson(storage)),
    ])

    const outputs = await publishResearchResults({
      primaryPath,
      sensitivityPath,
      storagePath,
      analysisPath,
      resultsPath,
      markdownPath,
    })

    expect(outputs).toEqual({ analysisPath, resultsPath, markdownPath })
    expect(await Bun.file(resultsPath).text()).toBe(primaryBytes)
    expect(validateDecisionAnalysis(await Bun.file(analysisPath).json()).representationDecision.outcome).toBe(
      'add-derived-temporal-graph',
    )
    const markdown = await Bun.file(markdownPath).text()
    expect(markdown).toStartWith('<!--\nSPDX-License-Identifier: BUSL-1.1')
    expect(markdown).toContain('active-record retrieval/injection proxy')
    expect(markdown).toContain('Weighted score')
    expect(markdown).toContain('Graph gate')
    expect(markdown).toContain('Public benchmark status')
    expect(markdown).toContain('Limitations')
    await expect(
      publishResearchResults({
        primaryPath,
        sensitivityPath,
        storagePath,
        analysisPath,
        resultsPath,
        markdownPath,
      }),
    ).rejects.toThrow('Refusing to overwrite')
  }, 30_000)

  test('parses the explicit publication CLI contract', () => {
    expect(
      parsePublishArgs([
        '--primary',
        'primary.json',
        '--sensitivity',
        'sensitivity.json',
        '--storage',
        'storage.json',
        '--analysis',
        'analysis.json',
        '--results',
        'results.json',
        '--markdown',
        'results.md',
      ]),
    ).toEqual({
      primaryPath: 'primary.json',
      sensitivityPath: 'sensitivity.json',
      storagePath: 'storage.json',
      analysisPath: 'analysis.json',
      resultsPath: 'results.json',
      markdownPath: 'results.md',
    })
    expect(() => parsePublishArgs(['--primary', 'only.json'])).toThrow('requires')
  })

  test('reserves every publication output before reading or publishing inputs', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'papai-memory-publication-'))
    const options = {
      primaryPath: join(outputRoot, 'primary.json'),
      sensitivityPath: join(outputRoot, 'sensitivity.json'),
      storagePath: join(outputRoot, 'storage.json'),
      analysisPath: join(outputRoot, 'decision-analysis.json'),
      resultsPath: join(outputRoot, '04-results.json'),
      markdownPath: join(outputRoot, '04-results.md'),
    }
    const reservation = await reservePublicationOutputs(options)
    await expect(reservePublicationOutputs(options)).rejects.toThrow('reserved')
    await releasePublicationReservation(reservation)
  })
})
