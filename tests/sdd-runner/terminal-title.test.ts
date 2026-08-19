// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'

import { TERMINAL_TITLE_RESTORE, registerTerminalTitle, terminalTitleFor } from '../../sdd-runner/src/terminal-title.js'
import type { TerminalTitleHandle } from '../../sdd-runner/src/terminal-title.js'

// Every registration installs process-global listeners; without disposal they
// outlive this file and convert any later SIGTERM to the bun test process
// into process.exit(143) — the exact failure mode that killed CI's Checks
// job after this suite ran.
const handles: TerminalTitleHandle[] = []

afterEach(() => {
  while (handles.length > 0) {
    handles.pop()?.dispose()
  }
})

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
    handles.push(handle)
    handle.restore()
    expect(written[written.length - 1]).toBe(TERMINAL_TITLE_RESTORE)
  })

  it('dispose removes the registered exit and signal listeners', () => {
    const before = {
      exit: process.listenerCount('exit'),
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
    }
    const handle = registerTerminalTitle(
      () => undefined,
      () => TERMINAL_TITLE_RESTORE,
    )
    handles.push(handle)
    expect(process.listenerCount('exit')).toBe(before.exit + 1)
    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT + 1)
    expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM + 1)
    handle.dispose()
    expect(process.listenerCount('exit')).toBe(before.exit)
    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT)
    expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM)
  })
})
