// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { userCachesForTesting } from '../src/cache.js'
import { getOrCreateDescriptors } from '../src/llm-orchestrator-descriptor-cache.js'
import type { PrepareLlmInvocationDeps } from '../src/llm-orchestrator-tools.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const stubTool = (): ToolSet[string] =>
  tool({ description: 'probe', inputSchema: z.object({}), execute: () => Promise.resolve('ok') })

describe('getOrCreateDescriptors', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
  })

  test('builds via deps on a miss and returns the cached instance on the next call', async () => {
    const built: ToolSet = { create_task: stubTool() }
    const buildToolDescriptors = mock(() => Promise.resolve(built))
    const deps = {
      buildToolDescriptors,
      buildProviderlessToolDescriptors: mock(() => Promise.resolve({} as ToolSet)),
      applyResultCompaction: (tools: ToolSet): ToolSet => tools,
    } satisfies PrepareLlmInvocationDeps

    const first = await getOrCreateDescriptors(
      'ctx-desc-cache',
      'user-1',
      null,
      createMockProvider(),
      'dm',
      undefined,
      undefined,
      deps,
      false,
      undefined,
    )
    const second = await getOrCreateDescriptors(
      'ctx-desc-cache',
      'user-1',
      null,
      createMockProvider(),
      'dm',
      undefined,
      undefined,
      deps,
      false,
      undefined,
    )

    expect(buildToolDescriptors).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })
})
