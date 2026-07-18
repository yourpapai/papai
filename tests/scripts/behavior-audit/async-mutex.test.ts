// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createAsyncMutex } from '../../../scripts/behavior-audit/async-mutex.js'

describe('createAsyncMutex', () => {
  test('serializes same-key acquisitions', async () => {
    const mutex = createAsyncMutex()
    const order: string[] = []
    const t1 = mutex('k', async () => {
      order.push('t1-start')
      await Bun.sleep(10)
      order.push('t1-end')
    })
    const t2 = mutex('k', async () => {
      order.push('t2-start')
      await Bun.sleep(5)
      order.push('t2-end')
    })
    await Promise.all([t1, t2])
    expect(order).toEqual(['t1-start', 't1-end', 't2-start', 't2-end'])
  })

  test('runs distinct keys in parallel', async () => {
    const mutex = createAsyncMutex()
    const order: string[] = []
    const t1 = mutex('a', async () => {
      order.push('a-start')
      await Bun.sleep(20)
      order.push('a-end')
    })
    const t2 = mutex('b', async () => {
      order.push('b-start')
      await Bun.sleep(5)
      order.push('b-end')
    })
    await Promise.all([t1, t2])
    expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end'])
  })

  test('propagates return values', async () => {
    const mutex = createAsyncMutex()
    const result = await mutex('k', () => Promise.resolve(42))
    expect(result).toBe(42)
  })

  test('continues chain after a task throws', async () => {
    const mutex = createAsyncMutex()
    await expect(mutex('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    const after = await mutex('k', () => Promise.resolve('ok'))
    expect(after).toBe('ok')
  })

  test('does not block distinct keys after one key throws', async () => {
    const mutex = createAsyncMutex()
    await expect(mutex('a', () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    const result = await mutex('b', () => Promise.resolve('ok'))
    expect(result).toBe('ok')
  })
})
