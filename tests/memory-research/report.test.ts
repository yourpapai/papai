// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import { FROZEN_SCENARIO_MANIFEST } from '../../scripts/memory-research/manifest.js'
import { aggregateQueryMetrics, scoreQueryResult } from '../../scripts/memory-research/metrics.js'
import { isCompleteFrozenSplit } from '../../scripts/memory-research/report-validation-frozen.js'
import { expectedGateStates } from '../../scripts/memory-research/report-validation-gates.js'
import {
  createResearchSourceInventory,
  createScenarioSelection,
  CandidateResearchResultSchema,
  hashResearchSourceFiles,
  implementationDigest,
  renderReportMarkdown,
  stableReportJson,
  selectionDigest,
  validateResearchReport,
} from '../../scripts/memory-research/report.js'
import type { CandidateResearchResult, ResearchReport } from '../../scripts/memory-research/report.js'
import { MemoryHitSchema } from '../../scripts/memory-research/types.js'
import type {
  CandidateId,
  MemoryHit,
  MemoryQuery,
  RawQueryResult,
  RunManifest,
  SliceLabel,
} from '../../scripts/memory-research/types.js'

const revision = 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a'
const sourceHash = '1'.repeat(64)
const sourceFiles = [{ path: 'scripts/memory-research/example.ts', sha256: sourceHash }] as const
const implementationHash = implementationDigest(sourceFiles)
const scenario = memoryScenarios.find(({ split }) => split === 'development')!
const query = scenario.queries[0]!
const selection = createScenarioSelection('papai-synthetic-v3', 'development', [scenario])
const resources = {
  ingestedEventCount: 1000,
  ingestDurationMs: 100,
  ingestThroughputPerSecond: 10_000,
  retrievalCount: 1,
  modelCallCount: 0,
  extractorCallCount: 0,
  storedBytes: 10_000,
  incrementalRssBytes: 1000,
} as const

const manifest = (candidateId: CandidateId): RunManifest => ({
  runId: `run-${candidateId}`,
  scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
  scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
  deterministicEmbeddingVersion: 'papai-deterministic-bilingual-v1',
  deterministicEmbeddingDimension: 64,
  candidate: {
    id: candidateId,
    version: `${candidateId}-v1`,
    config: { queryTimeoutMs: 1000, workerDeadlineMs: 10_000 },
  },
  split: 'development',
  scale: 1000,
  seed: 20260723,
  repository: { revision, dirty: true },
  runtime: { bunVersion: '1.3.0', os: 'darwin', arch: 'arm64' },
  hardware: { cpuModel: 'test-cpu', cpuCount: 8, totalMemoryBytes: 16_000_000_000 },
  startedAt: '2026-07-23T10:00:00.000Z',
  completedAt: '2026-07-23T10:01:00.000Z',
  faultConfiguration: {
    missingEmbeddingEvidenceIds: scenario.faults.missingEmbeddingEvidenceIds,
    embeddingVersionChanges: scenario.faults.embeddingVersionChanges,
    duplicateEvidenceIds: scenario.faults.duplicateEvidenceIds,
    ingestOrder: scenario.faults.ingestOrder,
    forgetRequests: scenario.forgetRequests,
    nonRecaptureEvidenceIds: scenario.faults.recaptureAfterForgetEvidenceIds,
    crossScopeProbeQueryIds: scenario.faults.crossScopeProbeQueryIds,
    restartBeforeQueryIds: scenario.faults.restartBeforeQueryIds,
    rebuildBeforeQueryIds: scenario.faults.rebuildBeforeQueryIds,
  },
})

const lifecycle: CandidateResearchResult['lifecycle'] = [
  ...scenario.events
    .map(({ scope }) => `${scope.kind}:${scope.id}`)
    .filter((scope, index, scopes) => scopes.indexOf(scope) === index)
    .sort()
    .map((scope) => ({
      scenarioId: scenario.scenarioId,
      kind: 'scale-ingest' as const,
      referenceId: `${scope}:1000`,
      occurredAt: scenario.events[0]!.ingestTime,
    })),
  ...scenario.faults.ingestOrder.map((eventId) => ({
    scenarioId: scenario.scenarioId,
    kind: 'event-ingest' as const,
    referenceId: eventId,
    occurredAt: scenario.events.find((event) => event.eventId === eventId)!.ingestTime,
  })),
  ...scenario.queries.map((scenarioQuery) => ({
    scenarioId: scenario.scenarioId,
    kind: 'query' as const,
    referenceId: scenarioQuery.queryId,
    occurredAt: scenarioQuery.queryTime,
  })),
].map((entry, ordinal) => ({ ...entry, ordinal }))

