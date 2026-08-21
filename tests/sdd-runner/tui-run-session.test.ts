// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import type { EventInput } from '../../sdd-runner/src/events.js'
import { appendEvent, stampEvent } from '../../sdd-runner/src/events.js'
import { emptyRunFold, foldRunView } from '../../sdd-runner/src/run-view.js'
import { RunScreenTui } from '../../sdd-runner/src/tui-run-session.js'
import { createRunScreenSession } from '../../sdd-runner/src/tui-run-session.js'
import type { RunScreenSessionDeps } from '../../sdd-runner/src/tui-run-session.js'

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
