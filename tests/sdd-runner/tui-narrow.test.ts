// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { render } from 'ink-testing-library'
import { createElement } from 'react'

import { renderPipelineMap } from '../../sdd-runner/src/renderer.js'
import { createRunView } from '../../sdd-runner/src/run-view.js'
import { emptyRunFold } from '../../sdd-runner/src/run-view.js'
import type { RunFold } from '../../sdd-runner/src/run-view.js'
import { displayWidth } from '../../sdd-runner/src/tui-panels.js'

const NOW = 9_000_000
const START = 0

function frameFor(bag: RunFold, width: number): string {
  const RunView = createRunView()
  const { lastFrame, unmount } = render(
    createElement(RunView, {
      state: bag.state,
      slots: bag.slots,
      findings: bag.findings,
      history: bag.history,
      width,
      startedAt: START,
      now: NOW,
      colorMode: 'monochrome',
    }),
  )
  const frame = lastFrame() ?? ''
  unmount()
  return frame
}

describe('narrow-terminal degradation (4.8)', () => {
  it('wide width joins pipeline stages to one line', () => {
    const line = renderPipelineMap(emptyRunFold().state, { width: 100 })
    expect(line.length).toBe(1)
    expect(line[0]).toContain('intake')
    expect(line[0]).toContain('atomicity')
  })

  it('under 60 cols the pipeline stacks vertically, one stage per line', () => {
    const lines = renderPipelineMap(emptyRunFold().state, { width: 40 })
    expect(lines.length).toBe(6)
    expect(lines.every((line) => line.length <= 40)).toBe(true)
  })

  it('the run view under 60 cols renders no line wider than the terminal', () => {
    const frame = frameFor(emptyRunFold(), 40)
    const widest = Math.max(...frame.split('\n').map((line) => displayWidth(line)))
    expect(widest).toBeLessThanOrEqual(40)
  })

  it('decision consequence lines are never truncated at narrow width', () => {
    const frame = frameFor(emptyRunFold(), 40)
    expect(frame).not.toContain('…')
    expect(frame.split('\n').some((line) => line.includes('(a)pprove'))).toBe(false)
  })
})
