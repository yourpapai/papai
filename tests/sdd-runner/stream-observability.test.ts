// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { createElement } from 'react'
import type { ReactElement } from 'react'

import type { EventInput } from '../../sdd-runner/src/events.js'
import { stampEvent } from '../../sdd-runner/src/events.js'
import { emptyRunFold, foldRunView } from '../../sdd-runner/src/run-view.js'
import type { RunFold } from '../../sdd-runner/src/run-view.js'
import { RunScreenTui } from '../../sdd-runner/src/tui-run-session.js'
import { countOccurrences, mountToStream, toyStaticScreen, waitFor } from './stream-harness.js'

/**
 * Walking skeleton (fancy-ui 1.1): prove the write-stream harness can see
 * what ink-testing-library frames cannot — that a `Static` region emits each
 * row exactly once when the component identity is stable across rerenders,
 * and re-emits rows when a per-render factory remounts the tree every
 * frame. Every later Static/live-split assertion (1.4, 7.5) rides on this
 * proof.
 */

interface ToyProps {
  readonly items: readonly string[]
}

const StableToy = toyStaticScreen()

function RemountHarness(props: ToyProps): ReactElement {
  const Toy = toyStaticScreen()
  return createElement(Toy, { items: props.items })
}

function StableHarness(props: ToyProps): ReactElement {
  return createElement(StableToy, { items: props.items })
}

const ROWS = ['alpha-row', 'beta-row', 'gamma-row'] as const

async function driveGrowingRerenders(harness: (props: ToyProps) => ReactElement): Promise<string> {
  const mount = mountToStream(createElement(harness, { items: [ROWS[0]] }))
  await waitFor(() => mount.streamText().includes(ROWS[0]))
  mount.rerender(createElement(harness, { items: [ROWS[0], ROWS[1]] }))
  await waitFor(() => mount.streamText().includes(ROWS[1]))
  mount.rerender(createElement(harness, { items: [...ROWS] }))
  await waitFor(() => mount.streamText().includes(ROWS[2]))
  mount.rerender(createElement(harness, { items: [...ROWS] }))
  await mount.waitUntilRenderFlush()
  const text = mount.streamText()
  mount.unmount()
  return text
}

describe('stream observability harness (1.1)', () => {
  it('a stable-identity component emits each Static row exactly once across rerenders', async () => {
    const text = await driveGrowingRerenders(StableHarness)
    for (const row of ROWS) {
      expect(countOccurrences(text, row)).toBe(1)
    }
  })

  it('a per-frame factory remount re-emits earlier Static rows into the stream', async () => {
    const text = await driveGrowingRerenders(RemountHarness)
    expect(countOccurrences(text, ROWS[0])).toBeGreaterThan(1)
    expect(countOccurrences(text, ROWS[1])).toBeGreaterThan(1)
  })

  it('the harness distinguishes the two shapes (the skeleton proof)', async () => {
    const stable = await driveGrowingRerenders(StableHarness)
    const remounting = await driveGrowingRerenders(RemountHarness)
    expect(countOccurrences(stable, ROWS[0])).toBe(1)
    expect(countOccurrences(remounting, ROWS[0])).toBeGreaterThan(countOccurrences(stable, ROWS[0]))
  })
})

describe('once-emission end-to-end through the real running screen (7.5)', () => {
  function e(seq: number, init: EventInput): EventInput {
    return stampEvent(init, seq, '2026-01-01T00:00:00.000Z')
  }

  function harness(bag: RunFold): ReactElement {
    return createElement(RunScreenTui, {
      bag,
      startedAt: 0,
      now: 60_000,
      onRequestCalmStop: () => undefined,
      onHardExit: () => undefined,
    })
  }

  it('every history row appears exactly once in the write stream while events and rerenders keep coming', async () => {
    let bag = emptyRunFold()
    bag = foldRunView(bag, e(1, { altitude: 'L2', type: 'stage_enter', stage: 'review' }))
    const mount = mountToStream(harness(bag))
    try {
      bag = foldRunView(
        bag,
        e(2, { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'glm' }),
      )
      bag = foldRunView(
        bag,
        e(3, { altitude: 'L2', type: 'finding', action: 'filed', id: 'F1', round: 1, class: 'BLOCKER' }),
      )
      mount.rerender(harness(bag))
      await waitFor(() => mount.streamText().includes('F1 r1'))
      bag = foldRunView(
        bag,
        e(4, {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'open',
          counts: { blocker: 1, material: 0, nitpick: 0 },
        }),
      )
      bag = foldRunView(bag, e(5, { altitude: 'L1', type: 'spawned', agent: 'fixer-r1', role: 'fixer', model: 'glm' }))
      mount.rerender(harness(bag))
      await waitFor(() => mount.streamText().includes('round 1: 1b 0m 0n'))
      bag = foldRunView(
        bag,
        e(6, {
          altitude: 'L1',
          type: 'done',
          agent: 'reviewer-r1',
          model: 'glm',
          usage: {
            inputTokens: 5000,
            outputTokens: 1200,
            reasoningTokens: 0,
            cachedReadTokens: 0,
            cachedWriteTokens: 0,
            costUsd: 0.0123,
            wallMs: 10_000,
          },
        }),
      )
      mount.rerender(harness(bag))
      await waitFor(() => mount.streamText().includes('reviewer-r1 done'))
      mount.rerender(harness(bag))
      mount.rerender(harness(bag))
      await mount.waitUntilRenderFlush()
      const text = mount.streamText()
      expect(countOccurrences(text, 'F1 r1')).toBe(1)
      expect(countOccurrences(text, 'round 1: 1b 0m 0n')).toBe(1)
      expect(countOccurrences(text, 'reviewer-r1 done')).toBe(1)
      expect(text).toContain('fixer-r1')
    } finally {
      mount.unmount()
    }
  })
})
