// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { TERMINAL_TITLE_RESTORE, registerTerminalTitle, terminalTitleFor } from '../../sdd-runner/src/terminal-title.js'

describe('terminalTitleFor (13.6)', () => {
  it('builds the set sequence', () => {
    expect(terminalTitleFor('add-thing', 'review')).toBe('\x1b]0;sdd add-thing · review\x07')
  })

  it('exposes a fixed default restore string', () => {
    expect(TERMINAL_TITLE_RESTORE.length).toBeGreaterThan(0)
  })

  it('registerTerminalTitle restores via the handle (best-effort)', () => {
    const written: string[] = []
    const handle = registerTerminalTitle(
      (chunk: string) => {
        written.push(chunk)
      },
      () => TERMINAL_TITLE_RESTORE,
    )
    handle.restore()
    expect(written[written.length - 1]).toBe(TERMINAL_TITLE_RESTORE)
  })
})
