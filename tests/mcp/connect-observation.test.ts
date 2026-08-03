// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { endpointHash, pluginHash } from '../../src/mcp/connect-observation.js'

describe('connect-observation hash helpers', () => {
  test('endpointHash is stable for identical configs and differs across urls', () => {
    const a = endpointHash({ id: 's1', url: 'https://a.example/mcp', enabled: true })
    const b = endpointHash({ id: 's1', url: 'https://a.example/mcp', enabled: true })
    const c = endpointHash({ id: 's1', url: 'https://b.example/mcp', enabled: true })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  test('endpointHash differs across headers and does not embed header values', () => {
    const a = endpointHash({
      id: 's1',
      url: 'https://a.example/mcp',
      headers: { Authorization: 'token-1' },
      enabled: true,
    })
    const b = endpointHash({
      id: 's1',
      url: 'https://a.example/mcp',
      headers: { Authorization: 'token-2' },
      enabled: true,
    })
    expect(a).not.toBe(b)
    expect(a).not.toContain('token-1')
  })

  test('pluginHash includes the plugin id and transport fields', () => {
    const base = { transport: 'streamable-http' as const, url: 'https://a.example/mcp' }
    const a = pluginHash('plugin-1', base)
    const b = pluginHash('plugin-2', base)
    const c = pluginHash('plugin-1', base)
    expect(a).toBe(c)
    expect(a).not.toBe(b)
    expect(a).not.toContain('plugin-1')
  })
})
