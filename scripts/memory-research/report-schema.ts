// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { PublicDatasetIdSchema, PublicDatasetProfileSchema } from './importer-types.js'
import { RunManifestSchema } from './manifest.js'
import {
  AggregateReportSchema,
  CandidateIdSchema,
  MemoryQuerySchema,
  QueryIdSchema,
  QueryMetricsSchema,
  RawQueryResultSchema,
  ResourceMetricsSchema,
  ScenarioIdSchema,
  ScenarioSplitSchema,
  SliceLabelSchema,
} from './types.js'

export const REPORT_SCHEMA_VERSION = 'memory-research-report-v1'
export const SOURCE_INVENTORY_CONTRACT_VERSION = 'memory-research-source-inventory-v1'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const localPathSchema = z
  .string()
  .min(1)
  .refine((path) => !/^[a-z][a-z0-9+.-]*:\/\//iu.test(path), {
    message: 'validated dataset local path cannot be a URL',
  })

export const ScenarioSelectionSchema = z
  .object({
    suite: z.string().min(1),
    split: ScenarioSplitSchema,
    scenarioIds: z.array(ScenarioIdSchema).min(1).readonly(),
    selectionSha256: sha256Schema,
  })
  .strict()
  .readonly()

export const ResearchSourceFileSchema = z
  .object({
    path: z.string().min(1),
    sha256: sha256Schema,
  })
  .strict()
  .readonly()

export const ResearchSourceInventorySchema = z
  .object({
    contractVersion: z.literal(SOURCE_INVENTORY_CONTRACT_VERSION),
    scope: z.enum(['complete', 'fixture']),
    pathsSha256: sha256Schema,
  })
  .strict()
  .readonly()

export const GateStateSchema = z.enum(['pass', 'fail', 'not_evaluable'])

const gateResultSchema = z
  .object({
    state: GateStateSchema,
    evidence: z.string().min(1),
  })
  .strict()
  .readonly()

const queryDiagnosticsSchema = z
  .object({
    forbiddenHitCount: z.number().int().nonnegative(),
    erasedHitCount: z.number().int().nonnegative(),
  })
  .strict()
  .readonly()

export const RawQueryEvaluationSchema = z
  .object({
    query: MemoryQuerySchema,
    rawResult: RawQueryResultSchema,
    metrics: QueryMetricsSchema,
    diagnostics: queryDiagnosticsSchema,
  })
  .strict()
  .readonly()

export const ScenarioEvaluationSchema = z
  .object({
    scenarioId: ScenarioIdSchema,
    queries: z.array(RawQueryEvaluationSchema).min(1).readonly(),
  })
  .strict()
  .readonly()

const sliceAggregateSchema = z
  .object({
    slice: SliceLabelSchema,
    aggregate: AggregateReportSchema,
  })
  .strict()
  .readonly()

export const RunFailureSchema = z
  .object({
    scenarioId: ScenarioIdSchema.nullable(),
    queryId: QueryIdSchema.nullable(),
    stage: z.enum(['setup', 'ingest', 'forget', 'restart', 'rebuild', 'retrieve', 'context', 'resource']),
    kind: z.enum(['exception', 'timeout', 'validation', 'safety']),
    message: z.string().min(1),
  })
  .strict()
  .readonly()

export const LifecycleEntrySchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    scenarioId: ScenarioIdSchema,
    kind: z.enum([
      'scale-ingest',
      'event-ingest',
      'embedding-version-change',
      'forget',
      'recapture-attempt',
      'restart',
      'rebuild',
      'query',
    ]),
    referenceId: z.string().min(1),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .readonly()

export const RebuildProbeSchema = z
  .object({
    queryId: QueryIdSchema,
    beforeHitIds: z.array(z.string().min(1)).readonly(),
    afterHitIds: z.array(z.string().min(1)).readonly(),
    status: z.enum(['success', 'failure', 'timeout']),
  })
  .strict()
  .readonly()

export const RebuildAgreementSchema = z
  .object({
    probeCount: z.number().int().nonnegative(),
    agreementCount: z.number().int().nonnegative(),
    exact: z.boolean(),
    probes: z.array(RebuildProbeSchema).readonly(),
  })
  .strict()
  .readonly()

