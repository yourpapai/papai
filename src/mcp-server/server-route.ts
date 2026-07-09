// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// PUBLIC capability-token route family — mounted BEFORE the settings auth gate in
// src/debug/server.ts, mirroring the transcript viewer. Access control is possession
// of a valid signed binding token (src/mcp-server/token.ts), not a session cookie.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { getConfigContextIdFromStorageContextId, parseScopedContextId } from '../chat/scoped-context.js'
import { listEnabledInternalMcpServers } from '../coding-credentials/mcp-plugin-servers.js'
import { logger } from '../logger.js'
import { callPluginMcpTool, listPluginMcpTools } from './plugin-bridge.js'
import { verifyPluginMcpToken, type PluginMcpTokenClaims } from './token.js'

const log = logger.child({ scope: 'mcp-server:route' })
const PREFIX = '/mcp/plugin/'

export interface PluginMcpRouteDeps {
  verifyToken: (raw: string, nowMs?: number) => PluginMcpTokenClaims | null
  isExposedInternalServer: (pluginId: string, storageContextId: string) => boolean
}

const defaultDeps: PluginMcpRouteDeps = {
  verifyToken: verifyPluginMcpToken,
  isExposedInternalServer: (pluginId, storageContextId) => {
    const pi = parseScopedContextId(storageContextId)?.platformInstanceId
    if (pi === undefined) return false
    const cc = getConfigContextIdFromStorageContextId(storageContextId)
    return listEnabledInternalMcpServers(pi, cc).some((s) => s.pluginId === pluginId)
  },
}

function extractBearer(req: Request): string | null {
  const raw = req.headers.get('authorization')
  if (raw === null || raw.trim() === '') return null
  const trimmed = raw.trim()
  return trimmed.toLowerCase().startsWith('bearer ') ? trimmed.slice(7).trim() : trimmed
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

function decodePluginId(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

type PluginMcpAuthResult = { claims: PluginMcpTokenClaims } | { errorResponse: Response }

function resolvePluginMcpAuth(req: Request, pathPluginId: string, deps: PluginMcpRouteDeps): PluginMcpAuthResult {
  const token = extractBearer(req)
  if (token === null) return { errorResponse: unauthorized() }
  const claims = deps.verifyToken(token)
  if (claims === null || claims.pluginId !== pathPluginId) return { errorResponse: unauthorized() }

  if (!deps.isExposedInternalServer(claims.pluginId, claims.storageContextId)) {
    log.warn(
      { pluginId: claims.pluginId },
      'plugin is not an enabled internal MCP server for this context; refusing (fail-closed)',
    )
    return { errorResponse: unauthorized() }
  }
  return { claims }
}

// Built on the low-level `server` escape hatch documented on `McpServer` ("For advanced usage
// (like sending notifications or setting custom request handlers), use the underlying Server
// instance available via the `server` property") rather than `McpServer.registerTool`, because
// our tool set is dynamic per-plugin/per-request and already carries JSON-Schema `inputSchema`
// values (from `listPluginMcpTools`) — `registerTool` only accepts Zod schemas, which would
// require lossy on-the-fly JSON-Schema-to-Zod translation for no benefit.
function buildPluginMcpServer(claims: PluginMcpTokenClaims): McpServer {
  const mcpServer = new McpServer(
    { name: `papai-plugin-${claims.pluginId}`, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await listPluginMcpTools(claims.pluginId),
  }))
  mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const result = await callPluginMcpTool({
      pluginId: claims.pluginId,
      toolName: request.params.name,
      input: request.params.arguments ?? {},
      storageContextId: claims.storageContextId,
      chatUserId: claims.chatUserId,
    })
    return result.isError === undefined
      ? { content: result.content }
      : { content: result.content, isError: result.isError }
  })
  return mcpServer
}

async function handlePluginMcpTransport(req: Request, claims: PluginMcpTokenClaims): Promise<Response> {
  const server = buildPluginMcpServer(claims)

  // `enableJsonResponse: true` forces the transport to await the full request/response
  // round trip and resolve `handleRequest` with a plain JSON `Response` rather than
  // returning an in-flight SSE stream body. Without it, the SDK's default SSE mode
  // returns the `Response` immediately while the actual JSON-RPC reply is still being
  // written to the stream asynchronously (via `Server`'s message handling), so closing
  // the server right after `handleRequest` resolves would race — and could truncate —
  // that write. With JSON mode, the response is fully materialized before we get it
  // back, so closing the server in `finally` below is safe.
  //
  // This rationale is scoped to the POST JSON-RPC path this route actually serves. A
  // GET+SSE streaming session is not a supported/used mode here — if one were added,
  // closing in `finally` right after `handleRequest` resolves would tear down the
  // stream immediately instead of letting it deliver further server-initiated messages.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(req)
  } finally {
    await server.close()
  }
}

/**
 * Route a request against the `/mcp/plugin/:pluginId` path family. Returns `null` when the
 * path doesn't match (the caller should fall through to its next route), otherwise a
 * `Response` — including 401s for auth/eligibility failures and the MCP transport's own
 * response for authorized requests.
 *
 * Each call spins up a fresh, stateless `Server` + transport pair bound to the resolved
 * plugin/context; nothing is retained across requests.
 */
export function routePluginMcpPaths(
  req: Request,
  url: URL,
  deps: PluginMcpRouteDeps = defaultDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith(PREFIX)) return Promise.resolve(null)
  const rawSegment = url.pathname.slice(PREFIX.length).split('/')[0] ?? ''
  const pathPluginId = decodePluginId(rawSegment)
  if (pathPluginId === null || pathPluginId === '') return Promise.resolve(new Response('Not found', { status: 404 }))

  const auth = resolvePluginMcpAuth(req, pathPluginId, deps)
  if ('errorResponse' in auth) return Promise.resolve(auth.errorResponse)

  return handlePluginMcpTransport(req, auth.claims)
}
