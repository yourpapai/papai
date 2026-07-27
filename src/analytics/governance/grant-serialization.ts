// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:governance:grant-serialization' })

export class GrantMutexHeldError extends Error {
  constructor(grantKey: string) {
    super(`delivery grant mutex already held for key ${grantKey}`)
    this.name = 'GrantMutexHeldError'
  }
}

export type GrantSendMutex = Readonly<{
  tryAcquire: (grantKey: string) => (() => void) | null
  isHeld: (grantKey: string) => boolean
  release: (grantKey: string) => boolean
  heldCount?: () => number
}>

/**
 * Per-grant keyed mutex. The delivery send path holds the mutex keyed by the
 * delivery row's exact grant key from the final grant recheck in the same
 * transaction as `leased → sending` through acknowledgement classification, so
 * a withdrawal racing an in-flight send can rely on settlement completing
 * before rows are removed.
 */
export const createGrantSendMutex = (): GrantSendMutex => {
  const held = new Set<string>()
  return {
    tryAcquire: (grantKey) => {
      if (held.has(grantKey)) return null
      held.add(grantKey)
      return () => {
        held.delete(grantKey)
      }
    },
    isHeld: (grantKey) => held.has(grantKey),
    release: (grantKey) => held.delete(grantKey),
    heldCount: () => held.size,
  }
}

export const withGrantSendLock = <T>(mutex: GrantSendMutex, grantKey: string, fn: () => T): T => {
  const release = mutex.tryAcquire(grantKey)
  if (release === null) {
    log.warn('grant send mutex contention')
    throw new GrantMutexHeldError(grantKey)
  }
  try {
    return fn()
  } finally {
    release()
  }
}

/**
 * Acquires every named grant in sorted key order (the deterministic order the
 * withdrawal workflow uses across the collection-ref and delivery-grant
 * serialization domains), runs `fn`, then releases in reverse order.
 */
export const runInDeterministicGrantOrder = <T>(
  mutex: GrantSendMutex,
  grantKeys: readonly string[],
  fn: () => T,
): T => {
  const sorted = [...new Set(grantKeys)].sort()
  const releases: (() => void)[] = []
  try {
    for (const grantKey of sorted) {
      const release = mutex.tryAcquire(grantKey)
      if (release === null) {
        log.warn('grant send mutex contention during ordered acquisition')
        throw new GrantMutexHeldError(grantKey)
      }
      releases.push(release)
    }
    return fn()
  } finally {
    for (const release of releases.reverse()) release()
  }
}
