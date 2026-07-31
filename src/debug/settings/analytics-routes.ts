// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { inArray } from 'drizzle-orm'
import { z } from 'zod'

import { getDeletionRequest } from '../../analytics/governance/deletion-target-store.js'
import { getPolicy } from '../../analytics/governance/policy-store.js'
import { getPreference, setPreference } from '../../analytics/governance/preference-store.js'
import type { PreferenceLane } from '../../analytics/governance/preference-store.js'
import { createSnapshotInvalidator } from '../../analytics/governance/snapshot-invalidator.js'
import { DeletionIncompleteError, executeDeletionWorkflow } from '../../analytics/governance/subject-deletion.js'
import { deriveSubjectKeys, flattenSubjectKeys } from '../../analytics/governance/subject-keys.js'
import type { SubjectIdentity } from '../../analytics/governance/subject-keys.js'
import {
  exportSubjectData,
  requestSubjectDeletion,
  withdrawSubject,
} from '../../analytics/governance/subject-service.js'
import type { SubjectServiceDeps } from '../../analytics/governance/subject-service.js'
import { parseAnalyticsKeyring, parseGovernanceKeyring } from '../../analytics/identity/keyring.js'
import { getDrizzleDb } from '../../db/drizzle.js'
import { analyticsCensorIntervals } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../settings/request-auth.js'
import { settingsRequestNowMs } from './request-clock.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-analytics' })

const EXPORT_EXPLANATION =
  'Aggregate analytics count events in daily totals that never identify you. ' +
  'Pseudonymous analytics link events to a rotating pseudonym derived from your account, ' +
  'which you can withdraw or delete at any time.'

const ACTOR_ID_QUERY_KEYS: ReadonlySet<string> = new Set([
  'actorId',
  'actorKey',
  'userId',
  'platformUserId',
  'platformInstanceId',
  'governanceActorKey',
])

const PreferencesBodySchema = z
  .object({
    localLongitudinal: z.enum(['allow', 'deny']).optional(),
    externalPseudonymous: z.enum(['allow', 'deny']).optional(),
  })
  .strict()
  .refine((body) => body.localLongitudinal !== undefined || body.externalPseudonymous !== undefined, {
    message: 'at least one preference lane is required',
  })

export type AnalyticsActorRouteDeps = Readonly<{ subject: SubjectServiceDeps }>

const defaultDeps = (): AnalyticsActorRouteDeps => ({
  subject: {
    getDrizzleDb,
    keyrings: { analytics: parseAnalyticsKeyring(), governance: parseGovernanceKeyring() },
    snapshotInvalidator: createSnapshotInvalidator({ getDrizzleDb }),
  },
})

const identityOf = (authed: AuthenticatedSettingsRequest): SubjectIdentity => ({
  platformInstanceId: authed.principal.platformInstanceId,
  platformUserId: authed.principal.platformUserId,
})

const rejectSuppliedActorId = (url: URL): Response | null => {
  for (const key of url.searchParams.keys()) {
    if (ACTOR_ID_QUERY_KEYS.has(key)) {
      log.warn({ key }, 'actor identity supplied by client rejected')
      return settingsJson(422, { error: 'actor identity is taken from the authenticated session' })
    }
  }
  return null
}

const requireGovernanceKeyring = (deps: AnalyticsActorRouteDeps): Response | null => {
  if (deps.subject.keyrings.governance.kind !== 'available') {
    return settingsJson(503, { error: 'subject rights are unavailable', code: 'subject_rights_unavailable' })
  }
  return null
}

const activeGovernanceKey = (
  identity: SubjectIdentity,
  deps: AnalyticsActorRouteDeps,
): { governanceActorKey: string; keyVersion: string } => {
  const governance = deps.subject.keyrings.governance
  if (governance.kind !== 'available') throw new Error('governance keyring unavailable')
  const keys = deriveSubjectKeys(identity, deps.subject.keyrings)
  const primary =
    keys.governanceActorKeys.find((entry) => entry.keyVersion === governance.activeVersion) ??
    keys.governanceActorKeys[0]
  if (primary === undefined) throw new Error('no governance key derivable for the subject')
  return { governanceActorKey: primary.pseudonym, keyVersion: primary.keyVersion }
}

type PreferencePayload = Readonly<{
  localLongitudinal: string
  externalPseudonymous: string
  effectiveAtMs: number | null
}>

const preferencePayload = (identity: SubjectIdentity, deps: AnalyticsActorRouteDeps): PreferencePayload => {
  if (deps.subject.keyrings.governance.kind !== 'available') {
    return { localLongitudinal: 'unknown', externalPseudonymous: 'unknown', effectiveAtMs: null } as const
  }
  const { governanceActorKey } = activeGovernanceKey(identity, deps)
  const row = getPreference(governanceActorKey, { getDrizzleDb: deps.subject.getDrizzleDb })
  return {
    localLongitudinal: row?.localLongitudinal ?? 'unknown',
    externalPseudonymous: row?.externalPseudonymous ?? 'unknown',
    effectiveAtMs: row?.effectiveAt ?? null,
  } as const
}

const handleGetPreferences = (authed: AuthenticatedSettingsRequest, deps: AnalyticsActorRouteDeps): Response => {
  const identity = identityOf(authed)
  const policy = getPolicy({ getDrizzleDb: deps.subject.getDrizzleDb })
  return settingsJson(200, {
    notice: {
      policyVersion: policy.policyVersion,
      noticeVersion: policy.noticeVersion,
      purpose: policy.purpose,
      controllerContact: policy.controllerContact,
      lawfulBasisMode: policy.lawfulBasisMode,
      policyEffectiveAtMs: policy.policyEffectiveAtMs,
    },
    preference: preferencePayload(identity, deps),
    explanation: EXPORT_EXPLANATION,
    subjectRightsAvailable: deps.subject.keyrings.governance.kind === 'available',
  })
}

