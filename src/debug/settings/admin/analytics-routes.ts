// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { buildDailyAggregateRelease } from '../../../analytics/delivery/aggregate-release.js'
import { assessReleaseRequest } from '../../../analytics/delivery/release-suppression.js'
import { hasEnabledSink, isEnabledAggregateSinkVersion } from '../../../analytics/delivery/sink-service.js'
import { getPolicy, updatePolicy } from '../../../analytics/governance/policy-store.js'
import type { PolicyUpdateFields } from '../../../analytics/governance/policy-store.js'
import { runReconciliation } from '../../../analytics/jobs/reconcile.js'
import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { settingsRequestNowMs } from '../request-clock.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'
import { handleCreateSink, handleDisableSink, handleRotateSink, handleVerifySink } from './analytics-sink-routes.js'
import { buildAdminView, defaultAdminAnalyticsDeps, sinkDepsOf } from './analytics-view.js'
import type { AdminAnalyticsRouteDeps } from './analytics-view.js'

const log = logger.child({ scope: 'debug-server:settings-admin-analytics' })

export type { AdminAnalyticsRouteDeps } from './analytics-view.js'

const PatchBodySchema = z
  .object({
    expectedConfigVersion: z.number().int().positive(),
    localMode: z.enum(['off', 'local_aggregate', 'local_pseudonymous']).optional(),
    externalAggregateEnabled: z.boolean().optional(),
    externalPseudonymousEnabled: z.boolean().optional(),
    policyVersion: z.number().int().positive().optional(),
    noticeVersion: z.number().int().positive().optional(),
    controllerContact: z.string().min(1).optional(),
    purpose: z.string().min(1).optional(),
    lawfulBasisMode: z.enum(['consent', 'legitimate_interest']).optional(),
    retainedEventHorizonDays: z.number().int().min(1).max(90).optional(),
    reviewDateMs: z.number().int().nonnegative().optional(),
    acknowledge: z.literal(true).optional(),
    policyEffectiveAtMs: z.number().int().nonnegative().optional(),
  })
  .strict()

