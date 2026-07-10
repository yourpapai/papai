// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ConfluenceClient } from './client.js'
import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.js'
import {
  confluenceAddCommentSchema,
  confluenceGetCommentsSchema,
  confluenceGetPageByTitleSchema,
  confluenceGetPageSchema,
  confluenceResolveShortLinkSchema,
} from './input-schema.js'

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

type ConfluenceCreds = { baseUrl: string; username: string; password: string }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): ConfluenceCreds | undefined {
  const baseUrl = runtimeContext.adminConfig.get('base_url')
  const username = runtimeContext.adminConfig.get('username')
  const password = runtimeContext.adminConfig.get('password')
  if (baseUrl === undefined || username === undefined || password === undefined) return undefined
  return { baseUrl, username, password }
}

function buildExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'confluence_error', message }
}

async function withConfluenceGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: ConfluenceClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'Confluence is not configured' }
  }

  const client = new ConfluenceClient({
    baseUrl: creds.baseUrl,
    username: creds.username,
    password: creds.password,
    httpFetch,
  })

  try {
    return await run(client)
  } catch (err) {
    return buildExecutionError(err)
  }
}

function executeGetPage(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withConfluenceGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getPage(readRequiredString(record, 'pageId'))
  })
}

function executeGetPageByTitle(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withConfluenceGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getPageByTitle(readRequiredString(record, 'spaceKey'), readRequiredString(record, 'title'))
  })
}

function executeGetComments(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withConfluenceGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getComments(readRequiredString(record, 'pageId'))
  })
}

function executeAddComment(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withConfluenceGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.addComment(readRequiredString(record, 'pageId'), readRequiredString(record, 'text'))
  })
}

function executeResolveShortLink(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withConfluenceGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.resolveShortLink(readRequiredString(record, 'shortLink'))
  })
}

type ConfluenceToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function buildToolDefinitions(getHttpFetch: () => HttpFetch | undefined): ConfluenceToolDefinition[] {
  return [
    {
      name: 'confluence_get_page',
      description: 'Get a Confluence page by id, with body content in storage (XHTML) format',
      inputSchema: confluenceGetPageSchema,
      execute: (input, runtimeContext) => executeGetPage(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'confluence_get_page_by_title',
      description: 'Get a Confluence page by space key and exact title',
      inputSchema: confluenceGetPageByTitleSchema,
      execute: (input, runtimeContext) => executeGetPageByTitle(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'confluence_get_comments',
      description: 'List comments on a Confluence page',
      inputSchema: confluenceGetCommentsSchema,
      execute: (input, runtimeContext) => executeGetComments(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'confluence_add_comment',
      description: 'Add a comment to a Confluence page',
      inputSchema: confluenceAddCommentSchema,
      execute: (input, runtimeContext) => executeAddComment(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'confluence_resolve_short_link',
      description: 'Resolve a Confluence tiny/short link to its full URL and page',
      inputSchema: confluenceResolveShortLinkSchema,
      execute: (input, runtimeContext) => executeResolveShortLink(input, runtimeContext, getHttpFetch()),
    },
  ]
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

      pluginContext.log.info({}, 'mcp-confluence plugin activated')

      for (const tool of buildToolDefinitions(() => httpFetch)) {
        pluginContext.registration.registerTool(tool)
      }
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-confluence plugin deactivated')
    },
  }
}

export default factory
