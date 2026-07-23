// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  aggregateStatistic,
  BOOTSTRAP_SEED,
  callCostRatio,
  computeWeightedScore,
  decideRepresentation,
  evaluateGraphGate,
  evaluateHierarchySuperiority,
  evaluatePracticalSuperiority,
  evaluateReproducibilityGate,
  evaluateSafetyGate,
  evaluateSelfHostingGate,
  evaluateStorageDecision,
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_SCENARIO_IDS,
  FROZEN_100K_STORED_RECORDS,
  generateScenarioIndexes,
  intervalStrictlyPositive,
  pairedBootstrapDelta,
  selectStrongestEligibleNonGraph,
  STORAGE_RSS_THRESHOLD_BYTES,
  type7Quantile,
} from '../../scripts/memory-research/statistics.js'
import type {
  CandidateObservationSet,
  CandidateScoreInput,
  ComparisonIdentity,
  EfficiencyBaseline,
  GraphGateInput,
  QueryObservation,
  StorageRun,
  ValidationResult,
  WeightedScoreResult,
} from '../../scripts/memory-research/statistics.js'

const valueOf = <Value>(result: ValidationResult<Value>): Value => {
  expect(result.valid).toBeTrue()
  if (!result.valid) throw new Error(result.errors.join('; '))
  return result.value
}

const scoredTotal = (result: WeightedScoreResult): number => {
  expect(result.status).toBe('scored')
  if (result.status !== 'scored') throw new Error('expected scored result')
  return result.total
}

const observation = (
  scenarioId: string,
  queryId: string,
  value: number,
  slices: readonly string[],
  status: QueryObservation['status'] = 'success',
): QueryObservation => ({
  scenarioId,
  queryId,
  status,
  slices,
  precisionAtK: value,
  recallAtK: value,
  reciprocalRank: value,
  ndcgAtK: value,
})

const identity = {
  scenarioManifestVersion: 'memory-scenario-manifest-v3',
  scenarioManifestSha256: 'a'.repeat(64),
  selectionSha256: 'b'.repeat(64),
  split: 'sealed-test',
  scale: 10_000,
  seed: BOOTSTRAP_SEED,
} as const

const candidateSet = (
  candidateId: CandidateObservationSet['candidateId'],
  rows: readonly QueryObservation[],
): CandidateObservationSet => ({ candidateId, identity, rows })