const candidateResult = (candidateId: CandidateId): CandidateResearchResult => {
  const rawResult: RawQueryResult = {
    status: 'success',
    queryId: query.queryId,
    hits: [],
    latencyMs: 5,
  }
  const metrics = scoreQueryResult(query, rawResult)
  return {
    registration: {
      id: candidateId,
      version: `${candidateId}-v1`,
      config: { queryTimeoutMs: 1000, workerDeadlineMs: 10_000 },
      implementationSha256: implementationHash,
      implementationSourcePaths: null,
      selfHosting: {
        executionMode: 'offline',
        requiresNetwork: false,
        requiresApiKey: false,
        requiresHostedModel: false,
        requiresProprietaryService: false,
        requiresManagedDatabase: false,
      },
    },
    manifest: manifest(candidateId),
    scenarios: [
      {
        scenarioId: scenario.scenarioId,
        queries: [
          {
            query,
            rawResult,
            metrics,
            diagnostics: { forbiddenHitCount: 0, erasedHitCount: 0 },
          },
        ],
      },
    ],
    aggregate: aggregateQueryMetrics([metrics]),
    sliceAggregates: query.slices.map((slice) => ({
      slice,
      aggregate: aggregateQueryMetrics([metrics]),
    })),
    resources,
    resourcesComplete: true,
    workers: [
      {
        workerPid: 1234,
        scenarioId: scenario.scenarioId,
        status: 'completed',
        resourceStatus: 'measured',
        resources,
      },
    ],
    failures: [],
    lifecycle,
    rebuildAgreement: { probeCount: 0, agreementCount: 0, exact: true, probes: [] },
    gates: {
      scopeIsolation: { state: 'not_evaluable', evidence: 'Subset does not contain the full safety suite.' },
      erasure: { state: 'not_evaluable', evidence: 'Subset does not contain the full safety suite.' },
      selfHosting: { state: 'pass', evidence: 'Offline deterministic adapter.' },
      reproducibility: { state: 'not_evaluable', evidence: 'Fixture source inventory is incomplete.' },
    },
  }
}

const report = (candidateIds: readonly CandidateId[] = ['as-shipped', 'corrected-hybrid']): ResearchReport => {
  return {
    schemaVersion: 'memory-research-report-v1',
    selection,
    sourceInventory: createResearchSourceInventory(sourceFiles.map(({ path }) => path)),
    sourceFiles,
    implementationSha256: implementationDigest(sourceFiles),
    candidates: candidateIds.map(candidateResult),
    publicDatasets: [
      {
        datasetId: 'longmemeval',
        profile: null,
        sourceSha256: null,
        localPath: null,
        importStatus: 'not_supplied',
        protocolStatus: 'not_run',
        reason: 'Dataset was not supplied locally.',
      },
      {
        datasetId: 'locomo',
        profile: null,
        sourceSha256: null,
        localPath: null,
        importStatus: 'not_supplied',
        protocolStatus: 'not_run',
        reason: 'Dataset was not supplied locally.',
      },
      {
        datasetId: 'memoryagentbench',
        profile: null,
        sourceSha256: null,
        localPath: null,
        importStatus: 'not_supplied',
        protocolStatus: 'not_run',
        reason: 'Dataset was not supplied locally.',
      },
      {
        datasetId: 'membench',
        profile: null,
        sourceSha256: null,
        localPath: null,
        importStatus: 'not_supplied',
        protocolStatus: 'not_run',
        reason: 'Dataset was not supplied locally.',
      },
    ],
  }
}

const replaceAt = <Value>(values: readonly Value[], index: number, value: Value): readonly Value[] => [
  ...values.slice(0, index),
  value,
  ...values.slice(index + 1),
]

