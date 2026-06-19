// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import * as cacheModule from '../src/cache.js'
import * as attachmentsModule from '../src/llm-orchestrator-attachments.js'
import { buildHistory } from '../src/llm-orchestrator-history.js'

type SpyInstance = { mockRestore: () => void }

describe('buildHistory', () => {
  const spies: SpyInstance[] = []

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
  })

  const track = <T extends SpyInstance>(spy: T): T => {
    spies.push(spy)
    return spy
  }

  test('returns baseHistory from cache and turn messages from buildUserTurnMessages', async () => {
    const baseHistory: ModelMessage[] = [{ role: 'user', content: 'prior' }]
    const modelMessage: ModelMessage = { role: 'user', content: 'model content' }
    const historyMessage: ModelMessage = { role: 'user', content: 'raw text' }

    track(spyOn(cacheModule, 'getCachedHistory').mockReturnValue(baseHistory))
    track(spyOn(attachmentsModule, 'buildUserTurnMessages').mockResolvedValue({ modelMessage, historyMessage }))

    const result = await buildHistory('ctx:thread:1', 'user1', 'gpt-4o', 'hello', [])

    expect(result.baseHistory).toBe(baseHistory)
    expect(result.modelMessage).toBe(modelMessage)
    expect(result.historyMessage).toBe(historyMessage)
  })
})