describe('deterministic scenario bootstrap', () => {
  test('matches the frozen xorshift32 golden index stream', () => {
    expect(generateScenarioIndexes(3, 12, BOOTSTRAP_SEED)).toEqual([0, 1, 0, 1, 2, 0, 1, 0, 2, 0, 2, 0])
    expect(generateScenarioIndexes(3, 12, BOOTSTRAP_SEED)).toEqual(generateScenarioIndexes(3, 12, BOOTSTRAP_SEED))
  })

  test('uses type-7 quantiles and strict unrounded positivity', () => {
    expect(valueOf(type7Quantile([0, 10, 20, 30], 0.25))).toBe(7.5)
    expect(valueOf(type7Quantile([0, 10, 20, 30], 0.975))).toBeCloseTo(29.25)
    expect(intervalStrictlyPositive({ lower95: Number.EPSILON, upper95: 1 })).toBeTrue()
    expect(intervalStrictlyPositive({ lower95: 0, upper95: 1 })).toBeFalse()
    expect(intervalStrictlyPositive({ lower95: -0, upper95: 1 })).toBeFalse()
    expect(intervalStrictlyPositive({ lower95: 1, upper95: 0 })).toBeFalse()
  })

  test('resamples whole scenarios, carrying every query in the sampled scenario', () => {
    const candidate = candidateSet('corrected-hybrid', [
      observation('scenario-a', 'query-a1', 1, ['direct-fact']),
      observation('scenario-a', 'query-a2', 1, ['direct-fact']),
      observation('scenario-b', 'query-b1', 0, ['direct-fact']),
    ])
    const comparator = candidateSet(
      'as-shipped',
      candidate.rows.map((row) => ({ ...row, precisionAtK: 0, recallAtK: 0, reciprocalRank: 0, ndcgAtK: 0 })),
    )
    const interval = valueOf(
      pairedBootstrapDelta(
        candidate,
        comparator,
        { kind: 'overall', metric: 'ndcgAtK' },
        {
          mode: 'fixture',
          resamples: 4,
        },
      ),
    )

    expect(interval.pointDelta).toBeCloseTo(2 / 3)
    expect(interval.lower95).toBeCloseTo(2 / 3)
    expect(interval.upper95).toBe(1)
  })

  test('rejects comparison identity, query-key, and ordering mismatches', () => {
    const rows = [
      observation('scenario-a', 'query-a', 1, ['direct-fact']),
      observation('scenario-b', 'query-b', 0, ['direct-fact']),
    ]
    const candidate = candidateSet('corrected-hybrid', rows)
    const reversed = candidateSet('as-shipped', [...rows].reverse())
    const identityMismatches: readonly ComparisonIdentity[] = [
      { ...identity, scenarioManifestVersion: 'different' },
      { ...identity, scenarioManifestSha256: 'c'.repeat(64) },
      { ...identity, selectionSha256: 'd'.repeat(64) },
      { ...identity, split: 'development' },
      { ...identity, scale: 1_000 },
      { ...identity, seed: 1 },
    ]

    identityMismatches.forEach((differentIdentity) => {
      expect(
        pairedBootstrapDelta(
          candidate,
          { ...candidateSet('as-shipped', rows), identity: differentIdentity },
          { kind: 'overall', metric: 'ndcgAtK' },
          { mode: 'fixture' },
        ).valid,
      ).toBeFalse()
    })
    expect(pairedBootstrapDelta(candidate, reversed, { kind: 'overall', metric: 'ndcgAtK' }).valid).toBeFalse()
    expect(
      pairedBootstrapDelta(
        candidate,
        candidateSet('as-shipped', rows),
        { kind: 'overall', metric: 'ndcgAtK' },
        { mode: 'fixture' },
      ).valid,
    ).toBeTrue()
    expect(
      pairedBootstrapDelta(candidate, candidateSet('as-shipped', rows), {
        kind: 'overall',
        metric: 'ndcgAtK',
      }).valid,
    ).toBeFalse()
  })

  test('rejects different per-query slice assignments', () => {
    const rows = [
      observation('scenario-a', 'query-a', 1, ['direct-fact']),
      observation('scenario-b', 'query-b', 0, ['long-range', 'knowledge-update']),
    ]
    const comparatorRows = [rows[0]!, { ...rows[1]!, slices: ['long-range', 'abstention'] }]

    const result = pairedBootstrapDelta(
      candidateSet('corrected-hybrid', rows),
      candidateSet('as-shipped', comparatorRows),
      { kind: 'overall', metric: 'ndcgAtK' },
      { mode: 'fixture', resamples: 4 },
    )

    expect(result).toEqual({
      valid: false,
      errors: ['comparison per-query slice assignments differ'],
    })
  })
})

