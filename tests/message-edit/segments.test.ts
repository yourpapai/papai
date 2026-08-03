// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { formatMessageSegment, rebuildCoalescedText } from '../../src/message-edit/segments.js'

describe('formatMessageSegment', () => {
  it('prefixes group thread with @username', () => {
    expect(formatMessageSegment('hi', 'alice', true)).toBe('[@alice]: hi')
  })
  it('no prefix when username null', () => {
    expect(formatMessageSegment('hi', null, true)).toBe('hi')
  })
  it('no prefix in DM', () => {
    expect(formatMessageSegment('hi', 'alice', false)).toBe('hi')
  })
})

describe('rebuildCoalescedText', () => {
  const segments = [
    { messageId: 'm1', text: 'hi', username: 'alice' as const },
    { messageId: 'm2', text: 'there', username: 'alice' as const },
  ]
  it('joins DM with double newline', () => {
    expect(rebuildCoalescedText(segments, { isThread: false, isDm: true })).toBe('hi\n\nthere')
  })
  it('joins group thread with single newline + prefix', () => {
    expect(rebuildCoalescedText(segments, { isThread: true, isDm: false })).toBe('[@alice]: hi\n[@alice]: there')
  })
  it('returns empty string for empty segments', () => {
    expect(rebuildCoalescedText([], { isThread: false, isDm: true })).toBe('')
  })
  it('group main (non-thread, non-dm) joins single newline without prefix', () => {
    expect(rebuildCoalescedText(segments, { isThread: false, isDm: false })).toBe('hi\nthere')
  })
})
