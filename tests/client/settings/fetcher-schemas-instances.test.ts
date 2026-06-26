// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ApplyInstancesResultSchema } from '../../../client/settings/fetcher-schemas-instances.js'

describe('ApplyInstancesResultSchema', () => {
  test('parses a minimal apply result with all required fields', () => {
    const parsed = ApplyInstancesResultSchema.parse({
      applied: 2,
      started: ['a'],
      stopped: [],
      removed: [],
      removedDetails: [],
      recreated: [],
      unchanged: ['b'],
      failed: [],
      unreadable: [],
    })
    expect(parsed.applied).toBe(2)
    expect(parsed.started).toEqual(['a'])
    expect(parsed.unchanged).toEqual(['b'])
    expect(parsed.failed).toEqual([])
  })

  test('defaults removedDetails and unreadable when absent', () => {
    const parsed = ApplyInstancesResultSchema.parse({
      applied: 0,
      started: [],
      stopped: [],
      removed: [],
      recreated: [],
      unchanged: [],
      failed: [],
    })
    expect(parsed.removedDetails).toEqual([])
    expect(parsed.unreadable).toEqual([])
  })

  test('parses failed entries with remove/recreate/start actions', () => {
    const parsed = ApplyInstancesResultSchema.parse({
      applied: 1,
      started: [],
      stopped: [],
      removed: [],
      removedDetails: [],
      recreated: [],
      unchanged: [],
      failed: [{ id: 'x', action: 'start', error: 'boom' }],
      unreadable: [],
    })
    expect(parsed.failed[0]).toMatchObject({ id: 'x', action: 'start', error: 'boom' })
  })

  test('rejects unknown action values in failed entries', () => {
    expect(
      ApplyInstancesResultSchema.safeParse({
        applied: 0,
        started: [],
        stopped: [],
        removed: [],
        recreated: [],
        unchanged: [],
        failed: [{ id: 'x', action: 'unknown', error: 'bad' }],
      }).success,
    ).toBe(false)
  })
})
