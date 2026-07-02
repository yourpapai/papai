// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { resolveMemberLabels } from '../../../src/debug/settings/member-labels.js'

describe('resolveMemberLabels', () => {
  test('uses the cache and never calls live for a cache hit', async () => {
    const live = mock(() => Promise.resolve<string | null>('LIVE'))
    const out = await resolveMemberLabels(['42'], new Map([['42', 'Cached Ann']]), live)
    expect(out.get('42')).toBe('Cached Ann')
    expect(live).not.toHaveBeenCalled()
  })

  test('falls back to the live resolver on a cache miss', async () => {
    const live = mock((id: string) => Promise.resolve<string | null>(`Live ${id}`))
    const out = await resolveMemberLabels(['42', '43'], new Map([['42', 'Cached']]), live)
    expect(out.get('42')).toBe('Cached')
    expect(out.get('43')).toBe('Live 43')
    expect(live).toHaveBeenCalledTimes(1)
  })

  test('yields null when the live resolver rejects (best-effort, no throw)', async () => {
    const live = mock(() => Promise.reject(new Error('platform down')))
    const out = await resolveMemberLabels(['99'], new Map(), live)
    expect(out.get('99')).toBeNull()
  })

  test('yields null when live resolves null', async () => {
    const live = mock(() => Promise.resolve<string | null>(null))
    const out = await resolveMemberLabels(['99'], new Map(), live)
    expect(out.get('99')).toBeNull()
  })
})
