// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { applyWhoMayUseFilter } from '../src/llm-orchestrator-tools.js'
import { createToolGateRegistry } from '../src/ports/tool-gate.js'

const fakeTool = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })
const toolset = (): ToolSet => ({
  plugin_acp__start_session: fakeTool(),
  list_tasks: fakeTool(),
})

describe('applyWhoMayUseFilter', () => {
  test('returns the same reference when whoMayUse is "members"', () => {
    const reg = createToolGateRegistry()
    reg.setGate('plugin_acp__start_session', 'operator')
    const tools = toolset()
    expect(applyWhoMayUseFilter(tools, 'members', 'anyone', reg)).toBe(tools)
  })

  test('returns the same reference when the actor is on the allowlist', () => {
    const reg = createToolGateRegistry()
    reg.setGate('plugin_acp__start_session', 'operator')
    const tools = toolset()
    expect(applyWhoMayUseFilter(tools, ['op-user'], 'op-user', reg)).toBe(tools)
  })

  test('drops operator-gated tools for a non-allowlisted actor, keeps the rest', () => {
    const reg = createToolGateRegistry()
    reg.setGate('plugin_acp__start_session', 'operator')
    const out = applyWhoMayUseFilter(toolset(), ['op-user'], 'other-user', reg)
    expect('plugin_acp__start_session' in out).toBe(false)
    expect('list_tasks' in out).toBe(true)
  })

  test('keeps a plugin tool that is not operator-gated', () => {
    // no gates recorded
    const reg = createToolGateRegistry()
    const out = applyWhoMayUseFilter(toolset(), ['op-user'], 'other-user', reg)
    expect('plugin_acp__start_session' in out).toBe(true)
  })
})