const ReconcileBodySchema = z
  .object({
    apply: z.boolean().optional(),
    release: z
      .object({
        utcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        endUtcDay: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/u)
          .optional(),
        rollingWindowDays: z.number().int().positive().optional(),
        dimensions: z.array(z.enum(['platform', 'contextType', 'actorRole', 'taskProvider'])).optional(),
        appVersion: z.string().optional(),
        drillThrough: z.boolean().optional(),
        sinkVersionId: z.string().min(1).optional(),
        execute: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const policyFieldsOf = (body: z.infer<typeof PatchBodySchema>, nowMs: number): PolicyUpdateFields => ({
  localMode: body.localMode,
  externalAggregateEnabled: body.externalAggregateEnabled,
  externalPseudonymousEnabled: body.externalPseudonymousEnabled,
  policyVersion: body.policyVersion,
  noticeVersion: body.noticeVersion,
  controllerContact: body.controllerContact,
  purpose: body.purpose,
  lawfulBasisMode: body.lawfulBasisMode,
  retainedEventHorizonDays: body.retainedEventHorizonDays,
  reviewDateMs: body.reviewDateMs,
  acknowledgedAtMs: body.acknowledge === true ? nowMs : undefined,
  policyEffectiveAtMs: body.policyEffectiveAtMs,
})

const mapUpdateError = (error: unknown): Response => {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('config version mismatch')) {
    return settingsJson(409, { error: 'config version mismatch', code: 'config_version_mismatch' })
  }
  if (message.startsWith('governance incomplete:')) {
    return settingsJson(422, {
      error: 'governance incomplete',
      code: 'governance_incomplete',
      missing: message.slice('governance incomplete:'.length).split(','),
    })
  }
  throw error
}

const handlePatch = async (
  req: Request,
  authed: AuthenticatedSettingsRequest,
  deps: AdminAnalyticsRouteDeps,
): Promise<Response> => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const nowMs = settingsRequestNowMs(req)
  const current = getPolicy({ getDrizzleDb: deps.getDrizzleDb })
  if (
    body.data.retainedEventHorizonDays !== undefined &&
    current.retainedEventHorizonDays !== null &&
    body.data.retainedEventHorizonDays > current.retainedEventHorizonDays
  ) {
    return settingsJson(422, { error: 'retention can only decrease', code: 'retention_increase_forbidden' })
  }

  const mergedExternalPseudo = body.data.externalPseudonymousEnabled ?? current.externalPseudonymousEnabled
  if (mergedExternalPseudo && !hasEnabledSink('pseudonymous', sinkDepsOf(deps))) {
    log.warn('pseudonymous egress refused: no enabled pseudonymous sink')
    return settingsJson(422, { error: 'no enabled pseudonymous sink', code: 'no_enabled_pseudonymous_sink' })
  }

  try {
    updatePolicy(
      { expectedConfigVersion: body.data.expectedConfigVersion, nowMs, fields: policyFieldsOf(body.data, nowMs) },
      {
        getDrizzleDb: deps.getDrizzleDb,
        analyticsKeyring: deps.analyticsKeyring,
        governanceKeyring: deps.governanceKeyring,
      },
    )
  } catch (error) {
    return mapUpdateError(error)
  }
  log.info('analytics policy updated through settings')
  return settingsJson(200, buildAdminView(deps, nowMs))
}

type ReconcileRelease = NonNullable<z.infer<typeof ReconcileBodySchema>['release']>

type ReleaseExecution = Readonly<{ status: string; releaseId: string; releaseHash: string; cellCount: number }>

type ReleaseOutcome =
  | Readonly<{ kind: 'denied'; response: Response }>
  | Readonly<{ kind: 'handled'; assessment: Readonly<{ ok: true }>; execution: ReleaseExecution | undefined }>

type ExecuteOutcome =
  | Readonly<{ kind: 'denied'; response: Response }>
  | Readonly<{ kind: 'executed'; execution: ReleaseExecution }>

const executeRelease = (release: ReconcileRelease, nowMs: number, deps: AdminAnalyticsRouteDeps): ExecuteOutcome => {
  const { sinkVersionId } = release
  if (sinkVersionId === undefined) {
    return {
      kind: 'denied',
      response: settingsJson(422, {
        error: 'sinkVersionId is required when execute is true',
        code: 'release_sink_required',
      }),
    }
  }
  if (!isEnabledAggregateSinkVersion(sinkVersionId, sinkDepsOf(deps))) {
    return {
      kind: 'denied',
      response: settingsJson(422, { error: 'no enabled aggregate sink version', code: 'release_sink_unavailable' }),
    }
  }
  const result = buildDailyAggregateRelease(
    { utcDay: release.utcDay, sinkVersionId, nowMs },
    { getDrizzleDb: deps.getDrizzleDb },
  )
  if (result.status === 'day_not_complete') {
    return {
      kind: 'denied',
      response: settingsJson(422, { error: 'utc day is not complete', code: 'release_day_incomplete' }),
    }
  }
  if (result.status === 'empty') {
    return {
      kind: 'denied',
      response: settingsJson(422, { error: 'no aggregate cells for utc day', code: 'release_empty_day' }),
    }
  }
  const execution: ReleaseExecution = {
    status: result.status,
    releaseId: result.releaseId,
    releaseHash: result.releaseHash,
    cellCount: result.status === 'released' ? result.cellCount : 0,
  }
  log.info({ releaseId: result.releaseId, status: result.status }, 'aggregate release executed through settings')
  return { kind: 'executed', execution }
}

const handleReleaseRequest = (
  release: ReconcileRelease,
  nowMs: number,
  deps: AdminAnalyticsRouteDeps,
): ReleaseOutcome => {
  const { execute, sinkVersionId, ...assessmentInput } = release
  const assessment = assessReleaseRequest({ ...assessmentInput, nowMs })
  if (!assessment.ok) {
    return {
      kind: 'denied',
      response: settingsJson(422, {
        error: 'release request denied',
        code: 'release_denied',
        reason: assessment.reason,
      }),
    }
  }
  if (execute !== true) return { kind: 'handled', assessment: { ok: true }, execution: undefined }
  const outcome = executeRelease({ ...assessmentInput, sinkVersionId, execute }, nowMs, deps)
  if (outcome.kind === 'denied') return outcome
  return { kind: 'handled', assessment: { ok: true }, execution: outcome.execution }
}

const handleReconcile = async (
  req: Request,
  authed: AuthenticatedSettingsRequest,
  deps: AdminAnalyticsRouteDeps,
): Promise<Response> => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ReconcileBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const nowMs = settingsRequestNowMs(req)
  let releaseAssessment: Readonly<{ ok: true }> | undefined
  let releaseExecution: ReleaseExecution | undefined
  if (body.data.release !== undefined) {
    const outcome = handleReleaseRequest(body.data.release, nowMs, deps)
    if (outcome.kind === 'denied') return outcome.response
    releaseAssessment = outcome.assessment
    releaseExecution = outcome.execution
  }
  const report = runReconciliation({ nowMs, apply: body.data.apply ?? false }, { getDrizzleDb: deps.getDrizzleDb })
  return settingsJson(200, {
    status: report.status,
    liveEpochs: report.liveEpochs,
    delivery: report.delivery,
    associationViolations: report.associationViolations,
    eventsByName: report.eventsByName,
    eventsByAttributionQuality: report.eventsByAttributionQuality,
    releaseAssessment,
    releaseExecution,
  })
}

const SINK_ACTIONS: ReadonlySet<string> = new Set(['verify', 'rotate', 'disable'])

export function handleAdminAnalyticsRoutes(
  req: Request,
  url: URL,
  deps: AdminAnalyticsRouteDeps = defaultAdminAnalyticsDeps(),
): Promise<Response> {
  const pathname = url.pathname
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  const guard = requireAdmin(auth.authed, req.method === 'GET' ? 'read' : 'write')
  if (guard !== null) return Promise.resolve(guard)

  if (pathname === '/settings/api/admin/analytics') {
    if (req.method === 'GET') {
      return Promise.resolve(settingsJson(200, buildAdminView(deps, settingsRequestNowMs(req))))
    }
    if (req.method === 'PATCH') return handlePatch(req, auth.authed, deps)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  if (pathname === '/settings/api/admin/analytics/reconcile') {
    if (req.method !== 'POST') return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
    return handleReconcile(req, auth.authed, deps)
  }
  if (pathname === '/settings/api/admin/analytics/sinks') {
    if (req.method !== 'POST') return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
    return handleCreateSink(req, auth.authed, deps)
  }
  const sinkActionMatch = /^\/settings\/api\/admin\/analytics\/sinks\/([^/]+)\/([^/]+)$/u.exec(pathname)
  if (sinkActionMatch !== null && req.method === 'POST' && SINK_ACTIONS.has(sinkActionMatch[2] ?? '')) {
    const sinkVersionId = sinkActionMatch[1] ?? ''
    const action = sinkActionMatch[2]
    if (action === 'verify') return handleVerifySink(req, auth.authed, deps, sinkVersionId)
    if (action === 'rotate') return handleRotateSink(req, auth.authed, deps, sinkVersionId)
    return Promise.resolve(handleDisableSink(req, auth.authed, deps, sinkVersionId))
  }
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
