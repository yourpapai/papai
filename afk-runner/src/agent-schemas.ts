// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * The agent layer's sidecar and classification schemas (findings,
 * resolutions, assumptions, depth) — data contracts, extraction seam for the
 * C7 re-tighten.
 */

export const FindingSchema = z.object({
  id: z.string().min(1),
  class: z.enum(['BLOCKER', 'MATERIAL', 'NITPICK']),
  gap: z.string().min(1),
  question: z.string().min(1),
  code_evidence_attempted: z.string().min(1),
})
export type Finding = z.infer<typeof FindingSchema>

export const FindingsSidecarSchema = z.object({ findings: z.array(FindingSchema) })

export const ResolutionSchema = z
  .object({
    id: z.string().min(1),
    class: z.enum(['BLOCKER', 'MATERIAL', 'NITPICK']),
    resolution: z.enum(['edited', 'evidence-answered', 'assumed', 'dismissed']),
    outcome: z.string().min(1).optional(),
    justification: z.string().min(1).optional(),
  })
  .refine((record) => record.resolution !== 'dismissed' || record.justification !== undefined, {
    message: 'dismissed resolutions require a justification',
  })
export type Resolution = z.infer<typeof ResolutionSchema>

export const ResolutionsSidecarSchema = z.object({ resolutions: z.array(ResolutionSchema) })

export const AssumptionRecordSchema = z.object({
  id: z.string().regex(/^A\d+$/u, 'assumptions[].id must follow the A-prefix convention (A1, A2, …)'),
  text: z.string().min(1),
  basis: z.enum(['code-evidence', 'convention', 'default']),
  confidence: z.enum(['high', 'medium', 'low']),
  blast_radius: z.string().min(1),
  status: z.enum(['open', 'confirmed', 'vetoed']),
  evidence: z.object({ files: z.array(z.string().min(1)).min(1) }),
  /**
   * The finding this assumption was logged against, when it came from one. It
   * is what lets an `assumed` resolution be closed as traceable rather than
   * taken on trust; sidecars written before the link existed carry none, and
   * the openness predicate falls back to a round-level check for those.
   */
  findingId: z.string().min(1).optional(),
})
export type AssumptionRecord = z.infer<typeof AssumptionRecordSchema>

export const AssumptionsSidecarSchema = z.object({ assumptions: z.array(AssumptionRecordSchema) })

export const DepthSignalsSchema = z.object({
  cross_module: z.boolean(),
  db_migration: z.boolean(),
  provider_surface: z.boolean(),
  credentials: z.boolean(),
  novelty: z.enum(['new-subsystem', 'existing-modules']),
})
export type DepthSignals = z.infer<typeof DepthSignalsSchema>

export const DepthClassificationSchema = z.object({
  implicated_files: z.array(z.string().min(1)),
  signals: DepthSignalsSchema,
  rationale: z.string().min(1),
  capabilities: z.array(z.string().min(1)).optional(),
})
export type DepthClassification = z.infer<typeof DepthClassificationSchema>
