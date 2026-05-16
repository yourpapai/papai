// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

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

  test('buildInvocationToolSet returns null when provider is null', () => {
    const result = buildInvocationToolSet('user-1', 'user-1', 'dm', null)
    expect(result).toBeNull()
  })

  test('safeBuildProvider returns null when factory throws', () => {
    void mock.module('../../src/providers/factory.js', () => ({
      buildProviderForUser: (): never => {
        throw new Error('factory failed')
      },
    }))

    const result = safeBuildProvider('user-1')
    expect(result).toBeNull()
  })
})
