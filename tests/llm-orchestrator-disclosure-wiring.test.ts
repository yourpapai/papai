// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { prepareLlmInvocation, type PrepareLlmInvocationDeps } from '../src/llm-orchestrator-tools.js'
import { applyResultCompaction } from '../src/tools/compaction/wrap-compaction.js'
import type { ReductionFlags } from '../src/tools/feature-flags.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const d = (desc: string): ToolSet[string] => tool({ description: desc, inputSchema: z.object({}), execute: () => ({}) })

// resultCompaction stays OFF, so the real applyResultCompaction is a pass-through.
const makeDeps = (progressiveDisclosure: boolean): PrepareLlmInvocationDeps => ({
  buildToolDescriptors: (): Promise<ToolSet> => Promise.resolve({}),
  buildProviderlessToolDescriptors: (): Promise<ToolSet> => Promise.resolve({ list_tasks: d('List tasks.') }),
  resolveReductionFlags: (): ReductionFlags => ({
    progressiveDisclosure,
    resultCompaction: false,
    semanticToolRetrieval: false,
    crossThreadMemory: false,
  }),
  applyResultCompaction,
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

  it('returns a disclosure session and injects meta tools when the flag is ON', async () => {
    const out = await prepareLlmInvocation(optsFor('dw-ctx-on', 'find tasks'), makeDeps(true))
    expect(out.disclosure).toBeDefined()
    expect(out.tools['search_tools']).toBeDefined()
    expect(out.tools['load_tool']).toBeDefined()
  })

  it('returns no disclosure session when the flag is OFF', async () => {
    const out = await prepareLlmInvocation(optsFor('dw-ctx-off', 'hi'), makeDeps(false))
    expect(out.disclosure).toBeUndefined()
    expect(out.tools['search_tools']).toBeUndefined()
  })

  it('OFF: enabledToolNames equals the descriptor tools (no meta injected)', async () => {
    const out = await prepareLlmInvocation(optsFor('dw-ctx-off-names', 'hi'), makeDeps(false))
    expect([...out.enabledToolNames].toSorted()).toEqual(['list_tasks'])
    expect(out.disclosure).toBeUndefined()
  })
})
