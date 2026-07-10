// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { setMcpRedactionConfig } from '../../src/coding-credentials/mcp-redaction.js'
import { callPluginMcpTool } from '../../src/mcp-server/plugin-bridge.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { pluginManifestSchema } from '../../src/plugins/types.js'
import type { PluginContributions } from '../../src/plugins/types.js'
import { restoreFetch, setMockFetch, setupTestDb } from '../utils/test-helpers.js'

const FAKE_PLUGIN_ID = 'fake-redaction-plugin'
const PLATFORM_INSTANCE_ID = 'pi-1'
const STORAGE_CONTEXT_ID = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: 'ctx-1' })

function buildManifest(mcpResponseRedaction: boolean): ReturnType<typeof pluginManifestSchema.parse> {
  return pluginManifestSchema.parse({
    id: FAKE_PLUGIN_ID,
    name: 'Fake Redaction Plugin',
    version: '1.0.0',
    description: 'Fake plugin for redaction bridge tests',
    apiVersion: 1,
    main: 'index.js',
    contributes: { tools: ['leak'] },
    permissions: [],
    mcpServer: true,
    mcpResponseRedaction,
  })
}

function registerFakePlugin(mcpResponseRedaction: boolean): void {
  const contributions: PluginContributions = {
    tools: [
      {
        name: 'leak',
        description: 'Leaks a raw email address',
        execute: () => Promise.resolve('email: a@b.com'),
      },
    ],
    promptFragments: [],
  }
  contributionRegistry.register(FAKE_PLUGIN_ID, contributions, buildManifest(mcpResponseRedaction))
}

function registerThrowingFakePlugin(mcpResponseRedaction: boolean): void {
  const contributions: PluginContributions = {
    tools: [
      {
        name: 'leak',
        description: 'Throws with a sensitive error message',
        execute: () => Promise.reject(new Error('secret-db-conn-string')),
      },
    ],
    promptFragments: [],
  }
  contributionRegistry.register(FAKE_PLUGIN_ID, contributions, buildManifest(mcpResponseRedaction))
}

function callLeakTool(): ReturnType<typeof callPluginMcpTool> {
  return callPluginMcpTool({
    pluginId: FAKE_PLUGIN_ID,
    toolName: 'leak',
    input: {},
    storageContextId: STORAGE_CONTEXT_ID,
    chatUserId: 'user-1',
  })
}

describe('callPluginMcpTool response redaction', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterEach(() => {
    restoreFetch()
    contributionRegistry.deregister(FAKE_PLUGIN_ID)
  })

  test('opt-out: manifest without mcpResponseRedaction passes text through unchanged', async () => {
    registerFakePlugin(false)
    let fetchCalled = false
    setMockFetch(() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    const result = await callLeakTool()

    expect(result.content[0]?.text).toBe('email: a@b.com')
    expect(result.isError).toBeUndefined()
    expect(fetchCalled).toBe(false)
  })

  test('opt-in with config present redacts the response via the internal model', async () => {
    registerFakePlugin(true)
    setMcpRedactionConfig(PLATFORM_INSTANCE_ID, {
      model_url: 'https://internal-model.invalid',
      api_key: 'test-key',
      model_name: 'test-model',
    })
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '[{"string":"a@b.com","redacted":"email"}]' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    const result = await callLeakTool()

    expect(result.content[0]?.text).toBe('email: [EMAIL]')
    expect(result.isError).toBeUndefined()
  })

  test('opt-in without configured mcp_redaction fails closed', async () => {
    registerFakePlugin(true)

    const result = await callLeakTool()

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text.startsWith('[RESULT BLOCKED BY VALIDATION')).toBe(true)
  })

  test('opt-in: tool execution throw is fail-closed, does not leak the raw error message', async () => {
    registerThrowingFakePlugin(true)
    setMcpRedactionConfig(PLATFORM_INSTANCE_ID, {
      model_url: 'https://internal-model.invalid',
      api_key: 'test-key',
      model_name: 'test-model',
    })
    let fetchCalled = false
    setMockFetch(() => {
      fetchCalled = true
      return Promise.resolve(new Response('{}', { status: 200 }))
    })

    const result = await callLeakTool()

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text.startsWith('[RESULT BLOCKED BY VALIDATION')).toBe(true)
    expect(result.content[0]?.text).not.toContain('secret-db-conn-string')
    expect(fetchCalled).toBe(false)
  })

  test('opt-out: tool execution throw still returns the raw error message (unchanged behavior)', async () => {
    registerThrowingFakePlugin(false)

    const result = await callLeakTool()

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe('secret-db-conn-string')
  })
})
