// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { clearBriefEmbeddingCachesForTesting } from '../../../src/tools/disclosure/embedding-tool-retriever.js'
import { clearBriefEmbeddingCachesForTesting as shimmedClear } from '../../../src/tools/disclosure/embedding-tool-retriever.testing.js'

test('embedding-tool-retriever.testing shim re-exports the production seam', () => {
  expect(shimmedClear).toBe(clearBriefEmbeddingCachesForTesting)
})
