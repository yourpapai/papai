// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { resolveDisclosedToolDefinitions } from '../../src/commands/context-tool-resolution.js'
import { ALWAYS_ON_TOOL_NAMES } from '../../src/tools/disclosure/core.js'
import { makeTools } from '../../src/tools/index.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('resolveDisclosedToolDefinitions', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('narrows a full catalog to the always-on disclosure surface plus injected meta tools', () => {
    const surface = {
      definitions: {
        get_current_time: { description: 'Return the current time.' },
        expand_result: { description: 'Page a stored tool result.' },
        create_task: { description: 'Create a task.' },
        list_tasks: { description: 'List tasks.' },
        search_projects: { description: 'Search projects.' },
      },
    }

    const disclosed = resolveDisclosedToolDefinitions(surface)

    expect(Object.keys(disclosed).sort()).toEqual(['expand_result', 'get_current_time', 'load_tool', 'search_tools'])
  })

  test('injects search_tools and load_tool with real input schemas', () => {
    const surface = {
      definitions: {
        get_current_time: { description: 'Return the current time.' },
        create_task: { description: 'Create a task.' },
      },
    }

    const disclosed = resolveDisclosedToolDefinitions(surface)

    expect(disclosed['search_tools']).toHaveProperty('inputSchema')
    expect(disclosed['load_tool']).toHaveProperty('inputSchema')
  })

  test('returns only the injected meta tools when the catalog has no always-on tools', () => {
    const surface = {
      definitions: {
        create_task: { description: 'Create a task.' },
        list_tasks: { description: 'List tasks.' },
      },
    }

    const disclosed = resolveDisclosedToolDefinitions(surface)

    expect(Object.keys(disclosed).sort()).toEqual(['load_tool', 'search_tools'])
  })

  test('excludes the non-disclosed catalog tools from the returned surface', () => {
    const surface = {
      definitions: {
        get_current_time: { description: 'Return the current time.' },
        create_task: { description: 'Create a task.' },
      },
    }

    const disclosed = resolveDisclosedToolDefinitions(surface)

    expect(disclosed).not.toHaveProperty('create_task')
  })

  test('narrows a real provider-backed catalog to a handful of tools, not the whole catalog', async () => {
    await setupTestDb()
    const catalog = await makeTools(createMockProvider(), {
      storageContextId: 'user1',
      chatUserId: 'user1',
      mode: 'normal',
      contextType: 'dm',
    })
    const catalogSize = Object.keys(catalog).length

    const disclosed = resolveDisclosedToolDefinitions({ definitions: catalog })

    // The real catalog is large; disclosure exposes only the always-on surface at turn start.
    expect(catalogSize).toBeGreaterThan(10)
    expect(Object.keys(disclosed).length).toBeLessThanOrEqual(ALWAYS_ON_TOOL_NAMES.size)
    // The injected meta tools are always part of the disclosed surface.
    expect(disclosed).toHaveProperty('search_tools')
    expect(disclosed).toHaveProperty('load_tool')
    // A run-of-the-mill catalog tool is not disclosed until load_tool pulls it in.
    expect(disclosed).not.toHaveProperty('create_task')
  })
})
