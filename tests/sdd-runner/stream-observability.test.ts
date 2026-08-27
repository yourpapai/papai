// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { createElement } from 'react'
import type { ReactElement } from 'react'

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
