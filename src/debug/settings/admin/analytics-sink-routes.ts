// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  createSinkVersion,
  disableSinkVersion,
  getSinkVersion,
  rotateSinkVersion,
  verifySinkVersion,
} from '../../../analytics/delivery/sink-service.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { settingsRequestNowMs } from '../request-clock.js'
import { parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { sinkDepsOf } from './analytics-view.js'
import type { AdminAnalyticsRouteDeps } from './analytics-view.js'

export const GateAttestationSchema = z
  .object({
    capabilities: z
      .object({
        callerControlledIdempotency: z.boolean(),
        deterministicReconciliation: z.boolean(),
        deleteActor: z.boolean(),
      })
      .strict(),
    processorReview: z
      .object({
        subprocessorReviewed: z.boolean(),
        residencyReviewed: z.boolean(),
        deletionPathReviewed: z.boolean(),
        incidentReviewed: z.boolean(),
        transferReviewed: z.boolean(),
        noSecondaryUse: z.boolean(),
      })
      .strict(),
    httpsPolicyApproved: z.boolean(),
  })
  .strict()

export const CreateSinkBodySchema = z
  .object({
    logicalSinkId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u),
    kind: z.enum(['webhook', 'openpanel']),
    egressMode: z.enum(['aggregate', 'pseudonymous']),
    endpoint: z.string().min(1),
    secret: z.string().min(8),
  })
  .strict()

export const RotateSinkBodySchema = CreateSinkBodySchema.omit({ logicalSinkId: true })
  .strict()
  .and(GateAttestationSchema)

type BodyOutcome<S extends z.ZodType> =
  | Readonly<{ ok: true; data: z.infer<S> }>
  | Readonly<{ ok: false; response: Response }>

const parseBody = async <S extends z.ZodType>(
  req: Request,
  authed: AuthenticatedSettingsRequest,
  schema: S,
): Promise<BodyOutcome<S>> => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return { ok: false, response: csrf }
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return { ok: false, response: parsed.response }
  const body = schema.safeParse(parsed.value)
  if (!body.success) return { ok: false, response: settingsJson(422, { error: 'invalid request' }) }
  return { ok: true, data: body.data as z.infer<S> }
}

export const handleCreateSink = async (
  req: Request,
  authed: AuthenticatedSettingsRequest,
  deps: AdminAnalyticsRouteDeps,
): Promise<Response> => {
  const body = await parseBody(req, authed, CreateSinkBodySchema)
  if (!body.ok) return body.response
  try {
    const view = createSinkVersion({ ...body.data, nowMs: settingsRequestNowMs(req) }, sinkDepsOf(deps))
    return settingsJson(201, { status: 'created', sink: view })
  } catch (error) {
    return settingsJson(422, { error: error instanceof Error ? error.message : String(error) })
  }
}

export const handleVerifySink = async (
  req: Request,
  authed: AuthenticatedSettingsRequest,
  deps: AdminAnalyticsRouteDeps,
  sinkVersionId: string,
): Promise<Response> => {
  const body = await parseBody(req, authed, GateAttestationSchema)
  if (!body.ok) return body.response
  const result = await verifySinkVersion(
    { sinkVersionId, nowMs: settingsRequestNowMs(req), ...body.data },
    sinkDepsOf(deps),
  )
  if (result.status === 'not_found') return settingsJson(404, { error: 'sink version not found' })
  if (result.status === 'not_pending') return settingsJson(409, { status: 'not_pending' })
  if (result.status === 'gate_denied') return settingsJson(200, { status: 'gate_denied', reason: result.reason })
  if (result.status === 'verification_failed') {
    return settingsJson(200, { status: 'verification_failed', failureClass: result.failureClass })
  }
  return settingsJson(200, { status: 'enabled', sink: result.view })
}

export const handleRotateSink = async (
  req: Request,
  authed: AuthenticatedSettingsRequest,
  deps: AdminAnalyticsRouteDeps,
  sinkVersionId: string,
): Promise<Response> => {
  const body = await parseBody(req, authed, RotateSinkBodySchema)
  if (!body.ok) return body.response
  const existing = getSinkVersion(sinkVersionId, sinkDepsOf(deps))
  if (existing === null) return settingsJson(404, { error: 'sink version not found' })
  const result = await rotateSinkVersion(
    { ...body.data, logicalSinkId: existing.logicalSinkId, nowMs: settingsRequestNowMs(req) },
    sinkDepsOf(deps),
  )
  if (result.status === 'no_predecessor') return settingsJson(409, { status: 'no_predecessor' })
  if (result.status === 'gate_denied') return settingsJson(200, { status: 'gate_denied', reason: result.reason })
  if (result.status === 'verification_failed') {
    return settingsJson(200, { status: 'verification_failed', failureClass: result.failureClass })
  }
  return settingsJson(200, { status: 'rotated', sink: result.view })
}

export const handleDisableSink = (
  req: Request,
  authed: AuthenticatedSettingsRequest,
  deps: AdminAnalyticsRouteDeps,
  sinkVersionId: string,
): Response => {
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const result = disableSinkVersion({ sinkVersionId, nowMs: settingsRequestNowMs(req) }, sinkDepsOf(deps))
  if (result === 'not_found') return settingsJson(404, { error: 'sink version not found' })
  if (result === 'not_enabled') return settingsJson(409, { status: 'not_enabled' })
  return settingsJson(200, { status: 'disabled', sink: getSinkVersion(sinkVersionId, sinkDepsOf(deps)) })
}
