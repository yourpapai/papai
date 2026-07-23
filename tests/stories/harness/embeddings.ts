// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StrictHttpDispatcher } from './strict-http.js'

export const EMBEDDINGS_URL = 'https://llm.invalid/v1/embeddings'
export const MATCH_EMBEDDING: readonly number[] = [1, 0, 0, 0]
export const MISMATCH_EMBEDDING: readonly number[] = [0, 1, 0, 0]

export function expectEmbedding(http: StrictHttpDispatcher, embedding: readonly number[] = MATCH_EMBEDDING): void {
  http.expect({ method: 'POST', url: EMBEDDINGS_URL }, () => Response.json({ data: [{ embedding: [...embedding] }] }))
}
