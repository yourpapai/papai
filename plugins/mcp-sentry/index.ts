// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { SentryClient } from './client.ts'
import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.ts'
import {
  sentryGetIssueCommentsSchema,
  sentryGetIssueEventsSchema,
  sentryGetIssueSchema,
  sentryGetIssueDetailsSchema,
  sentryGetIssueTagValuesSchema,
  sentryGetProjectsSchema,
  sentrySearchIssuesSchema,
} from './input-schema.ts'

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

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

type SentryCreds = { baseUrl: string; token: string; orgSlug: string }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): SentryCreds | undefined {
  const baseUrl = runtimeContext.adminConfig.get('base_url')
  const token = runtimeContext.adminConfig.get('token')
  const orgSlug = runtimeContext.adminConfig.get('org_slug')
  if (baseUrl === undefined || token === undefined || orgSlug === undefined) return undefined
  return { baseUrl, token, orgSlug }
}

function buildExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'sentry_error', message }
}

async function withSentryGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: SentryClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'Sentry is not configured' }
  }

  const client = new SentryClient({ baseUrl: creds.baseUrl, token: creds.token, orgSlug: creds.orgSlug, httpFetch })

  try {
    return await run(client)
  } catch (err) {
    return buildExecutionError(err)
  }
}

function executeGetProjects(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withSentryGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getProjects(readOptionalNumber(record, 'limit'))
  })
}

function executeSearchIssues(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withSentryGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.searchIssues({
      project: readOptionalString(record, 'project'),
      query: readOptionalString(record, 'query'),
      statsPeriod: readOptionalString(record, 'statsPeriod'),
      environment: readOptionalString(record, 'environment'),
      sort: readOptionalString(record, 'sort'),
      limit: readOptionalNumber(record, 'limit'),
    })
  })
}

function executeGetIssue(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withSentryGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getIssue(readRequiredString(record, 'issueId'))
  })
}

function executeGetIssueEvents(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withSentryGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getIssueEvents(readRequiredString(record, 'issueId'), readOptionalNumber(record, 'limit'))
  })
}

function executeGetIssueTagValues(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withSentryGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getIssueTagValues(
      readRequiredString(record, 'issueId'),
      readRequiredString(record, 'tagKey'),
      readOptionalNumber(record, 'limit'),
    )
  })
}

function executeGetIssueComments(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withSentryGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getIssueComments(readRequiredString(record, 'issueId'), readOptionalNumber(record, 'limit'))
  })
}

function executeGetIssueDetails(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withSentryGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getIssueDetails(readRequiredString(record, 'issueId'), {
      eventsLimit: readOptionalNumber(record, 'eventsLimit'),
      tagValuesLimit: readOptionalNumber(record, 'tagValuesLimit'),
      commentsLimit: readOptionalNumber(record, 'commentsLimit'),
      releasesLimit: readOptionalNumber(record, 'releasesLimit'),
      commitsLimit: readOptionalNumber(record, 'commitsLimit'),
    })
  })
}

type SentryToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function buildToolDefinitions(getHttpFetch: () => HttpFetch | undefined): SentryToolDefinition[] {
  return [
    {
      name: 'sentry_get_projects',
      description: 'List Sentry projects in the org',
      inputSchema: sentryGetProjectsSchema,
      execute: (input, runtimeContext) => executeGetProjects(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'sentry_search_issues',
      description: 'Search Sentry issues with an optional query/filter',
      inputSchema: sentrySearchIssuesSchema,
      execute: (input, runtimeContext) => executeSearchIssues(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'sentry_get_issue',
      description: 'Get a Sentry issue by id',
      inputSchema: sentryGetIssueSchema,
      execute: (input, runtimeContext) => executeGetIssue(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'sentry_get_issue_events',
      description: 'List recent events for a Sentry issue',
      inputSchema: sentryGetIssueEventsSchema,
      execute: (input, runtimeContext) => executeGetIssueEvents(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'sentry_get_issue_tag_values',
      description: 'List tag values for a Sentry issue tag key',
      inputSchema: sentryGetIssueTagValuesSchema,
      execute: (input, runtimeContext) => executeGetIssueTagValues(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'sentry_get_issue_comments',
      description: 'List comments/activity on a Sentry issue',
      inputSchema: sentryGetIssueCommentsSchema,
      execute: (input, runtimeContext) => executeGetIssueComments(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'sentry_get_issue_details',
      description:
        'Get a composite view of a Sentry issue: issue, latest events, tag values, comments, and suspect releases/commits',
      inputSchema: sentryGetIssueDetailsSchema,
      execute: (input, runtimeContext) => executeGetIssueDetails(input, runtimeContext, getHttpFetch()),
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

      pluginContext.log.info({}, 'mcp-sentry plugin activated')

      for (const tool of buildToolDefinitions(() => httpFetch)) {
        pluginContext.registration.registerTool(tool)
      }
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-sentry plugin deactivated')
    },
  }
}

export default factory
