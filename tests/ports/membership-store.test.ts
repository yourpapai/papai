// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createMembershipStorePort, type MembershipStore } from '../../src/ports/membership-store.js'

const EMPTY_BACKFILL = { total: 0, created: 0, exists: 0, skipped: 0, failed: 0 }

describe('MembershipStorePort', () => {
  test('no-ops safely when no store is registered', async () => {
    const port = createMembershipStorePort()
    expect(await port.ensureMember('g', 'u')).toBe('skipped')
    expect(() => port.markMemberInactive('g', 'u')).not.toThrow()
    expect(await port.runStartupBackfill()).toEqual(EMPTY_BACKFILL)
  })

  test('delegates to the registered store and injects the current label resolver', async () => {
    const port = createMembershipStorePort()
    const seen: Array<string | null> = []
    const store: MembershipStore = {
      ensureMember: async (_g, _c, _opts, resolveUserLabel) => {
        seen.push(await resolveUserLabel('u', 'g', 'pi'))
        return 'created'
      },
      markMemberInactive: () => {},
      runStartupBackfill: async (resolveUserLabel) => {
        seen.push(await resolveUserLabel('u', 'g', 'pi'))
        return EMPTY_BACKFILL
      },
    }
    port.register(store)
    expect(await port.ensureMember('g', 'u')).toBe('created')
    port.setUserLabelResolver(() => Promise.resolve('Alice'))
    await port.ensureMember('g', 'u')
    await port.runStartupBackfill()
    expect(seen).toEqual([null, 'Alice', 'Alice'])
  })
})
