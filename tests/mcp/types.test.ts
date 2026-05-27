// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mcpEndpointConfigSchema, mcpPluginConfigSchema, sanitizeServerId } from '../../src/mcp/types.js'

describe('mcpEndpointConfigSchema', () => {
  test('accepts valid streamable-http endpoint', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      id: 'my-server',
      url: 'https://example.com/mcp',
    })
    expect(result.success).toBe(true)
  })

  test('rejects missing id', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      url: 'https://example.com/mcp',
    })
    expect(result.success).toBe(false)
  })

  test('rejects non-https url', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      id: 'my-server',
      url: 'http://example.com/mcp',
    })
    expect(result.success).toBe(false)
  })

  test('defaults enabled to true', () => {
    const result = mcpEndpointConfigSchema.parse({
      id: 'my-server',
      url: 'https://example.com/mcp',
    })
    expect(result.enabled).toBe(true)
  })

  test('accepts optional toolFilter', () => {
    const result = mcpEndpointConfigSchema.safeParse({
      id: 'my-server',
      url: 'https://example.com/mcp',
      toolFilter: { allow: ['tool1'], deny: ['tool2'] },
    })
    expect(result.success).toBe(true)
  })
})

describe('mcpPluginConfigSchema', () => {
  test('accepts streamable-http with url', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
    })
    expect(result.success).toBe(true)
  })

  test('rejects streamable-http without url', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'streamable-http',
    })
    expect(result.success).toBe(false)
  })

  test('accepts stdio with command', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    })
    expect(result.success).toBe(true)
  })

  test('rejects stdio without command', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'stdio',
    })
    expect(result.success).toBe(false)
  })

  test('accepts optional headers', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    })
    expect(result.success).toBe(true)
  })

  test('accepts optional env', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'stdio',
      command: 'node',
      env: { NODE_ENV: 'production' },
    })
    expect(result.success).toBe(true)
  })

  test('accepts optional toolFilter', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      toolFilter: { allow: ['tool1'] },
    })
    expect(result.success).toBe(true)
  })

  test('accepts optional idleTimeoutMs', () => {
    const result = mcpPluginConfigSchema.safeParse({
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      idleTimeoutMs: 30000,
    })
    expect(result.success).toBe(true)
  })
})

describe('sanitizeServerId', () => {
  test('lowercases and replaces non-alphanum with hyphens', () => {
    expect(sanitizeServerId('My_Server.Name')).toBe('my-server-name')
  })

  test('strips leading and trailing hyphens', () => {
    expect(sanitizeServerId('--hello--')).toBe('hello')
  })

  test('collapses multiple hyphens', () => {
    expect(sanitizeServerId('a---b---c')).toBe('a-b-c')
  })
})
