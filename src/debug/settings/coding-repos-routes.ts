// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { deleteRepo, listRepos, upsertRepo } from '../../modules/coding/repos/store.js'
import { REPO_PRESETS } from '../../modules/coding/repos/types.js'
import {
  authenticate,
  type AuthOutcome,
  parseJsonBody,
  requireCsrf,
  resolveContextScope,
  settingsJson,
} from './respond.js'

const PostBodySchema = z
  .object({
    contextId: z.string().optional(),
    name: z.string(),
    repoUrl: z.string(),
    baseBranch: z.string(),
    permissionPreset: z.enum(REPO_PRESETS),
    additionalEgressDomains: z.array(z.string()).max(20).optional(),
  })
  .strict()

async function handlePost(req: Request, auth: AuthOutcome & { ok: true }): Promise<Response> {
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PostBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })
  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response
  let repoId: string
  try {
    repoId = upsertRepo(
      scope.scope.contextId,
      {
        name: body.data.name,
        repoUrl: body.data.repoUrl,
        baseBranch: body.data.baseBranch,
        permissionPreset: body.data.permissionPreset,
        additionalEgressDomains: body.data.additionalEgressDomains ?? [],
      },
      auth.authed.principal.platformUserId,
    )
  } catch (err) {
    return settingsJson(422, { error: err instanceof Error ? err.message : 'invalid repo' })
  }
  return settingsJson(200, { ok: true, repoId, contextId: scope.scope.contextId })
}

function handleDelete(req: Request, url: URL, auth: AuthOutcome & { ok: true }): Response {
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const repoId = url.searchParams.get('repoId')
  if (repoId === null || repoId.length === 0) return settingsJson(400, { error: 'repoId is required' })
  const scope = resolveContextScope(auth.authed.principal, 'write', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  deleteRepo(scope.scope.contextId, repoId, auth.authed.principal.platformUserId)
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export function handleCodingReposRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
    if (!scope.ok) return Promise.resolve(scope.response)
    return Promise.resolve(settingsJson(200, { repos: listRepos(scope.scope.contextId) }))
  }
  if (req.method === 'POST') return handlePost(req, auth)
  if (req.method === 'DELETE') return Promise.resolve(handleDelete(req, url, auth))
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
