// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { prepareLlmInvocation, type PrepareLlmInvocationDeps } from '../src/llm-orchestrator-tools.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const d = (desc: string): ToolSet[string] => tool({ description: desc, inputSchema: z.object({}), execute: () => ({}) })

// Progressive disclosure is now unconditional; the compaction dep is stubbed to a
// pass-through so this suite stays focused on disclosure meta-tool injection.
const makeDeps = (): PrepareLlmInvocationDeps => ({
  buildToolDescriptors: (): Promise<ToolSet> => Promise.resolve({}),
  buildProviderlessToolDescriptors: (): Promise<ToolSet> => Promise.resolve({ list_tasks: d('List tasks.') }),
  applyResultCompaction: (tools: ToolSet): ToolSet => tools,
})

const optsFor = (contextId: string, userText: string): Parameters<typeof prepareLlmInvocation>[0] => ({
  contextId,
  configId: contextId,
  chatUserId: 'u1',
  username: null,
  contextType: 'dm',
  provider: null,
  history: [],
  userText,
  stagedDownloadFn: undefined,
  askPermission: undefined,
})

describe('prepareLlmInvocation disclosure wiring', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('always returns a disclosure session and injects meta tools', async () => {
    const out = await prepareLlmInvocation(optsFor('dw-ctx-on', 'find tasks'), makeDeps())
    expect(out.disclosure).toBeDefined()
    expect(out.tools['search_tools']).toBeDefined()
    expect(out.tools['load_tool']).toBeDefined()
  })

  it('enabledToolNames includes the descriptor tools plus the injected meta tools', async () => {
    const out = await prepareLlmInvocation(optsFor('dw-ctx-names', 'hi'), makeDeps())
    expect([...out.enabledToolNames].toSorted()).toEqual(['list_tasks', 'load_tool', 'search_tools'])
  })
})
