// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { truncateMiddle } from '../../../../client/settings/lib/truncate-middle.js'

describe('truncateMiddle', () => {
  test('keeps short values intact', () => {
    expect(truncateMiddle('short', 8, 8)).toBe('short')
  })
  test('middle-truncates long values with an ellipsis', () => {
    // 27-char id, head=6 ('psid0Y') + '…' + tail=6 ('nQshTg')
    expect(truncateMiddle('psid0YeZWdyYW0tZGVv2MnQshTg', 6, 6)).toBe('psid0Y…nQshTg')
  })
  test('uses default head/tail of 8', () => {
    const v = 'placeholder-4d1e563d-0190-aaaa-bbbb-cccccccccccc'
    const out = truncateMiddle(v)
    expect(out.startsWith('placehol')).toBe(true)
    expect(out.includes('…')).toBe(true)
    expect(out.endsWith('cccccccc')).toBe(true)
  })
})
