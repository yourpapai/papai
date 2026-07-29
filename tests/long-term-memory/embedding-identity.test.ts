// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { embeddingVersionOf, UNKNOWN_EMBEDDING_VERSION } from '../../src/long-term-memory/embedding-identity.js'

describe('embeddingVersionOf', () => {
  test('joins model and dimension', () => {
    expect(embeddingVersionOf('text-embedding-3-small', 1536)).toBe('text-embedding-3-small:1536')
  })

  test('distinguishes the same model at different dimensions', () => {
    expect(embeddingVersionOf('m', 768)).not.toBe(embeddingVersionOf('m', 1536))
  })

  test('never collides with the pre-migration sentinel', () => {
    expect(embeddingVersionOf('unknown', 0)).not.toBe(UNKNOWN_EMBEDDING_VERSION)
  })
})
