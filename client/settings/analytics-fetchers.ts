// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import {
  AdminAnalyticsResponseSchema,
  AnalyticsDeleteResponseSchema,
  AnalyticsExportSchema,
  AnalyticsPreferenceUpdateResponseSchema,
  AnalyticsPreferencesResponseSchema,
  AnalyticsReconcileResponseSchema,
  AnalyticsSinkMutationResponseSchema,
  AnalyticsWithdrawResponseSchema,
  type AdminAnalyticsResponse,
  type AnalyticsDeleteResponse,
  type AnalyticsExport,
  type AnalyticsPreferenceState,
  type AnalyticsPreferencesResponse,
  type AnalyticsReconcileResponse,
  type AnalyticsSinkMutationResponse,
  type AnalyticsWithdrawResponse,
} from './fetcher-schemas-analytics.js'
import { getJson, settingsFetch, writeJson } from './fetchers.js'

export type AnalyticsPreferenceWrite = Readonly<{
  localLongitudinal?: 'allow' | 'deny'
  externalPseudonymous?: 'allow' | 'deny'
}>

export type SinkGateAttestation = Readonly<{
  capabilities: Readonly<{
    callerControlledIdempotency: boolean
    deterministicReconciliation: boolean
    deleteActor: boolean
  }>
  processorReview: Readonly<{
    subprocessorReviewed: boolean
    residencyReviewed: boolean
    deletionPathReviewed: boolean
    incidentReviewed: boolean
    transferReviewed: boolean
    noSecondaryUse: boolean
  }>
  httpsPolicyApproved: boolean
}>

export type CreateAnalyticsSinkInput = Readonly<{
  logicalSinkId: string
  kind: 'webhook' | 'openpanel'
  egressMode: 'aggregate' | 'pseudonymous'
  endpoint: string
  secret: string
}>

export type RotateAnalyticsSinkInput = Omit<CreateAnalyticsSinkInput, 'logicalSinkId'> & SinkGateAttestation

export type AdminAnalyticsPatch = Readonly<{
  expectedConfigVersion: number
  localMode?: 'off' | 'local_aggregate' | 'local_pseudonymous'
  externalAggregateEnabled?: boolean
  externalPseudonymousEnabled?: boolean
  policyVersion?: number
  noticeVersion?: number
  controllerContact?: string
  purpose?: string
  lawfulBasisMode?: 'consent' | 'legitimate_interest'
  retainedEventHorizonDays?: number
  reviewDateMs?: number
  acknowledge?: true
  policyEffectiveAtMs?: number
}>

export type AnalyticsExportResult = Readonly<{ data: AnalyticsExport; filename: string }>

// --- Actor ---

export const fetchAnalyticsPreferences = (): Promise<AnalyticsPreferencesResponse> =>
  getJson('/settings/api/analytics/preferences', (b) => AnalyticsPreferencesResponseSchema.parse(b))

export const putAnalyticsPreferences = (input: AnalyticsPreferenceWrite): Promise<AnalyticsPreferenceState> =>
  writeJson('/settings/api/analytics/preferences', 'PUT', input, (b) =>
    AnalyticsPreferenceUpdateResponseSchema.parse(b),
  ).then((r) => r.preference)

const EXPORT_FALLBACK_FILENAME = 'papai-analytics-export.json'

const filenameFromDisposition = (header: string | null): string => {
  if (header === null) return EXPORT_FALLBACK_FILENAME
  const match = /filename="([^"]+)"/u.exec(header)
  return match?.[1] ?? EXPORT_FALLBACK_FILENAME
}

export const exportAnalyticsData = async (): Promise<AnalyticsExportResult> => {
  const res = await settingsFetch('/settings/api/analytics/export', { method: 'POST', body: '{}' })
  const body = await readBody(res)
  requireOk(res, body)
  const cacheControl = res.headers.get('Cache-Control') ?? ''
  if (!cacheControl.includes('no-store')) {
    throw new Error('analytics export response is missing the no-store cache control')
  }
  return {
    data: AnalyticsExportSchema.parse(body),
    filename: filenameFromDisposition(res.headers.get('Content-Disposition')),
  }
}

export const withdrawAnalytics = (): Promise<AnalyticsWithdrawResponse> =>
  writeJson('/settings/api/analytics/withdraw', 'POST', {}, (b) => AnalyticsWithdrawResponseSchema.parse(b))

export const deleteAnalyticsData = (): Promise<AnalyticsDeleteResponse> =>
  writeJson('/settings/api/analytics/delete', 'POST', {}, (b) => AnalyticsDeleteResponseSchema.parse(b))

// --- Admin ---

export const fetchAdminAnalytics = (): Promise<AdminAnalyticsResponse> =>
  getJson('/settings/api/admin/analytics', (b) => AdminAnalyticsResponseSchema.parse(b))

export const patchAdminAnalytics = (input: AdminAnalyticsPatch): Promise<AdminAnalyticsResponse> =>
  writeJson('/settings/api/admin/analytics', 'PATCH', input, (b) => AdminAnalyticsResponseSchema.parse(b))

export const createAnalyticsSink = (input: CreateAnalyticsSinkInput): Promise<AnalyticsSinkMutationResponse> =>
  writeJson('/settings/api/admin/analytics/sinks', 'POST', input, (b) => AnalyticsSinkMutationResponseSchema.parse(b))

export const verifyAnalyticsSink = (
  sinkVersionId: string,
  gate: SinkGateAttestation,
): Promise<AnalyticsSinkMutationResponse> =>
  writeJson(`/settings/api/admin/analytics/sinks/${encodeURIComponent(sinkVersionId)}/verify`, 'POST', gate, (b) =>
    AnalyticsSinkMutationResponseSchema.parse(b),
  )

export const rotateAnalyticsSink = (
  sinkVersionId: string,
  input: RotateAnalyticsSinkInput,
): Promise<AnalyticsSinkMutationResponse> =>
  writeJson(`/settings/api/admin/analytics/sinks/${encodeURIComponent(sinkVersionId)}/rotate`, 'POST', input, (b) =>
    AnalyticsSinkMutationResponseSchema.parse(b),
  )

export const disableAnalyticsSink = (sinkVersionId: string): Promise<AnalyticsSinkMutationResponse> =>
  writeJson(`/settings/api/admin/analytics/sinks/${encodeURIComponent(sinkVersionId)}/disable`, 'POST', {}, (b) =>
    AnalyticsSinkMutationResponseSchema.parse(b),
  )

export const reconcileAnalytics = (input: {
  apply?: boolean
  release?: Readonly<{
    utcDay: string
    endUtcDay?: string
    rollingWindowDays?: number
    dimensions?: readonly ('platform' | 'contextType' | 'actorRole' | 'taskProvider')[]
    appVersion?: string
    drillThrough?: boolean
  }>
}): Promise<AnalyticsReconcileResponse> =>
  writeJson('/settings/api/admin/analytics/reconcile', 'POST', input, (b) => AnalyticsReconcileResponseSchema.parse(b))
