// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Box, Static, Text } from 'ink'
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import type { ReactElement } from 'react'

import type { EventInput } from '../../sdd-runner/src/events.js'
import { appendEvent, stampEvent } from '../../sdd-runner/src/events.js'
import type { KeyFlags } from '../../sdd-runner/src/gate-session-state.js'
import { emptyRunFold, foldRunView } from '../../sdd-runner/src/run-view.js'
import type { RunFold } from '../../sdd-runner/src/run-view.js'
import { createKeyFeed } from '../../sdd-runner/src/tui-gate-session.js'
import type { KeyFeed } from '../../sdd-runner/src/tui-gate-session.js'
import { RunScreenTui } from '../../sdd-runner/src/tui-run-session.js'
import { createRunScreenSession } from '../../sdd-runner/src/tui-run-session.js'
import type { RunScreenSessionDeps } from '../../sdd-runner/src/tui-run-session.js'
import { countOccurrences, mountToStream, waitFor } from './stream-harness.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-runsession-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function e(seq: number, init: EventInput): EventInput {
  return stampEvent(init, seq, '2026-01-01T00:00:00.000Z')
}

function spawnEvent(seq: number, agent: string): EventInput {
  return e(seq, { altitude: 'L1', type: 'spawned', agent, role: agent, model: 'glm' })
}

interface DepsSpy {
  readonly deps: RunScreenSessionDeps
  readonly calmStops: number
  readonly exitCodes: number[]
}

function makeDeps(logPath: string, keyScript?: string): DepsSpy {
  const state = { calmStops: 0, exitCodes: [] as number[] }
  const deps: RunScreenSessionDeps = {
    logPath,
    requestCalmStop: (): void => {
      state.calmStops += 1
    },
    hardExit: (code): void => {
      state.exitCodes.push(code)
    },
    ...(keyScript === undefined ? {} : { keyScript }),
  }
  return {
    deps,
    get calmStops() {
      return state.calmStops
    },
    exitCodes: state.exitCodes,
  }
}

describe('run-screen session skeleton (4.1 through the session)', () => {
  it('folds live events into the snapshot and unmounts cleanly', () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    fs.writeFileSync(logPath, '')
    const spy = makeDeps(logPath, '')
    const session = createRunScreenSession(spy.deps)
    try {
      session.onEvent(e(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
      session.onEvent(spawnEvent(2, 'reviewer-r1'))
      session.onEvent(e(3, { altitude: 'L0', type: 'tool_use', agent: 'reviewer-r1', tool: 'search', arg: 'scope' }))
      const bag = session.snapshot()
      expect(bag.state.stages['review']).toBe('active')
      expect(bag.slots.map((slot) => slot.agent)).toEqual(['reviewer-r1'])
      expect(bag.slots[0]?.label).toContain('search')
    } finally {
      expect(() => session.unmount()).not.toThrow()
    }
  })

  it('renders the stop affordance and tool call in the frame (component level)', () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, e(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(bag, spawnEvent(2, 'reviewer-r1'))
    bag = foldRunView(
      bag,
      e(3, { altitude: 'L0', type: 'tool_use', agent: 'reviewer-r1', tool: 'search', arg: 'scope' }),
    )
    const instance = render(
      createElement(RunScreenTui, {
        bag,
        width: 100,
        startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
        now: Date.parse('2026-01-01T00:01:00.000Z'),
        onRequestCalmStop: () => undefined,
        onHardExit: () => undefined,
      }),
    )
    const frame = instance.lastFrame()
    expect(frame).toContain('review')
    expect(frame).toContain('reviewer-r1')
    expect(frame).toContain('search scope')
    expect(frame).toContain('q to stop')
    instance.unmount()
  })
})

describe('run-screen restore seeding (4.7)', () => {
  it('rebuilds the fold from the event log alone before any live event', () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    appendEvent(logPath, e(1, { altitude: 'L2', type: 'stage_enter', stage: 'draft' }))
    appendEvent(logPath, spawnEvent(2, 'drafter-proposal'))
    const spy = makeDeps(logPath, '')
    const session = createRunScreenSession(spy.deps)
    try {
      const bag = session.snapshot()
      expect(bag.state.stages['draft']).toBe('active')
      expect(bag.slots.map((slot) => slot.agent)).toEqual(['drafter-proposal'])
    } finally {
      session.unmount()
    }
  })

  it('seeds an empty fold when the run has no event log yet', () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    const spy = makeDeps(logPath, '')
    const session = createRunScreenSession(spy.deps)
    try {
      expect(session.snapshot().slots).toEqual([])
    } finally {
      session.unmount()
    }
  })
})

describe('run-screen stop keys (4.6)', () => {
  it('q requests a calm stop through the injected seam', async () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    fs.writeFileSync(logPath, '')
    const spy = makeDeps(logPath, 'q')
    const session = createRunScreenSession(spy.deps)
    await session.whenArmed
    session.unmount()
    expect(spy.calmStops).toBe(1)
    expect(spy.exitCodes).toEqual([])
  })

  it('first Ctrl-C requests a calm stop; a second exits 130', async () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    fs.writeFileSync(logPath, '')
    const spy = makeDeps(logPath, '\u0003\u0003')
    const session = createRunScreenSession(spy.deps)
    await session.whenArmed
    session.unmount()
    expect(spy.calmStops).toBe(1)
    expect(spy.exitCodes).toEqual([130])
  })

  it('ordinary keys are ignored', async () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    fs.writeFileSync(logPath, '')
    const spy = makeDeps(logPath, 'xj1')
    const session = createRunScreenSession(spy.deps)
    await session.whenArmed
    session.unmount()
    expect(spy.calmStops).toBe(0)
    expect(spy.exitCodes).toEqual([])
  })
})

