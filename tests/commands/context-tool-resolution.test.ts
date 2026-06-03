// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { setCachedTools, userCachesForTesting } from '../../src/cache.js'
import {
  buildInvocationToolSet,
  resolveContextToolSurface,
  safeBuildProvider,
} from '../../src/commands/context-tool-resolution.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function fakeTool(name: string): ToolSet[string] {
  return tool({
    description: `fake ${name}`,
    inputSchema: z.object({ id: z.string() }),
    execute: ({ id }: { id: string }) => Promise.resolve(`${name}:${id}`),
  })
}

describe('context-tool-resolution', () => {
  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('resolveContextToolSurface returns definitions without catalogPages', async () => {
    const provider = createMockProvider()
    const surface = await resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)

    expect(surface).toHaveProperty('definitions')
    expect(surface).not.toHaveProperty('catalogPages')
    expect(Object.keys(surface.definitions).length).toBeGreaterThan(0)
  })

  test('resolveContextToolSurface returns the full set when no lastUserText is provided', async () => {
    const provider = createMockProvider()
    const surface = await resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)

    expect(Object.keys(surface.definitions).length).toBeGreaterThan(0)
  })

  test('resolveContextToolSurface returns the full live set even when lastUserText is provided', async () => {
    const provider = createMockProvider()
    const full = await resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)
    const withLastUserText = await resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)

    expect(Object.keys(withLastUserText.definitions).toSorted()).toEqual(Object.keys(full.definitions).toSorted())
    expect(withLastUserText.definitions).toHaveProperty('save_memo')
    expect(withLastUserText.definitions).toHaveProperty('create_task')
  })

  test('buildInvocationToolSet returns providerless tools when provider is null', async () => {
    const result = await buildInvocationToolSet('user-1', 'user-1', 'dm', null)

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('get_current_time')
    expect(result).toHaveProperty('save_memo')
    expect(result).not.toHaveProperty('create_task')
  })

  test('buildInvocationToolSet returns a Promise when provider is not null', () => {
    const provider = createMockProvider()
    const result = buildInvocationToolSet('user-1', 'user-1', 'dm', provider)
    expect(result).toBeInstanceOf(Promise)
  })

  test('resolveContextToolSurface returns a Promise', () => {
    const provider = createMockProvider()
    const result = resolveContextToolSurface('user-1', 'user-1', 'dm', provider, buildInvocationToolSet)
    expect(result).toBeInstanceOf(Promise)
  })

  test('safeBuildProvider returns null when resolver has no provider', async () => {
    const result = await safeBuildProvider('user-1')

    expect(result).toBeNull()
  })

  test('resolveContextToolSurface falls back to the exact cached descriptor set for the current invocation scope', async () => {
    setCachedTools('providerless:no-staged-download:user-1:user-1:', { save_memo: { description: 'providerless' } })

    const surface = await resolveContextToolSurface('user-1', 'user-1', 'dm', null, () => null)

    expect(surface.definitions).toEqual({ save_memo: { description: 'providerless' } })
  })

  test('resolveContextToolSurface degraded fallback does not reuse another scope cached descriptor set', async () => {
    setCachedTools('provider-backed:no-staged-download:user-1:user-1:', {
      create_task: { description: 'provider-backed' },
    })
    setCachedTools('providerless:no-staged-download:user-1:other-user:', { save_memo: { description: 'other-actor' } })

    const surface = await resolveContextToolSurface('user-1', 'user-1', 'dm', null, () => null)

    expect(surface.definitions).toEqual({})
  })

  test('resolveContextToolSurface reapplies tool preferences to degraded cached descriptors', async () => {
    const cachedSaveMemo = fakeTool('save_memo')
    setToolPrefs('user-1', { domainDefaults: { task: 'deny' }, toolOverrides: { save_memo: 'ask' } })
    setCachedTools('providerless:no-staged-download:user-1:user-1:', {
      create_task: fakeTool('create_task'),
      save_memo: cachedSaveMemo,
    })

    const surface = await resolveContextToolSurface('user-1', 'user-1', 'dm', null, () => null)

    expect(surface.definitions).not.toHaveProperty('create_task')
    expect(surface.definitions).toHaveProperty('save_memo')
    expect(surface.definitions['save_memo']).not.toBe(cachedSaveMemo)
  })
})
