// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { MattermostClient } from './client.js'
import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.js'
import {
  mattermostCreatePostSchema,
  mattermostDownloadAttachmentSchema,
  mattermostGetChannelPostsSchema,
  mattermostGetPostSchema,
  mattermostGetThreadSchema,
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

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function readOptionalStringOrNumber(record: Record<string, unknown>, key: string): string | number | undefined {
  const value = record[key]
  if (typeof value === 'string' || typeof value === 'number') return value
  return undefined
}

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

type MattermostCreds = { baseUrl: string; accessToken: string }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): MattermostCreds | undefined {
  const baseUrl = runtimeContext.adminConfig.get('base_url')
  const accessToken = runtimeContext.adminConfig.get('access_token')
  if (baseUrl === undefined || accessToken === undefined) return undefined
  return { baseUrl, accessToken }
}

function buildExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'mattermost_error', message }
}

async function withMattermostGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: MattermostClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'Mattermost is not configured' }
  }

  const client = new MattermostClient({ baseUrl: creds.baseUrl, token: creds.accessToken, httpFetch })

  try {
    return await run(client)
  } catch (err) {
    return buildExecutionError(err)
  }
}

function executeGetPost(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withMattermostGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getPost(readRequiredString(record, 'linkOrId'))
  })
}

function executeGetThread(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withMattermostGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getThread(readRequiredString(record, 'linkOrId'))
  })
}

function executeGetChannelPosts(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withMattermostGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getChannelPosts(readRequiredString(record, 'channelId'), {
      since: readOptionalStringOrNumber(record, 'since'),
      page: readOptionalNumber(record, 'page'),
      perPage: readOptionalNumber(record, 'perPage'),
    })
  })
}

function executeCreatePost(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withMattermostGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.createPost({
      channelId: readRequiredString(record, 'channelId'),
      message: readRequiredString(record, 'message'),
      rootId: readOptionalString(record, 'rootId'),
      threadLinkOrId: readOptionalString(record, 'threadLinkOrId'),
    })
  })
}

function executeDownloadAttachment(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withMattermostGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.downloadAttachment(readRequiredString(record, 'fileId'))
  })
}

type MattermostToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function buildToolDefinitions(getHttpFetch: () => HttpFetch | undefined): MattermostToolDefinition[] {
  return [
    {
      name: 'mattermost_get_post',
      description: 'Get a single Mattermost post by permalink or id, enriched with author and attachment metadata',
      inputSchema: mattermostGetPostSchema,
      execute: (input, runtimeContext) => executeGetPost(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'mattermost_get_thread',
      description: 'Get all posts in a Mattermost thread by its root permalink or id, ordered oldest to newest',
      inputSchema: mattermostGetThreadSchema,
      execute: (input, runtimeContext) => executeGetThread(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'mattermost_get_channel_posts',
      description: 'List recent posts in a Mattermost channel, optionally since a given time, paginated',
      inputSchema: mattermostGetChannelPostsSchema,
      execute: (input, runtimeContext) => executeGetChannelPosts(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'mattermost_create_post',
      description: 'WRITE: post a message to a Mattermost channel, optionally as a thread reply',
      inputSchema: mattermostCreatePostSchema,
      execute: (input, runtimeContext) => executeCreatePost(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'mattermost_download_attachment',
      description: 'Download a Mattermost file attachment by id (inlines small text files, flags large/binary ones)',
      inputSchema: mattermostDownloadAttachmentSchema,
      execute: (input, runtimeContext) => executeDownloadAttachment(input, runtimeContext, getHttpFetch()),
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

      pluginContext.log.info({}, 'mcp-mattermost plugin activated')

      for (const tool of buildToolDefinitions(() => httpFetch)) {
        pluginContext.registration.registerTool(tool)
      }
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-mattermost plugin deactivated')
    },
  }
}

export default factory
