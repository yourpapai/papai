// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { desc, eq } from 'drizzle-orm'

import { approveSinkEndpoint, buildSinkAuthHeaders } from '../../../analytics/delivery/http-policy.js'
import { createPinnedTransport } from '../../../analytics/delivery/pinned-transport.js'
import { listSinkVersions } from '../../../analytics/delivery/sink-service.js'
import type { SinkPublicView, SinkServiceDeps } from '../../../analytics/delivery/sink-service.js'
import { OPENPANEL_ASSESSED_CAPABILITIES } from '../../../analytics/delivery/sink.js'
import { SUBJECT_RIGHTS_LOOKUP_HORIZON_DAYS } from '../../../analytics/governance/generation-store.js'
import {
  assessGovernanceReadiness,
  getPolicy,
  resolveEffectiveLanes,
} from '../../../analytics/governance/policy-store.js'
import type { EffectiveLanes, GovernanceReadiness } from '../../../analytics/governance/policy-store.js'
import { parseAnalyticsKeyring, parseGovernanceKeyring } from '../../../analytics/identity/keyring.js'
import type { KeyringState } from '../../../analytics/identity/keyring.js'
import { getDrizzleDb as defaultGetDrizzleDb } from '../../../db/drizzle.js'
import { analyticsSnapshotPublications } from '../../../db/schema.js'

export type AdminAnalyticsRouteDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  analyticsKeyring: KeyringState
  governanceKeyring: KeyringState
  probe: SinkServiceDeps['probe']
}>

const httpProbe: SinkServiceDeps['probe'] = async ({ endpoint, secret }) => {
  try {
    const approved = await approveSinkEndpoint(endpoint)
    const outcome = await createPinnedTransport()(approved, {
      headers: buildSinkAuthHeaders(secret),
      body: JSON.stringify({ kind: 'sink_verification' }),
    })
    if (outcome.kind === 'delivered') return { ok: true }
    if (outcome.kind === 'responded') return { ok: false, failureClass: outcome.errorClass }
    if (outcome.kind === 'timeout') return { ok: false, failureClass: 'timeout' }
    if (outcome.kind === 'network') return { ok: false, failureClass: 'network' }
    return { ok: false, failureClass: 'policy' }
  } catch (error) {
    return { ok: false, failureClass: error instanceof Error ? error.name : 'unknown' }
  }
}

export const defaultAdminAnalyticsDeps = (): AdminAnalyticsRouteDeps => ({
  getDrizzleDb: defaultGetDrizzleDb,
  analyticsKeyring: parseAnalyticsKeyring(),
  governanceKeyring: parseGovernanceKeyring(),
  probe: httpProbe,
})

export const sinkDepsOf = (deps: AdminAnalyticsRouteDeps): SinkServiceDeps => ({
  getDrizzleDb: deps.getDrizzleDb,
  probe: deps.probe,
})

export const openPanelBlockReasons = (): readonly string[] => {
  const reasons: string[] = []
  if (!OPENPANEL_ASSESSED_CAPABILITIES.callerControlledIdempotency) {
    reasons.push('missing_caller_controlled_idempotency')
  }
  if (!OPENPANEL_ASSESSED_CAPABILITIES.deterministicReconciliation) {
    reasons.push('missing_deterministic_reconciliation')
  }
  if (!OPENPANEL_ASSESSED_CAPABILITIES.deleteActor) reasons.push('missing_delete_actor')
  return reasons
}

const latestSnapshot = (
  deps: AdminAnalyticsRouteDeps,
  nowMs: number,
): Readonly<{ snapshotId: string; publishedAtMs: number; ageMs: number }> | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsSnapshotPublications)
    .where(eq(analyticsSnapshotPublications.state, 'published'))
    .orderBy(desc(analyticsSnapshotPublications.publishedAt))
    .limit(1)
    .get()
  if (row === undefined || row.publishedAt === null) return null
  return { snapshotId: row.snapshotId, publishedAtMs: row.publishedAt, ageMs: Math.max(0, nowMs - row.publishedAt) }
}

export type AdminAnalyticsView = Readonly<{
  configVersion: number
  mode: Readonly<{
    localMode: string
    externalAggregateEnabled: boolean
    externalPseudonymousEnabled: boolean
  }>
  effective: EffectiveLanes
  policy: Readonly<{
    policyVersion: number | null
    noticeVersion: number | null
    purpose: string | null
    controllerContact: string | null
    lawfulBasisMode: string | null
    retainedEventHorizonDays: number | null
    reviewDateMs: number | null
    acknowledgedAtMs: number | null
    policyEffectiveAtMs: number | null
    subjectRightsLookupHorizonDays: number
  }>
  readiness: GovernanceReadiness
  sinks: readonly SinkPublicView[]
  openPanel: Readonly<{ blocked: boolean; reasons: readonly string[] }>
  snapshot: Readonly<{ snapshotId: string; publishedAtMs: number; ageMs: number }> | null
}>

export const buildAdminView = (deps: AdminAnalyticsRouteDeps, nowMs: number): AdminAnalyticsView => {
  const policy = getPolicy({ getDrizzleDb: deps.getDrizzleDb })
  return {
    configVersion: policy.configVersion,
    mode: {
      localMode: policy.localMode,
      externalAggregateEnabled: policy.externalAggregateEnabled,
      externalPseudonymousEnabled: policy.externalPseudonymousEnabled,
    },
    effective: resolveEffectiveLanes({ policy }),
    policy: {
      policyVersion: policy.policyVersion,
      noticeVersion: policy.noticeVersion,
      purpose: policy.purpose,
      controllerContact: policy.controllerContact,
      lawfulBasisMode: policy.lawfulBasisMode,
      retainedEventHorizonDays: policy.retainedEventHorizonDays,
      reviewDateMs: policy.reviewDateMs,
      acknowledgedAtMs: policy.acknowledgedAtMs,
      policyEffectiveAtMs: policy.policyEffectiveAtMs,
      subjectRightsLookupHorizonDays: SUBJECT_RIGHTS_LOOKUP_HORIZON_DAYS,
    },
    readiness: assessGovernanceReadiness({
      policy,
      analyticsKeyring: deps.analyticsKeyring,
      governanceKeyring: deps.governanceKeyring,
    }),
    sinks: listSinkVersions(sinkDepsOf(deps)),
    openPanel: { blocked: openPanelBlockReasons().length > 0, reasons: openPanelBlockReasons() },
    snapshot: latestSnapshot(deps, nowMs),
  }
}
