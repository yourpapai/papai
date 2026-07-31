// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { registerProviderBackedTool } from '../../src/tools/tool-registration.js'

describe('registerProviderBackedTool', () => {
  test('registers a scope-free, unwrapped descriptor under the given name', () => {
    const tools: ToolSet = {}
    const descriptor = tool({
      description: 'echo',
      inputSchema: z.object({ id: z.string() }),
      execute: ({ id }: { id: string }) => Promise.resolve(id),
    })

    registerProviderBackedTool(tools, 'echo_tool', descriptor)

    expect(tools['echo_tool']).toBe(descriptor)
    expect(tools['echo_tool']!.contextSchema).toBeUndefined()
  })
})
