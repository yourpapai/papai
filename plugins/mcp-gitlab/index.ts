// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { GitLabClient } from './client.js'
import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.js'
import { parseJobUrl } from './format.js'
import {
  gitlabGetFileContentSchema,
  gitlabGetJobSchema,
  gitlabGetMrInfoSchema,
  gitlabGetMrsSchema,
  gitlabGetRepositoryTreeSchema,
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

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

type GitLabCreds = { baseUrl: string; token: string }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): GitLabCreds | undefined {
  const baseUrl = runtimeContext.adminConfig.get('base_url')
  const token = runtimeContext.adminConfig.get('token')
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
  return { error: 'gitlab_error', message }
}

async function withGitLabGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: GitLabClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'GitLab is not configured' }
  }

  const client = new GitLabClient({
    baseUrl: creds.baseUrl,
    token: creds.token,
    httpFetch,
  })

  try {
    return await run(client)
  } catch (err) {
    return buildExecutionError(err)
  }
}

function executeGetRepositoryTree(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getRepositoryTree(readRequiredString(record, 'projectPath'), {
      path: readOptionalString(record, 'path'),
      ref: readOptionalString(record, 'ref'),
      recursive: readOptionalBoolean(record, 'recursive'),
    })
  })
}

function executeGetFileContent(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getFileContent(readRequiredString(record, 'projectPath'), readRequiredString(record, 'filePath'), {
      ref: readOptionalString(record, 'ref'),
    })
  })
}

function executeGetMrInfo(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getMrInfo(readRequiredString(record, 'projectPath'), readRequiredString(record, 'mrIid'))
  })
}

function executeGetMrs(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getMrs(readRequiredString(record, 'projectPath'), {
      state: readOptionalString(record, 'state'),
      search: readOptionalString(record, 'search'),
      labels: readOptionalString(record, 'labels'),
      sourceBranch: readOptionalString(record, 'sourceBranch'),
      targetBranch: readOptionalString(record, 'targetBranch'),
      orderBy: readOptionalString(record, 'orderBy'),
      sort: readOptionalString(record, 'sort'),
      perPage: readOptionalNumber(record, 'perPage'),
      page: readOptionalNumber(record, 'page'),
      all: readOptionalBoolean(record, 'all'),
    })
  })
}

function executeGetJob(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    const jobUrl = readOptionalString(record, 'jobUrl')
    if (jobUrl !== undefined && jobUrl !== '') {
      const parsed = parseJobUrl(jobUrl)
      return client.getJob(parsed.projectPath, parsed.jobId)
    }
    const projectPath = readOptionalString(record, 'projectPath')
    const jobId = readOptionalString(record, 'jobId')
    if (projectPath === undefined || projectPath === '' || jobId === undefined || jobId === '') {
      throw new ValidationError('provide either jobUrl, or both projectPath and jobId')
    }
    return client.getJob(projectPath, jobId)
  })
}

type GitLabToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function buildToolDefinitions(getHttpFetch: () => HttpFetch | undefined): GitLabToolDefinition[] {
  return [
    {
      name: 'gitlab_get_repository_tree',
      description: 'List files and directories in a GitLab repository at a given path/ref (read-only)',
      inputSchema: gitlabGetRepositoryTreeSchema,
      execute: (input, runtimeContext) => executeGetRepositoryTree(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_get_file_content',
      description: 'Get the raw content of a file from a GitLab repository at a given ref (read-only)',
      inputSchema: gitlabGetFileContentSchema,
      execute: (input, runtimeContext) => executeGetFileContent(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_get_mr_info',
      description: 'Get details of a single GitLab merge request by iid (read-only)',
      inputSchema: gitlabGetMrInfoSchema,
      execute: (input, runtimeContext) => executeGetMrInfo(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_get_mrs',
      description: 'List/search GitLab merge requests in a project with optional filters (read-only)',
      inputSchema: gitlabGetMrsSchema,
      execute: (input, runtimeContext) => executeGetMrs(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_get_job',
      description: 'Get a GitLab CI job (metadata and trace log) by id (read-only)',
      inputSchema: gitlabGetJobSchema,
      execute: (input, runtimeContext) => executeGetJob(input, runtimeContext, getHttpFetch()),
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

      pluginContext.log.info({}, 'mcp-gitlab plugin activated')

      for (const tool of buildToolDefinitions(() => httpFetch)) {
        pluginContext.registration.registerTool(tool)
      }
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-gitlab plugin deactivated')
    },
  }
}

export default factory
