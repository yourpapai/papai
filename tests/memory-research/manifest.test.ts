// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import {
  DETERMINISTIC_EMBEDDING_DIMENSION,
  DETERMINISTIC_EMBEDDING_VERSION,
} from '../../scripts/memory-research/deterministic-embedding.js'
import {
  createScenarioManifest,
  FROZEN_SCENARIO_MANIFEST,
  FROZEN_SCENARIO_MANIFEST_SHA256,
  RunManifestSchema,
  verifyScenarioManifest,
} from '../../scripts/memory-research/manifest.js'
import type { MemoryScenario } from '../../scripts/memory-research/types.js'

const hasCellSplit = (
  scenario: MemoryScenario,
  kind: MemoryScenario['primaryScope']['kind'],
  language: MemoryScenario['language'],
  split: MemoryScenario['split'],
): boolean => scenario.primaryScope.kind === kind && scenario.language === language && scenario.split === split

const swapScenarioSplits = (
  scenarios: readonly MemoryScenario[],
  developmentIndex: number,
  sealedIndex: number,
): readonly MemoryScenario[] => {
  const unbalanced = [...scenarios]
  unbalanced[developmentIndex] = { ...unbalanced[developmentIndex]!, split: 'sealed-test' }
  unbalanced[sealedIndex] = { ...unbalanced[sealedIndex]!, split: 'development' }
  return unbalanced
}

describe('scenario manifest', () => {
  test('freezes canonical count, balance, generator identity, and lowercase SHA-256', () => {
    const manifest = createScenarioManifest(memoryScenarios)

    expect(manifest.scenarioCount).toBe(240)
    expect(manifest.splitCounts).toEqual({ development: 60, sealedTest: 180 })
    expect(manifest.balanceCounts).toEqual({
      'personal:en': 60,
      'personal:ru': 60,
      'group:en': 60,
      'group:ru': 60,
    })
    expect(manifest.cellSplitCounts).toEqual({
      'personal:en': { development: 15, sealedTest: 45 },
      'personal:ru': { development: 15, sealedTest: 45 },
      'group:en': { development: 15, sealedTest: 45 },
      'group:ru': { development: 15, sealedTest: 45 },
    })
    expect(FROZEN_SCENARIO_MANIFEST_SHA256).toBe('283044dbd97c119b5b76a639f4f28792e4ff12cc0bdc73e6a81761b083bb12f7')
    expect(FROZEN_SCENARIO_MANIFEST).toEqual(manifest)
    expect(manifest.scenarioManifestSha256).toBe(FROZEN_SCENARIO_MANIFEST_SHA256)
    expect(verifyScenarioManifest(manifest, memoryScenarios)).toEqual({ valid: true })
  })

  test('rejects changed digest, changed count, and changed scenario content', () => {
    const manifest = createScenarioManifest(memoryScenarios)

    expect(
      verifyScenarioManifest({ ...manifest, scenarioManifestSha256: '0'.repeat(64) }, memoryScenarios),
    ).toMatchObject({ valid: false })
    expect(verifyScenarioManifest({ ...manifest, scenarioCount: 239 }, memoryScenarios)).toMatchObject({ valid: false })
    expect(
      verifyScenarioManifest(manifest, [{ ...memoryScenarios[0]!, seed: 1 }, ...memoryScenarios.slice(1)]),
    ).toMatchObject({ valid: false })
    expect(createScenarioManifest([...memoryScenarios].reverse()).scenarioManifestSha256).toBe(
      manifest.scenarioManifestSha256,
    )
    expect(
      createScenarioManifest([
        {
          ...memoryScenarios[0]!,
          events: [...memoryScenarios[0]!.events].reverse(),
        },
        ...memoryScenarios.slice(1),
      ]).scenarioManifestSha256,
    ).not.toBe(manifest.scenarioManifestSha256)
  })

  test('rejects self-consistent undersized and per-cell split-unbalanced corpora', () => {
    const undersized = memoryScenarios.slice(0, -1)
    const personalEnDevelopment = memoryScenarios.findIndex((scenario) =>
      hasCellSplit(scenario, 'personal', 'en', 'development'),
    )
    const personalRuSealed = memoryScenarios.findIndex((scenario) =>
      hasCellSplit(scenario, 'personal', 'ru', 'sealed-test'),
    )
    const unbalanced = swapScenarioSplits(memoryScenarios, personalEnDevelopment, personalRuSealed)

    expect(() => createScenarioManifest(undersized)).toThrow()
    expect(() => createScenarioManifest(unbalanced)).toThrow()
    expect(verifyScenarioManifest(createScenarioManifest(memoryScenarios), undersized)).toMatchObject({ valid: false })
  })
})

