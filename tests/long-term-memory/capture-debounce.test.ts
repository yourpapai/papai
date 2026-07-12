// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  armMemoryCapture,
  cancelPendingMemoryCaptures,
  type ArmCaptureDeps,
} from '../../src/long-term-memory/capture-debounce.js'
import type { RunMemoryCaptureInput } from '../../src/long-term-memory/capture.js'

const makeInput = (storageContextId = 'g:thread:a'): RunMemoryCaptureInput => ({
  storageContextId,
  configContextId: 'g',
  contextType: 'group',
  history: [],
})

describe('armMemoryCapture', () => {
  test('coalesces rapid arms into a single deferred capture', async () => {
    let captures = 0
    let capturedFn: (() => void) | undefined
    const deps: ArmCaptureDeps = {
      markActivity: (): void => undefined,
      runCapture: (): Promise<void> => {
        captures += 1
        return Promise.resolve()
      },
      schedule: (fn: () => void): ReturnType<typeof setTimeout> => {
        capturedFn = fn
        return setTimeout(() => undefined, 9_999_999)
      },
      clear: (timer: ReturnType<typeof setTimeout>): void => {
        clearTimeout(timer)
      },
      debounceMs: 600_000,
      now: (): string => '2026-06-16T00:00:00.000Z',
    }
    const input = makeInput()
    armMemoryCapture(input, deps)
    armMemoryCapture(input, deps)
    expect(captures).toBe(0)
    expect(capturedFn).toBeDefined()
    capturedFn!()
    await Promise.resolve()
    expect(captures).toBe(1)
  })

  test('cancels every pending capture and permits clean reuse', () => {
    let cleared = 0
    const deps: ArmCaptureDeps = {
      markActivity: (): void => undefined,
      runCapture: (): Promise<void> => Promise.resolve(),
      schedule: (): ReturnType<typeof setTimeout> => setTimeout(() => undefined, 9_999_999),
      clear: (timer): void => {
        clearTimeout(timer)
        cleared += 1
      },
      debounceMs: 600_000,
      now: (): string => '2026-06-16T00:00:00.000Z',
    }

    armMemoryCapture(makeInput('group-a'), deps)
    armMemoryCapture(makeInput('group-b'), deps)
    cancelPendingMemoryCaptures()
    cancelPendingMemoryCaptures()
    armMemoryCapture(makeInput('group-c'), deps)
    cancelPendingMemoryCaptures()

    expect(cleared).toBe(3)
  })
})
