// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { ToolSet } from 'ai'

import type { ReductionFlags } from '../src/tools/feature-flags.js'

const resolveReductionFlags = mock(
  (_storageContextId: string): ReductionFlags => ({
    progressiveDisclosure: true,
    resultCompaction: false,
    semanticToolRetrieval: false,
  }),
)

void mock.module('../src/tools/feature-flags.js', () => ({
  resolveReductionFlags,
  REDUCTION_FLAGS_CONFIG_KEY: 'tool_context_flags',
}))

void mock.module('../src/tools/compaction/wrap-compaction.js', () => ({
  applyResultCompaction: (tools: ToolSet): ToolSet => tools,
}))

void mock.module('../src/cache.js', () => ({
  getCachedTools: (): unknown => ({
    list_tasks: { description: 'List tasks.', execute: (): Record<string, never> => ({}) },
  }),
  setCachedTools: (): void => {},
  getCachedConfig: (): null => null,
  setCachedConfig: (): void => {},
  clearCachedToolsByPrefix: (): void => {},
}))

void mock.module('../src/tools/index.js', () => ({
  buildToolDescriptors: (): Promise<ToolSet> => Promise.resolve({}),
  buildProviderlessToolDescriptors: (): Promise<ToolSet> => Promise.resolve({}),
  applyToolPreferences: (tools: ToolSet): ToolSet => tools,
}))

void mock.module('../src/conversation.js', () => ({
  buildMessagesWithMemory: (_c: string, h: unknown): { messages: unknown; memoryMsg: null } => ({
    messages: h,
    memoryMsg: null,
  }),
}))

void mock.module('../src/llm-orchestrator-validation.js', () => ({
  validateToolResults: (m: unknown): unknown => m,
}))

void mock.module('../src/llm-orchestrator-config.js', () => ({
  resolveTimezone: (): string => 'UTC',
}))

const { prepareLlmInvocation } = await import('../src/llm-orchestrator-tools.js')

describe('prepareLlmInvocation disclosure wiring', () => {
  beforeEach(() => {
    resolveReductionFlags.mockReset()
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: true,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
  })

  it('returns a disclosure session and injects meta tools when the flag is ON', async () => {
    const out = await prepareLlmInvocation({
      contextId: 'ctx-1',
      configId: 'ctx-1',
      chatUserId: 'u1',
      username: null,
      contextType: 'dm',
      provider: null,
      history: [],
      userText: 'find tasks',
      stagedDownloadFn: undefined,
      askPermission: undefined,
    })
    expect(out.disclosure).toBeDefined()
    expect(out.tools['search_tools']).toBeDefined()
    expect(out.tools['load_tool']).toBeDefined()
  })

  it('returns no disclosure session when the flag is OFF', async () => {
    resolveReductionFlags.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
    const out = await prepareLlmInvocation({
      contextId: 'ctx-1',
      configId: 'ctx-1',
      chatUserId: 'u1',
      username: null,
      contextType: 'dm',
      provider: null,
      history: [],
      userText: 'hi',
      stagedDownloadFn: undefined,
      askPermission: undefined,
    })
    expect(out.disclosure).toBeUndefined()
    expect(out.tools['search_tools']).toBeUndefined()
  })
})
