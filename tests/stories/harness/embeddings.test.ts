// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { EMBEDDINGS_URL, MATCH_EMBEDDING, expectEmbedding } from './embeddings.js'
import { createScenarioEvents } from './events.js'
import { createStrictHttpDispatcher } from './strict-http.js'

describe('embeddings fixture', () => {
  test('serves a declared embedding vector on the OpenAI-compatible route', async () => {
    const http = createStrictHttpDispatcher(createScenarioEvents('embeddings'))
    expectEmbedding(http)
    const response = await http.fetch(EMBEDDINGS_URL, {
      method: 'POST',
      body: JSON.stringify({
        model: 'scenario-main-model',
        input: ['hello'],
        encoding_format: 'float',
      }),
    })
    expect(await response.json()).toEqual({
      data: [{ embedding: [...MATCH_EMBEDDING] }],
    })
    expect(() => http.verifyConsumed()).not.toThrow()
  })
})
