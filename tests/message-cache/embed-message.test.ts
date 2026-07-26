// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { and, eq } from 'drizzle-orm'

import { messageEmbeddings } from '../../src/db/schema.js'
import type { LlmConfigResult, ResolvedRole } from '../../src/llm-providers/types.js'
import { cacheMessage } from '../../src/message-cache/cache.js'
import { embedAndStoreMessage } from '../../src/message-cache/embed-message.js'
import type { EmbedAndStoreArgs, EmbedMessageDeps } from '../../src/message-cache/embed-message.js'
import type { MessageScope } from '../../src/message-cache/store.js'
import { loadEmbeddingsForScope } from '../../src/message-cache/vector-store.js'
import { flushPendingWrites, getTestDb, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const groupScope = (g: string): MessageScope => ({
  kind: 'group',
  groupContextId: g,
})

const role = (model: string): ResolvedRole => ({
  apiKey: 'k',
  baseUrl: 'u',
  model,
  source: 'global',
})

const okConfig = (model: string): LlmConfigResult => ({
  ok: true,
  source: 'global',
  main: role(model),
  small: role(model),
  embedding: role(model),
})

const missingConfig = (): LlmConfigResult => ({
  ok: false,
  type: 'missing',
  source: 'global',
  missing: ['embedding'],
})

const embedArgs = (text: string): EmbedAndStoreArgs => ({
  text,
  contextId: 'g:t1',
  messageId: 'm1',
  configContextId: 'g',
  embeddingCtx: {
    storageContextId: 'g:t1',
    contextType: 'group',
    chatUserId: 'u1',
  },
})

const seedMessage = async (): Promise<void> => {
  cacheMessage({
    messageId: 'm1',
    contextId: 'g:t1',
    groupContextId: 'g',
    text: 'hi',
    timestamp: 1,
  })
  await flushPendingWrites()
}

describe('embedAndStoreMessage', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('no-op (no store) when LLM config does not resolve', async () => {
    await seedMessage()
    const embedOne = mock(() => Promise.resolve<number[] | null>([0.1, 0.2]))
    const deps: EmbedMessageDeps = { resolve: () => missingConfig(), embedOne }

    await embedAndStoreMessage(embedArgs('hi'), deps)

    expect(embedOne).toHaveBeenCalledTimes(0)
    expect(loadEmbeddingsForScope(groupScope('g'))).toHaveLength(0)
  })

  test('no-op (no store), no throw when embed call rejects', async () => {
    await seedMessage()
    const deps: EmbedMessageDeps = {
      resolve: () => okConfig('m'),
      embedOne: () => Promise.reject(new Error('boom')),
    }

    await expect(embedAndStoreMessage(embedArgs('hi'), deps)).resolves.toBeUndefined()
    expect(loadEmbeddingsForScope(groupScope('g'))).toHaveLength(0)
  })

  test('no-op (no store) when embed call returns null', async () => {
    await seedMessage()
    const deps: EmbedMessageDeps = {
      resolve: () => okConfig('m'),
      embedOne: () => Promise.resolve(null),
    }

    await embedAndStoreMessage(embedArgs('hi'), deps)

    expect(loadEmbeddingsForScope(groupScope('g'))).toHaveLength(0)
  })

  test('stores the embedding with model + dim provenance on success', async () => {
    await seedMessage()
    const deps: EmbedMessageDeps = {
      resolve: () => okConfig('text-emb'),
      embedOne: () => Promise.resolve<number[] | null>([0.4, 0.5, 0.6]),
    }

    await embedAndStoreMessage(embedArgs('hi'), deps)

    const loaded = loadEmbeddingsForScope(groupScope('g'))
    expect(loaded).toHaveLength(1)
    const row = loaded[0]
    assert(row !== undefined)
    expect(row.messageId).toBe('m1')
    expect(Array.from(row.vec)).toEqual(Array.from(new Float32Array([0.4, 0.5, 0.6])))

    const provenance = getTestDb()
      .select()
      .from(messageEmbeddings)
      .where(and(eq(messageEmbeddings.contextId, 'g:t1'), eq(messageEmbeddings.messageId, 'm1')))
      .get()
    expect(provenance?.embeddingModel).toBe('text-emb')
    expect(provenance?.embeddingDim).toBe(3)
  })

  test('threads the embedding call context through to embedOne', async () => {
    await seedMessage()
    const embedOne = mock(() => Promise.resolve<number[] | null>([0.1]))
    const deps: EmbedMessageDeps = { resolve: () => okConfig('m'), embedOne }

    await embedAndStoreMessage(embedArgs('hi'), deps)

    expect(embedOne).toHaveBeenCalledTimes(1)
    expect(embedOne).toHaveBeenCalledWith('hi', 'k', 'u', 'm', {
      storageContextId: 'g:t1',
      contextType: 'group',
      chatUserId: 'u1',
    })
  })
})
