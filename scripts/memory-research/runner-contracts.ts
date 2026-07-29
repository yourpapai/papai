// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { candidateVersions } from './candidate-registry.js'
import { LifecycleEntrySchema, RebuildProbeSchema, RunFailureSchema, ScenarioEvaluationSchema } from './report.js'
import type { LifecycleEntry, RebuildProbe, RunFailure, ScenarioEvaluation } from './report.js'
import { CandidateIdSchema, MemoryScenarioSchema, ResourceMetricsSchema, ScaleProfileSchema } from './types.js'
import type { CandidateId, MemoryCandidateAdapter, MemoryScenario, ResourceMetrics, RunManifest } from './types.js'

export const ScenarioJobInputSchema = z
  .object({
    candidateId: CandidateIdSchema,
    scenario: MemoryScenarioSchema,
    scale: ScaleProfileSchema,
    seed: z.number().int().nonnegative(),
    queryTimeoutMs: z.number().int().positive(),
  })
  .strict()
  .readonly()

export type ScenarioJobInput = Readonly<{
  candidateId: CandidateId
  scenario: MemoryScenario
  scale: RunManifest['scale']
  seed: number
  queryTimeoutMs: number
}>

export type ScenarioJobResult = Readonly<{
  candidateId: CandidateId
  candidateVersion: string
  workerPid: number
  scenario: ScenarioEvaluation
  resources: ResourceMetrics
  failures: readonly RunFailure[]
  lifecycle: readonly LifecycleEntry[]
  rebuildProbes: readonly RebuildProbe[]
}>

export const ScenarioJobResultSchema = z
  .object({
    candidateId: CandidateIdSchema,
    candidateVersion: z.string().min(1),
    workerPid: z.number().int().positive(),
    scenario: ScenarioEvaluationSchema,
    resources: ResourceMetricsSchema,
    failures: z.array(RunFailureSchema).readonly(),
    lifecycle: z.array(LifecycleEntrySchema).readonly(),
    rebuildProbes: z.array(RebuildProbeSchema).readonly(),
  })
  .strict()
  .superRefine(({ candidateId, candidateVersion }, context) => {
    if (candidateVersion !== candidateVersions[candidateId]) {
      context.addIssue({
        code: 'custom',
        message: `candidate version must match static registration ${candidateVersions[candidateId]}`,
        path: ['candidateVersion'],
      })
    }
  })
  .readonly()

export type ScenarioJobDependencies = Readonly<{
  createCandidate?: () => MemoryCandidateAdapter
  monotonicNow?: () => number
}>