const syntheticHit = (memoryQuery: MemoryQuery, index: number, rank = index + 1): MemoryHit =>
  MemoryHitSchema.parse({
    evidenceId: `evidence-report-hit-${index + 1}`,
    sourceEventId: `event-report-hit-${index + 1}`,
    scope: memoryQuery.authorizedScope,
    score: { lexical: 1, dense: 0, graph: 0, recency: 0, total: 1 },
    rank,
    content: `Synthetic report hit ${index + 1}`,
    validity: { validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
    provenance: { kind: 'canonical', derivedFromEvidenceIds: [] },
  })

const completeDevelopmentFixture = (): Readonly<{
  selection: ReturnType<typeof createScenarioSelection>
  candidate: CandidateResearchResult
}> => {
  const developmentScenarios = memoryScenarios.filter(({ split }) => split === 'development')
  const completeSelection = createScenarioSelection('papai-synthetic-v3', 'development', developmentScenarios)
  const candidate = {
    ...candidateResult('as-shipped'),
    scenarios: developmentScenarios.map((development) => ({
      scenarioId: development.scenarioId,
      queries: development.queries.map((frozenQuery) => {
        const rawResult = {
          status: 'success' as const,
          queryId: frozenQuery.queryId,
          hits: [],
          latencyMs: 1,
        }
        return {
          query: frozenQuery,
          rawResult,
          metrics: scoreQueryResult(frozenQuery, rawResult),
          diagnostics: { forbiddenHitCount: 0, erasedHitCount: 0 },
        }
      }),
    })),
  }
  return { selection: completeSelection, candidate }
}

const withDesignatedProbeHit = (
  candidate: CandidateResearchResult,
  slice: SliceLabel,
  createHit: (memoryQuery: MemoryQuery) => MemoryHit,
): CandidateResearchResult => ({
  ...candidate,
  scenarios: candidate.scenarios.map((scenarioResult) => ({
    ...scenarioResult,
    queries: scenarioResult.queries.map((evaluation) => {
      if (!evaluation.query.slices.includes(slice)) return evaluation
      const hit = createHit(evaluation.query)
      const rawResult = { status: 'success' as const, queryId: evaluation.query.queryId, hits: [hit], latencyMs: 1 }
      return {
        ...evaluation,
        rawResult,
        metrics: scoreQueryResult(evaluation.query, rawResult),
        diagnostics: {
          forbiddenHitCount: evaluation.query.forbiddenEvidenceIds.includes(hit.evidenceId) ? 1 : 0,
          erasedHitCount: evaluation.query.erasedEvidenceIds.includes(hit.evidenceId) ? 1 : 0,
        },
      }
    }),
  })),
})

const withRawHitForgery = (
  baseline: ResearchReport,
  createHits: (query: MemoryQuery) => readonly MemoryHit[],
): unknown => {
  const candidate = baseline.candidates[0]!
  const scenarioResult = candidate.scenarios[0]!
  const evaluation = scenarioResult.queries[0]!
  const rawResult = {
    status: 'success' as const,
    queryId: evaluation.query.queryId,
    hits: createHits(evaluation.query),
    latencyMs: evaluation.rawResult.latencyMs,
  }
  const metrics = scoreQueryResult(evaluation.query, rawResult)
  const changedEvaluation = {
    ...evaluation,
    rawResult,
    metrics,
    diagnostics: { forbiddenHitCount: 0, erasedHitCount: 0 },
  }
  const changedCandidate = {
    ...candidate,
    scenarios: replaceAt(candidate.scenarios, 0, {
      ...scenarioResult,
      queries: replaceAt(scenarioResult.queries, 0, changedEvaluation),
    }),
    aggregate: aggregateQueryMetrics([metrics]),
    sliceAggregates: evaluation.query.slices.map((slice) => ({
      slice,
      aggregate: aggregateQueryMetrics([metrics]),
    })),
  }
  return {
    ...baseline,
    candidates: replaceAt(baseline.candidates, 0, changedCandidate),
  }
}

type RawHitForgery = readonly [string, (query: MemoryQuery) => readonly MemoryHit[], string]

const rawHitForgeries = [
  [
    'more hits than k',
    (memoryQuery): readonly MemoryHit[] =>
      Array.from({ length: memoryQuery.k + 1 }, (_, index) => syntheticHit(memoryQuery, index)),
    'exceeds query k',
  ],
  [
    'duplicate evidence IDs',
    (memoryQuery): readonly MemoryHit[] => [syntheticHit(memoryQuery, 0, 1), syntheticHit(memoryQuery, 0, 2)],
    'duplicate evidence IDs',
  ],
  [
    'non-contiguous ranks',
    (memoryQuery): readonly MemoryHit[] => [syntheticHit(memoryQuery, 0, 1), syntheticHit(memoryQuery, 1, 3)],
    'one-based output position',
  ],
  [
    'ranks that disagree with output order',
    (memoryQuery): readonly MemoryHit[] => [syntheticHit(memoryQuery, 0, 2), syntheticHit(memoryQuery, 1, 1)],
    'one-based output position',
  ],
] as const satisfies readonly RawHitForgery[]

const withAggregateTamper = (baseline: ResearchReport): unknown => {
  const candidate = baseline.candidates[0]!
  return {
    ...baseline,
    candidates: replaceAt(baseline.candidates, 0, {
      ...candidate,
      aggregate: { ...candidate.aggregate, ndcgAtK: 0.75 },
    }),
  }
}

const withScaleMismatch = (baseline: ResearchReport): unknown => {
  const candidate = baseline.candidates[1]!
  return {
    ...baseline,
    candidates: replaceAt(baseline.candidates, 1, {
      ...candidate,
      manifest: { ...candidate.manifest, scale: 10_000 },
    }),
  }
}

const withQueryMismatch = (baseline: ResearchReport): unknown => {
  const candidate = baseline.candidates[1]!
  const scenarioResult = candidate.scenarios[0]!
  const evaluation = scenarioResult.queries[0]!
  const mismatched = {
    ...evaluation,
    query: { ...evaluation.query, queryId: 'query-mismatched' },
    rawResult: { ...evaluation.rawResult, queryId: 'query-mismatched' },
    metrics: { ...evaluation.metrics, queryId: 'query-mismatched' },
  }
  const changedScenario = {
    ...scenarioResult,
    queries: replaceAt(scenarioResult.queries, 0, mismatched),
  }
  const changedCandidate = {
    ...candidate,
    scenarios: replaceAt(candidate.scenarios, 0, changedScenario),
  }
  return {
    ...baseline,
    candidates: replaceAt(baseline.candidates, 1, changedCandidate),
  }
}

const withQueryMetricTamper = (baseline: ResearchReport): unknown => {
  const candidate = baseline.candidates[0]!
  const scenarioResult = candidate.scenarios[0]!
  const evaluation = scenarioResult.queries[0]!
  const changedScenario = {
    ...scenarioResult,
    queries: replaceAt(scenarioResult.queries, 0, {
      ...evaluation,
      metrics: { ...evaluation.metrics, ndcgAtK: 0.5 },
    }),
  }
  const changedCandidate = {
    ...candidate,
    scenarios: replaceAt(candidate.scenarios, 0, changedScenario),
  }
  return {
    ...baseline,
    candidates: replaceAt(baseline.candidates, 0, changedCandidate),
  }
}

const withSelectionSuiteTamper = (baseline: ResearchReport): unknown => ({
  ...baseline,
  selection: createScenarioSelection('attacker-controlled-suite', baseline.selection.split, [scenario]),
})

const withFrozenQueryTamper = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    scenarios: candidate.scenarios.map((scenarioResult) => ({
      ...scenarioResult,
      queries: scenarioResult.queries.map((evaluation) => ({
        ...evaluation,
        query: { ...evaluation.query, text: `${evaluation.query.text} attacker suffix` },
      })),
    })),
  })),
})

