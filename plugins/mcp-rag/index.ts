// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { RagClient } from './client.js'
import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.js'
import { dedupeDocuments, formatDocuments, formatFailures, parseContextCodes, parseSources } from './format.js'
import { ragSearchSchema } from './input-schema.js'

const BASE_TOOL_DESCRIPTION =
  'Search a corporate knowledge base (RAG service) by natural-language query. ' +
  'Returns matching documents (title, link, source). Sources and context are fixed in the server config.'

class ValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new ValidationError('input must be an object')
  }
  return input
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value === '') {
    throw new ValidationError(`${key} must be a non-empty string`)
  }
  return value
}

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

type RagCreds = { baseUrl: string; apiKey: string; contextCodes: string[]; sources: string[] }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): RagCreds | undefined {
  const baseUrl = runtimeContext.adminConfig.get('base_url')
  const apiKey = runtimeContext.adminConfig.get('api_key')
  const contextCode = runtimeContext.adminConfig.get('context_code')
  if (baseUrl === undefined || apiKey === undefined || contextCode === undefined) return undefined

  const contextCodes = parseContextCodes(contextCode)
  if (contextCodes.length === 0) return undefined

  const sources = parseSources(runtimeContext.adminConfig.get('sources'))
  return { baseUrl, apiKey, contextCodes, sources }
}

function buildExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'rag_error', message }
}

async function runRagSearch(input: unknown, creds: RagCreds, httpFetch: HttpFetch): Promise<string> {
  const record = toRecord(input)
  const query = readRequiredString(record, 'query')

  const client = new RagClient({
    baseUrl: creds.baseUrl,
    apiKey: creds.apiKey,
    contextCodes: creds.contextCodes,
    sources: creds.sources,
    httpFetch,
  })

  const { documents, failures } = await client.search(query)
  const deduped = dedupeDocuments(documents)
  const note = formatFailures(failures)
  return note === '' ? formatDocuments(deduped) : `${formatDocuments(deduped)}\n\n${note}`
}

async function executeRagSearch(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'RAG is not configured' }
  }

  try {
    return await runRagSearch(input, creds, httpFetch)
  } catch (err) {
    return buildExecutionError(err)
  }
}

type RagToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function buildRagTool(getHttpFetch: () => HttpFetch | undefined, description: string): RagToolDefinition {
  return {
    name: 'rag_search',
    description,
    inputSchema: ragSearchSchema,
    execute: (input, runtimeContext) => executeRagSearch(input, runtimeContext, getHttpFetch()),
  }
}

function resolveDescription(pluginContext: ReturnType<typeof requirePluginContext>): string {
  const sourceDesc = pluginContext.adminConfig?.get('source_description')?.trim()
  return sourceDesc !== undefined && sourceDesc !== ''
    ? `${BASE_TOOL_DESCRIPTION} ${sourceDesc}`
    : BASE_TOOL_DESCRIPTION
}

const factory = (): {
  activate(ctx: unknown): void
  deactivate(ctx: unknown): void
} => {
  let httpFetch: HttpFetch | undefined

  return {
    activate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      const providerRuntime = pluginContext.providerRuntime
      httpFetch = providerRuntime === undefined ? undefined : providerRuntime.httpFetch

      pluginContext.log.info({}, 'mcp-rag plugin activated')

      pluginContext.registration.registerTool(buildRagTool(() => httpFetch, resolveDescription(pluginContext)))
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-rag plugin deactivated')
    },
  }
}

export default factory
