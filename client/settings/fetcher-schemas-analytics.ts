// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const AnalyticsNoticeSchema = z
  .object({
    policyVersion: z.number().nullable(),
    noticeVersion: z.number().nullable(),
    purpose: z.string().nullable(),
    controllerContact: z.string().nullable(),
    lawfulBasisMode: z.enum(['consent', 'legitimate_interest']).nullable(),
    policyEffectiveAtMs: z.number().nullable(),
  })
  .strict()
export type AnalyticsNotice = z.infer<typeof AnalyticsNoticeSchema>

export const AnalyticsPreferenceStateSchema = z
  .object({
    localLongitudinal: z.enum(['allow', 'deny', 'unknown']),
    externalPseudonymous: z.enum(['allow', 'deny', 'unknown']),
    effectiveAtMs: z.number().nullable(),
  })
  .strict()
export type AnalyticsPreferenceState = z.infer<typeof AnalyticsPreferenceStateSchema>

export const AnalyticsPreferencesResponseSchema = z
  .object({
    notice: AnalyticsNoticeSchema,
    preference: AnalyticsPreferenceStateSchema,
    explanation: z.string(),
    subjectRightsAvailable: z.boolean(),
  })
  .strict()
export type AnalyticsPreferencesResponse = z.infer<typeof AnalyticsPreferencesResponseSchema>

export const AnalyticsPreferenceUpdateResponseSchema = z
  .object({ ok: z.literal(true), preference: AnalyticsPreferenceStateSchema })
  .strict()

export const AnalyticsExportSchema = z
  .object({
    productAnalytics: z
      .object({
        events: z.array(z.record(z.string(), z.unknown())),
        sessions: z.array(z.record(z.string(), z.unknown())),
        deliveries: z.array(z.record(z.string(), z.unknown())),
      })
      .strict(),
    governance: z
      .object({
        preference: z.object({ localLongitudinal: z.string(), externalPseudonymous: z.string() }).strict().nullable(),
        audit: z.array(z.record(z.string(), z.unknown())),
      })
      .strict(),
    coverage: z.literal('analytics_only'),
    outOfScope: z.string(),
  })
  .strict()
export type AnalyticsExport = z.infer<typeof AnalyticsExportSchema>

export const AnalyticsWithdrawResponseSchema = z
  .object({
    status: z.literal('completed'),
    eventsRemoved: z.number(),
    deliveryRowsRemoved: z.number(),
    censorsApplied: z.number(),
  })
  .strict()
export type AnalyticsWithdrawResponse = z.infer<typeof AnalyticsWithdrawResponseSchema>

export const AnalyticsDeleteResponseSchema = z
  .object({
    status: z.enum(['completed', 'in_progress', 'failed', 'requested']),
    coverage: z.literal('analytics_only'),
  })
  .strict()
export type AnalyticsDeleteResponse = z.infer<typeof AnalyticsDeleteResponseSchema>

export const AnalyticsSinkViewSchema = z
  .object({
    sinkVersionId: z.string(),
    logicalSinkId: z.string(),
    version: z.number(),
    kind: z.string(),
    egressMode: z.string(),
    state: z.string(),
    payloadSchemaVersion: z.number(),
    configFingerprint: z.string(),
    verifiedAtMs: z.number().nullable(),
    createdAtMs: z.number(),
    disabledAtMs: z.number().nullable(),
  })
  .strict()
export type AnalyticsSinkView = z.infer<typeof AnalyticsSinkViewSchema>

export const AdminAnalyticsResponseSchema = z
  .object({
    configVersion: z.number(),
    mode: z
      .object({
        localMode: z.enum(['off', 'local_aggregate', 'local_pseudonymous']),
        externalAggregateEnabled: z.boolean(),
        externalPseudonymousEnabled: z.boolean(),
      })
      .strict(),
    effective: z
      .object({
        killSwitchActive: z.boolean(),
        localMode: z.enum(['off', 'local_aggregate', 'local_pseudonymous']),
        externalAggregateEnabled: z.boolean(),
        externalPseudonymousEnabled: z.boolean(),
      })
      .strict(),
    policy: z
      .object({
        policyVersion: z.number().nullable(),
        noticeVersion: z.number().nullable(),
        purpose: z.string().nullable(),
        controllerContact: z.string().nullable(),
        lawfulBasisMode: z.enum(['consent', 'legitimate_interest']).nullable(),
        retainedEventHorizonDays: z.number().nullable(),
        reviewDateMs: z.number().nullable(),
        acknowledgedAtMs: z.number().nullable(),
        policyEffectiveAtMs: z.number().nullable(),
        subjectRightsLookupHorizonDays: z.literal(90),
      })
      .strict(),
    readiness: z.object({ ready: z.boolean(), missing: z.array(z.string()) }).strict(),
    sinks: z.array(AnalyticsSinkViewSchema),
    openPanel: z.object({ blocked: z.boolean(), reasons: z.array(z.string()) }).strict(),
    snapshot: z.object({ snapshotId: z.string(), publishedAtMs: z.number(), ageMs: z.number() }).strict().nullable(),
  })
  .strict()
export type AdminAnalyticsResponse = z.infer<typeof AdminAnalyticsResponseSchema>

export const AnalyticsSinkMutationResponseSchema = z
  .object({
    status: z.string(),
    sink: AnalyticsSinkViewSchema.optional(),
    reason: z.string().optional(),
    failureClass: z.string().optional(),
  })
  .strict()
export type AnalyticsSinkMutationResponse = z.infer<typeof AnalyticsSinkMutationResponseSchema>

export const AnalyticsReconcileResponseSchema = z
  .object({
    status: z.enum(['reconciled', 'gap', 'delta']),
    liveEpochs: z.array(
      z
        .object({
          epochId: z.string(),
          state: z.string(),
          status: z.string(),
          unexplainedDelta: z.number(),
          gapDays: z.array(z.string()),
          publishableTotal: z.number().nullable(),
        })
        .strict(),
    ),
    delivery: z
      .object({
        total: z.number(),
        uniquePairs: z.number(),
        byState: z.record(z.string(), z.number()),
        excludedNonActiveGeneration: z.number(),
        conserved: z.boolean(),
      })
      .strict(),
    associationViolations: z.number(),
    eventsByName: z.record(z.string(), z.number()),
    eventsByAttributionQuality: z.record(z.string(), z.number()),
    releaseAssessment: z
      .object({ ok: z.literal(true) })
      .strict()
      .optional(),
  })
  .strict()
export type AnalyticsReconcileResponse = z.infer<typeof AnalyticsReconcileResponseSchema>
