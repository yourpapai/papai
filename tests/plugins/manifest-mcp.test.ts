// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { pluginManifestSchema } from '../../src/plugins/types.js'

const base = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  apiVersion: 1,
}

describe('pluginManifestSchema mcp field', () => {
  test('accepts manifest with streamable-http mcp config', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      mcp: {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
      },
    })
    expect(parsed.mcp?.transport).toBe('streamable-http')
    expect(parsed.mcp?.url).toBe('https://example.com/mcp')
  })

  test('accepts manifest with stdio mcp config', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      mcp: {
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
    })
    expect(parsed.mcp?.transport).toBe('stdio')
    expect(parsed.mcp?.command).toBe('node')
  })

  test('rejects streamable-http without url', () => {
    const result = pluginManifestSchema.safeParse({
      ...base,
      mcp: {
        transport: 'streamable-http',
      },
    })
    expect(result.success).toBe(false)
  })

  test('rejects stdio without command', () => {
    const result = pluginManifestSchema.safeParse({
      ...base,
      mcp: {
        transport: 'stdio',
      },
    })
    expect(result.success).toBe(false)
  })

  test('allows main to be omitted when mcp is declared (defaults to index.ts)', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      mcp: {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
      },
    })
    expect(parsed.main).toBe('index.ts')
  })

  test('accepts mcp with headers, env, toolFilter, and idleTimeoutMs', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      mcp: {
        transport: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
        env: { NODE_ENV: 'production' },
        toolFilter: { allow: ['tool_a'], deny: ['tool_b'] },
        idleTimeoutMs: 30_000,
      },
    })
    expect(parsed.mcp?.headers).toEqual({ Authorization: 'Bearer token' })
    expect(parsed.mcp?.env).toEqual({ NODE_ENV: 'production' })
    expect(parsed.mcp?.toolFilter).toEqual({ allow: ['tool_a'], deny: ['tool_b'] })
    expect(parsed.mcp?.idleTimeoutMs).toBe(30_000)
  })

  test('mcp field is undefined when not provided', () => {
    const parsed = pluginManifestSchema.parse(base)
    expect(parsed.mcp).toBeUndefined()
  })
})
