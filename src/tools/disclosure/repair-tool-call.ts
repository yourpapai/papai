// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { NoSuchToolError, type ToolCallRepairFunction, type ToolSet } from 'ai'

import { logger } from '../../logger.js'
import type { DisclosureSession } from './registry.js'

const log = logger.child({ scope: 'disclosure:repair-tool-call' })

export function createRepairToolCall(session: DisclosureSession, contextId: string): ToolCallRepairFunction<ToolSet> {
  return ({ toolCall, error }) => {
    if (!NoSuchToolError.isInstance(error)) return Promise.resolve(null)
    const name = error.toolName
    if (!session.allNames.has(name) || session.activeToolNames().includes(name)) return Promise.resolve(null)
    session.markLoaded([name])
    log.debug({ contextId, repairedName: name }, 'misdirected tool call redirected into load_tool')
    return Promise.resolve({
      type: 'tool-call',
      toolCallId: toolCall.toolCallId,
      toolName: 'load_tool',
      input: JSON.stringify({ names: [name] }),
    })
  }
}
