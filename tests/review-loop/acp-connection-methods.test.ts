// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createWaitForSessionUpdatesMethod } from '../../review-loop/src/acp-connection-methods.js'

describe('createWaitForSessionUpdatesMethod', () => {
  test('returns a function that resolves immediately when no updates are pending', async () => {
    const pendingUpdates = new Set<Promise<void>>()
    const waitForUpdates = createWaitForSessionUpdatesMethod(pendingUpdates)
    await expect(waitForUpdates()).resolves.toBeUndefined()
  })

  test('returns a function that resolves after all pending updates settle', async () => {
    const pendingUpdates = new Set<Promise<void>>()
    let resolve!: () => void
    const pending = new Promise<void>((res) => {
      resolve = res
    })
    pendingUpdates.add(pending)
    const waitForUpdates = createWaitForSessionUpdatesMethod(pendingUpdates)

    const waitPromise = waitForUpdates()
    // Remove from set before resolving (mimics the real runtime behaviour)
    pendingUpdates.delete(pending)
    resolve()
    await expect(waitPromise).resolves.toBeUndefined()
  })
})
