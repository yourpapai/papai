// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { armMemoryCapture, type ArmCaptureDeps } from '../../src/long-term-memory/capture-debounce.js'
import type { RunMemoryCaptureInput } from '../../src/long-term-memory/capture.js'

const groupInput = (actorRole: 'guest' | 'member' | undefined): RunMemoryCaptureInput => ({
  storageContextId: 'g1:thread-1',
  configContextId: 'g1',
  contextType: 'group',
  history: [{ role: 'user', content: 'remember my office is in Berlin' }],
  actorRole,
})

const makeDeps = (onSchedule: () => void): ArmCaptureDeps => ({
  markActivity: (): void => undefined,
  runCapture: (): Promise<void> => Promise.resolve(),
  schedule: (fn: () => void): ReturnType<typeof setTimeout> => {
    onSchedule()
    return setTimeout(fn, 9_999_999)
  },
  clear: (timer: ReturnType<typeof setTimeout>): void => {
    clearTimeout(timer)
  },
  debounceMs: 600_000,
  now: (): string => '2026-06-19T00:00:00.000Z',
})

describe('guest memory capture exclusion', () => {
  test('armMemoryCapture does not schedule for a guest turn', () => {
    let scheduled = false
    armMemoryCapture(
      groupInput('guest'),
      makeDeps(() => {
        scheduled = true
      }),
    )
    expect(scheduled).toBe(false)
  })

  test('armMemoryCapture schedules for a member turn', () => {
    let scheduled = false
    armMemoryCapture(
      groupInput('member'),
      makeDeps(() => {
        scheduled = true
      }),
    )
    expect(scheduled).toBe(true)
  })
})
