// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { harnessLiveView, registerTitleIfTty } from '../../sdd-runner/src/harness-view.js'
import type { LiveViewWiring } from '../../sdd-runner/src/live-view.js'
import { TERMINAL_TITLE_RESTORE } from '../../sdd-runner/src/terminal-title.js'
import { waitFor } from './stream-harness.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-harness-view-'))
  tmpDirs.push(dir)
  return dir
}

/**
 * Records the exit code, then throws the interception sentinel — the exit
 * must not actually happen. With the teardown hook wired, no listener exits;
 * if the glue reverts to the bare exit, the sentinel fails the test instead
 * of killing the worker.
 */
function recordExitInto(exits: unknown[]): (code: string | number | null | undefined) => never {
  return (code) => {
    exits.push(code)
    throw new Error(`intercepted process.exit(${String(code)})`)
  }
}

/** Narrows the wiring union without a conditional in the test body. */
function tuiWiringOf(wiring: LiveViewWiring): Extract<LiveViewWiring, { mode: 'tui' }> {
  if (wiring.mode !== 'tui') throw new Error('expected the fake TTY streams to pick the tui mode')
  return wiring
}

/** Poll condition for either exit surface (module-level: keeps the `||` out of test bodies). */
function exitedEither(teardownExits: number[], bareExits: unknown[]): () => boolean {
  return (): boolean => teardownExits.length >= 1 || bareExits.length >= 1
}

describe('registerTitleIfTty', () => {
  it('hands a TTY interrupt to the teardown hook and restores the title', () => {
    const codes: number[] = []
    const written: string[] = []
    const exits: unknown[] = []
    const spy = spyOn(process, 'exit').mockImplementation(recordExitInto(exits))
    const handle = registerTitleIfTty(
      {
        isTTY: true,
        write: (chunk: string): boolean => {
          written.push(chunk)
          return true
        },
      },
      (code: number): void => {
        codes.push(code)
      },
    )
    try {
      expect(() => process.emit('SIGINT')).not.toThrow()
      expect(codes).toContain(130)
      expect(written).toContain(TERMINAL_TITLE_RESTORE)
    } finally {
      handle?.dispose()
      spy.mockRestore()
    }
  })

  it('registers nothing off a TTY', () => {
    const before = process.listenerCount('SIGINT')
    const handle = registerTitleIfTty({ isTTY: false, write: (): boolean => true }, (): void => undefined)
    expect(handle).toBeUndefined()
    expect(process.listenerCount('SIGINT')).toBe(before)
  })
})

describe('harnessLiveView hard exit (claude gate D3 teardown)', () => {
  it("the run screen's second Ctrl-C reaches the injected teardown, not a bare exit", async () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    fs.writeFileSync(logPath, '')
    const teardownExits: number[] = []
    const bareExits: unknown[] = []
    const spy = spyOn(process, 'exit').mockImplementation(recordExitInto(bareExits))
    const wiring = tuiWiringOf(
      harnessLiveView(
        (): void => undefined,
        (code: number): void => {
          teardownExits.push(code)
        },
        { streams: { stdout: { isTTY: true }, stdin: { isTTY: true } }, env: {}, keyScript: '\u0003\u0003' },
      ),
    )
    try {
      wiring.mountRunScreen({ runDir: dir, logPath })
      await waitFor(exitedEither(teardownExits, bareExits))
      expect(teardownExits).toEqual([130])
      expect(bareExits).toEqual([])
    } finally {
      spy.mockRestore()
      wiring.unmountRunScreen()
    }
  })
})
