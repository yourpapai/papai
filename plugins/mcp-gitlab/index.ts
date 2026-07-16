// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.js'
import { parseJobUrl } from './format.js'
import {
  ValidationError,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readRequiredString,
  toRecord,
  withGitLabGuards,
  type GitLabToolDefinition,
} from './guards.js'
import {
  gitlabGetFileContentSchema,
  gitlabGetJobSchema,
  gitlabGetMrInfoSchema,
  gitlabGetMrsSchema,
  gitlabGetRepositoryTreeSchema,
} from './input-schema.js'

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
