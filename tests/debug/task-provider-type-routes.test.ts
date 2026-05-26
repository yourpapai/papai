// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { handleTaskProviderTypes } from '../../src/debug/task-provider-type-routes.js'

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
  test('GET /api/task-provider-types returns 200 with built-in catalog containing kaneo and youtrack', async () => {
    const res = expectResponse(route('/api/task-provider-types'))

    expect(res.status).toBe(200)
    const body = assertArray(await readJson(res))
    const types = body.map((entry) => pick(assertObject(entry), 'type'))
    expect(types).toContain('kaneo')
    expect(types).toContain('youtrack')
  })

  test('GET /api/task-provider-types kaneo entry has source builtin and capabilities array', async () => {
    const res = expectResponse(route('/api/task-provider-types'))
    const body = assertArray(await readJson(res))
    const kaneoRaw = body.find((entry) => pick(assertObject(entry), 'type') === 'kaneo')
    const kaneo = assertObject(kaneoRaw)

    expect(pick(kaneo, 'source')).toBe('builtin')
    expect(Array.isArray(pick(kaneo, 'capabilities'))).toBe(true)
  })

  test('returns null for non-matching paths', () => {
    expect(route('/api/task-instances')).toBeNull()
    expect(route('/api/task-provider-types/kaneo')).toBeNull()
  })

  test('returns null for non-GET methods on /api/task-provider-types', () => {
    expect(route('/api/task-provider-types', 'POST')).toBeNull()
  })
})
