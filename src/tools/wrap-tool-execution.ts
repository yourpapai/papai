// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'

import { logger } from '../logger.js'
import { buildToolFailureResult } from '../tool-failure.js'

const log = logger.child({ scope: 'tool-wrapper' })

export function wrapToolExecution(
  execute: (input: unknown, options: ToolExecutionOptions) => Promise<unknown>,
  toolName: string,
): (input: unknown, options: ToolExecutionOptions) => Promise<unknown> {
  return async (input: unknown, options: ToolExecutionOptions) => {
    try {
      return await execute(input, options)
    } catch (error) {
      const failure = buildToolFailureResult(error, toolName, options.toolCallId)
      log.error(
        {
          tool: toolName,
          toolCallId: options.toolCallId,
          error: failure.error,
          errorType: failure.errorType,
          errorCode: failure.errorCode,
        },
        'Tool execution failed',
      )
      return failure
    }
  }
}
