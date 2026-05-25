// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { executeCancel } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:cancel-deferred-prompt' })

export function makeCancelDeferredPromptTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Cancel a deferred prompt by ID. Works for both scheduled prompts and alerts.',
    inputSchema: z.object({ id: z.string().describe('The deferred prompt ID to cancel') }),
    execute: (input: { id: string }) => {
      try {
        return executeCancel(userId, input)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            tool: 'cancel_deferred_prompt',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
