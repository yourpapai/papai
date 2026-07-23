// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { SCENARIO_MANIFEST_VERSION } from './manifest.js'
import { FROZEN_100K_SEED } from './statistics-storage.js'
import { BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED } from './statistics.js'
import { CandidateIdSchema } from './types.js'

export const DECISION_ANALYSIS_SCHEMA_VERSION = 'memory-research-decision-v1'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const finiteSchema = z.number()
const unitSchema = finiteSchema.min(0).max(1)
const gateStateSchema = z.enum(['pass', 'fail', 'not_evaluable'])
const costRatioSchema = z.union([finiteSchema.nonnegative(), z.literal('infinity')])

export const DecisionArtifactSchema = z
  .object({
    path: z.string().min(1),
    sha256: sha256Schema,
  })
  .strict()
  .readonly()

const qualitySnapshotSchema = z
  .object({
    precisionAtK: unitSchema,
    recallAtK: unitSchema,
    reciprocalRank: unitSchema,
    ndcgAtK: unitSchema,
    relationalTemporalComposite: unitSchema,
    longHorizonComposite: unitSchema,
    missingEmbeddingRecallAtK: unitSchema,
    duplicateOutOfOrderRecallAtK: unitSchema,
  })
  .strict()
  .readonly()

const scoreResourcesSchema = z
  .object({
    retrievalP95Ms: finiteSchema.nonnegative(),
    ingestThroughputPerSecond: finiteSchema.nonnegative(),
    storedBytes: z.number().int().nonnegative(),
    incrementalRssBytes: z.number().int(),
  })
  .strict()
  .readonly()

const graphCostResourcesSchema = z
  .object({
    retrievalP95Ms: finiteSchema.nonnegative(),
    ingestDurationMs: finiteSchema.nonnegative(),
    attemptedRecordCount: z.number().int().nonnegative(),
    modelCallCount: z.number().int().nonnegative(),
    extractorCallCount: z.number().int().nonnegative(),
    storedBytes: z.number().int().nonnegative(),
  })
  .strict()
  .readonly()

const gateStatesSchema = z
  .object({
    scopeSafety: gateStateSchema,
    erasureSafety: gateStateSchema,
    selfHosting: gateStateSchema,
    reproducibility: gateStateSchema,
  })
  .strict()
  .readonly()

const weightedScoreSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('scored'),
      total: finiteSchema,
      components: z.record(z.string().min(1), finiteSchema),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal('ineligible'),
      reasons: z.array(z.string().min(1)).min(1).readonly(),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal('invalid'),
      errors: z.array(z.string().min(1)).min(1).readonly(),
    })
    .strict()
    .readonly(),
])

export const StorageDecisionAnalysisSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('decided'),
      decision: z.enum(['keep-sqlite', 'open-migration-evaluation']),
      pooledP95Ms: finiteSchema.nonnegative(),
      maxIncrementalRssBytes: finiteSchema.nonnegative(),
      perCellP95Ms: z.record(z.string().min(1), finiteSchema.nonnegative()),
    })
    .strict()
    .readonly(),
  z
    .object({
      status: z.literal('blocked'),
      errors: z.array(z.string().min(1)).min(1).readonly(),
    })
    .strict()
    .readonly(),
])

const rebuildSummarySchema = z
  .object({
    probeCount: z.number().int().nonnegative(),
    agreementCount: z.number().int().nonnegative(),
    agreementRate: unitSchema,
  })
  .strict()
  .readonly()

export const CandidateDecisionAnalysisSchema = z
  .object({
    candidateId: CandidateIdSchema,
    primary: qualitySnapshotSchema,
    sensitivity: qualitySnapshotSchema,
    gates: gateStatesSchema,
    resources: scoreResourcesSchema,
    graphCost: graphCostResourcesSchema,
    rebuild: rebuildSummarySchema,
    weightedScore: weightedScoreSchema,
    storageDecision: StorageDecisionAnalysisSchema,
  })
  .strict()
  .readonly()

const pairedIntervalSchema = z
  .object({
    seed: z.literal(BOOTSTRAP_SEED),
    resamples: z.literal(BOOTSTRAP_RESAMPLES),
    unit: z.literal('scenario'),
    pointDelta: finiteSchema,
    lower95: finiteSchema,
    upper95: finiteSchema,
  })
  .strict()
  .refine(({ lower95, upper95 }) => lower95 <= upper95, {
    message: 'paired interval lower bound exceeds upper bound',
  })
  .readonly()

