// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { makeCoreTools } from '../../src/tools/core-tools.js'
import { createMockProvider } from './mock-provider.js'

describe('makeCoreTools', () => {
  // get_current_time is intentionally NOT registered here — it is owned by the
  // provider-independent tools builder, which keys it on the thread-stripped config context.
  it('should return core tools', () => {
    const provider = createMockProvider()
    const tools = makeCoreTools(provider, 'user-123')

    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
    expect(tools).not.toHaveProperty('get_current_time')
  })

  it('should work without userId', () => {
    const provider = createMockProvider()
    const tools = makeCoreTools(provider)

    expect(tools).toHaveProperty('create_task')
    expect(tools).toHaveProperty('update_task')
    expect(tools).toHaveProperty('search_tasks')
    expect(tools).toHaveProperty('list_tasks')
    expect(tools).toHaveProperty('get_task')
    expect(tools).not.toHaveProperty('get_current_time')
  })
})