describe('registered aggregation', () => {
  test('keeps failures in the denominator as zero', () => {
    const rows = [
      observation('scenario-a', 'query-a', 1, ['direct-fact']),
      observation('scenario-b', 'query-b', 1, ['direct-fact'], 'failure'),
      observation('scenario-c', 'query-c', 1, ['direct-fact'], 'timeout'),
    ]

    expect(valueOf(aggregateStatistic(rows, { kind: 'overall', metric: 'recallAtK' }))).toBeCloseTo(1 / 3)
  })

  test('uses equal slice weights instead of pooling unequal query counts', () => {
    const rows = [
      observation('scenario-a', 'query-a', 1, ['graph-multi-hop']),
      observation('scenario-b', 'query-b', 0, ['temporal-conflict']),
      observation('scenario-c', 'query-c', 0, ['temporal-conflict']),
      observation('scenario-d', 'query-d', 0, ['temporal-conflict']),
    ]

    expect(
      valueOf(
        aggregateStatistic(rows, {
          kind: 'composite',
          metric: 'ndcgAtK',
          slices: ['graph-multi-hop', 'temporal-conflict'],
        }),
      ),
    ).toBe(0.5)
    expect(valueOf(aggregateStatistic(rows, { kind: 'overall', metric: 'ndcgAtK' }))).toBe(0.25)
  })

  test('counts a multi-labeled query once per slice and rejects an empty required slice', () => {
    const rows = [observation('scenario-a', 'query-a', 0.75, ['long-range', 'knowledge-update'])]

    expect(valueOf(aggregateStatistic(rows, { kind: 'slice', metric: 'ndcgAtK', slice: 'long-range' }))).toBe(0.75)
    expect(
      aggregateStatistic(rows, {
        kind: 'composite',
        metric: 'ndcgAtK',
        slices: ['long-range', 'abstention'],
      }).valid,
    ).toBeFalse()
  })
})

const passingGates = {
  scopeSafety: 'pass',
  erasureSafety: 'pass',
  selfHosting: 'pass',
  reproducibility: 'pass',
} as const

const perfectQuality = {
  recallAtK: 1,
  ndcgAtK: 1,
  reciprocalRank: 1,
  precisionAtK: 1,
  relationalTemporalComposite: 1,
  missingEmbeddingRecallAtK: 1,
  duplicateOutOfOrderRecallAtK: 1,
} as const

const resources = {
  retrievalP95Ms: 10,
  ingestThroughputPerSecond: 1_000,
  storedBytes: 10_000,
  incrementalRssBytes: 20_000,
} as const

const efficiencyBaseline = (overrides: Partial<EfficiencyBaseline> = {}): EfficiencyBaseline => ({
  candidateId: 'as-shipped',
  split: 'sealed-test',
  scale: 10_000,
  resources,
  ...overrides,
})

const scoreInput = (overrides: Partial<CandidateScoreInput> = {}): CandidateScoreInput => ({
  candidateId: 'corrected-hybrid',
  split: 'sealed-test',
  scale: 10_000,
  gates: passingGates,
  quality: perfectQuality,
  resources,
  rebuildProbes: [{ status: 'success', orderedHitIdsEqual: true }],
  ...overrides,
})

describe('weighted decision score', () => {
  test('scores the exact 100-point formula and registered efficiency ratios', () => {
    const perfect = computeWeightedScore(scoreInput(), efficiencyBaseline())
    expect(scoredTotal(perfect)).toBe(100)

    const slower = computeWeightedScore(
      scoreInput({
        resources: {
          retrievalP95Ms: 20,
          ingestThroughputPerSecond: 500,
          storedBytes: 20_000,
          incrementalRssBytes: 40_000,
        },
      }),
      efficiencyBaseline(),
    )
    expect(scoredTotal(slower)).toBe(95)
  })

  test('invalidates every non-positive efficiency input and a non-primary scale', () => {
    const fields = ['retrievalP95Ms', 'ingestThroughputPerSecond', 'storedBytes', 'incrementalRssBytes'] as const
    const invalidValues = [0, -1, Number.NaN, Number.POSITIVE_INFINITY] as const
    fields.forEach((field) => {
      invalidValues.forEach((invalidValue) => {
        expect(
          computeWeightedScore(scoreInput({ resources: { ...resources, [field]: invalidValue } }), efficiencyBaseline())
            .status,
        ).toBe('invalid')
        expect(
          computeWeightedScore(scoreInput(), efficiencyBaseline({ resources: { ...resources, [field]: invalidValue } }))
            .status,
        ).toBe('invalid')
      })
    })
    expect(computeWeightedScore(scoreInput({ scale: 1_000 }), efficiencyBaseline()).status).toBe('invalid')
    expect(computeWeightedScore(scoreInput(), efficiencyBaseline({ scale: 1_000 })).status).toBe('invalid')
  })

  test('retains failed rebuild probes as zero, rejects no probes, and requires passing gates', () => {
    const failed = computeWeightedScore(
      scoreInput({ rebuildProbes: [{ status: 'timeout', orderedHitIdsEqual: false }] }),
      efficiencyBaseline(),
    )
    expect(scoredTotal(failed)).toBe(95)
    expect(computeWeightedScore(scoreInput({ rebuildProbes: [] }), efficiencyBaseline()).status).toBe('invalid')
    expect(
      computeWeightedScore(scoreInput({ gates: { ...passingGates, erasureSafety: 'fail' } }), efficiencyBaseline())
        .status,
    ).toBe('ineligible')
  })
})

