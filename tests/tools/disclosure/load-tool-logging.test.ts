// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { CORE_TOOL_NAMES } from '../../../src/tools/disclosure/core.js'
import { createDisclosureSession } from '../../../src/tools/disclosure/registry.js'
import { createTrackedLoggerMock, getToolExecutor, type TrackedLoggerMock } from '../../utils/test-helpers.js'

// load-tool.ts binds `logger.child` at module-eval time. A static import would
// capture the real logger before the per-test mock is registered, and the live
// binding does not reliably refresh under serial (single-process) test runs.
// Cache-busting dynamic import (see tests/startup-helpers.test.ts) forces a fresh
// evaluation AFTER mock.module() installs the stub, so the bound logger is the
// mock.
type LoadToolModule = typeof import('../../../src/tools/disclosure/load-tool.js')

const isLoadToolModule = (value: unknown): value is LoadToolModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'makeLoadToolTool') === 'function'

async function loadLoadToolModule(tracked: TrackedLoggerMock): Promise<LoadToolModule> {
  void mock.module('../../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  const loaded: unknown = await import(`../../../src/tools/disclosure/load-tool.js?t=${crypto.randomUUID()}`)
  if (isLoadToolModule(loaded)) return loaded
  throw new Error('load-tool module did not export makeLoadToolTool')
}

const d = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

function makeExec(makeLoadToolTool: LoadToolModule['makeLoadToolTool']): (...args: unknown[]) => Promise<unknown> {
  const tools: ToolSet = {
    get_current_time: d(),
    search_tools: d(),
    load_tool: d(),
    expand_result: d(),
    list_tasks: d(),
    get_task: d(),
  }
  const session = createDisclosureSession(tools, CORE_TOOL_NAMES)
  return getToolExecutor(makeLoadToolTool(session, 'ctx-log'))
}

describe('load_tool debug logging', () => {
  test('stays silent for no-op loads of already-active or unknown names', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeLoadToolTool } = await loadLoadToolModule(tracked)
    const exec = makeExec(makeLoadToolTool)

    await exec({ names: ['get_current_time'] })
    await exec({ names: ['load_tool'] })
    await exec({ names: ['nope'] })

    expect(tracked.getCallsByLevel('debug')).toHaveLength(0)
  })

  test('logs the newly activated tool names on a real load', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeLoadToolTool } = await loadLoadToolModule(tracked)
    const exec = makeExec(makeLoadToolTool)

    await exec({ names: ['list_tasks', 'get_task', 'bogus'] })

    const debugCalls = tracked.getCallsByLevel('debug')
    expect(debugCalls.length).toBeGreaterThan(0)
    expect(debugCalls[0]?.args[0]).toMatchObject({
      activated: ['list_tasks', 'get_task'],
      unknownCount: 1,
    })
    expect(String(debugCalls[0]?.args[1])).toContain('load_tool')
  })

  test('stays silent when re-requesting an already-loaded tool', async () => {
    const tracked = createTrackedLoggerMock()
    const { makeLoadToolTool } = await loadLoadToolModule(tracked)
    const exec = makeExec(makeLoadToolTool)

    await exec({ names: ['list_tasks'] })
    tracked.clearCalls()
    await exec({ names: ['list_tasks'] })

    expect(tracked.getCallsByLevel('debug')).toHaveLength(0)
  })
})
