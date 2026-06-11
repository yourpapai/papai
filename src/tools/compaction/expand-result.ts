// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../../logger.js'
import type { ToolFailureResult } from '../../tool-failure.js'
import { EXPAND_DEFAULT_LIMIT_BYTES } from './constants.js'
import { getResultPage } from './result-store.js'

const log = logger.child({ scope: 'tool:expand-result' })

export function makeExpandResultTool(contextId: string): ToolSet[string] {
  return tool({
    description:
      'Page through the full raw content of a previously compacted tool result. Pass the handle from a _compacted result. Use offset/limit to read in windows.',
    inputSchema: z.object({
      handle: z.string().min(1).describe('The handle from the compacted result envelope, e.g. res_ab12'),
      offset: z.number().int().min(0).default(0).describe('Character offset to start from'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(16_000)
        .default(EXPAND_DEFAULT_LIMIT_BYTES)
        .describe('Maximum characters to return'),
    }),
    execute: ({ handle, offset, limit }, opts) => {
      // getToolExecutor and some SDK paths bypass schema parsing, so defaults are applied here too
      const resolvedOffset = offset ?? 0
      const resolvedLimit = limit ?? EXPAND_DEFAULT_LIMIT_BYTES
      const page = getResultPage(contextId, handle, resolvedOffset, resolvedLimit)
      if (!page.found) {
        log.warn({ contextId, handle }, 'expand_result handle not found or expired')
        const failure: ToolFailureResult = {
          success: false,
          error: 'Result handle not found or expired',
          toolName: 'expand_result',
          toolCallId: opts?.toolCallId ?? '',
          timestamp: new Date().toISOString(),
          errorType: 'tool-execution',
          errorCode: 'expired',
          userMessage: 'That cached result is no longer available.',
          agentMessage: 'The compacted result expired. Re-run the original tool to get fresh data.',
          retryable: true,
        }
        return failure
      }
      log.debug({ contextId, handle, nextOffset: page.nextOffset, done: page.done }, 'expand_result page served')
      return { chunk: page.chunk, nextOffset: page.nextOffset, done: page.done }
    },
  })
}
