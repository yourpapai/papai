// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { slugifySessionId } from '../../sdd-runner/src/session-id.js'

describe('slugifySessionId', () => {
  it('lowercases and separates words with dashes', () => {
    expect(slugifySessionId('Fix Flaky Auth Test')).toBe('fix-flaky-auth-test')
  })

  it('collapses separator runs and trims edges', () => {
    expect(slugifySessionId('  fix -- flaky___auth!!test  ')).toBe('fix-flaky-auth-test')
  })

  it('clamps to 64 characters without a trailing dash', () => {
    const slug = slugifySessionId('a'.repeat(100) + '-tail')
    expect(slug.length).toBeLessThanOrEqual(64)
    expect(slug.endsWith('-')).toBe(false)
    expect(slug).toBe('a'.repeat(64))
  })

  it('strips unicode diacritics and non-ascii characters', () => {
    expect(slugifySessionId('café — résumé ünïcode')).toBe('cafe-resume-unicode')
    expect(slugifySessionId('日本語タスク')).toBe('')
  })

  it('keeps digits', () => {
    expect(slugifySessionId('release v2 rollout')).toBe('release-v2-rollout')
  })
})
