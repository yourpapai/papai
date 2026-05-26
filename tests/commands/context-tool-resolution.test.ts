// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { userCachesForTesting } from '../../src/cache.js'
import {
  buildInvocationToolSet,
  resolveContextToolSurface,
  safeBuildProvider,
} from '../../src/commands/context-tool-resolution.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('context-tool-resolution', () => {
  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('resolveContextToolSurface returns definitions without catalogPages', () => {
    const provider = createMockProvider()
    const surface = resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)

    expect(surface).toHaveProperty('definitions')
    expect(surface).not.toHaveProperty('catalogPages')
    expect(Object.keys(surface.definitions).length).toBeGreaterThan(0)
  })

  test('resolveContextToolSurface returns the full set when no lastUserText is provided', () => {
    const provider = createMockProvider()
    const surface = resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)

    expect(surface.routing).toBeUndefined()
  })

  test('resolveContextToolSurface applies routing when lastUserText is provided', () => {
    const provider = createMockProvider()
    const full = resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)
    const routed = resolveContextToolSurface(
      'user-1',
      'user-1',
      'dm',
      provider,
      buildInvocationToolSet,
      'remember that I prefer morning standups',
    )

    expect(routed.routing).toBeDefined()
    expect(routed.routing?.intent).toBe('memo')
    expect(routed.routing?.fullToolCount).toBe(Object.keys(full.definitions).length)
    expect(routed.routing?.exposedToolCount).toBe(Object.keys(routed.definitions).length)
    expect(Object.keys(routed.definitions).length).toBeLessThan(Object.keys(full.definitions).length)
    expect(routed.definitions).toHaveProperty('save_memo')
    expect(routed.definitions).not.toHaveProperty('create_task')
  })

  test('resolveContextToolSurface returns full set when routing falls back to full intent', () => {
    const provider = createMockProvider()
    const routed = resolveContextToolSurface(
      'user-1',
      'user-1',
      'dm',
      provider,
      buildInvocationToolSet,
      'can you handle the thing we discussed',
    )

    expect(routed.routing?.intent).toBe('full')
    expect(routed.routing?.exposedToolCount).toBe(routed.routing?.fullToolCount)
  })

  test('buildInvocationToolSet returns null when provider is null', () => {
    const result = buildInvocationToolSet('user-1', 'user-1', 'dm', null)
    expect(result).toBeNull()
  })

  test('safeBuildProvider returns null when resolver has no provider', () => {
    const result = safeBuildProvider('user-1')

    expect(result).toBeNull()
  })
})