describe('factory-identity pin (1.4: rerenders never remount the mounted tree)', () => {
  const ROWS = ['h-row-1', 'h-row-2', 'h-row-3'] as const
  const START = Date.parse('2026-01-01T00:00:00.000Z')
  const NOW = Date.parse('2026-01-01T00:01:00.000Z')

  function streamHarness(rows: readonly string[], bag: RunFold): ReactElement {
    return createElement(
      Box,
      { flexDirection: 'column' },
      createElement(Static, {
        items: [...rows],
        children: (row: unknown): ReactElement => createElement(Text, { key: String(row) }, String(row)),
      }),
      createElement(RunScreenTui, {
        bag,
        width: 100,
        startedAt: START,
        now: NOW,
        onRequestCalmStop: () => undefined,
        onHardExit: () => undefined,
      }),
    )
  }

  it('a toy Static sibling emits each row exactly once while the live region keeps updating', async () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, e(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    const mount = mountToStream(streamHarness([ROWS[0]], bag))
    await waitFor(() => mount.streamText().includes(ROWS[0]))
    bag = foldRunView(bag, spawnEvent(2, 'reviewer-r1'))
    mount.rerender(streamHarness([ROWS[0], ROWS[1]], bag))
    await waitFor(() => mount.streamText().includes(ROWS[1]))
    bag = foldRunView(bag, spawnEvent(3, 'fixer-r1'))
    mount.rerender(streamHarness([...ROWS], bag))
    await waitFor(() => mount.streamText().includes(ROWS[2]))
    mount.rerender(streamHarness([...ROWS], bag))
    await mount.waitUntilRenderFlush()
    const text = mount.streamText()
    mount.unmount()
    for (const row of ROWS) {
      expect(countOccurrences(text, row)).toBe(1)
    }
    expect(text).toContain('reviewer-r1')
    expect(text).toContain('fixer-r1')
  })
})

function stackedFrame(frame: string): boolean {
  return frame.includes('╭─ Findings') && !frame.includes('╮╭─ Burndown')
}

describe('running screen chrome (6.2: footer + help overlay + width reflow)', () => {
  const PLAIN: KeyFlags = {
    upArrow: false,
    downArrow: false,
    return: false,
    escape: false,
    backspace: false,
    delete: false,
  }

  async function mountedRunScreen(bag: RunFold): Promise<{
    readonly mount: ReturnType<typeof mountToStream>
    readonly keys: KeyFeed
  }> {
    const keys = createKeyFeed()
    const mount = mountToStream(
      createElement(RunScreenTui, {
        bag,
        startedAt: 0,
        now: 60_000,
        onRequestCalmStop: () => undefined,
        onHardExit: () => undefined,
        keys,
      }),
    )
    await keys.whenSubscribed
    await mount.waitUntilRenderFlush()
    return { mount, keys }
  }

  it('renders the persistent footer beside the status line', async () => {
    const { mount } = await mountedRunScreen(emptyRunFold())
    try {
      expect(mount.streamText()).toContain('(q) · (Ctrl-C ×2) · (?) help')
      expect(mount.streamText()).toContain('q to stop')
    } finally {
      mount.unmount()
    }
  })

  it('? opens the overlay; while open q and Ctrl-C are swallowed; after dismissal q stops calmly', async () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    fs.writeFileSync(logPath, '')
    const spy = makeDeps(logPath)
    const calmKeys = createKeyFeed()
    const calmMount = mountToStream(
      createElement(RunScreenTui, {
        bag: emptyRunFold(),
        startedAt: 0,
        now: 0,
        onRequestCalmStop: spy.deps.requestCalmStop,
        onHardExit: (): void => {
          spy.deps.hardExit(130)
        },
        keys: calmKeys,
      }),
    )
    try {
      await calmKeys.whenSubscribed
      calmKeys.emit('?', PLAIN)
      await waitFor(() => calmMount.streamText().includes('Keys · running'))
      calmKeys.emit('q', PLAIN)
      calmKeys.emit('\u0003', PLAIN)
      await calmMount.waitUntilRenderFlush()
      expect(spy.calmStops).toBe(0)
      expect(spy.exitCodes).toEqual([])
      expect(calmMount.streamText()).toContain('Keys · running')
      calmKeys.emit('?', PLAIN)
      await calmMount.waitUntilRenderFlush()
      calmKeys.emit('q', PLAIN)
      await waitFor(() => spy.calmStops === 1)
      expect(spy.exitCodes).toEqual([])
    } finally {
      calmMount.unmount()
    }
  })

  it('narrow→stack→rejoin reflow without losing content', async () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, e(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    bag = foldRunView(
      bag,
      e(2, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'BLOCKER' }),
    )
    bag = foldRunView(
      bag,
      e(3, {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 0 },
      }),
    )
    const { mount } = await mountedRunScreen(bag)
    try {
      await waitFor(() => mount.lastFrame().includes('╮╭─ Burndown'))
      mount.stdout.resizeTo(48, 24)
      await waitFor(() => stackedFrame(mount.lastFrame()))
      mount.stdout.resizeTo(100, 24)
      await waitFor(() => mount.lastFrame().includes('╮╭─ Burndown'))
      expect(mount.lastFrame()).toContain('round 1: 1b 0m 0n')
      expect(mount.lastFrame()).toContain('BLOCKER')
      expect(mount.lastFrame()).toContain('F1 r1')
    } finally {
      mount.unmount()
    }
  })
})
