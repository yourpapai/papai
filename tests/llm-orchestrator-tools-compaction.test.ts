// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { prepareLlmInvocation, type PrepareLlmInvocationDeps } from '../src/llm-orchestrator-tools.js'
import type { CompactionContext } from '../src/tools/compaction/types.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const d = (): ToolSet[string] => tool({ description: 'd', inputSchema: z.object({}), execute: () => ({}) })

const applyResultCompactionSpy = mock((tools: ToolSet, _ctx: CompactionContext): ToolSet => tools)

const makeDeps = (): PrepareLlmInvocationDeps => ({
  buildToolDescriptors: (): Promise<ToolSet> => Promise.resolve({}),
  buildProviderlessToolDescriptors: (): Promise<ToolSet> => Promise.resolve({ list_tasks: d() }),
  applyResultCompaction: applyResultCompactionSpy,
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

describe('prepareLlmInvocation compaction wiring', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    applyResultCompactionSpy.mockClear()
  })

  it('always applies compaction with the user text as intent and the context id', async () => {
    await prepareLlmInvocation(optsFor('comp-ctx', 'find overdue tasks'), makeDeps())
    expect(applyResultCompactionSpy).toHaveBeenCalledTimes(1)
    const ctxArg: CompactionContext = applyResultCompactionSpy.mock.calls[0]![1]
    expect(ctxArg.userIntent).toBe('find overdue tasks')
    expect(ctxArg.storageContextId).toBe('comp-ctx')
  })
})