const withValidatedPublicDatasetWithoutPath = (baseline: ResearchReport): unknown => ({
  ...baseline,
  publicDatasets: replaceAt(baseline.publicDatasets, 0, {
    ...baseline.publicDatasets[0]!,
    profile: 'longmemeval-cleaned-v1',
    sourceSha256: '3'.repeat(64),
    importStatus: 'validated',
  }),
})

const withRemotePublicDatasetPath = (baseline: ResearchReport): unknown => ({
  ...baseline,
  publicDatasets: replaceAt(baseline.publicDatasets, 0, {
    ...baseline.publicDatasets[0]!,
    profile: 'longmemeval-cleaned-v1',
    sourceSha256: '3'.repeat(64),
    localPath: 'https://example.test/longmemeval.json',
    importStatus: 'validated',
  }),
})

const withCandidateImplementationTamper = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    registration: {
      ...candidate.registration,
      implementationSha256: '2'.repeat(64),
    },
  })),
})

const withRecomputableCandidateSubset = (baseline: ResearchReport): unknown => {
  const expandedSources = [
    ...baseline.sourceFiles,
    { path: 'scripts/memory-research/unrelated.ts', sha256: '4'.repeat(64) },
  ]
  return {
    ...baseline,
    sourceInventory: createResearchSourceInventory(expandedSources.map(({ path }) => path)),
    sourceFiles: expandedSources,
    implementationSha256: implementationDigest(expandedSources),
    candidates: baseline.candidates.map((candidate) => ({
      ...candidate,
      registration: {
        ...candidate.registration,
        implementationSourcePaths: baseline.sourceFiles.map(({ path }) => path),
      },
    })),
  }
}

