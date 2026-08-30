// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { createElement, useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { KeyFlags } from '../../sdd-runner/src/gate-session-state.js'
import { createKeyFeed } from '../../sdd-runner/src/tui-gate-session.js'
import type { KeyFeed } from '../../sdd-runner/src/tui-gate-session.js'
import { createWidthFeed, useTerminalWidth } from '../../sdd-runner/src/tui-width.js'
import type { WidthFeed } from '../../sdd-runner/src/tui-width.js'
import { FakeStdout, mountToStream, waitFor } from './stream-harness.js'

/**
 * tui-width (fancy-ui 4.x): `useTerminalWidth()` is a thin wrapper over
 * ink's stock `useWindowSize` (no hand-rolled resize subscription); the
 * `WidthFeed` seam drives scripted resizes by updating columns/rows on an
 * injected stdout and emitting `resize` there; components stay pure
 * functions of an injectable width prop; text-entry buffers survive a
 * mid-entry resize.
 */

function WidthProbe(): ReactElement {
  const width = useTerminalWidth()
  return createElement(Text, null, `width: ${String(width)}`)
}

function PropWidthProbe(props: { readonly width: number }): ReactElement {
  return createElement(Text, null, `width: ${String(props.width)}`)
}

function EntryProbe(props: { readonly keys?: KeyFeed }): ReactElement {
  const [buffer, setBuffer] = useState('')
  const [cursor, setCursor] = useState(0)
  const width = useTerminalWidth()
  const handle = useCallback((input: string, key: KeyFlags): void => {
    if (key.backspace || key.delete) {
      setBuffer((current) => current.slice(0, -1))
      setCursor((current) => Math.max(0, current - 1))
      return
    }
    if (input.length > 0) {
      setBuffer((current) => current + input)
      setCursor((current) => current + input.length)
    }
  }, [])
  useEffect(() => {
    if (props.keys === undefined) return undefined
    return props.keys.onKey(handle)
  }, [props.keys, handle])
  return createElement(Text, null, `w${String(width)} buf[${buffer}] cur${String(cursor)}`)
}

const PLAIN_KEY: KeyFlags = {
  upArrow: false,
  downArrow: false,
  return: false,
  escape: false,
  backspace: false,
  delete: false,
}

/** Pin COLUMNS/LINES so ink's non-TTY size fallback is deterministic; returns the restore. */
function pinTerminalEnv(columns: string, lines: string): () => void {
  const priorColumns = process.env['COLUMNS']
  const priorLines = process.env['LINES']
  process.env['COLUMNS'] = columns
  process.env['LINES'] = lines
  return (): void => {
    if (priorColumns === undefined) delete process.env['COLUMNS']
    else process.env['COLUMNS'] = priorColumns
    if (priorLines === undefined) delete process.env['LINES']
    else process.env['LINES'] = priorLines
  }
}

describe('useTerminalWidth (over ink stock useWindowSize)', () => {
  it('reads the injected stdout columns and follows WidthFeed resizes', async () => {
    const mount = mountToStream(createElement(WidthProbe))
    await waitFor(() => mount.streamText().includes('width: 100'))
    const feed: WidthFeed = createWidthFeed(mount.stdout)
    feed.resize(50, 24)
    await waitFor(() => mount.streamText().includes('width: 50'))
    feed.resize(120, 40)
    await waitFor(() => mount.streamText().includes('width: 120'))
    mount.unmount()
  })

  it('the width prop stays injectable beside the hook (fixed-100 fake stdout)', () => {
    const instance = render(createElement(PropWidthProbe, { width: 40 }))
    expect(instance.lastFrame()).toContain('width: 40')
    instance.unmount()
  })

  it('the hook reports the fake stdout\u2019s fixed 100 columns under ink-testing-library', () => {
    const restore = pinTerminalEnv('100', '24')
    try {
      const instance = render(createElement(WidthProbe))
      expect(instance.lastFrame()).toContain('width: 100')
      instance.unmount()
    } finally {
      restore()
    }
  })
})

describe('WidthFeed (scripted resize seam)', () => {
  it('updates columns and rows on the stdout and emits resize there', () => {
    const stdout = new FakeStdout()
    const resized: number[] = []
    stdout.on('resize', () => {
      resized.push(stdout.columns)
    })
    const feed = createWidthFeed(stdout)
    feed.resize(72, 30)
    expect(stdout.columns).toBe(72)
    expect(stdout.rows).toBe(30)
    expect(resized).toEqual([72])
    feed.resize(48, 20)
    expect(stdout.columns).toBe(48)
    expect(resized).toEqual([72, 48])
  })
})

describe('mid-entry resize preserves the text-entry buffer and cursor', () => {
  it('buffer and cursor survive the resize and typing continues into the same buffer', async () => {
    const keys = createKeyFeed()
    const mount = mountToStream(createElement(EntryProbe, { keys }))
    await waitFor(() => mount.streamText().includes('buf[] cur0'))
    keys.emit('a', PLAIN_KEY)
    keys.emit('b', PLAIN_KEY)
    await waitFor(() => mount.streamText().includes('buf[ab] cur2'))
    const stdout: FakeStdout = mount.stdout
    createWidthFeed(stdout).resize(50, 24)
    await waitFor(() => mount.streamText().includes('w50 buf[ab] cur2'))
    keys.emit('cd', PLAIN_KEY)
    await waitFor(() => mount.streamText().includes('w50 buf[abcd] cur4'))
    keys.emit('', { ...PLAIN_KEY, backspace: true })
    await waitFor(() => mount.streamText().includes('w50 buf[abc] cur3'))
    mount.unmount()
  })
})
