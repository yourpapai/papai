// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { FROZEN_SCENARIO_MANIFEST, SCENARIO_MANIFEST_VERSION } from './manifest.js'
import type { ScenarioWorkload } from './runner.js'
import { FROZEN_100K_SEED } from './statistics-storage.js'
import type { StorageRun } from './statistics-storage.js'
import { CandidateIdSchema, MemoryScenarioSchema, ResourceMetricsSchema } from './types.js'
import type { CandidateId, MemoryCandidateAdapter, MemoryScenario, ResourceMetrics } from './types.js'

export const StorageJobInputSchema = z
  .object({
    candidateId: CandidateIdSchema,
    scenario: MemoryScenarioSchema,
    scenarioManifestVersion: z.literal(SCENARIO_MANIFEST_VERSION),
    scenarioManifestSha256: z.literal(FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256),
    seed: z.literal(FROZEN_100K_SEED),
    queryTimeoutMs: z.number().int().positive(),
  })
  .strict()
  .readonly()

export type StorageJobInput = Readonly<{
  candidateId: CandidateId
  scenario: MemoryScenario
  scenarioManifestVersion: typeof SCENARIO_MANIFEST_VERSION
  scenarioManifestSha256: typeof FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256
  seed: typeof FROZEN_100K_SEED
  queryTimeoutMs: number
}>

export const StorageRunSchema = z
  .object({
    scenarioId: z.string().min(1),
    status: z.enum(['success', 'failure', 'missing']),
    freshWorker: z.boolean(),
    fixturesMaterializedBeforeReset: z.boolean(),
    primaryScopeStoredRecordCount: z.number().int().nonnegative(),
    recordsOutsidePrimaryScope: z.number().int().nonnegative(),
    warmupCount: z.number().int().nonnegative(),
    measuredLatenciesMs: z.array(z.number().nonnegative()).readonly(),
    incrementalRssBytes: z.number().nonnegative(),
    absoluteProcessPeakRssBytes: z.number().nonnegative(),
    rssCapture: z.enum(['current-pre-serialization', 'absolute-process-peak']),
  })
  .strict()
  .readonly()

export const StorageJobResultSchema = z
  .object({
    candidateId: CandidateIdSchema,
    candidateVersion: z.string().min(1),
    workerPid: z.number().int().positive(),
    scenarioManifestVersion: z.literal(SCENARIO_MANIFEST_VERSION),
    scenarioManifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    run: StorageRunSchema,
    resources: ResourceMetricsSchema,
    failure: z.string().min(1).nullable(),
  })
  .strict()
  .readonly()

export type StorageJobResult = Readonly<{
  candidateId: CandidateId
  candidateVersion: string
  workerPid: number
  scenarioManifestVersion: typeof SCENARIO_MANIFEST_VERSION
  scenarioManifestSha256: string
  run: StorageRun
  resources: ResourceMetrics
  failure: string | null
}>

export type StorageJobDependencies = Readonly<{
  createCandidate?: () => MemoryCandidateAdapter
  materializeWorkload?: (scenario: MemoryScenario) => ScenarioWorkload
  monotonicNow?: () => number
}>
