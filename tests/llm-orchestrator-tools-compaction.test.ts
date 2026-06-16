// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { prepareLlmInvocation, type PrepareLlmInvocationDeps } from '../src/llm-orchestrator-tools.js'
import type { CompactionContext } from '../src/tools/compaction/types.js'
import type { ReductionFlags } from '../src/tools/feature-flags.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const d = (): ToolSet[string] => tool({ description: 'd', inputSchema: z.object({}), execute: () => ({}) })

const flags = (resultCompaction: boolean): ReductionFlags => ({
  progressiveDisclosure: false,
  resultCompaction,
  semanticToolRetrieval: false,
  crossThreadMemory: false,
})

const applyResultCompactionSpy = mock((tools: ToolSet, _ctx: CompactionContext): ToolSet => tools)

const makeDeps = (f: ReductionFlags): PrepareLlmInvocationDeps => ({
  buildToolDescriptors: (): Promise<ToolSet> => Promise.resolve({}),
  buildProviderlessToolDescriptors: (): Promise<ToolSet> => Promise.resolve({ list_tasks: d() }),
  resolveReductionFlags: (): ReductionFlags => f,
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

  it('applies compaction with enabled=true and the user text as intent', async () => {
    await prepareLlmInvocation(optsFor('comp-ctx-on', 'find overdue tasks'), makeDeps(flags(true)))
    expect(applyResultCompactionSpy).toHaveBeenCalledTimes(1)
    const ctxArg: CompactionContext = applyResultCompactionSpy.mock.calls[0]![1]
    expect(ctxArg.enabled).toBe(true)
    expect(ctxArg.userIntent).toBe('find overdue tasks')
  })

  it('applies compaction with enabled=false when the flag is OFF', async () => {
    await prepareLlmInvocation(optsFor('comp-ctx-off', 'hi'), makeDeps(flags(false)))
    expect(applyResultCompactionSpy).toHaveBeenCalledTimes(1)
    const ctxArg: CompactionContext = applyResultCompactionSpy.mock.calls[0]![1]
    expect(ctxArg.enabled).toBe(false)
  })
})
