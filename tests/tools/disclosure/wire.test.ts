// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert/strict'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import {
  createActorProviderRequestScope,
  type ProviderRequestScope,
} from '../../../src/analytics/provider-request-scope.js'
import { isToolFailureResult } from '../../../src/tool-failure.js'
import { LexicalToolRetriever } from '../../../src/tools/disclosure/tool-retriever.js'
import { maybeApplyDisclosure } from '../../../src/tools/disclosure/wire.js'
import {
  finalizeProviderScopedTools,
  providerRequestScopeContextSchema,
} from '../../../src/tools/wrap-tool-execution.js'

const d = (): ToolSet[string] => tool({ description: 'x', inputSchema: z.object({}), execute: () => ({}) })

const makeScope = (): ProviderRequestScope =>
  createActorProviderRequestScope({
    requestContext: {
      source: {
        platform: 'telegram',
        platformInstanceId: 'pi-1',
        chatUserId: 'user-1',
        nativeContextId: 'chat-1',
        storageContextId: 'pi-1:chat-1',
        configContextId: 'pi-1:chat-1',
        contextType: 'dm',
        actorRole: 'member',
        taskInstanceId: null,
        taskProvider: 'none',
        invocationMode: 'normal',
        rawTurnId: 'turn-1',
      },
      sourceEventId: 'turn-1:scope',
    },
    observeProviderRequest: () => {},
  })

const execOptions = (scope: unknown): { toolCallId: string; messages: never[]; context: unknown } => ({
  toolCallId: 'call-1',
  messages: [],
  context: scope,
})

describe('maybeApplyDisclosure', () => {
  it('adds meta tools and a session', () => {
    const tools: ToolSet = { get_current_time: d(), list_tasks: d() }
    const out = maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever())
    expect(out.tools['search_tools']).toBeDefined()
    expect(out.tools['load_tool']).toBeDefined()
    assert.ok(out.disclosure !== undefined)
    expect(out.disclosure.allNames.has('list_tasks')).toBe(true)
    expect(out.disclosure.allNames.has('search_tools')).toBe(true)
    expect(out.disclosure.allNames.has('load_tool')).toBe(true)
    expect(out.tools).not.toBe(tools)
  })

  it('finalize wraps ordinary tools plus disclosure meta tools with the common schema/wrapper', async () => {
    const tools: ToolSet = {
      get_current_time: d(),
      list_tasks: tool({
        description: 'list',
        inputSchema: z.object({}),
        execute: () => Promise.resolve('listed'),
      }),
    }
    const { tools: disclosed, disclosure } = maybeApplyDisclosure(tools, 'ctx-1', new LexicalToolRetriever())
    assert.ok(disclosure !== undefined)

    const finalized = finalizeProviderScopedTools(disclosed)

    for (const name of ['list_tasks', 'search_tools', 'load_tool']) {
      expect(finalized[name], name).toBeDefined()
      expect(finalized[name]!.contextSchema, name).toBe(providerRequestScopeContextSchema)
    }

    // A descriptor inactive at step 0 becomes executable through explicit load.
    expect(disclosure.activeToolNames()).not.toContain('list_tasks')
    const scope = makeScope()
    const loadOut: unknown = await finalized['load_tool']!.execute!({ names: ['list_tasks'] }, execOptions(scope))
    expect(loadOut).toMatchObject({ loaded: ['list_tasks'], unknown: [] })
    expect(disclosure.activeToolNames()).toContain('list_tasks')

    // The loaded tool executes under the same keyed scope.
    const listed: unknown = await finalized['list_tasks']!.execute!({}, execOptions(scope))
    expect(listed).toBe('listed')

    // Without a valid keyed context the call fails closed before execution.
    const failure: unknown = await finalized['list_tasks']!.execute!({}, execOptions({ kind: 'bogus' }))
    assert.ok(isToolFailureResult(failure))
    expect(failure.errorCode).toBe('provider_scope_missing')
  })
})
