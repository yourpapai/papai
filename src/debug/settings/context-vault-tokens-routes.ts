// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { createToken, listTokens, revokeToken } from '../../context-vault/token-store.js'
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
    label: z.string().min(1),
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
  const created = createToken(scope.scope.contextId, body.data.label)
  return settingsJson(200, {
    ok: true,
    tokenId: created.tokenId,
    plaintext: created.plaintext,
    contextId: scope.scope.contextId,
  })
}

function handleDelete(req: Request, url: URL, auth: AuthOutcome & { ok: true }): Response {
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const tokenId = url.searchParams.get('tokenId')
  if (tokenId === null || tokenId.length === 0) return settingsJson(400, { error: 'tokenId is required' })
  const scope = resolveContextScope(auth.authed.principal, 'write', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const revoked = revokeToken(scope.scope.contextId, tokenId)
  if (!revoked) return settingsJson(404, { error: 'token not found' })
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export function handleContextVaultTokensRoutes(req: Request, url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
    if (!scope.ok) return Promise.resolve(scope.response)
    return Promise.resolve(settingsJson(200, { tokens: listTokens(scope.scope.contextId) }))
  }
  if (req.method === 'POST') return handlePost(req, auth)
  if (req.method === 'DELETE') return Promise.resolve(handleDelete(req, url, auth))
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
