// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { digestOf, isStableEdit, looksAnswered } from '../../../afk-runner/src/work/waiter-probe.js'

describe('waiter probe grammar', () => {
  it('digestOf is the sha256 of the content', () => {
    expect(digestOf('veto F99=drop it')).toHaveLength(64)
    expect(digestOf('a')).not.toBe(digestOf('b'))
  })

  it('isStableEdit demands three consecutive identical digests', () => {
    expect(isStableEdit(['a', 'a'])).toBe(false)
    expect(isStableEdit(['a', 'b', 'a'])).toBe(false)
    expect(isStableEdit(['a', 'a', 'a'])).toBe(true)
    expect(isStableEdit(['b', 'a', 'a', 'a'])).toBe(true)
  })

  it('looksAnswered trips on a checked box, a response section, or a decision directive', () => {
    expect(looksAnswered('## Early gate (cap hit)\n- [ ] A1 unchecked')).toBe(false)
    expect(looksAnswered('- [x] A1 checked')).toBe(true)
    expect(looksAnswered('## Gate response')).toBe(true)
    expect(looksAnswered('prose\nAPPROVE')).toBe(true)
    expect(looksAnswered('prose\nVETO: redo it')).toBe(true)
  })

  it('looksAnswered stays untripped by prose alone — the zero-signal shape (no widening)', () => {
    expect(looksAnswered('## Early gate (cap hit)\n\nlooks good to me\n')).toBe(false)
  })
})