export const PairedDecisionComparisonSchema = z
  .object({
    candidateId: CandidateIdSchema,
    comparatorId: CandidateIdSchema,
    statistic: z.enum(['overall-ndcg', 'long-horizon-ndcg', 'relational-temporal-ndcg']),
    interval: pairedIntervalSchema,
  })
  .strict()
  .refine(({ candidateId, comparatorId }) => candidateId !== comparatorId, {
    message: 'paired comparison requires different candidates',
  })
  .readonly()

const promotionEvidenceSchema = z
  .object({
    challenger: z.enum(['corrected-hybrid', 'hierarchical']),
    comparator: z.enum(['as-shipped', 'corrected-hybrid', 'hierarchical']),
    weightedScoreDelta: finiteSchema,
    overallNdcgDelta: pairedIntervalSchema,
    longHorizonDelta: pairedIntervalSchema.optional(),
  })
  .strict()
  .readonly()

const graphGateSchema = z
  .object({
    pass: z.boolean(),
    comparatorId: z.enum(['as-shipped', 'corrected-hybrid', 'hierarchical']),
    ratios: z
      .object({
        retrievalP95: costRatioSchema,
        ingestCostPerAttempt: costRatioSchema,
        callCostPerAttempt: costRatioSchema,
        storedBytes: costRatioSchema,
      })
      .strict()
      .readonly(),
    failedCriteria: z.array(z.string().min(1)).readonly(),
  })
  .strict()
  .readonly()

const representationDecisionSchema = z
  .object({
    outcome: z.enum([
      'retain-shipped-behavior',
      'repair-hybrid',
      'adopt-hierarchy',
      'add-derived-temporal-graph',
      'block-adoption',
    ]),
    candidateId: CandidateIdSchema.nullable(),
  })
  .strict()
  .readonly()

const publicDatasetStatusSchema = z
  .object({
    datasetId: z.enum(['longmemeval', 'locomo', 'memoryagentbench', 'membench']),
    importStatus: z.enum(['not_supplied', 'validated']),
    protocolStatus: z.literal('not_run'),
    reason: z.string().min(1),
  })
  .strict()
  .readonly()

export const DecisionAnalysisSchema = z
  .object({
    schemaVersion: z.literal(DECISION_ANALYSIS_SCHEMA_VERSION),
    artifacts: z
      .object({
        primary: DecisionArtifactSchema,
        sensitivity: DecisionArtifactSchema,
        storage: DecisionArtifactSchema,
      })
      .strict()
      .readonly(),
    freeze: z
      .object({
        scenarioManifestVersion: z.literal(SCENARIO_MANIFEST_VERSION),
        scenarioManifestSha256: sha256Schema,
        selectionSha256: sha256Schema,
        seed: z.literal(FROZEN_100K_SEED),
        primaryScale: z.literal(10_000),
        sensitivityScale: z.literal(1_000),
        bootstrapSeed: z.literal(BOOTSTRAP_SEED),
        bootstrapResamples: z.literal(BOOTSTRAP_RESAMPLES),
      })
      .strict()
      .readonly(),
    implementationSha256: sha256Schema,
    candidates: z.array(CandidateDecisionAnalysisSchema).length(4).readonly(),
    pairedComparisons: z.array(PairedDecisionComparisonSchema).readonly(),
    promotions: z.array(promotionEvidenceSchema).readonly(),
    strongestEligibleNonGraph: z.enum(['as-shipped', 'corrected-hybrid', 'hierarchical']).nullable(),
    graphGate: graphGateSchema.nullable(),
    representationDecision: representationDecisionSchema,
    selectedStorageDecision: z
      .object({
        candidateId: CandidateIdSchema,
        result: StorageDecisionAnalysisSchema,
      })
      .strict()
      .readonly()
      .nullable(),
    publicDatasets: z.array(publicDatasetStatusSchema).length(4).readonly(),
    limitations: z.array(z.string().min(1)).min(1).readonly(),
  })
  .strict()
  .readonly()

export type DecisionArtifact = z.infer<typeof DecisionArtifactSchema>
export type CandidateDecisionAnalysis = z.infer<typeof CandidateDecisionAnalysisSchema>
export type PairedDecisionComparison = z.infer<typeof PairedDecisionComparisonSchema>
export type DecisionAnalysis = z.infer<typeof DecisionAnalysisSchema>