const withValidationFailure = (baseline: ResearchReport): unknown => {
  const candidate = baseline.candidates[0]!
  const scenarioResult = candidate.scenarios[0]!
  const evaluation = scenarioResult.queries[0]!
  const rawResult = {
    status: 'failure' as const,
    queryId: evaluation.query.queryId,
    latencyMs: 1,
    error: 'Malformed candidate output',
  }
  const metrics = scoreQueryResult(evaluation.query, rawResult)
  const changedScenario = {
    ...scenarioResult,
    queries: replaceAt(scenarioResult.queries, 0, { ...evaluation, rawResult, metrics }),
  }
  const changedCandidate = {
    ...candidate,
    scenarios: replaceAt(candidate.scenarios, 0, changedScenario),
    aggregate: aggregateQueryMetrics([metrics]),
    sliceAggregates: evaluation.query.slices.map((slice) => ({
      slice,
      aggregate: aggregateQueryMetrics([metrics]),
    })),
    failures: [
      {
        scenarioId: scenario.scenarioId,
        queryId: evaluation.query.queryId,
        stage: 'retrieve' as const,
        kind: 'validation' as const,
        message: 'Malformed candidate output',
      },
    ],
    workers: candidate.workers.map((worker) => ({ ...worker, status: 'failure' as const })),
    gates: {
      ...candidate.gates,
      selfHosting: {
        state: 'not_evaluable' as const,
        evidence: 'Execution retained a truthful malformed-output failure.',
      },
    },
  }
  return {
    ...baseline,
    candidates: replaceAt(baseline.candidates, 0, changedCandidate),
  }
}

const withFaultScheduleTamper = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    manifest: {
      ...candidate.manifest,
      faultConfiguration: {
        ...candidate.manifest.faultConfiguration,
        ingestOrder: [...candidate.manifest.faultConfiguration.ingestOrder].reverse(),
      },
    },
  })),
})

const withMissingTimeoutConfig = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    registration: { ...candidate.registration, config: {} },
    manifest: {
      ...candidate.manifest,
      candidate: { ...candidate.manifest.candidate, config: {} },
    },
  })),
})

const withEmptyLifecycleClaimingReproducibility = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    lifecycle: [],
    workers: candidate.workers.map((worker) => ({
      ...worker,
      resourceStatus: 'missing' as const,
      resources: null,
    })),
    resources: {
      ingestedEventCount: 0,
      ingestDurationMs: 0,
      ingestThroughputPerSecond: 0,
      retrievalCount: 0,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: 0,
      incrementalRssBytes: 0,
    },
    resourcesComplete: false,
    gates: {
      ...candidate.gates,
      reproducibility: {
        state: 'pass' as const,
        evidence: 'Claimed despite incomplete lifecycle evidence.',
      },
    },
  })),
})

const withEmptyLifecycleClaimingSelfHosting = (baseline: ResearchReport): unknown => {
  return {
    ...baseline,
    candidates: baseline.candidates.map((candidate) => ({
      ...candidate,
      lifecycle: [],
      workers: candidate.workers.map((worker) => ({
        ...worker,
        resourceStatus: 'missing' as const,
        resources: null,
      })),
      resources: {
        ingestedEventCount: 0,
        ingestDurationMs: 0,
        ingestThroughputPerSecond: 0,
        retrievalCount: 0,
        modelCallCount: 0,
        extractorCallCount: 0,
        storedBytes: 0,
        incrementalRssBytes: 0,
      },
      resourcesComplete: false,
      gates: {
        ...candidate.gates,
        reproducibility: {
          state: 'not_evaluable' as const,
          evidence: 'Lifecycle evidence is incomplete.',
        },
      },
    })),
  }
}

