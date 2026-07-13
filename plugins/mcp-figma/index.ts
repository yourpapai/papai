// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { FigmaClient, type FigmaImageFormat } from './client.js'
import { requirePluginContext, type HttpFetch, type PluginToolRuntimeContextLike } from './context.js'
import {
  figmaGetCommentsSchema,
  figmaGetComponentsSchema,
  figmaGetFileNodesSchema,
  figmaGetFileSchema,
  figmaGetFileStylesSchema,
  figmaGetImagesSchema,
  figmaGetStyleSchema,
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

function resolveRateLimitActorId(runtimeContext: PluginToolRuntimeContextLike): string {
  if (runtimeContext.chatUserId !== '') return runtimeContext.chatUserId
  return runtimeContext.storageContextId
}

function readToken(runtimeContext: PluginToolRuntimeContextLike): string | undefined {
  return runtimeContext.contextConfig.get('token')
}

function hasUsableToken(token: string | undefined): token is string {
  if (token === undefined) return false
  return token.split(',').some((t) => t.trim().length > 0)
}

function toImageFormat(value: string | undefined): FigmaImageFormat {
  if (value === 'svg') return 'svg'
  if (value === 'pdf') return 'pdf'
  return 'png'
}

function buildExecutionError(err: unknown): unknown {
  if (err instanceof ValidationError) {
    return { error: 'validation_error', message: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'timeout', message }
  }
  return { error: 'figma_error', message }
}

async function withFigmaGuards(
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
  run: (client: FigmaClient) => Promise<unknown>,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(resolveRateLimitActorId(runtimeContext))
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  const token = readToken(runtimeContext)
  if (!hasUsableToken(token) || httpFetch === undefined) {
    return { error: 'not_configured', message: 'Figma token is not configured' }
  }

  const client = new FigmaClient({ token, httpFetch })

  try {
    return await run(client)
  } catch (err) {
    return buildExecutionError(err)
  }
}

function executeGetFile(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withFigmaGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getFile(readRequiredString(record, 'fileKey'))
  })
}

function executeGetFileNodes(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withFigmaGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getFileNodes(readRequiredString(record, 'fileKey'), readRequiredString(record, 'ids'))
  })
}

function executeGetImages(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withFigmaGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getImages(
      readRequiredString(record, 'fileKey'),
      readRequiredString(record, 'ids'),
      toImageFormat(readOptionalString(record, 'format')),
      readOptionalNumber(record, 'scale'),
    )
  })
}

function executeGetFileStyles(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withFigmaGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getFileStyles(readRequiredString(record, 'fileKey'))
  })
}

function executeGetStyle(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withFigmaGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getStyle(readRequiredString(record, 'fileKey'), readRequiredString(record, 'styleKey'))
  })
}

function executeGetComponents(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withFigmaGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getComponents(readRequiredString(record, 'fileKey'))
  })
}

function executeGetComments(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withFigmaGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.getComments(readRequiredString(record, 'fileKey'))
  })
}

type FigmaToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContextLike) => Promise<unknown>
}

function buildToolDefinitions(getHttpFetch: () => HttpFetch | undefined): FigmaToolDefinition[] {
  return [
    {
      name: 'figma_get_file',
      description: 'Get a simplified Figma file document tree (dimensions, text, layout, no styling noise)',
      inputSchema: figmaGetFileSchema,
      execute: (input, runtimeContext) => executeGetFile(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'figma_get_file_nodes',
      description: 'Get simplified Figma nodes by id from a file',
      inputSchema: figmaGetFileNodesSchema,
      execute: (input, runtimeContext) => executeGetFileNodes(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'figma_get_images',
      description: 'Render Figma nodes to image URLs (png/svg/pdf)',
      inputSchema: figmaGetImagesSchema,
      execute: (input, runtimeContext) => executeGetImages(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'figma_get_file_styles',
      description: 'List the styles (color/text/effect/grid) defined in a Figma file',
      inputSchema: figmaGetFileStylesSchema,
      execute: (input, runtimeContext) => executeGetFileStyles(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'figma_get_style',
      description: 'Get a single Figma style by key',
      inputSchema: figmaGetStyleSchema,
      execute: (input, runtimeContext) => executeGetStyle(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'figma_get_components',
      description: 'List the components defined in a Figma file',
      inputSchema: figmaGetComponentsSchema,
      execute: (input, runtimeContext) => executeGetComponents(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'figma_get_comments',
      description: 'List comments on a Figma file',
      inputSchema: figmaGetCommentsSchema,
      execute: (input, runtimeContext) => executeGetComments(input, runtimeContext, getHttpFetch()),
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

      pluginContext.log.info({}, 'mcp-figma plugin activated')

      for (const tool of buildToolDefinitions(() => httpFetch)) {
        pluginContext.registration.registerTool(tool)
      }
    },

    deactivate(ctx: unknown): void {
      const pluginContext = requirePluginContext(ctx)
      pluginContext.log.info({}, 'mcp-figma plugin deactivated')
    },
  }
}

export default factory
