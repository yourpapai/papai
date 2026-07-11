// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { YouTrackClient } from './client.js'
import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.js'
import {
  youtrackAddCommentSchema,
  youtrackGetAttachmentsSchema,
  youtrackGetCommentsSchema,
  youtrackGetFieldOptionsSchema,
  youtrackGetIssueSchema,
  youtrackGetIssueTagsSchema,
  youtrackGetStateActivitiesSchema,
  youtrackReadAttachmentSchema,
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

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

type YouTrackCreds = { baseUrl: string; token: string }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): YouTrackCreds | undefined {
  const baseUrl = runtimeContext.adminConfig.get('base_url')
  const token = runtimeContext.contextConfig.get('token')
  if (baseUrl === undefined || token === undefined) return undefined
  return { baseUrl, token }
}

function buildExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'youtrack_error', message }
}

async function withYouTrackGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: YouTrackClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'YouTrack is not configured' }
  }

  const client = new YouTrackClient({ baseUrl: creds.baseUrl, token: creds.token, httpFetch })

  try {
    return await run(client)
  } catch (err) {
    return buildExecutionError(err)
  }
}

function executeGetIssue(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getIssue(readRequiredString(record, 'issueId'))
  })
}

function executeGetStateActivities(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getStateActivities(readRequiredString(record, 'issueId'))
  })
}

function executeGetComments(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getComments(readRequiredString(record, 'issueId'))
  })
}

function executeGetIssueTags(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getIssueTags(readRequiredString(record, 'issueId'))
  })
}

function executeGetFieldOptions(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getFieldOptions(readRequiredString(record, 'issueId'), readOptionalString(record, 'fieldName'))
  })
}

function executeGetAttachments(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getAttachments(readRequiredString(record, 'issueId'))
  })
}

function executeReadAttachment(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.readAttachment(readRequiredString(record, 'issueId'), readRequiredString(record, 'attachmentId'))
  })
}

function executeAddComment(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.addComment(readRequiredString(record, 'issueId'), readRequiredString(record, 'text'))
  })
}

type YouTrackToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function buildReadToolDefinitions(getHttpFetch: () => HttpFetch | undefined): YouTrackToolDefinition[] {
  return [
    {
      name: 'youtrack_get_issue',
      description: 'Get a YouTrack issue by id (summary, description, fields, tags, links)',
      inputSchema: youtrackGetIssueSchema,
      execute: (input, runtimeContext) => executeGetIssue(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_get_state_activities',
      description: 'Get the State-field change history for a YouTrack issue',
      inputSchema: youtrackGetStateActivitiesSchema,
      execute: (input, runtimeContext) => executeGetStateActivities(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_get_comments',
      description: 'List non-deleted comments on a YouTrack issue',
      inputSchema: youtrackGetCommentsSchema,
      execute: (input, runtimeContext) => executeGetComments(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_get_issue_tags',
      description: 'List tags on a YouTrack issue',
      inputSchema: youtrackGetIssueTagsSchema,
      execute: (input, runtimeContext) => executeGetIssueTags(input, runtimeContext, getHttpFetch()),
    },
  ]
}

function buildAttachmentAndWriteToolDefinitions(getHttpFetch: () => HttpFetch | undefined): YouTrackToolDefinition[] {
  return [
    {
      name: 'youtrack_get_field_options',
      description: 'List allowed custom-field values for a YouTrack issue, optionally filtered to one field',
      inputSchema: youtrackGetFieldOptionsSchema,
      execute: (input, runtimeContext) => executeGetFieldOptions(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_get_attachments',
      description: 'List attachments on a YouTrack issue',
      inputSchema: youtrackGetAttachmentsSchema,
      execute: (input, runtimeContext) => executeGetAttachments(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_read_attachment',
      description: 'Read a YouTrack attachment by id, inlining small text content when available',
      inputSchema: youtrackReadAttachmentSchema,
      execute: (input, runtimeContext) => executeReadAttachment(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_add_comment',
      description: 'WRITE: add a comment to a YouTrack issue',
      inputSchema: youtrackAddCommentSchema,
      execute: (input, runtimeContext) => executeAddComment(input, runtimeContext, getHttpFetch()),
    },
  ]
}

function buildToolDefinitions(getHttpFetch: () => HttpFetch | undefined): YouTrackToolDefinition[] {
  return [...buildReadToolDefinitions(getHttpFetch), ...buildAttachmentAndWriteToolDefinitions(getHttpFetch)]
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

      pluginContext.log.info({}, 'mcp-youtrack plugin activated')

      for (const tool of buildToolDefinitions(() => httpFetch)) {
        pluginContext.registration.registerTool(tool)
      }
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-youtrack plugin deactivated')
    },
  }
}

export default factory
