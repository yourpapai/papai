// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { nervAdminFetch, type NervAdminResult } from './nerv-admin-client.js'
import {
  authenticate,
  type AuthOutcome,
  parseJsonBody,
  requireCsrf,
  resolveContextScope,
  settingsJson,
} from './respond.js'

const RepoSchema = z
  .object({ projectPath: z.string(), repoUrl: z.string().optional(), baseBranch: z.string().optional() })
  .strict()

// Content validation of the repo list (non-empty, repoUrl derivation, projectPath
// uniqueness, etc.) is intentionally deferred to nerv's PUT /projects/self — this
// schema only validates shape so we can proxy the request, so it's deliberately
// looser than nerv's own validation (e.g. no `.min(1)` on `repositories` here).
const PutSchema = z
  .object({
    contextId: z.string().optional(),
    repositories: z.array(RepoSchema),
    autoReview: z.boolean().optional(),
    selfReviewEnabled: z.boolean().optional(),
    costBudgetUsd: z.number().nullable().optional(),
  })
  .strict()

function mapResult(result: NervAdminResult): Response {
  if (!result.ok) {
    if (result.reason === 'not_configured') return settingsJson(422, { error: 'nerv_not_configured' })
    return settingsJson(502, { error: 'nerv_unreachable' })
  }
  // A 401/403 from nerv means papai's configured nerv_token is invalid — surface it as a
  // deployment/config failure, not as a papai-session auth error (which a bare 401 would look like).
  if (result.status === 401 || result.status === 403) return settingsJson(502, { error: 'nerv_auth_failed' })
  return settingsJson(result.status, result.data)
}

async function handlePut(req: Request, auth: AuthOutcome & { ok: true }): Promise<Response> {
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PutSchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response
  const result = await nervAdminFetch('PUT', '/projects/self', {
    contextId: scope.scope.contextId,
    repositories: body.data.repositories,
    autoReview: body.data.autoReview,
    selfReviewEnabled: body.data.selfReviewEnabled,
    costBudgetUsd: body.data.costBudgetUsd,
  })
  return mapResult(result)
}

async function handleDelete(req: Request, url: URL, auth: AuthOutcome & { ok: true }): Promise<Response> {
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const scope = resolveContextScope(auth.authed.principal, 'write', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const result = await nervAdminFetch('DELETE', `/projects/self?contextId=${encodeURIComponent(scope.scope.contextId)}`)
  return mapResult(result)
}

export function handleSupervisedProjectsRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
    if (!scope.ok) return Promise.resolve(scope.response)
    return nervAdminFetch('GET', `/projects/self?contextId=${encodeURIComponent(scope.scope.contextId)}`).then(
      mapResult,
    )
  }
  if (req.method === 'PUT') return handlePut(req, auth)
  if (req.method === 'DELETE') return handleDelete(req, url, auth)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
