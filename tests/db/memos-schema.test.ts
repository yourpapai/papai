// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { memoLinks, memos } from '../../src/db/memos-schema.js'

describe('memos schema', () => {
  test('exposes the expected memo columns', () => {
    expect(memos.id).toBeDefined()
    expect(memos.userId).toBeDefined()
    expect(memos.content).toBeDefined()
    expect(memos.summary).toBeDefined()
    expect(memos.tags).toBeDefined()
    expect(memos.embedding).toBeDefined()
    expect(memos.status).toBeDefined()
    expect(memos.createdAt).toBeDefined()
    expect(memos.updatedAt).toBeDefined()
  })
})

describe('memoLinks schema', () => {
  test('exposes the expected memo-link columns', () => {
    expect(memoLinks.id).toBeDefined()
    expect(memoLinks.sourceMemoId).toBeDefined()
    expect(memoLinks.targetMemoId).toBeDefined()
    expect(memoLinks.targetTaskId).toBeDefined()
    expect(memoLinks.relationType).toBeDefined()
    expect(memoLinks.createdAt).toBeDefined()
  })
})