const handlePutPreferences = async (
  req: Request,
  authed: AuthenticatedSettingsRequest,
  deps: AnalyticsActorRouteDeps,
): Promise<Response> => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const unavailable = requireGovernanceKeyring(deps)
  if (unavailable !== null) return unavailable
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PreferencesBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const identity = identityOf(authed)
  const nowMs = settingsRequestNowMs(req)
  const { governanceActorKey, keyVersion } = activeGovernanceKey(identity, deps)
  const policy = getPolicy({ getDrizzleDb: deps.subject.getDrizzleDb })
  const policyVersion = policy.policyVersion ?? 1
  const storeDeps = { getDrizzleDb: deps.subject.getDrizzleDb }
  const lanes: readonly (readonly [PreferenceLane, 'allow' | 'deny' | undefined])[] = [
    ['local_longitudinal', body.data.localLongitudinal],
    ['external_pseudonymous', body.data.externalPseudonymous],
  ]
  for (const [lane, value] of lanes) {
    if (value === undefined) continue
    setPreference({ governanceActorKey, keyVersion, lane, value, policyVersion, source: 'settings', nowMs }, storeDeps)
  }
  log.info('analytics preference updated through settings')
  return settingsJson(200, { ok: true, preference: preferencePayload(identity, deps) })
}

const handleExport = (req: Request, authed: AuthenticatedSettingsRequest, deps: AnalyticsActorRouteDeps): Response => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const unavailable = requireGovernanceKeyring(deps)
  if (unavailable !== null) return unavailable
  const payload = exportSubjectData(identityOf(authed), deps.subject, settingsRequestNowMs(req))
  return new Response(JSON.stringify({ ...payload, coverage: 'analytics_only' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="papai-analytics-export.json"',
      'Cache-Control': 'no-store',
    },
  })
}

const countWithdrawalCensors = (identity: SubjectIdentity, deps: AnalyticsActorRouteDeps): number => {
  const flat = flattenSubjectKeys(deriveSubjectKeys(identity, deps.subject.keyrings))
  if (flat.analyticsActorKeys.length === 0) return 0
  return deps.subject
    .getDrizzleDb()
    .select({ actorKey: analyticsCensorIntervals.actorKey })
    .from(analyticsCensorIntervals)
    .where(inArray(analyticsCensorIntervals.actorKey, [...flat.analyticsActorKeys]))
    .all().length
}

const handleWithdraw = (
  req: Request,
  authed: AuthenticatedSettingsRequest,
  deps: AnalyticsActorRouteDeps,
): Response => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const unavailable = requireGovernanceKeyring(deps)
  if (unavailable !== null) return unavailable
  const identity = identityOf(authed)
  try {
    const result = withdrawSubject(identity, deps.subject, settingsRequestNowMs(req))
    return settingsJson(200, {
      status: result.state,
      eventsRemoved: result.eventsRemoved,
      deliveryRowsRemoved: result.deliveryRowsRemoved,
      censorsApplied: countWithdrawalCensors(identity, deps),
    })
  } catch (error) {
    if (error instanceof DeletionIncompleteError) {
      return settingsJson(409, { error: 'withdrawal could not complete', code: 'deletion_incomplete' })
    }
    throw error
  }
}

const handleDelete = (req: Request, authed: AuthenticatedSettingsRequest, deps: AnalyticsActorRouteDeps): Response => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const unavailable = requireGovernanceKeyring(deps)
  if (unavailable !== null) return unavailable
  const identity = identityOf(authed)
  const nowMs = settingsRequestNowMs(req)
  const { requestId } = requestSubjectDeletion(identity, deps.subject, nowMs)
  try {
    executeDeletionWorkflow({ requestId, nowMs }, deps.subject)
    return settingsJson(200, { status: 'completed', coverage: 'analytics_only' })
  } catch (error) {
    if (error instanceof DeletionIncompleteError) {
      const request = getDeletionRequest(requestId, { getDrizzleDb: deps.subject.getDrizzleDb })
      return settingsJson(202, { status: request?.state ?? 'failed', coverage: 'analytics_only' })
    }
    throw error
  }
}

export function handleAnalyticsRoutes(
  req: Request,
  url: URL,
  deps: AnalyticsActorRouteDeps = defaultDeps(),
): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  const suppliedActor = rejectSuppliedActorId(url)
  if (suppliedActor !== null) return Promise.resolve(suppliedActor)

  if (url.pathname === '/settings/api/analytics/preferences') {
    if (req.method === 'GET') return Promise.resolve(handleGetPreferences(auth.authed, deps))
    if (req.method === 'PUT') return handlePutPreferences(req, auth.authed, deps)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (url.pathname === '/settings/api/analytics/export' && req.method === 'POST') {
    return Promise.resolve(handleExport(req, auth.authed, deps))
  }
  if (url.pathname === '/settings/api/analytics/withdraw' && req.method === 'POST') {
    return Promise.resolve(handleWithdraw(req, auth.authed, deps))
  }
  if (url.pathname === '/settings/api/analytics/delete' && req.method === 'POST') {
    return Promise.resolve(handleDelete(req, auth.authed, deps))
  }
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