describe('tri-state universal gates', () => {
  test('gives an observed safety violation precedence over unevaluable probes', () => {
    expect(
      evaluateSafetyGate([
        { status: 'timeout', violationCount: 0 },
        { status: 'success', violationCount: 1 },
      ]),
    ).toBe('fail')
    expect(evaluateSafetyGate([{ status: 'timeout', violationCount: 0 }])).toBe('not_evaluable')
    expect(evaluateSafetyGate([{ status: 'success', violationCount: 0 }])).toBe('pass')
    expect(evaluateSafetyGate([])).toBe('not_evaluable')
  })

  test('requires explicit offline execution and complete valid reproducibility evidence', () => {
    const offline = {
      registration: 'valid',
      execution: 'success',
      requiresNetwork: false,
      requiresApiKey: false,
      requiresHostedModel: false,
      requiresProprietaryService: false,
      requiresManagedDatabase: false,
    } as const
    expect(evaluateSelfHostingGate(offline)).toBe('pass')
    expect(evaluateSelfHostingGate({ ...offline, requiresNetwork: true })).toBe('fail')
    expect(evaluateSelfHostingGate({ ...offline, registration: 'missing' })).toBe('not_evaluable')
    const completeInventory = {
      manifests: 'valid',
      implementationHashes: 'valid',
      sourceHashes: 'valid',
      rawRows: 'valid',
      failureRows: 'valid',
      aggregates: 'valid',
      requiredOutputs: 'valid',
    } as const
    expect(evaluateReproducibilityGate(completeInventory)).toBe('pass')
    expect(evaluateReproducibilityGate({ manifests: 'valid' })).toBe('not_evaluable')
    expect(evaluateReproducibilityGate({ ...completeInventory, rawRows: 'missing' })).toBe('not_evaluable')
    expect(evaluateReproducibilityGate({ ...completeInventory, failureRows: 'invalid' })).toBe('fail')
  })
})

const positiveInterval = { pointDelta: 0.05, lower95: Number.EPSILON, upper95: 0.1 } as const

describe('practical superiority gates', () => {
  test('applies exact general and hierarchy-special boundaries', () => {
    expect(evaluatePracticalSuperiority({ weightedScoreDelta: 2, overallNdcgDelta: positiveInterval })).toBeTrue()
    expect(
      evaluatePracticalSuperiority({ weightedScoreDelta: 1.999_999, overallNdcgDelta: positiveInterval }),
    ).toBeFalse()
    expect(
      evaluatePracticalSuperiority({
        weightedScoreDelta: 2,
        overallNdcgDelta: { ...positiveInterval, lower95: 0 },
      }),
    ).toBeFalse()

    expect(
      evaluateHierarchySuperiority({
        weightedScoreDelta: -2,
        overallNdcgDelta: { pointDelta: 0, lower95: 0, upper95: 0 },
        longHorizonDelta: positiveInterval,
      }),
    ).toEqual({ pass: true, path: 'special' })
    expect(
      evaluateHierarchySuperiority({
        weightedScoreDelta: -2.000_001,
        overallNdcgDelta: { pointDelta: 0, lower95: 0, upper95: 0 },
        longHorizonDelta: positiveInterval,
      }).pass,
    ).toBeFalse()
    expect(
      evaluatePracticalSuperiority({
        weightedScoreDelta: 2,
        overallNdcgDelta: { pointDelta: 0.05, lower95: 0.1, upper95: 0.01 },
      }),
    ).toBeFalse()
    expect(
      evaluateHierarchySuperiority({
        weightedScoreDelta: -2,
        overallNdcgDelta: { pointDelta: 0, lower95: 0, upper95: 0 },
        longHorizonDelta: { ...positiveInterval, pointDelta: 0.049_999 },
      }).pass,
    ).toBeFalse()
    expect(
      evaluateHierarchySuperiority({
        weightedScoreDelta: -2,
        overallNdcgDelta: { pointDelta: 0, lower95: 0, upper95: 0 },
        longHorizonDelta: { ...positiveInterval, lower95: 0 },
      }).pass,
    ).toBeFalse()
  })
})