const withSafetyPassOnSubset = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    gates: {
      ...candidate.gates,
      scopeIsolation: { state: 'pass' as const, evidence: 'No probe was run.' },
      erasure: { state: 'pass' as const, evidence: 'No probe was run.' },
    },
  })),
})

const withLifecycleOrderTamper = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    lifecycle: [
      candidate.lifecycle[0]!,
      candidate.lifecycle[2]!,
      candidate.lifecycle[1]!,
      ...candidate.lifecycle.slice(3),
    ].map((entry, ordinal) => ({ ...entry, ordinal })),
  })),
})

const withExternalRegistrationClaimingPass = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    registration: {
      ...candidate.registration,
      selfHosting: {
        ...candidate.registration.selfHosting,
        executionMode: 'external' as const,
        requiresNetwork: true,
      },
    },
  })),
})

const withWorkerResourceTamper = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    workers: candidate.workers.map((worker) => ({
      ...worker,
      resources:
        worker.resources === null
          ? null
          : { ...worker.resources, ingestedEventCount: worker.resources.ingestedEventCount + 1 },
    })),
  })),
})

const withTruthfulMissingResources = (baseline: ResearchReport): unknown => ({
  ...baseline,
  candidates: baseline.candidates.map((candidate) => ({
    ...candidate,
    resources: {
      ingestedEventCount: 0,
      ingestDurationMs: 0,
      ingestThroughputPerSecond: 0,
      retrievalCount: 0,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: 0,
      incrementalRssBytes: 0,
    },
    resourcesComplete: false,
    workers: candidate.workers.map((worker) => ({
      ...worker,
      resourceStatus: 'missing' as const,
      resources: null,
    })),
    failures: [
      ...candidate.failures,
      {
        scenarioId: scenario.scenarioId,
        queryId: null,
        stage: 'resource' as const,
        kind: 'exception' as const,
        message: 'Resource collection failed.',
      },
    ],
    gates: {
      ...candidate.gates,
      reproducibility: {
        state: 'not_evaluable' as const,
        evidence: 'Per-worker resource evidence is incomplete.',
      },
    },
  })),
})

const withSplitTamper = (baseline: ResearchReport): unknown => {
  const split = 'sealed-test' as const
  const changedSelection = {
    ...baseline.selection,
    split,
    selectionSha256: selectionDigest(baseline.selection.suite, split, baseline.selection.scenarioIds),
  }
  return {
    ...baseline,
    selection: changedSelection,
    candidates: baseline.candidates.map((candidate) => ({
      ...candidate,
      manifest: { ...candidate.manifest, split },
    })),
  }
}

describe('research report identity', () => {
  test('sorts scenario selection and binds its exact suite, split, and IDs', () => {
    const selected = createScenarioSelection('papai-synthetic-v3', 'development', [
      memoryScenarios[1]!,
      memoryScenarios[0]!,
    ])
    const reversed = createScenarioSelection('papai-synthetic-v3', 'development', [
      memoryScenarios[0]!,
      memoryScenarios[1]!,
    ])

    expect(selected.scenarioIds).toEqual([...selected.scenarioIds].sort())
    expect(selected.selectionSha256).toBe(reversed.selectionSha256)
    expect(createScenarioSelection('different-suite', 'development', [memoryScenarios[0]!]).selectionSha256).not.toBe(
      selected.selectionSha256,
    )
  })

  test('hashes caller-selected files by content, including files outside Git tracking', async () => {
    const temporaryRoot = await Bun.$`mktemp -d`.text()
    const root = temporaryRoot.trim()
    await Bun.write(`${root}/untracked.ts`, 'first')
    await Bun.write(`${root}/tracked.ts`, 'second')

    const first = await hashResearchSourceFiles(root, ['tracked.ts', 'untracked.ts'])
    await Bun.write(`${root}/untracked.ts`, 'changed')
    const second = await hashResearchSourceFiles(root, ['untracked.ts', 'tracked.ts'])

    expect(first.files.map(({ path }) => path)).toEqual(['tracked.ts', 'untracked.ts'])
    expect(first.implementationSha256).not.toBe(second.implementationSha256)
  })
})

