// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseMattermostPermalink } from '../../../src/chat/mattermost/link-resolver.js'

describe('parseMattermostPermalink', () => {
  const base = 'https://mm.example.com'

  test('extracts post id from a permalink on the same host', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/pl/abc123', base)).toBe('abc123')
  })

  test('tolerates a trailing slash', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/pl/abc123/', base)).toBe('abc123')
  })

  test('rejects a link on a different host', () => {
    expect(parseMattermostPermalink('https://evil.example.com/eng/pl/abc123', base)).toBeNull()
  })

  test('rejects a non-permalink path', () => {
    expect(parseMattermostPermalink('https://mm.example.com/eng/channels/town-square', base)).toBeNull()
  })

  test('rejects a non-URL string', () => {
    expect(parseMattermostPermalink('not a url', base)).toBeNull()
  })
})
