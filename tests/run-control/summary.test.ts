// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildStopSummary } from '../../src/run-control/summary.js'

describe('buildStopSummary', () => {
  test('graceful stop with no effects', () => {
    const s = buildStopSummary([], { forced: false })
    expect(s).toBe('🛑 Stopped. No actions had been taken yet.')
  })

  test('graceful stop lists effects with counts', () => {
    const s = buildStopSummary(
      [{ toolName: 'update_task' }, { toolName: 'update_task' }, { toolName: 'add_comment' }],
      {
        forced: false,
      },
    )
    expect(s).toBe('🛑 Stopped. Completed 3 actions: update_task ×2, add_comment.')
  })

  test('forced stop warns about an in-flight action', () => {
    const s = buildStopSummary([{ toolName: 'update_task' }], { forced: true })
    expect(s).toBe(
      '🛑 Stopped immediately. Completed 1 action: update_task. An in-flight action may have been cut off — verify recent changes.',
    )
  })

  test('forced stop with no recorded effects still warns', () => {
    const s = buildStopSummary([], { forced: true })
    expect(s).toBe('🛑 Stopped immediately. An in-flight action may have been cut off — verify recent changes.')
  })
})
