// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setConfig } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { deleteTaskInstance, insertTaskInstance } from '../../src/instances/task-store.js'
import { TaskProviderResolver } from '../../src/providers/resolver.js'
import type { TaskProviderResolverDeps } from '../../src/providers/resolver.js'
import { setKaneoWorkspace } from '../../src/users.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

describe('TaskProviderResolver', () => {
  const created: Array<{ name: string; config: Record<string, string> }> = []

  const makeResolver = (): TaskProviderResolver => {
    const deps: Partial<TaskProviderResolverDeps> = {
      createProvider: (name, config) => {
        created.push({ name, config })
        return createMockProvider({ name })
      },
    }
    return new TaskProviderResolver(deps)
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '4'.repeat(64)
    created.length = 0
  })

  test('returns null when context has no assignment', () => {
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-missing')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when assigned task instance was removed', () => {
    seedTestTaskInstance({ id: 'deleted-task' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'deleted-task', platformInstanceId: 'telegram-default' })
    deleteTaskInstance('deleted-task')
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when assigned task instance is not active', () => {
    insertTaskInstance({ id: 'yt-stopped', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'stopped' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-stopped', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'youtrack_token', 'perm:abc')
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('builds a YouTrack provider from instance URL and per-context token', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'youtrack_token', 'perm:abc')
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider?.name).toBe('youtrack')
    expect(created).toEqual([{ name: 'youtrack', config: { baseUrl: 'https://yt.invalid', token: 'perm:abc' } }])
  })

  test('builds a Kaneo provider from instance URL, API key, and workspace ID', () => {
    insertTaskInstance({ id: 'kaneo-prod', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'kaneo_apikey', 'kn-key')
    setKaneoWorkspace('ctx-1', 'workspace-1')
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider?.name).toBe('kaneo')
    expect(created).toEqual([
      { name: 'kaneo', config: { apiKey: 'kn-key', baseUrl: 'https://kaneo.invalid', workspaceId: 'workspace-1' } },
    ])
  })

  test('builds a Kaneo provider with session cookie credentials', () => {
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'kaneo_apikey', 'better-auth.session_token=abc')
    setKaneoWorkspace('ctx-1', 'workspace-1')
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider?.name).toBe('kaneo')
    expect(created).toEqual([
      {
        name: 'kaneo',
        config: {
          baseUrl: 'https://kaneo.invalid',
          sessionCookie: 'better-auth.session_token=abc',
          workspaceId: 'workspace-1',
        },
      },
    ])
  })

  test('returns null when provider credentials are missing', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('resolveStrict throws clear setup guidance when resolution fails', () => {
    const resolver = makeResolver()

    expect(() => resolver.resolveStrict('ctx-missing')).toThrow('Context ctx-missing needs /setup')
  })

  test('resolves a contributed provider type by passing instance config through unchanged', () => {
    insertTaskInstance({
      id: 'demo-1',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid', region: 'eu' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'demo-1', platformInstanceId: 'telegram-default' })
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider).not.toBeNull()
    expect(created).toEqual([{ name: 'demo-tracker', config: { baseUrl: 'https://demo.invalid', region: 'eu' } }])
  })
})