describe('research report validation and rendering', () => {
  test('recomputes raw query metrics, aggregates, diagnostics, and safety gates', () => {
    const valid = validateResearchReport(report())

    expect(valid.candidates).toHaveLength(2)
    expect(valid.candidates.every(({ gates }) => gates.scopeIsolation.state === 'not_evaluable')).toBeTrue()
    expect(valid.candidates.every(({ gates }) => gates.erasure.state === 'not_evaluable')).toBeTrue()
    expect(() => validateResearchReport(withAggregateTamper(report()))).toThrow('aggregate')
  })

  test.each(rawHitForgeries)(
    'rejects a self-consistent report containing raw hits with %s',
    (_label, createHits, expectedError) => {
      expect(() => validateResearchReport(withRawHitForgery(report(), createHits))).toThrow(expectedError)
    },
  )

  test('rejects comparison identity and query-order mismatches', () => {
    const baseline = report()

    expect(() => validateResearchReport(withScaleMismatch(baseline))).toThrow('comparison identity')
    expect(() => validateResearchReport(withQueryMismatch(baseline))).toThrow('query order')
  })

  test('normalizes unordered report arrays while preserving raw hit order', () => {
    const baseline = report(['corrected-hybrid', 'as-shipped'])
    const reversed = {
      ...baseline,
      sourceFiles: [...baseline.sourceFiles].reverse(),
      candidates: [...baseline.candidates].reverse(),
      publicDatasets: [...baseline.publicDatasets].reverse(),
    }

    const stable = stableReportJson(report())
    const normalized = stableReportJson(reversed)

    expect(normalized).toBe(stable)
  })

  test('derives Markdown only from validated JSON and labels public protocols not run', () => {
    const markdown = renderReportMarkdown(report())

    expect(markdown).toStartWith('<!--\nSPDX-License-Identifier: BUSL-1.1')
    expect(markdown).toContain('active-record retrieval/injection proxy')
    expect(markdown).toContain('| Candidate |')
    expect(markdown).toContain('LongMemEval')
    expect(markdown).toContain('not_run')
    expect(() => renderReportMarkdown(withQueryMetricTamper(report()))).toThrow('query metrics')
  })

  test('rejects a self-consistent selection that is not anchored to the frozen v3 suite', () => {
    expect(() => validateResearchReport(withSelectionSuiteTamper(report()))).toThrow('frozen')
  })

  test('rejects a self-consistent split that disagrees with the frozen scenario identity', () => {
    expect(() => validateResearchReport(withSplitTamper(report()))).toThrow('frozen scenario split')
  })

  test('rejects query definitions changed consistently across every candidate', () => {
    expect(() => validateResearchReport(withFrozenQueryTamper(report()))).toThrow('frozen query')
  })

  test('rejects candidate implementation hashes that are not backed by declared source files', () => {
    expect(() => validateResearchReport(withCandidateImplementationTamper(report()))).toThrow(
      'candidate implementation SHA-256',
    )
  })

  test('accepts an explicit candidate source subset whose hash can be recomputed', () => {
    expect(() => validateResearchReport(withRecomputableCandidateSubset(report()))).not.toThrow()
  })

  test('requires explicit self-hosting registration', () => {
    const candidate = candidateResult('as-shipped')
    const { selfHosting: _selfHosting, ...registration } = candidate.registration
    const parsed = CandidateResearchResultSchema.safeParse({ ...candidate, registration })

    expect(parsed.success).toBeFalse()
  })

  test('requires per-worker resource evidence', () => {
    const candidate = candidateResult('as-shipped')
    const { workers: _workers, ...withoutWorkers } = candidate
    const parsed = CandidateResearchResultSchema.safeParse(withoutWorkers)

    expect(parsed.success).toBeFalse()
  })

  test('rejects a validated public dataset status without its local source path', () => {
    expect(() => validateResearchReport(withValidatedPublicDatasetWithoutPath(report()))).toThrow('local path')
  })

  test('rejects a remote URL masquerading as a validated local dataset path', () => {
    expect(() => validateResearchReport(withRemotePublicDatasetPath(report()))).toThrow('local path')
  })

  test('accepts a retained malformed-output failure whose truthful failure kind is validation', () => {
    expect(() => validateResearchReport(withValidationFailure(report()))).not.toThrow()
  })

  test('rejects identical candidate fault schedules when they differ from the frozen selection', () => {
    expect(() => validateResearchReport(withFaultScheduleTamper(report()))).toThrow('frozen fault schedule')
  })

  test('requires both execution deadlines in the candidate manifest configuration', () => {
    expect(() => validateResearchReport(withMissingTimeoutConfig(report()))).toThrow('queryTimeoutMs')
  })

  test('does not let an empty lifecycle certify reproducible nonempty work', () => {
    expect(() => validateResearchReport(withEmptyLifecycleClaimingReproducibility(report()))).toThrow(
      'reproducibility gate',
    )
  })

  test('rejects lifecycle events that do not follow the frozen job order', () => {
    expect(() => validateResearchReport(withLifecycleOrderTamper(report()))).toThrow('lifecycle closure/order')
  })

  test('does not let successful-looking raw rows certify self-hosting without execution evidence', () => {
    expect(() => validateResearchReport(withEmptyLifecycleClaimingSelfHosting(report()))).toThrow('selfHosting gate')
  })

  test('does not pass safety gates for a scenario subset without designated probes', () => {
    expect(() => validateResearchReport(withSafetyPassOnSubset(report()))).toThrow('scopeIsolation gate')
  })

  test('requires an offline registration for the self-hosting pass state', () => {
    expect(() => validateResearchReport(withExternalRegistrationClaimingPass(report()))).toThrow('selfHosting gate')
  })

  test('recomputes candidate resources from preserved per-worker measurements', () => {
    expect(() => validateResearchReport(withWorkerResourceTamper(report()))).toThrow('aggregate worker resources')
  })

  test('retains a truthful missing resource measurement and blocks reproducibility', () => {
    const validated = validateResearchReport(withTruthfulMissingResources(report()))

    expect(validated.candidates.every(({ resourcesComplete }) => !resourcesComplete)).toBeTrue()
    expect(validated.candidates.every(({ gates }) => gates.reproducibility.state === 'not_evaluable')).toBeTrue()
  })

  test('requires every designated probe in a complete frozen suite', () => {
    const complete = completeDevelopmentFixture()
    const missingStates = expectedGateStates(complete.selection, candidateResult('as-shipped'), {
      artifactsComplete: true,
      executionComplete: true,
    })
    const states = expectedGateStates(complete.selection, complete.candidate, {
      artifactsComplete: true,
      executionComplete: true,
    })

    expect(isCompleteFrozenSplit(complete.selection)).toBeTrue()
    expect(missingStates.scopeIsolation).toBe('not_evaluable')
    expect(missingStates.erasure).toBe('not_evaluable')
    expect(states.scopeIsolation).toBe('pass')
    expect(states.erasure).toBe('pass')
  })

  test('fails designated safety gates over evaluator evidence closure despite candidate relabeling', () => {
    const complete = completeDevelopmentFixture()
    const relabeled = withDesignatedProbeHit(complete.candidate, 'cross-scope', (frozenQuery) =>
      MemoryHitSchema.parse({
        ...syntheticHit(frozenQuery, 0),
        evidenceId: frozenQuery.forbiddenEvidenceIds[0],
        scope: frozenQuery.authorizedScope,
      }),
    )
    const derived = withDesignatedProbeHit(complete.candidate, 'erasure-non-recapture', (frozenQuery) =>
      MemoryHitSchema.parse({
        ...syntheticHit(frozenQuery, 0),
        provenance: { kind: 'derived', derivedFromEvidenceIds: [frozenQuery.erasedEvidenceIds[0]] },
      }),
    )
    const evidence = { artifactsComplete: true, executionComplete: true }

    expect(
      relabeled.scenarios.flatMap(({ queries }) => queries).some(({ metrics }) => metrics.leakageCount > 0),
    ).toBeFalse()
    expect(
      derived.scenarios.flatMap(({ queries }) => queries).some(({ metrics }) => metrics.erasedHitCount > 0),
    ).toBeFalse()
    expect(expectedGateStates(complete.selection, relabeled, evidence).scopeIsolation).toBe('fail')
    expect(expectedGateStates(complete.selection, derived, evidence).erasure).toBe('fail')
  })
})
