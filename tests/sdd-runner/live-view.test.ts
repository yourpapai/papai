// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { EventInput } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import { wireLiveView } from '../../sdd-runner/src/live-view.js'
import type { LiveViewWiring, RunScreenContext, RunScreenSessionLike } from '../../sdd-runner/src/live-view.js'

const TTY = { stdout: { isTTY: true }, stdin: { isTTY: true } }
const PIPE = { stdout: { isTTY: false }, stdin: { isTTY: false } }

function event(seq: number): EventInput {
  return stampEvent({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, seq, '2026-01-01T00:00:00.000Z')
}

function fakeSession(): RunScreenSessionLike & { events: EventInput[]; unmounted: () => boolean } {
  const events: EventInput[] = []
  let unmounted = false
  return {
    onEvent: (e): void => {
      events.push(e)
    },
    unmount: (): void => {
      unmounted = true
    },
    events,
    unmounted: (): boolean => unmounted,
  }
}

type TuiWiring = Extract<LiveViewWiring, { mode: 'tui' }>
type LineWiring = Extract<LiveViewWiring, { mode: 'line' | 'line-debug' }>

function asTui(wiring: LiveViewWiring): TuiWiring | null {
  return wiring.mode === 'tui' ? wiring : null
}

function asLine(wiring: LiveViewWiring): LineWiring | null {
  return wiring.mode === 'tui' ? null : wiring
}

describe('wireLiveView', () => {
  it('selects the TUI wiring on an interactive terminal and mounts one lazily', () => {
    const created: RunScreenContext[] = []
    const sessions: ReturnType<typeof fakeSession>[] = []
    const wiring = wireLiveView(
      TTY,
      {},
      () => undefined,
      (ctx) => {
        created.push(ctx)
        const session = fakeSession()
        sessions.push(session)
        return session
      },
    )
    expect(wiring.mode).toBe('tui')
    const tui = asTui(wiring)
    expect(tui).not.toBeNull()
    expect(created).toEqual([])
    tui?.mountRunScreen({ runDir: '/runs/r1', logPath: '/runs/r1/events.ndjson' })
    expect(created).toEqual([{ runDir: '/runs/r1', logPath: '/runs/r1/events.ndjson' }])
    const e = event(1)
    tui?.liveEvents(e)
    expect(sessions[0]?.events).toEqual([e])
    tui?.unmountRunScreen()
    expect(sessions[0]?.unmounted()).toBe(true)
    tui?.liveEvents(event(2))
    expect(sessions[0]?.events).toHaveLength(1)
    tui?.mountRunScreen({ runDir: '/runs/r2', logPath: '/runs/r2/events.ndjson' })
    expect(created).toHaveLength(2)
  })

  it('keeps the outermost session mounted across a nested mount/unmount pair', () => {
    const created: RunScreenContext[] = []
    const sessions: ReturnType<typeof fakeSession>[] = []
    const wiring = wireLiveView(
      TTY,
      {},
      () => undefined,
      (ctx) => {
        created.push(ctx)
        const session = fakeSession()
        sessions.push(session)
        return session
      },
    )
    const tui = asTui(wiring)
    const parent = { runDir: '/runs/parent', logPath: '/runs/parent/events.ndjson' }
    const child = { runDir: '/runs/child', logPath: '/runs/child/events.ndjson' }
    tui?.mountRunScreen(parent)
    tui?.mountRunScreen(child)
    expect(created).toEqual([parent])
    tui?.unmountRunScreen()
    expect(sessions[0]?.unmounted()).toBe(false)
    const e = event(1)
    tui?.liveEvents(e)
    expect(sessions[0]?.events).toEqual([e])
    tui?.unmountRunScreen()
    expect(sessions[0]?.unmounted()).toBe(true)
    tui?.liveEvents(event(2))
    expect(sessions[0]?.events).toHaveLength(1)
    expect(() => tui?.unmountRunScreen()).not.toThrow()
  })

  it('keeps the line renderer on a pipe with no session surface', () => {
    const lineRender = (): void => undefined
    const wiring = wireLiveView(PIPE, {}, lineRender, () => fakeSession())
    expect(wiring.mode).toBe('line')
    const line = asLine(wiring)
    expect(line).not.toBeNull()
    expect(line?.render).toBe(lineRender)
  })

  it('CI and dumb terminals stay on the line renderer too', () => {
    const lineRender = (): void => undefined
    for (const env of [{ CI: '1' }, { TERM: 'dumb' }]) {
      const wiring = wireLiveView(TTY, env, lineRender, () => fakeSession())
      const line = asLine(wiring)
      expect(line).not.toBeNull()
      expect(line?.render).toBe(lineRender)
    }
  })

  it('SDD_DEBUG raises the line mode label without switching to the TUI', () => {
    const wiring = wireLiveView(
      PIPE,
      { SDD_DEBUG: '1' },
      () => undefined,
      () => fakeSession(),
    )
    expect(wiring.mode).toBe('line-debug')
  })
})
