// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import factory from '../../plugins/synthetic-web-search/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type { PluginTool } from '../../src/plugins/types.js'

const missingHttpFetch = (_url: string, _init: RequestInit | undefined): Promise<Response> => {
  throw new Error('not implemented')
}

function createMockLogger(): PluginLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (isRecord(value)) return value
  throw new Error(message)
}

function extractJsonSchema(inputSchema: unknown): Record<string, unknown> {
  const schema = requireRecord(inputSchema, 'registered tool must expose an input schema object')
  if (!('jsonSchema' in schema)) return schema
  return requireRecord(schema['jsonSchema'], 'wrapped input schema must expose jsonSchema')
}

function requireTool(value: PluginTool | undefined): PluginTool {
  if (value !== undefined) return value
  throw new Error('expected tool to be registered')
}

function createMockContext(): { ctx: PluginContext; registeredTool: { value: PluginTool | undefined } } {
  const registeredTool: { value: PluginTool | undefined } = { value: undefined }

  const registration: PluginRegistration = {
    registerTool: (tool: PluginTool) => {
      registeredTool.value = tool
    },
    registerPromptFragment: () => {},
    registerCommand: () => {},
    registerScheduledJob: () => {},
    registerTaskProviderType: () => {},
  }

  const ctx: PluginContext = {
    pluginId: 'synthetic-web-search',
    contextId: '__system__',
    permissions: new Set(['http']),
    kv: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      list: () => [],
    },
    log: createMockLogger(),
    registration,
    providerRuntime: {
      httpFetch: missingHttpFetch,
      allowedHosts: new Set(['api.synthetic.new']),
      logger: createMockLogger(),
    },
    adminConfig: {
      get: () => 'test-api-key',
    },
  }

  return { ctx, registeredTool }
}

describe('synthetic-web-search schema registration', () => {
  test('registers a real input schema for query, max_length, and index', () => {
    const { ctx, registeredTool } = createMockContext()
    const instance = factory()

    instance.activate(ctx)

    const tool = requireTool(registeredTool.value)

    const schemaInput = tool.inputSchema
    const schema = extractJsonSchema(schemaInput)
    const properties = requireRecord(schema['properties'], 'input schema must expose object properties')

    expect(schema['type']).toBe('object')
    expect(schema['required']).toEqual(['query'])
    expect(properties['query']).toEqual(expect.objectContaining({ type: 'string', maxLength: 400 }))
    expect(properties['max_length']).toEqual(expect.objectContaining({ type: 'integer', minimum: 0, maximum: 10000 }))
    expect(properties['index']).toEqual(expect.objectContaining({ type: 'integer', minimum: 0 }))
  })
})
