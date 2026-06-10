// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, beforeEach } from 'bun:test'

import {
  putResult,
  getResultPage,
  clearResultStoreForTesting,
  setResultStoreClockForTesting,
} from '../../../src/tools/compaction/result-store.js'

describe('result-store', () => {
  let now = 1_000
  beforeEach(() => {
    clearResultStoreForTesting()
    now = 1_000
    setResultStoreClockForTesting(() => now)
  })

  it('stores and pages a raw string by byte window', () => {
    const handle = putResult('ctx-1', 'abcdefghij')
    expect(handle).toMatch(/^res_/u)
    const page = getResultPage('ctx-1', handle, 0, 4)
    expect(page).toEqual({ found: true, chunk: 'abcd', nextOffset: 4, done: false })
    const tail = getResultPage('ctx-1', handle, 8, 4)
    expect(tail).toEqual({ found: true, chunk: 'ij', nextOffset: 10, done: true })
  })

  it('reports not found for unknown handle', () => {
    expect(getResultPage('ctx-1', 'res_missing', 0, 4)).toEqual({ found: false })
  })

  it('expires entries past TTL', () => {
    const handle = putResult('ctx-1', 'data')
    now += 30 * 60_000 + 1
    expect(getResultPage('ctx-1', handle, 0, 4)).toEqual({ found: false })
  })

  it('isolates handles per context', () => {
    const handle = putResult('ctx-1', 'data')
    expect(getResultPage('ctx-2', handle, 0, 4)).toEqual({ found: false })
  })

  it('evicts oldest when exceeding max entries', () => {
    const handles: string[] = []
    for (let i = 0; i < 65; i++) handles.push(putResult('ctx-1', `v${i}`))
    expect(getResultPage('ctx-1', handles[0]!, 0, 4)).toEqual({ found: false })
    expect(getResultPage('ctx-1', handles[64]!, 0, 4).found).toBe(true)
  })

  it('allows a fresh put and correct paging after TTL-expiry evicts the sole entry for a context', () => {
    const handle = putResult('ctx-ttl', 'hello')
    // Expire the entry by advancing the clock past TTL
    now += 30 * 60_000 + 1
    expect(getResultPage('ctx-ttl', handle, 0, 5)).toEqual({ found: false })

    // Reset clock and store a new entry under the same context
    now = 1_000
    setResultStoreClockForTesting(() => now)
    const handle2 = putResult('ctx-ttl', 'world')
    expect(getResultPage('ctx-ttl', handle2, 0, 5)).toEqual({ found: true, chunk: 'world', nextOffset: 5, done: true })
    expect(getResultPage('ctx-ttl', handle2, 0, 3)).toEqual({ found: true, chunk: 'wor', nextOffset: 3, done: false })
  })
})
