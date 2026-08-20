// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { bannerFor } from '../../../client/transcript/banner.js'
import type { ViewerStatus } from '../../../client/transcript/transcript.svelte.js'

const ALL: ViewerStatus[] = ['connecting', 'live', 'finished', 'recording-disabled', 'invalid-token', 'error']

describe('bannerFor', () => {
  test('connecting is informational with no dot', () => {
    expect(bannerFor('connecting')).toEqual({ label: 'Connecting…', tone: 'info', dot: false })
  })

  test('live is the only status carrying a dot', () => {
    expect(bannerFor('live')).toEqual({ label: 'Live', tone: 'accent', dot: true })
  })

  test('finished is neutral', () => {
    expect(bannerFor('finished')).toEqual({ label: 'Session finished', tone: 'neutral', dot: false })
  })

  test('recording-disabled warns that nothing is retained', () => {
    expect(bannerFor('recording-disabled')).toEqual({
      label: 'Live only — not retained',
      tone: 'warn',
      dot: false,
    })
  })

  test('invalid-token is the terminal failure and keeps danger', () => {
    expect(bannerFor('invalid-token')).toEqual({
      label: 'Link invalid or expired',
      tone: 'danger',
      dot: false,
    })
  })

  test('error is warn, not danger, because the stream reconnects on its own', () => {
    expect(bannerFor('error')).toEqual({ label: 'Reconnecting…', tone: 'warn', dot: false })
  })

  test('error and invalid-token do not share a tone', () => {
    expect(bannerFor('error').tone).not.toBe(bannerFor('invalid-token').tone)
  })

  test('no label embeds a status glyph — the Dot primitive owns that', () => {
    for (const status of ALL) expect(bannerFor(status).label).not.toContain('●')
  })

  test('exactly one status carries a dot', () => {
    expect(ALL.filter((s) => bannerFor(s).dot)).toEqual(['live'])
  })
})
