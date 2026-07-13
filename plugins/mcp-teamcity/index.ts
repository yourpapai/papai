// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { TeamCityClient } from './client.js'
import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.js'
import {
  teamcityGetPipelineConfigSchema,
  teamcityGetProjectConfigSchema,
  teamcityGetProjectPipelinesSchema,
  teamcityGetProjectsSchema,
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

type TeamCityCreds = { baseUrl: string; token: string }

function readCreds(runtimeContext: PluginToolRuntimeContextLike): TeamCityCreds | undefined {
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
  return { error: 'teamcity_error', message }
}

async function withTeamCityGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: TeamCityClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const creds = readCreds(runtimeContext)
  if (creds === undefined || httpFetch === undefined) {
    return { error: 'not_configured', message: 'TeamCity is not configured' }
  }

  const client = new TeamCityClient({
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

function executeGetProjects(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withTeamCityGuards(runtimeContext, httpFetch, (client) => client.getProjects())
}

function executeGetProjectConfig(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withTeamCityGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getProjectConfig(readRequiredString(record, 'projectId'))
  })
}

function executeGetProjectPipelines(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withTeamCityGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getProjectBuildTypes(readRequiredString(record, 'projectId'))
  })
}

function executeGetPipelineConfig(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withTeamCityGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getBuildTypeConfig(readRequiredString(record, 'buildTypeId'))
  })
}

type TeamCityToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function buildToolDefinitions(getHttpFetch: () => HttpFetch | undefined): TeamCityToolDefinition[] {
  return [
    {
      name: 'teamcity_get_projects',
      description: 'List all TeamCity projects',
      inputSchema: teamcityGetProjectsSchema,
      execute: (_input, runtimeContext) => executeGetProjects(runtimeContext, getHttpFetch()),
    },
    {
      name: 'teamcity_get_project_config',
      description: 'Get a TeamCity project configuration by project id',
      inputSchema: teamcityGetProjectConfigSchema,
      execute: (input, runtimeContext) => executeGetProjectConfig(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'teamcity_get_project_pipelines',
      description: 'List the build configurations (pipelines) under a TeamCity project',
      inputSchema: teamcityGetProjectPipelinesSchema,
      execute: (input, runtimeContext) => executeGetProjectPipelines(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'teamcity_get_pipeline_config',
      description: 'Get a TeamCity build configuration (pipeline) by its id',
      inputSchema: teamcityGetPipelineConfigSchema,
      execute: (input, runtimeContext) => executeGetPipelineConfig(input, runtimeContext, getHttpFetch()),
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

      pluginContext.log.info({}, 'mcp-teamcity plugin activated')

      for (const tool of buildToolDefinitions(() => httpFetch)) {
        pluginContext.registration.registerTool(tool)
      }
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-teamcity plugin deactivated')
    },
  }
}

export default factory
