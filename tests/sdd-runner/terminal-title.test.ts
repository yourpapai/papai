// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { TERMINAL_TITLE_RESTORE, registerTerminalTitle, terminalTitleFor } from '../../sdd-runner/src/terminal-title.js'
import type { TerminalTitleHandle } from '../../sdd-runner/src/terminal-title.js'

// Every registration installs process-global listeners; without disposal they
// outlive this file and convert any later SIGTERM to the bun test process
// into process.exit(143) — the exact failure mode that killed CI's Checks
// job after this suite ran.
const handles: TerminalTitleHandle[] = []

/** Records the exit code, then throws the interception sentinel — the exit must not actually happen. */
function recordExitInto(exits: unknown[]): (code: string | number | null | undefined) => never {
  return (code) => {
    exits.push(code)
    throw new Error(`intercepted process.exit(${String(code)})`)
  }
}

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

  it('an interrupt hook replaces the bare exit and receives the signal code', () => {
    const codes: number[] = []
    const written: string[] = []
    const handle = registerTerminalTitle(
      (chunk: string): void => {
        written.push(chunk)
      },
      (): string => TERMINAL_TITLE_RESTORE,
      (code: number): void => {
        codes.push(code)
      },
    )
    handles.push(handle)
    // With the hook in place nothing exits — if the hook were ignored, the
    // bare default exit would throw its interception sentinel right here.
    expect(() => process.emit('SIGINT')).not.toThrow()
    expect(() => process.emit('SIGTERM')).not.toThrow()
    expect(codes).toEqual([130, 143])
    expect(written).toEqual([TERMINAL_TITLE_RESTORE, TERMINAL_TITLE_RESTORE])
  })

  it('without a hook the interrupt handlers still exit with the signal codes', () => {
    const exits: unknown[] = []
    const spy = spyOn(process, 'exit').mockImplementation(recordExitInto(exits))
    const handle = registerTerminalTitle(
      (): void => undefined,
      (): string => TERMINAL_TITLE_RESTORE,
    )
    handles.push(handle)
    try {
      expect(() => process.emit('SIGINT')).toThrow('intercepted process.exit(130)')
      expect(() => process.emit('SIGTERM')).toThrow('intercepted process.exit(143)')
      expect(exits).toEqual([130, 143])
    } finally {
      spy.mockRestore()
    }
  })
})