const graphGateInput = (overrides: Partial<GraphGateInput> = {}): GraphGateInput => ({
  comparatorId: 'corrected-hybrid',
  graphEligible: true,
  comparatorEligible: true,
  graphWeightedScore: 98,
  comparatorWeightedScore: 100,
  relationalTemporalDelta: positiveInterval,
  graphResources: {
    retrievalP95Ms: 200,
    ingestDurationMs: 150,
    attemptedRecordCount: 100,
    modelCallCount: 0,
    extractorCallCount: 0,
    storedBytes: 300,
  },
  comparatorResources: {
    retrievalP95Ms: 100,
    ingestDurationMs: 100,
    attemptedRecordCount: 100,
    modelCallCount: 0,
    extractorCallCount: 0,
    storedBytes: 100,
  },
  projectionRebuildable: true,
  ...overrides,
})

describe('graph gate and representation choice', () => {
  test('handles all registered call-cost zero cases', () => {
    expect(callCostRatio(0, 0)).toBe(1)
    expect(callCostRatio(1, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(callCostRatio(0, 1)).toBe(0)
    expect(callCostRatio(3, 2)).toBe(1.5)
  })

  test('passes every exact graph boundary and fails immediately beyond each one', () => {
    const boundary = valueOf(evaluateGraphGate(graphGateInput()))
    expect(boundary.pass).toBeTrue()

    const failures: readonly GraphGateInput[] = [
      graphGateInput({ graphWeightedScore: 97.999_999 }),
      graphGateInput({ relationalTemporalDelta: { ...positiveInterval, pointDelta: 0.049_999 } }),
      graphGateInput({ relationalTemporalDelta: { ...positiveInterval, lower95: 0 } }),
      graphGateInput({ graphResources: { ...graphGateInput().graphResources, retrievalP95Ms: 200.000_1 } }),
      graphGateInput({ graphResources: { ...graphGateInput().graphResources, ingestDurationMs: 150.000_1 } }),
      graphGateInput({ graphResources: { ...graphGateInput().graphResources, storedBytes: 300.000_1 } }),
      graphGateInput({
        graphResources: { ...graphGateInput().graphResources, modelCallCount: 1 },
      }),
      graphGateInput({ projectionRebuildable: false }),
    ]
    failures.forEach((input) => {
      expect(valueOf(evaluateGraphGate(input)).pass).toBeFalse()
    })
    expect(
      evaluateGraphGate(
        graphGateInput({
          graphResources: { ...graphGateInput().graphResources, attemptedRecordCount: 1.5 },
        }),
      ).valid,
    ).toBeFalse()
    expect(
      evaluateGraphGate(graphGateInput({ graphResources: { ...graphGateInput().graphResources, modelCallCount: 0.5 } }))
        .valid,
    ).toBeFalse()
    expect(
      valueOf(
        evaluateGraphGate(
          graphGateInput({
            graphResources: {
              ...graphGateInput().graphResources,
              attemptedRecordCount: 2,
              ingestDurationMs: 3,
              modelCallCount: 3,
            },
            comparatorResources: {
              ...graphGateInput().comparatorResources,
              attemptedRecordCount: 1,
              ingestDurationMs: 1,
              modelCallCount: 1,
            },
          }),
        ),
      ).pass,
    ).toBeTrue()
  })

  test('uses the frozen complexity tie-break and produces every finite outcome', () => {
    const tied = valueOf(
      selectStrongestEligibleNonGraph([
        { candidateId: 'hierarchical', eligible: true, weightedScore: 50 },
        { candidateId: 'corrected-hybrid', eligible: true, weightedScore: 50 },
        { candidateId: 'as-shipped', eligible: true, weightedScore: 50 },
      ]),
    )
    expect(tied).toBe('as-shipped')
    expect(
      selectStrongestEligibleNonGraph([
        { candidateId: 'as-shipped', eligible: true, weightedScore: null },
        { candidateId: 'corrected-hybrid', eligible: true, weightedScore: 50 },
      ]).valid,
    ).toBeFalse()

    const baseCandidates = [
      { candidateId: 'as-shipped', eligible: true, weightedScore: 90 },
      { candidateId: 'corrected-hybrid', eligible: false, weightedScore: null },
      { candidateId: 'hierarchical', eligible: false, weightedScore: null },
      { candidateId: 'temporal-graph', eligible: false, weightedScore: null },
    ] as const
    expect(valueOf(decideRepresentation({ candidates: baseCandidates, promotions: [], graphGate: null })).outcome).toBe(
      'retain-shipped-behavior',
    )
    expect(
      valueOf(
        decideRepresentation({
          candidates: [
            baseCandidates[0],
            { ...baseCandidates[1], eligible: true, weightedScore: 92 },
            baseCandidates[2],
            baseCandidates[3],
          ],
          promotions: [
            {
              challenger: 'corrected-hybrid',
              comparator: 'as-shipped',
              weightedScoreDelta: 2,
              overallNdcgDelta: positiveInterval,
            },
          ],
          graphGate: null,
        }),
      ).outcome,
    ).toBe('repair-hybrid')
    expect(
      valueOf(
        decideRepresentation({
          candidates: [
            { ...baseCandidates[0], eligible: false, weightedScore: null },
            { ...baseCandidates[1], eligible: true, weightedScore: 92 },
            { ...baseCandidates[2], eligible: true, weightedScore: 91 },
            baseCandidates[3],
          ],
          promotions: [
            {
              challenger: 'hierarchical',
              comparator: 'corrected-hybrid',
              weightedScoreDelta: -1,
              overallNdcgDelta: { pointDelta: 0, lower95: 0, upper95: 0 },
              longHorizonDelta: positiveInterval,
            },
          ],
          graphGate: null,
        }),
      ).outcome,
    ).toBe('adopt-hierarchy')
    const graphGate = valueOf(evaluateGraphGate(graphGateInput()))
    expect(
      valueOf(
        decideRepresentation({
          candidates: [
            { ...baseCandidates[0], eligible: false, weightedScore: null },
            { ...baseCandidates[1], eligible: true, weightedScore: 100 },
            baseCandidates[2],
            { ...baseCandidates[3], eligible: true, weightedScore: 98 },
          ],
          promotions: [],
          graphGate,
        }),
      ).outcome,
    ).toBe('add-derived-temporal-graph')
    expect(
      valueOf(
        decideRepresentation({
          candidates: baseCandidates.map((candidate) => ({ ...candidate, eligible: false, weightedScore: null })),
          promotions: [],
          graphGate: null,
        }),
      ).outcome,
    ).toBe('block-adoption')
  })

  test('rejects promotion evidence whose weighted-score delta disagrees with candidate scores', () => {
    const result = decideRepresentation({
      candidates: [
        { candidateId: 'as-shipped', eligible: true, weightedScore: 90 },
        { candidateId: 'corrected-hybrid', eligible: true, weightedScore: 91 },
        { candidateId: 'hierarchical', eligible: false, weightedScore: null },
        { candidateId: 'temporal-graph', eligible: false, weightedScore: null },
      ],
      promotions: [
        {
          challenger: 'corrected-hybrid',
          comparator: 'as-shipped',
          weightedScoreDelta: 2,
          overallNdcgDelta: positiveInterval,
        },
      ],
      graphGate: null,
    })

    expect(result).toEqual({
      valid: false,
      errors: ['promotion corrected-hybrid vs as-shipped weighted-score delta does not match candidate scores'],
    })
  })
})

const storageRuns = (latencyMs = 250, rssBytes = STORAGE_RSS_THRESHOLD_BYTES): readonly StorageRun[] =>
  FROZEN_100K_SCENARIO_IDS.map((scenarioId) => ({
    scenarioId,
    status: 'success',
    freshWorker: true,
    fixturesMaterializedBeforeReset: true,
    primaryScopeStoredRecordCount: FROZEN_100K_STORED_RECORDS,
    recordsOutsidePrimaryScope: 0,
    warmupCount: 1,
    measuredLatenciesMs: Array.from({ length: FROZEN_100K_MEASURED_RETRIEVALS }, () => latencyMs),
    incrementalRssBytes: rssBytes,
    absoluteProcessPeakRssBytes: rssBytes * 2,
    rssCapture: 'current-pre-serialization',
  }))

const oneSlowStorageSample = (): readonly StorageRun[] =>
  storageRuns().map((run, index) => ({
    ...run,
    measuredLatenciesMs: index === 0 ? [250.000_1, ...run.measuredLatenciesMs.slice(1)] : run.measuredLatenciesMs,
  }))

describe('frozen 100k storage decision', () => {
  test('keeps SQLite at both inclusive thresholds and opens evaluation immediately beyond either', () => {
    expect(evaluateStorageDecision(storageRuns())).toMatchObject({
      status: 'decided',
      decision: 'keep-sqlite',
      pooledP95Ms: 250,
      maxIncrementalRssBytes: STORAGE_RSS_THRESHOLD_BYTES,
    })
    expect(evaluateStorageDecision(storageRuns(250.000_1))).toMatchObject({
      status: 'decided',
      decision: 'open-migration-evaluation',
    })
    expect(evaluateStorageDecision(storageRuns(250, STORAGE_RSS_THRESHOLD_BYTES + 1))).toMatchObject({
      status: 'decided',
      decision: 'open-migration-evaluation',
    })
    expect(evaluateStorageDecision(oneSlowStorageSample())).toMatchObject({
      status: 'decided',
      decision: 'keep-sqlite',
      pooledP95Ms: 250,
    })
  })

  test('blocks missing, failed, wrong-selection, and wrong-sample workloads', () => {
    expect(evaluateStorageDecision(storageRuns().slice(1)).status).toBe('blocked')
    expect(
      evaluateStorageDecision([{ ...storageRuns()[0]!, status: 'failure' }, ...storageRuns().slice(1)]).status,
    ).toBe('blocked')
    expect(
      evaluateStorageDecision([
        { ...storageRuns()[0]!, scenarioId: 'scenario-personal-en-023' },
        ...storageRuns().slice(1),
      ]).status,
    ).toBe('blocked')
    expect(
      evaluateStorageDecision([
        { ...storageRuns()[0]!, measuredLatenciesMs: storageRuns()[0]!.measuredLatenciesMs.slice(1) },
        ...storageRuns().slice(1),
      ]).status,
    ).toBe('blocked')
    ;[
      { freshWorker: false },
      { fixturesMaterializedBeforeReset: false },
      { primaryScopeStoredRecordCount: FROZEN_100K_STORED_RECORDS - 1 },
      { recordsOutsidePrimaryScope: 1 },
      { warmupCount: 0 },
      { rssCapture: 'absolute-process-peak' as const },
    ].forEach((override) => {
      expect(evaluateStorageDecision([{ ...storageRuns()[0]!, ...override }, ...storageRuns().slice(1)]).status).toBe(
        'blocked',
      )
    })
  })
})
