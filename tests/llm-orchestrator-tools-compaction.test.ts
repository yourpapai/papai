// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import type { ToolSet } from 'ai'

import type { CompactionContext } from '../src/tools/compaction/types.js'
import type { ReductionFlags } from '../src/tools/feature-flags.js'

const resolveReductionFlagsMock = mock(
  (_storageContextId: string): ReductionFlags => ({
    progressiveDisclosure: false,
    resultCompaction: true,
    semanticToolRetrieval: false,
  }),
)

const applyResultCompactionMock = mock((tools: ToolSet, _ctx: CompactionContext): ToolSet => tools)

void mock.module('../src/tools/feature-flags.js', () => ({
  resolveReductionFlags: resolveReductionFlagsMock,
  REDUCTION_FLAGS_CONFIG_KEY: 'tool_context_flags',
}))

void mock.module('../src/tools/compaction/wrap-compaction.js', () => ({
  applyResultCompaction: applyResultCompactionMock,
}))

void mock.module('../src/cache.js', () => ({
  getCachedTools: (): unknown => ({ list_tasks: { description: 'd', execute: (): Record<string, never> => ({}) } }),
  setCachedTools: (): void => {},
  getCachedConfig: (): null => null,
  setCachedConfig: (): void => {},
  clearCachedToolsByPrefix: (): void => {},
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

void mock.module('../src/tools/index.js', () => ({
  buildToolDescriptors: (): Promise<ToolSet> => Promise.resolve({}),
  buildProviderlessToolDescriptors: (): Promise<ToolSet> => Promise.resolve({}),
  applyToolPreferences: (tools: ToolSet): ToolSet => tools,
}))

const { prepareLlmInvocation } = await import('../src/llm-orchestrator-tools.js')

describe('prepareLlmInvocation compaction wiring', () => {
  beforeEach(() => {
    resolveReductionFlagsMock.mockReset()
    applyResultCompactionMock.mockReset()
    applyResultCompactionMock.mockImplementation((tools: ToolSet): ToolSet => tools)
  })

  it('applies compaction with enabled=true and the user text as intent', async () => {
    resolveReductionFlagsMock.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: true,
      semanticToolRetrieval: false,
    })
    await prepareLlmInvocation({
      contextId: 'ctx-1',
      configId: 'ctx-1',
      chatUserId: 'u1',
      username: null,
      contextType: 'dm',
      provider: null,
      history: [],
      userText: 'find overdue tasks',
      stagedDownloadFn: undefined,
      askPermission: undefined,
    })
    expect(applyResultCompactionMock).toHaveBeenCalledTimes(1)
    const ctxArg: CompactionContext = applyResultCompactionMock.mock.calls[0]![1]
    expect(ctxArg.enabled).toBe(true)
    expect(ctxArg.userIntent).toBe('find overdue tasks')
  })

  it('applies compaction with enabled=false when the flag is OFF', async () => {
    resolveReductionFlagsMock.mockReturnValue({
      progressiveDisclosure: false,
      resultCompaction: false,
      semanticToolRetrieval: false,
    })
    await prepareLlmInvocation({
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
    const ctxArg: CompactionContext = applyResultCompactionMock.mock.calls[0]![1]
    expect(ctxArg.enabled).toBe(false)
  })
})
