// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getConfigValue, maskSensitiveValue, setConfigValue } from '../../config.js'
import { logger } from '../../logger.js'
import { mcpEndpointConfigSchema, type McpEndpointConfig } from '../../mcp/types.js'
import { parseMcpEndpoints } from '../../mcp/user-endpoints.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-mcp' })
const PutBodySchema = z.object({ endpoints: z.array(z.unknown()), contextId: z.string().optional() })

function maskHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, maskSensitiveValue(v)]))
}

/** Replace any header value equal to the masked form of the stored value with the stored plaintext. */
function restoreMaskedHeaders(incoming: McpEndpointConfig, stored: readonly McpEndpointConfig[]): McpEndpointConfig {
  if (incoming.headers === undefined) return incoming
  const prior = stored.find((e) => e.id === incoming.id)?.headers ?? {}
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(incoming.headers)) {
    const priorValue = prior[key]
    merged[key] = priorValue !== undefined && value === maskSensitiveValue(priorValue) ? priorValue : value
  }
  return { ...incoming, headers: merged }
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const endpoints = parseMcpEndpoints(getConfigValue(scope.scope.contextId, 'mcp_endpoints')).map((e) => ({
    ...e,
    headers: maskHeaders(e.headers),
  }))
  return settingsJson(200, { contextId: scope.scope.contextId, endpoints })
}

async function handlePut(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PutBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const stored = parseMcpEndpoints(getConfigValue(scope.scope.contextId, 'mcp_endpoints'))
  const validated: McpEndpointConfig[] = []
  for (const raw of body.data.endpoints) {
    const entry = mcpEndpointConfigSchema.safeParse(raw)
    if (!entry.success) return settingsJson(422, { error: entry.error.issues[0]?.message ?? 'invalid endpoint' })
    validated.push(restoreMaskedHeaders(entry.data, stored))
  }

  setConfigValue(scope.scope.contextId, 'mcp_endpoints', JSON.stringify(validated))
  log.info({ contextId: scope.scope.contextId, count: validated.length }, 'Settings MCP endpoints updated')
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}

export function handleMcpRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
  if (req.method === 'PUT') return handlePut(req)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
