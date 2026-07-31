// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

import type { HandlerFamily } from './settings-handlers-admin.js'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

// --- Admin: analytics (GET/PATCH /settings/api/admin/analytics + sinks + reconcile) ---
// AdminAnalyticsResponseSchema: strict view with mode/effective/policy/readiness/sinks/openPanel/snapshot.

const adminAnalyticsPolicy = {
  policyVersion: 1,
  noticeVersion: 1,
  purpose: 'product improvement',
  controllerContact: 'privacy@example.com',
  lawfulBasisMode: 'consent',
  retainedEventHorizonDays: 30,
  reviewDateMs: 1_800_000_000_000,
  acknowledgedAtMs: 1_800_000_000_000,
  policyEffectiveAtMs: null,
  subjectRightsLookupHorizonDays: 90,
}

const adminAnalyticsBase = {
  configVersion: 2,
  mode: { localMode: 'local_aggregate', externalAggregateEnabled: false, externalPseudonymousEnabled: false },
  effective: {
    killSwitchActive: false,
    localMode: 'local_aggregate',
    externalAggregateEnabled: false,
    externalPseudonymousEnabled: false,
  },
  policy: adminAnalyticsPolicy,
  readiness: { ready: true, missing: [] },
  sinks: [],
  openPanel: { blocked: true, reasons: ['missing_caller_controlled_idempotency', 'missing_delete_actor'] },
  snapshot: { snapshotId: 'snap-2026-07-26', publishedAtMs: 1_800_000_000_000, ageMs: 3_600_000 },
}

const adminAnalyticsIncomplete = {
  ...adminAnalyticsBase,
  policy: {
    ...adminAnalyticsPolicy,
    policyVersion: null,
    noticeVersion: null,
    purpose: null,
    controllerContact: null,
    lawfulBasisMode: null,
    retainedEventHorizonDays: null,
    reviewDateMs: null,
    acknowledgedAtMs: null,
  },
  readiness: {
    ready: false,
    missing: ['policy_version', 'notice_version', 'controller_contact', 'purpose', 'operator_acknowledgement'],
  },
  snapshot: null,
}

const adminAnalyticsLocalPilot = {
  ...adminAnalyticsBase,
  mode: { ...adminAnalyticsBase.mode, localMode: 'local_pseudonymous' },
  effective: { ...adminAnalyticsBase.effective, localMode: 'local_pseudonymous' },
}

const adminAnalyticsKillSwitch = {
  ...adminAnalyticsBase,
  effective: {
    killSwitchActive: true,
    localMode: 'off',
    externalAggregateEnabled: false,
    externalPseudonymousEnabled: false,
  },
}

const adminAnalyticsFailedSinkView = {
  sinkVersionId: 'ext-pseudo:v1',
  logicalSinkId: 'ext-pseudo',
  version: 1,
  kind: 'webhook',
  egressMode: 'pseudonymous',
  state: 'pending_verification',
  payloadSchemaVersion: 1,
  configFingerprint: 'fp-9f3ab1',
  verifiedAtMs: null,
  createdAtMs: 1_800_000_000_000,
  disabledAtMs: null,
}

const adminAnalyticsFailedSink = { ...adminAnalyticsBase, sinks: [adminAnalyticsFailedSinkView] }

const adminAnalyticsReconcileReport = {
  status: 'reconciled',
  liveEpochs: [
    {
      epochId: 'epoch-1',
      state: 'closed',
      status: 'publishable',
      unexplainedDelta: 0,
      gapDays: [],
      publishableTotal: 128,
    },
  ],
  delivery: { total: 0, uniquePairs: 0, byState: {}, excludedNonActiveGeneration: 0, conserved: true },
  associationViolations: 0,
  eventsByName: { turn_started: 128 },
  eventsByAttributionQuality: { native: 128 },
}

export const adminAnalyticsHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/analytics', () => HttpResponse.json(adminAnalyticsBase)),
    http.patch('/settings/api/admin/analytics', () => HttpResponse.json(adminAnalyticsBase)),
    http.post('/settings/api/admin/analytics/reconcile', () => HttpResponse.json(adminAnalyticsReconcileReport)),
  ],
  empty: [http.get('/settings/api/admin/analytics', () => HttpResponse.json(adminAnalyticsIncomplete))],
  error: [http.get('/settings/api/admin/analytics', boom)],
  loading: [
    http.get('/settings/api/admin/analytics', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(adminAnalyticsBase)
    }),
  ],
}

export const adminAnalyticsIncompleteGovernanceHandlers: HttpHandler[] = [
  http.get('/settings/api/admin/analytics', () => HttpResponse.json(adminAnalyticsIncomplete)),
]

export const adminAnalyticsGovernedLocalPilotHandlers: HttpHandler[] = [
  http.get('/settings/api/admin/analytics', () => HttpResponse.json(adminAnalyticsLocalPilot)),
]

export const adminAnalyticsKillSwitchHandlers: HttpHandler[] = [
  http.get('/settings/api/admin/analytics', () => HttpResponse.json(adminAnalyticsKillSwitch)),
]

export const adminAnalyticsFailedSinkHandlers: HttpHandler[] = [
  http.get('/settings/api/admin/analytics', () => HttpResponse.json(adminAnalyticsFailedSink)),
  http.post('/settings/api/admin/analytics/sinks/:sinkVersionId/verify', () =>
    HttpResponse.json({ status: 'verification_failed', failureClass: 'network' }),
  ),
]

export const adminAnalyticsReconciledHealthyHandlers: HttpHandler[] = [
  http.get('/settings/api/admin/analytics', () => HttpResponse.json(adminAnalyticsBase)),
  http.post('/settings/api/admin/analytics/reconcile', () => HttpResponse.json(adminAnalyticsReconcileReport)),
]
