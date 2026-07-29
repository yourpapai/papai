// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { SCENARIO_MANIFEST_VERSION } from './manifest.js'
import { ResearchSourceFileSchema, ResearchSourceInventorySchema } from './report.js'
import {
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_SEED,
  FROZEN_100K_STORED_RECORDS,
  FROZEN_100K_WARMUPS,
} from './statistics-storage.js'
import { StorageJobResultSchema } from './storage-contracts.js'
import { CandidateIdSchema } from './types.js'

export const STORAGE_REPORT_SCHEMA_VERSION = 'memory-research-storage-report-v1'

const storageDecisionSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('decided'),
      decision: z.enum(['keep-sqlite', 'open-migration-evaluation']),
      pooledP95Ms: z.number().nonnegative(),
      maxIncrementalRssBytes: z.number().nonnegative(),
      perCellP95Ms: z.record(z.string().min(1), z.number().nonnegative()),
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

const runtimeMetadataSchema = z
  .object({
    repository: z
      .object({
        revision: z.string().regex(/^[a-f0-9]{40}$/u),
        dirty: z.boolean(),
      })
      .strict()
      .readonly(),
    runtime: z
      .object({
        bunVersion: z.string().min(1),
        os: z.string().min(1),
        arch: z.string().min(1),
      })
      .strict()
      .readonly(),
    hardware: z
      .object({
        cpuModel: z.string().min(1),
        cpuCount: z.number().int().positive(),
        totalMemoryBytes: z.number().int().positive(),
      })
      .strict()
      .readonly(),
  })
  .strict()
  .readonly()

export const CandidateStorageReportSchema = z
  .object({
    candidateId: CandidateIdSchema,
    candidateVersion: z.string().min(1),
    implementationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    jobs: z.array(StorageJobResultSchema).length(4).readonly(),
    decision: storageDecisionSchema,
  })
  .strict()
  .readonly()

export const FrozenStorageReportSchema = z
  .object({
    schemaVersion: z.literal(STORAGE_REPORT_SCHEMA_VERSION),
    scenarioManifestVersion: z.literal(SCENARIO_MANIFEST_VERSION),
    scenarioManifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    seed: z.literal(FROZEN_100K_SEED),
    scale: z.literal(FROZEN_100K_STORED_RECORDS),
    warmupCount: z.literal(FROZEN_100K_WARMUPS),
    measuredRetrievalCount: z.literal(FROZEN_100K_MEASURED_RETRIEVALS),
    queryTimeoutMs: z.number().int().positive(),
    workerDeadlineMs: z.number().int().positive(),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    metadata: runtimeMetadataSchema,
    sourceInventory: ResearchSourceInventorySchema,
    sourceFiles: z.array(ResearchSourceFileSchema).min(1).readonly(),
    implementationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    candidates: z.array(CandidateStorageReportSchema).length(4).readonly(),
  })
  .strict()
  .readonly()

export type CandidateStorageReport = z.infer<typeof CandidateStorageReportSchema>
export type FrozenStorageReport = z.infer<typeof FrozenStorageReportSchema>
