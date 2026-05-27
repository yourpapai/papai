// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import type { McpServerInfo } from '../../src/mcp/types.js'

const getServerInfosMock = mock((): McpServerInfo[] => [
  {
    id: 'abc123',
    label: 'test-server',
    status: 'connected',
    toolCount: 5,
    lastError: null,
    lastConnectedAt: 1700000000000,
    url: 'https://example.com/mcp?token=secret',
  },
  {
    id: 'def456',
    label: null,
    status: 'error',
    toolCount: 0,
    lastError: 'connection refused',
    lastConnectedAt: null,
    url: null,
  },
])

void mock.module('../../src/mcp/client-pool.js', () => ({
  mcpPool: {
    getServerInfos: getServerInfosMock,
  },
}))

const { handleMcpStatus } = await import('../../src/debug/mcp-routes.js')

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}

const pick = (obj: object, key: string): unknown => Reflect.get(obj, key)

const pickArray = (obj: object, key: string): unknown[] => {
  const v = pick(obj, key)
  assert(Array.isArray(v), `expected ${key} to be an array`)
  return v
}

const asObject = (value: unknown): object => {
  assert(typeof value === 'object' && value !== null, 'expected object')
  return value
}

describe('handleMcpStatus', () => {
  beforeEach(() => {
    getServerInfosMock.mockClear()
  })

  test('returns 200 JSON with masked URLs', async () => {
    const res = handleMcpStatus()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')

    const body = await readJson(res)
    const servers = pickArray(body, 'servers')
    expect(servers).toHaveLength(2)

    const first = asObject(servers[0])
    expect(pick(first, 'url')).toBe('https://example.com/mcp')
    expect(pick(first, 'id')).toBe('abc123')
    expect(pick(first, 'label')).toBe('test-server')
    expect(pick(first, 'status')).toBe('connected')
    expect(pick(first, 'toolCount')).toBe(5)

    const second = asObject(servers[1])
    expect(pick(second, 'url')).toBeNull()
  })

  test('masks query params and path from URL', async () => {
    getServerInfosMock.mockReturnValueOnce([
      {
        id: 'x',
        label: 'x',
        status: 'connected',
        toolCount: 1,
        lastError: null,
        lastConnectedAt: 1700000000000,
        url: 'https://my-host.io/api/v1/mcp?key=abc&secret=xyz',
      },
    ])

    const res = handleMcpStatus()
    const body = await readJson(res)
    const servers = pickArray(body, 'servers')
    expect(pick(asObject(servers[0]), 'url')).toBe('https://my-host.io/api/v1/mcp')
  })

  test('returns *** for unparseable URLs', async () => {
    getServerInfosMock.mockReturnValueOnce([
      {
        id: 'x',
        label: 'x',
        status: 'connected',
        toolCount: 1,
        lastError: null,
        lastConnectedAt: 1700000000000,
        url: 'not-a-url',
      },
    ])

    const res = handleMcpStatus()
    const body = await readJson(res)
    const servers = pickArray(body, 'servers')
    expect(pick(asObject(servers[0]), 'url')).toBe('***')
  })

  test('returns empty servers array when pool is empty', async () => {
    getServerInfosMock.mockReturnValueOnce([])

    const res = handleMcpStatus()
    const body = await readJson(res)
    expect(pickArray(body, 'servers')).toEqual([])
  })
})
