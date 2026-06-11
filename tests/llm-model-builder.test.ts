// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import {
  buildChatModel,
  clearModelBuilderCacheForTesting,
  getOpenAICompatibleProvider,
  type ModelBuilderDeps,
} from '../src/llm-model-builder.js'
import { fetchWithoutTimeout } from '../src/utils/fetch.js'

function makeDeps(): { create: ReturnType<typeof mock>; deps: ModelBuilderDeps } {
  const create = mock((opts: Parameters<typeof createOpenAICompatible>[0]) => createOpenAICompatible(opts))
  return { create, deps: { create } }
}

describe('llm-model-builder', () => {
  beforeEach(() => {
    clearModelBuilderCacheForTesting()
  })

  it('memoizes the provider per apiKey+baseUrl', () => {
    const { create, deps } = makeDeps()
    const a = getOpenAICompatibleProvider('k1', 'http://x', deps)
    const b = getOpenAICompatibleProvider('k1', 'http://x', deps)
    expect(b).toBe(a)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('wires fetchWithoutTimeout into the provider', () => {
    const { create, deps } = makeDeps()
    getOpenAICompatibleProvider('k1', 'http://x', deps)
    expect(create.mock.calls[0]![0]).toMatchObject({ apiKey: 'k1', baseURL: 'http://x', fetch: fetchWithoutTimeout })
  })

  it('creates distinct providers for different credentials', () => {
    const { create, deps } = makeDeps()
    const a = getOpenAICompatibleProvider('k1', 'http://x', deps)
    const b = getOpenAICompatibleProvider('k2', 'http://x', deps)
    expect(b).not.toBe(a)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest provider past the cap', () => {
    for (let i = 0; i < 32; i++) getOpenAICompatibleProvider(`k${i}`, 'http://x')
    getOpenAICompatibleProvider('k-extra', 'http://x')
    const { create, deps } = makeDeps()
    getOpenAICompatibleProvider('k0', 'http://x', deps)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('does not collide when the apiKey contains a colon', () => {
    const { create, deps } = makeDeps()
    const a = getOpenAICompatibleProvider('user:password', 'https://api', deps)
    const b = getOpenAICompatibleProvider('user', 'password:https://api', deps)
    expect(b).not.toBe(a)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('buildChatModel returns a model bound to the requested model name', () => {
    const model = buildChatModel('k1', 'http://x', 'small-model-1')
    expect(model).toMatchObject({ modelId: 'small-model-1' })
  })
})
