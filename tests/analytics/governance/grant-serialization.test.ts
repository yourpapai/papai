// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  createGrantSendMutex,
  GrantMutexHeldError,
  runInDeterministicGrantOrder,
  withGrantSendLock,
} from '../../../src/analytics/governance/grant-serialization.js'

describe('grant send serialization', () => {
  test('the keyed mutex is held from acquisition through release', () => {
    const mutex = createGrantSendMutex()
    const release = mutex.tryAcquire('v1.d-grant-a')
    expect(release).not.toBeNull()
    expect(mutex.isHeld('v1.d-grant-a')).toBe(true)
    expect(mutex.tryAcquire('v1.d-grant-a')).toBeNull()
    expect(mutex.tryAcquire('v1.d-grant-b')).not.toBeNull()
    release?.()
    expect(mutex.isHeld('v1.d-grant-a')).toBe(false)
  })

  test('withGrantSendLock throws when the grant is already held and releases on success and error', () => {
    const mutex = createGrantSendMutex()
    const seen: string[] = []
    withGrantSendLock(mutex, 'v1.d-grant-a', () => {
      seen.push('inner')
      expect(() => withGrantSendLock(mutex, 'v1.d-grant-a', () => seen.push('nested'))).toThrow(GrantMutexHeldError)
    })
    expect(seen).toEqual(['inner'])
    expect(mutex.isHeld('v1.d-grant-a')).toBe(false)
    expect(() =>
      withGrantSendLock(mutex, 'v1.d-grant-a', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(mutex.isHeld('v1.d-grant-a')).toBe(false)
  })

  test('runInDeterministicGrantOrder acquires every grant in sorted order regardless of input order', () => {
    const mutex = createGrantSendMutex()
    const order: string[] = []
    const mutexWithOrder = {
      tryAcquire: (grantKey: string): (() => void) | null => {
        order.push(grantKey)
        return mutex.tryAcquire(grantKey)
      },
      isHeld: (grantKey: string): boolean => mutex.isHeld(grantKey),
    }
    runInDeterministicGrantOrder(mutexWithOrder, ['v1.d-grant-c', 'v1.d-grant-a', 'v1.d-grant-b'], () => {
      expect(mutex.isHeld('v1.d-grant-a')).toBe(true)
      expect(mutex.isHeld('v1.d-grant-b')).toBe(true)
      expect(mutex.isHeld('v1.d-grant-c')).toBe(true)
    })
    expect(order).toEqual(['v1.d-grant-a', 'v1.d-grant-b', 'v1.d-grant-c'])
    expect(mutex.isHeld('v1.d-grant-a')).toBe(false)
  })
})
