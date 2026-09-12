// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { InvalidToolInputError, NoSuchToolError, tool, type ToolCallRepairFunction, type ToolSet } from 'ai'
import { z } from 'zod'

import { CORE_TOOL_NAMES } from '../../../src/tools/disclosure/core.js'
import { createDisclosureSession, type DisclosureSession } from '../../../src/tools/disclosure/registry.js'
import { createRepairToolCall } from '../../../src/tools/disclosure/repair-tool-call.js'

const stub = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

type RepairOptions = Parameters<ToolCallRepairFunction<ToolSet>>[0]

interface Fixture {
  tools: ToolSet
  session: DisclosureSession
  repair: ToolCallRepairFunction<ToolSet>
}

function fixture(): Fixture {
  const tools: ToolSet = {
    get_current_time: stub(),
    search_tools: stub(),
    load_tool: stub(),
    list_tasks: stub(),
    get_task: stub(),
  }
  const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
  return { tools, session, repair: createRepairToolCall(session, 'ctx-1') }
}

function repairOptions(
  tools: ToolSet,
  toolCallId: string,
  toolName: string,
  error: NoSuchToolError | InvalidToolInputError,
  input = '{}',
): RepairOptions {
  return {
    instructions: undefined,
    system: undefined,
    messages: [],
    toolCall: { type: 'tool-call', toolCallId, toolName, input },
    tools,
    inputSchema: () => Promise.resolve({ type: 'object' }),
    error,
  }
}

type RedirectedToolCall = {
  type: 'tool-call'
  toolCallId: string
  toolName: 'load_tool'
  input: string
}

function redirectFor(toolCallId: string, name: string): RedirectedToolCall {
  return {
    type: 'tool-call',
    toolCallId,
    toolName: 'load_tool',
    input: JSON.stringify({ names: [name] }),
  }
}

describe('createRepairToolCall', () => {
  it('redirects a NoSuchToolError for a registered-but-inactive name into load_tool and activates it', async () => {
    const { tools, session, repair } = fixture()
    const result = await repair(
      repairOptions(tools, 'call-1', 'list_tasks', new NoSuchToolError({ toolName: 'list_tasks' })),
    )
    expect(result).toEqual(redirectFor('call-1', 'list_tasks'))
    expect(session.activeToolNames()).toContain('list_tasks')
  })

  it('returns null for an unregistered name and activates nothing', async () => {
    const { tools, session, repair } = fixture()
    const activeBefore = session.activeToolNames().toSorted()
    const result = await repair(
      repairOptions(tools, 'call-1', 'ghost_tool', new NoSuchToolError({ toolName: 'ghost_tool' })),
    )
    expect(result).toBeNull()
    expect(session.activeToolNames().toSorted()).toEqual(activeBefore)
    expect(session.hasLoaded()).toBe(false)
  })

  it('returns null for an already-active name', async () => {
    const { tools, session, repair } = fixture()
    const result = await repair(
      repairOptions(tools, 'call-1', 'get_current_time', new NoSuchToolError({ toolName: 'get_current_time' })),
    )
    expect(result).toBeNull()
    expect(session.hasLoaded()).toBe(false)
  })

  it('returns null for InvalidToolInputError and activates nothing', async () => {
    const { tools, session, repair } = fixture()
    const activeBefore = session.activeToolNames().toSorted()
    const error = new InvalidToolInputError({
      toolName: 'list_tasks',
      toolInput: '{not json',
      cause: new Error('Unexpected token n in JSON'),
    })
    const result = await repair(repairOptions(tools, 'call-1', 'list_tasks', error, '{not json'))
    expect(result).toBeNull()
    expect(session.activeToolNames().toSorted()).toEqual(activeBefore)
    expect(session.hasLoaded()).toBe(false)
  })

  it('is idempotent: a second repair for the same name returns null and does not re-activate', async () => {
    const { tools, session, repair } = fixture()
    const first = await repair(
      repairOptions(tools, 'call-1', 'list_tasks', new NoSuchToolError({ toolName: 'list_tasks' })),
    )
    expect(first).toEqual(redirectFor('call-1', 'list_tasks'))
    const second = await repair(
      repairOptions(tools, 'call-2', 'list_tasks', new NoSuchToolError({ toolName: 'list_tasks' })),
    )
    expect(second).toBeNull()
    expect(session.activeToolNames().filter((n) => n === 'list_tasks')).toHaveLength(1)
  })
})
