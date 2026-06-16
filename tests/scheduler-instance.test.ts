// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { scheduler } from '../src/scheduler-instance.js'

describe('scheduler-instance', () => {
  test('registers staged-files-purge task', () => {
    expect(scheduler.hasTask('staged-files-purge')).toBe(true)
  })

  test('registers memory-capture-sweep task', () => {
    expect(scheduler.hasTask('memory-capture-sweep')).toBe(true)
  })
})
