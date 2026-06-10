// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, mock } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

void mock.module('../../../src/debug/event-bus.js', () => ({ emitUser: (): void => {} }))

const { createDisclosureSession } = await import('../../../src/tools/disclosure/registry.js')
const { createDisclosurePrepareStep } = await import('../../../src/tools/disclosure/prepare-step.js')
const { CORE_TOOL_NAMES } = await import('../../../src/tools/disclosure/core.js')

const d = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

describe('disclosure loop', () => {
  it('widens activeTools only after load and never includes unloaded tools', () => {
    const tools: ToolSet = { get_current_time: d(), search_tools: d(), load_tool: d(), list_tasks: d(), web_fetch: d() }
    const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
    const prep = createDisclosurePrepareStep(session, 'ctx-1')

    const step0 = prep({ stepNumber: 0 })
    expect(step0.activeTools).not.toContain('list_tasks')
    expect(step0.activeTools).not.toContain('web_fetch')

    session.markLoaded(['list_tasks'])
    const step1 = prep({ stepNumber: 1 })
    expect(step1.activeTools).toContain('list_tasks')
    expect(step1.activeTools).not.toContain('web_fetch')
  })
})
