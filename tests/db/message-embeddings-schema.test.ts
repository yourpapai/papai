// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { messageEmbeddings } from '../../src/db/message-embeddings-schema.js'

describe('messageEmbeddings schema', () => {
  test('exposes the expected message-embedding columns', () => {
    expect(messageEmbeddings.contextId).toBeDefined()
    expect(messageEmbeddings.messageId).toBeDefined()
    expect(messageEmbeddings.embedding).toBeDefined()
    expect(messageEmbeddings.embeddingModel).toBeDefined()
    expect(messageEmbeddings.embeddingDim).toBeDefined()
    expect(messageEmbeddings.embeddedAt).toBeDefined()
  })
})
