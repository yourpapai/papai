// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asObject, asString, callNerv, NOT_CONFIGURED, readNervConfig } from './client.js'
import type { HttpFetch } from './client.js'
import { clearActive, getActiveTaskId } from './history.js'
import { cancelSchema, followupSchema } from './schemas.js'
import type { RuntimeContext, Tool } from './tools.js'

function resolveTaskId(runtimeContext: RuntimeContext, args: Record<string, unknown>): string | null {
  return asString(args, 'taskId') ?? getActiveTaskId(runtimeContext.kv, runtimeContext.storageContextId)
}

function eventTool(
  httpFetch: HttpFetch | undefined,
  name: string,
  description: string,
  type: 'chat_followup' | 'steer',
): Tool {
  return {
    name,
    description,
    inputSchema: followupSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const text = asString(args, 'text')
      if (text === null) return { error: 'invalid_input', message: 'text is required' }
      const taskId = resolveTaskId(runtimeContext, args)
      if (taskId === null) return { error: 'not_found', message: 'No coding task is running in this thread.' }
      const result = await callNerv(httpFetch, cfg, 'POST', `/tasks/${encodeURIComponent(taskId)}/events`, {
        type,
        payload: { text },
      })
      return result
    },
  }
}

export function followupCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
  return eventTool(
    httpFetch,
    'followup_coding_task',
    'Send a follow-up instruction to this thread’s running coding task (e.g. address a review comment).',
    'chat_followup',
  )
}

export function steerCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
  return eventTool(
    httpFetch,
    'steer_coding_task',
    'Steer this thread’s running coding task mid-flight with a corrective instruction.',
    'steer',
  )
}

export function cancelCodingTaskTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'cancel_coding_task',
    description: 'Cancel this thread’s running coding task (closes it on nerv).',
    inputSchema: cancelSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readNervConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const taskId = resolveTaskId(runtimeContext, asObject(input))
      if (taskId === null) return { error: 'not_found', message: 'No coding task is running in this thread.' }
      const result = await callNerv(httpFetch, cfg, 'POST', `/tasks/${encodeURIComponent(taskId)}/events`, {
        type: 'cancel',
        payload: {},
      })
      if (asObject(result)['error'] === undefined) clearActive(runtimeContext.kv, runtimeContext.storageContextId)
      return result
    },
  }
}
