// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { createKeyFeed } from '../../sdd-runner/src/tui-gate-session.js'
import type { KeyFeed } from '../../sdd-runner/src/tui-gate-session.js'
import { createScriptKeys, pumpScript } from '../../sdd-runner/src/tui-session-keys.js'

describe('createScriptKeys', () => {
  it('tokenizes arrow escapes as one key and singles as plain input', () => {
    const keys = createScriptKeys(`a\u001b[Bb\r`)
    expect(keys.next()).toEqual({
      input: 'a',
      key: { upArrow: false, downArrow: false, return: false, escape: false, backspace: false, delete: false },
    })
    const down = keys.next()
    expect(down?.input).toBe('\u001b[B')
    expect(down?.key.downArrow).toBe(true)
    expect(keys.next()?.input).toBe('b')
    expect(keys.next()?.key.return).toBe(true)
  })

  it('marks DEL as backspace so scripts can edit form text', () => {
    const keys = createScriptKeys('ab\x7f')
    keys.next()
    keys.next()
    const del = keys.next()
    expect(del?.input).toBe('\x7f')
    expect(del?.key.backspace).toBe(true)
  })

  it('is exhausted after the script ends and stays exhausted', () => {
    const keys = createScriptKeys('q')
    expect(keys.next()?.input).toBe('q')
    expect(keys.next()).toBeUndefined()
    expect(keys.next()).toBeUndefined()
  })
})

describe('pumpScript', () => {
  it('emits after subscription and stops once the consumer settles', async () => {
    const feed: KeyFeed = createKeyFeed()
    const seen: string[] = []
    let settledFlag = false
    feed.onKey((input) => {
      seen.push(input)
      settledFlag = seen.length >= 2
    })
    await pumpScript(feed, createScriptKeys('abcde'), (): boolean => settledFlag)
    expect(seen).toEqual(['a', 'b'])
  })
})