const candidateRegistrationSchema = z
  .object({
    id: CandidateIdSchema,
    version: z.string().min(1),
    config: z.record(z.string(), z.json()),
    implementationSha256: sha256Schema,
    implementationSourcePaths: z.array(z.string().min(1)).min(1).readonly().nullable(),
    selfHosting: z
      .object({
        executionMode: z.enum(['offline', 'external']),
        requiresNetwork: z.boolean(),
        requiresApiKey: z.boolean(),
        requiresHostedModel: z.boolean(),
        requiresProprietaryService: z.boolean(),
        requiresManagedDatabase: z.boolean(),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly()

export const CandidateWorkerResultSchema = z
  .object({
    workerPid: z.number().int().positive(),
    scenarioId: ScenarioIdSchema,
    status: z.enum(['completed', 'failure', 'timeout']),
    resourceStatus: z.enum(['measured', 'missing']),
    resources: ResourceMetricsSchema.nullable(),
  })
  .strict()
  .superRefine((worker, context) => {
    if (worker.resourceStatus === 'measured' && worker.resources === null) {
      context.addIssue({ code: 'custom', message: 'measured worker resources cannot be null' })
    }
    if (worker.resourceStatus === 'missing' && worker.resources !== null) {
      context.addIssue({ code: 'custom', message: 'missing worker resources must be null' })
    }
  })
  .readonly()

export const CandidateResearchResultSchema = z
  .object({
    registration: candidateRegistrationSchema,
    manifest: RunManifestSchema,
    scenarios: z.array(ScenarioEvaluationSchema).min(1).readonly(),
    aggregate: AggregateReportSchema,
    sliceAggregates: z.array(sliceAggregateSchema).min(1).readonly(),
    resources: ResourceMetricsSchema,
    resourcesComplete: z.boolean(),
    workers: z.array(CandidateWorkerResultSchema).min(1).readonly(),
    failures: z.array(RunFailureSchema).readonly(),
    lifecycle: z.array(LifecycleEntrySchema).readonly(),
    rebuildAgreement: RebuildAgreementSchema,
    gates: z
      .object({
        scopeIsolation: gateResultSchema,
        erasure: gateResultSchema,
        selfHosting: gateResultSchema,
        reproducibility: gateResultSchema,
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly()

const publicDatasetRunSchema = z
  .object({
    datasetId: PublicDatasetIdSchema,
    profile: PublicDatasetProfileSchema.nullable(),
    sourceSha256: sha256Schema.nullable(),
    localPath: localPathSchema.nullable(),
    importStatus: z.enum(['not_supplied', 'validated']),
    protocolStatus: z.literal('not_run'),
    reason: z.string().min(1),
  })
  .strict()
  .superRefine((entry, context) => {
    const hasImportedIdentity = entry.profile !== null && entry.sourceSha256 !== null && entry.localPath !== null
    if (entry.importStatus === 'validated' && !hasImportedIdentity) {
      context.addIssue({
        code: 'custom',
        message: 'validated import requires profile, source SHA-256, and local path',
      })
    }
    if (
      entry.importStatus === 'not_supplied' &&
      (entry.profile !== null || entry.sourceSha256 !== null || entry.localPath !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'unsupplied import cannot claim profile, source SHA-256, or local path',
      })
    }
  })
  .readonly()

export const ResearchReportSchema = z
  .object({
    schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
    selection: ScenarioSelectionSchema,
    sourceInventory: ResearchSourceInventorySchema,
    sourceFiles: z.array(ResearchSourceFileSchema).min(1).readonly(),
    implementationSha256: sha256Schema,
    candidates: z.array(CandidateResearchResultSchema).min(1).readonly(),
    publicDatasets: z.array(publicDatasetRunSchema).length(4).readonly(),
  })
  .strict()
  .readonly()

export type ScenarioSelection = z.infer<typeof ScenarioSelectionSchema>
export type ResearchSourceFile = z.infer<typeof ResearchSourceFileSchema>
export type ResearchSourceInventory = z.infer<typeof ResearchSourceInventorySchema>
export type RawQueryEvaluation = z.infer<typeof RawQueryEvaluationSchema>
export type ScenarioEvaluation = z.infer<typeof ScenarioEvaluationSchema>
export type RunFailure = z.infer<typeof RunFailureSchema>
export type LifecycleEntry = z.infer<typeof LifecycleEntrySchema>
export type RebuildProbe = z.infer<typeof RebuildProbeSchema>
export type RebuildAgreement = z.infer<typeof RebuildAgreementSchema>
export type CandidateResearchResult = z.infer<typeof CandidateResearchResultSchema>
export type CandidateWorkerResult = z.infer<typeof CandidateWorkerResultSchema>
export type ResearchReport = z.infer<typeof ResearchReportSchema>