describe('run manifest', () => {
  const scenarioManifest = createScenarioManifest(memoryScenarios)
  const valid = {
    runId: 'run-synthetic-001',
    scenarioManifestVersion: scenarioManifest.scenarioManifestVersion,
    scenarioManifestSha256: scenarioManifest.scenarioManifestSha256,
    deterministicEmbeddingVersion: DETERMINISTIC_EMBEDDING_VERSION,
    deterministicEmbeddingDimension: DETERMINISTIC_EMBEDDING_DIMENSION,
    candidate: {
      id: 'corrected-hybrid',
      version: '1.0.0',
      config: { denseWeight: 0.5 },
    },
    split: 'development',
    scale: 1000,
    seed: 20260723,
    repository: {
      revision: 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a',
      dirty: true,
    },
    runtime: {
      bunVersion: '1.3.0',
      os: 'darwin',
      arch: 'arm64',
    },
    hardware: {
      cpuModel: 'synthetic-cpu',
      cpuCount: 8,
      totalMemoryBytes: 16_000_000_000,
    },
    startedAt: '2026-07-23T10:00:00.000Z',
    completedAt: '2026-07-23T10:01:00.000Z',
    faultConfiguration: {
      missingEmbeddingEvidenceIds: [],
      embeddingVersionChanges: [],
      duplicateEvidenceIds: [],
      ingestOrder: [],
      forgetRequests: [],
      nonRecaptureEvidenceIds: [],
      crossScopeProbeQueryIds: [],
      restartBeforeQueryIds: [],
      rebuildBeforeQueryIds: [],
    },
  } as const

  test('accepts a complete frozen run identity', () => {
    expect(RunManifestSchema.parse(valid)).toEqual(valid)
  })

  test('accepts a populated normalized fault schedule and rejects incomplete schedules', () => {
    const scenario = memoryScenarios.find(({ labels }) => labels.includes('cross-scope'))!
    const event = scenario.events[0]!
    const query = scenario.queries[0]!
    const configured = {
      ...valid,
      faultConfiguration: {
        missingEmbeddingEvidenceIds: [event.evidenceId],
        embeddingVersionChanges: [
          {
            evidenceId: event.evidenceId,
            fromVersion: DETERMINISTIC_EMBEDDING_VERSION,
            toVersion: 'papai-deterministic-bilingual-v2',
            changedAt: '2026-07-23T10:00:30.000Z',
          },
        ],
        duplicateEvidenceIds: [event.evidenceId],
        ingestOrder: [event.eventId],
        forgetRequests: [
          {
            kind: 'evidence',
            scope: scenario.primaryScope,
            evidenceIds: [event.evidenceId],
            completedAt: '2026-07-23T10:00:40.000Z',
          },
        ],
        nonRecaptureEvidenceIds: [event.evidenceId],
        crossScopeProbeQueryIds: [query.queryId],
        restartBeforeQueryIds: [query.queryId],
        rebuildBeforeQueryIds: [query.queryId],
      },
    }

    expect(RunManifestSchema.safeParse(configured).success).toBeTrue()
    const { rebuildBeforeQueryIds: _missing, ...incomplete } = configured.faultConfiguration
    expect(
      RunManifestSchema.safeParse({
        ...configured,
        faultConfiguration: incomplete,
      }).success,
    ).toBeFalse()
  })

  test('validates subject/scope forget targets and non-recapture coverage', () => {
    const graph = memoryScenarios.find(({ labels }) => labels.includes('graph-multi-hop'))!
    const subjectEvent = graph.events[0]!
    const subjectId = subjectEvent.entities[0]!.entityId
    const scoped = memoryScenarios.find(({ labels }) => labels.includes('direct-fact'))!
    const scopeEvent = scoped.events[0]!
    const covered = {
      ...valid,
      faultConfiguration: {
        ...valid.faultConfiguration,
        forgetRequests: [
          {
            kind: 'subject',
            scope: graph.primaryScope,
            subjectId,
            completedAt: '2026-07-23T10:00:20.000Z',
          },
          {
            kind: 'scope',
            scope: scoped.primaryScope,
            completedAt: '2026-07-23T10:00:30.000Z',
          },
        ],
        nonRecaptureEvidenceIds: [subjectEvent.evidenceId, scopeEvent.evidenceId],
      },
    }

    expect(RunManifestSchema.safeParse(covered).success).toBeTrue()
    expect(
      RunManifestSchema.safeParse({
        ...covered,
        faultConfiguration: {
          ...covered.faultConfiguration,
          forgetRequests: [
            {
              kind: 'subject',
              scope: graph.primaryScope,
              subjectId: 'entity-absent-subject',
              completedAt: '2026-07-23T10:00:20.000Z',
            },
          ],
        },
      }).success,
    ).toBeFalse()
    expect(
      RunManifestSchema.safeParse({
        ...covered,
        faultConfiguration: {
          ...covered.faultConfiguration,
          forgetRequests: [
            {
              kind: 'scope',
              scope: { kind: 'group', id: 'group-absent-scope' },
              completedAt: '2026-07-23T10:00:20.000Z',
            },
          ],
        },
      }).success,
    ).toBeFalse()
    expect(
      RunManifestSchema.safeParse({
        ...valid,
        faultConfiguration: {
          ...valid.faultConfiguration,
          nonRecaptureEvidenceIds: [scopeEvent.evidenceId],
        },
      }).success,
    ).toBeFalse()
  })

  test('rejects unknown keys, invalid identity, split, scale, and embedding mismatch', () => {
    expect(RunManifestSchema.safeParse({ ...valid, unknown: true }).success).toBeFalse()
    expect(RunManifestSchema.safeParse({ ...valid, scenarioManifestSha256: 'ABC' }).success).toBeFalse()
    expect(
      RunManifestSchema.safeParse({
        ...valid,
        scenarioManifestSha256: '0'.repeat(64),
      }).success,
    ).toBeFalse()
    expect(RunManifestSchema.safeParse({ ...valid, split: 'all' }).success).toBeFalse()
    expect(RunManifestSchema.safeParse({ ...valid, scale: 500 }).success).toBeFalse()
    expect(
      RunManifestSchema.safeParse({
        ...valid,
        deterministicEmbeddingDimension: DETERMINISTIC_EMBEDDING_DIMENSION + 1,
      }).success,
    ).toBeFalse()
    expect(
      RunManifestSchema.safeParse({
        ...valid,
        repository: { dirty: false },
      }).success,
    ).toBeFalse()
    expect(
      RunManifestSchema.safeParse({
        ...valid,
        faultConfiguration: {
          ...valid.faultConfiguration,
          restart: false,
        },
      }).success,
    ).toBeFalse()
  })
})
