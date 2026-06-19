// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { applyGuestReadOnlyFilter } from '../../src/tools/index.js'

// Minimal tool stub; only the key (name) matters for risk classification.
const stub = (): ToolSet[string] =>
  tool({ description: '', inputSchema: z.object({}), execute: () => Promise.resolve(null) })

describe('applyGuestReadOnlyFilter', () => {
  test('keeps read-risk tools and drops write/destructive/open-world tools', () => {
    const tools = {
      // read
      list_tasks: stub(),
      // read
      get_task: stub(),
      // write
      create_task: stub(),
      // destructive
      delete_task: stub(),
      // open-world
      web_fetch: stub(),
      // open-world (mcp_ prefix)
      mcp_server__do: stub(),
    }
    const filtered = applyGuestReadOnlyFilter(tools)
    expect(Object.keys(filtered).sort()).toEqual(['get_task', 'list_tasks'])
  })

  test('drops tools with unknown metadata', () => {
    const filtered = applyGuestReadOnlyFilter({ totally_unknown_tool: stub() })
    expect(Object.keys(filtered)).toEqual([])
  })
})
