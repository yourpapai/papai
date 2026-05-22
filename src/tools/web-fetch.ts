// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { fetchAndExtract as defaultFetchAndExtract } from '../web/fetch-extract.js'

const log = logger.child({ scope: 'tool:web-fetch' })
const webFetchInputSchema = z.object({
  url: z
    .string()
    .refine(isHttpUrl, 'Expected a fully qualified http(s) URL')
    .describe('Fully qualified public http(s) URL to fetch'),
  goal: z.string().optional().describe('Optional summarization or extraction goal for the fetched page'),
})
type WebFetchToolInput = z.infer<typeof webFetchInputSchema>
type ToolExecutionOptions = { abortSignal?: AbortSignal }

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export interface WebFetchToolDeps {
  fetchAndExtract: typeof defaultFetchAndExtract
}

const defaultDeps: WebFetchToolDeps = {
  fetchAndExtract: defaultFetchAndExtract,
}

function logWebFetchSuccess(
  storageContextId: string,
  actorUserId: string | undefined,
  result: Awaited<ReturnType<WebFetchToolDeps['fetchAndExtract']>>,
): void {
  log.info(
    {
      storageContextId,
      actorUserId,
      url: result.url,
      title: result.title,
      contentType: result.contentType,
      truncated: result.truncated,
    },
    'web_fetch completed',
  )
}

function createWebFetchExecutor(
  storageContextId: string,
  actorUserId: string | undefined,
  contextType: 'dm' | 'group' | undefined,
  deps: WebFetchToolDeps,
): (
  input: WebFetchToolInput,
  options: ToolExecutionOptions,
) => Promise<Awaited<ReturnType<WebFetchToolDeps['fetchAndExtract']>>> {
  return async ({ url, goal }: WebFetchToolInput, { abortSignal }: ToolExecutionOptions) => {
    try {
      log.debug({ storageContextId, actorUserId, url, hasGoal: goal !== undefined }, 'Executing web_fetch')
      const result = await deps.fetchAndExtract({ storageContextId, actorUserId, contextType, url, goal, abortSignal })
      logWebFetchSuccess(storageContextId, actorUserId, result)
      return result
    } catch (error) {
      log.error(
        {
          storageContextId,
          actorUserId,
          url,
          error: error instanceof Error ? error.message : String(error),
          tool: 'web_fetch',
        },
        'Tool execution failed',
      )
      throw error
    }
  }
}

export function makeWebFetchTool(
  storageContextId: string,
  actorUserId?: string,
  contextType?: 'dm' | 'group',
  deps: WebFetchToolDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Fetch a public URL and return a bounded summary and excerpt for answering questions or for later memo/task creation when the user explicitly asks.',
    inputSchema: webFetchInputSchema,
    execute: createWebFetchExecutor(storageContextId, actorUserId, contextType, deps),
  })
}
