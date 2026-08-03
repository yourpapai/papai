// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AdminAnalyticsResponseSchema,
  AnalyticsDeleteResponseSchema,
  AnalyticsExportSchema,
  AnalyticsPreferencesResponseSchema,
  AnalyticsSinkMutationResponseSchema,
  AnalyticsSinkViewSchema,
  AnalyticsWithdrawResponseSchema,
} from '../../../client/settings/fetcher-schemas-analytics.js'

const preferencesPayload = {
  notice: {
    policyVersion: 1,
    noticeVersion: 1,
    purpose: 'product improvement',
    controllerContact: 'privacy@example.com',
    lawfulBasisMode: 'consent',
    policyEffectiveAtMs: null,
  },
  preference: { localLongitudinal: 'allow', externalPseudonymous: 'unknown', effectiveAtMs: 123 },
  explanation: 'Aggregate analytics count events in daily totals.',
  subjectRightsAvailable: true,
} as const

const sinkView = {
  sinkVersionId: 'ext:v1',
  logicalSinkId: 'ext',
  version: 1,
  kind: 'webhook',
  egressMode: 'pseudonymous',
  state: 'pending_verification',
  payloadSchemaVersion: 1,
  configFingerprint: 'fp-1',
  verifiedAtMs: null,
  createdAtMs: 100,
  disabledAtMs: null,
} as const

const adminPayload = {
  configVersion: 3,
  mode: { localMode: 'local_aggregate', externalAggregateEnabled: false, externalPseudonymousEnabled: false },
  effective: {
    killSwitchActive: false,
    localMode: 'local_aggregate',
    externalAggregateEnabled: false,
    externalPseudonymousEnabled: false,
  },
  policy: {
    policyVersion: 1,
    noticeVersion: 1,
    purpose: 'product improvement',
    controllerContact: 'privacy@example.com',
    lawfulBasisMode: 'consent',
    retainedEventHorizonDays: 30,
    reviewDateMs: 100,
    acknowledgedAtMs: 100,
    policyEffectiveAtMs: null,
    subjectRightsLookupHorizonDays: 90,
  },
  readiness: { ready: true, missing: [] },
  sinks: [sinkView],
  openPanel: { blocked: true, reasons: ['missing_delete_actor'] },
  snapshot: null,
} as const

const exportPayload = {
  productAnalytics: { events: [], sessions: [], deliveries: [] },
  governance: { preference: null, audit: [] },
  coverage: 'analytics_only',
  outOfScope: 'This export covers analytics data only.',
} as const

const withdrawPayload = { status: 'completed', eventsRemoved: 1, deliveryRowsRemoved: 0, censorsApplied: 2 } as const
const deletePayload = { status: 'completed', coverage: 'analytics_only' } as const

describe('analytics fetcher schemas', () => {
  test('valid responses parse', () => {
    expect(AnalyticsPreferencesResponseSchema.parse(preferencesPayload).preference.localLongitudinal).toBe('allow')
    expect(AdminAnalyticsResponseSchema.parse(adminPayload).policy.subjectRightsLookupHorizonDays).toBe(90)
    expect(AnalyticsExportSchema.parse(exportPayload).coverage).toBe('analytics_only')
    expect(AnalyticsWithdrawResponseSchema.parse(withdrawPayload).censorsApplied).toBe(2)
    expect(AnalyticsDeleteResponseSchema.parse(deletePayload).status).toBe('completed')
    expect(AnalyticsSinkMutationResponseSchema.parse({ status: 'enabled', sink: sinkView }).status).toBe('enabled')
  })

  test('unknown keys are rejected', () => {
    expect(() => AnalyticsPreferencesResponseSchema.parse({ ...preferencesPayload, extra: 1 })).toThrow()
    expect(() => AdminAnalyticsResponseSchema.parse({ ...adminPayload, debug: {} })).toThrow()
    expect(() => AnalyticsSinkViewSchema.parse({ ...sinkView, internal: 'x' })).toThrow()
  })

  test('secret-looking fields are rejected', () => {
    expect(() => AnalyticsSinkViewSchema.parse({ ...sinkView, endpoint: 'https://x' })).toThrow()
    expect(() => AnalyticsSinkViewSchema.parse({ ...sinkView, secret: 'tok' })).toThrow()
    expect(() => AnalyticsSinkViewSchema.parse({ ...sinkView, endpointCiphertext: 'ct' })).toThrow()
    expect(() => AnalyticsSinkViewSchema.parse({ ...sinkView, secretCiphertext: 'ct' })).toThrow()
  })

  test('invalid enums are rejected', () => {
    const bad = {
      ...preferencesPayload,
      preference: { ...preferencesPayload.preference, localLongitudinal: 'sometimes' },
    }
    expect(() => AnalyticsPreferencesResponseSchema.parse(bad)).toThrow()
    const badMode = { ...adminPayload, mode: { ...adminPayload.mode, localMode: 'everything' } }
    expect(() => AdminAnalyticsResponseSchema.parse(badMode)).toThrow()
  })

  test('missing coverage and censor fields are rejected', () => {
    const { coverage: _coverage, ...noCoverage } = exportPayload
    expect(() => AnalyticsExportSchema.parse(noCoverage)).toThrow()
    const { coverage: _deleteCoverage, ...deleteNoCoverage } = deletePayload
    expect(() => AnalyticsDeleteResponseSchema.parse(deleteNoCoverage)).toThrow()
    const { censorsApplied: _censors, ...noCensors } = withdrawPayload
    expect(() => AnalyticsWithdrawResponseSchema.parse(noCensors)).toThrow()
  })

  test('a horizon other than 90 is rejected as non-conforming policy evidence', () => {
    const bad = {
      ...adminPayload,
      policy: { ...adminPayload.policy, subjectRightsLookupHorizonDays: 30 },
    }
    expect(() => AdminAnalyticsResponseSchema.parse(bad)).toThrow()
  })
})
