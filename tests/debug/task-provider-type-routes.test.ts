// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { handleTaskProviderTypes } from '../../src/debug/task-provider-type-routes.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger } from '../utils/test-helpers.js'

const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'

const registerYouTrackContributed = (): void => {
  mockLogger()
  registerContributedTaskProviderType('youtrack', {
    pluginId: YOUTRACK_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'youtrack' }),
    capabilities: new Set(),
    displayName: 'YouTrack',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
    ],
    contextConfigSchema: [
      {
        key: 'token',
        label: 'YouTrack Permanent Token',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'youtrack_token',
      },
    ],
    traits: new Set(['command-language:youtrack']),
  })
}

beforeEach(() => {
  registerYouTrackContributed()
})

afterEach(() => {
  unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
})

const route = (path: string, method = 'GET'): Response | null => {
  const req = new Request(`http://debug.test${path}`, { method })
  return handleTaskProviderTypes(req, new URL(req.url))
}

const readJson = async (res: Response): Promise<unknown> => JSON.parse(await res.text())

const expectResponse = (response: Response | null): Response => {
  expect(response).toBeInstanceOf(Response)
  if (response === null) throw new Error('expected response')
  return response
}

const assertArray = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error('expected array')
  return value
}

const assertObject = (value: unknown): object => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object')
  return value
}

const pick = (value: object, key: string): unknown => Reflect.get(value, key)

describe('handleTaskProviderTypes', () => {
  test('GET /api/task-provider-types returns 200 with catalog containing youtrack (plugin-contributed)', async () => {
    const res = expectResponse(route('/api/task-provider-types'))

    expect(res.status).toBe(200)
    const body = assertArray(await readJson(res))
    const types = body.map((entry) => pick(assertObject(entry), 'type'))
    expect(types).not.toContain('kaneo')
    expect(types).toContain('youtrack')
  })

  test('GET /api/task-provider-types youtrack entry has source plugin and capabilities array', async () => {
    const res = expectResponse(route('/api/task-provider-types'))
    const body = assertArray(await readJson(res))
    const youtrackRaw = body.find((entry) => pick(assertObject(entry), 'type') === 'youtrack')
    const youtrack = assertObject(youtrackRaw)

    expect(pick(youtrack, 'source')).toEqual({ plugin: YOUTRACK_PLUGIN_ID })
    expect(Array.isArray(pick(youtrack, 'capabilities'))).toBe(true)
  })

  test('GET /api/task-provider-types youtrack entry has correct displayName, instance field key and sensitive flag', async () => {
    const res = expectResponse(route('/api/task-provider-types'))
    const body = assertArray(await readJson(res))
    const youtrackRaw = body.find((entry) => pick(assertObject(entry), 'type') === 'youtrack')
    const youtrack = assertObject(youtrackRaw)

    expect(pick(youtrack, 'displayName')).toBe('YouTrack')
    const firstField = assertObject(assertArray(pick(youtrack, 'instanceConfigSchema'))[0])
    expect(pick(firstField, 'key')).toBe('baseUrl')
    expect(pick(firstField, 'sensitive')).toBe(false)
    expect(pick(firstField, 'scope')).toBeUndefined()
  })

  test('GET /api/task-provider-types returns split schemas and traits', async () => {
    const res = expectResponse(route('/api/task-provider-types'))
    const body = assertArray(await readJson(res))
    const youtrack = assertObject(body.find((entry) => pick(assertObject(entry), 'type') === 'youtrack'))

    expect(assertArray(pick(youtrack, 'instanceConfigSchema')).map((f) => pick(assertObject(f), 'key'))).toEqual([
      'baseUrl',
    ])
    expect(
      assertArray(pick(youtrack, 'contextConfigSchema')).map((f) => pick(assertObject(f), 'storageKey')),
    ).toContain('youtrack_token')
    expect(assertArray(pick(youtrack, 'traits'))).toContain('command-language:youtrack')
  })

  test('returns null for non-matching paths', () => {
    expect(route('/api/task-instances')).toBeNull()
    expect(route('/api/task-provider-types/kaneo')).toBeNull()
  })

  test('returns null for non-GET methods on /api/task-provider-types', () => {
    expect(route('/api/task-provider-types', 'POST')).toBeNull()
  })
})

describe('handleTaskProviderTypes scope filtering', () => {
  test('separates instance-scoped and context-scoped fields in the catalog response (youtrack contributed)', async () => {
    const res = expectResponse(route('/api/task-provider-types'))
    const body = assertArray(await readJson(res))
    const youtrackRaw = body.find((entry) => pick(assertObject(entry), 'type') === 'youtrack')
    const youtrack = assertObject(youtrackRaw)
    const instanceKeys = assertArray(pick(youtrack, 'instanceConfigSchema')).map((f) => pick(assertObject(f), 'key'))
    const contextKeys = assertArray(pick(youtrack, 'contextConfigSchema')).map((f) => pick(assertObject(f), 'key'))

    expect(instanceKeys).toContain('baseUrl')
    expect(instanceKeys).not.toContain('token')
    expect(contextKeys).toContain('token')
  })
})
