// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { createAgentReporter } from '../../sdd-runner/src/agent-reporter.js'
import type { EventInput } from '../../sdd-runner/src/events.js'

function harness(): { emitted: EventInput[]; reporter: ReturnType<typeof createAgentReporter> } {
  const emitted: EventInput[] = []
  const reporter = createAgentReporter('resolver-r1', (event) => {
    emitted.push(event)
  })
  return { emitted, reporter }
}

describe('createAgentReporter', () => {
  it('parses a slot line into a tool_use event tagged with the construction label', () => {
    const { emitted, reporter } = harness()
    reporter.slot?.('resolver-r1', 'resolver-r1 \u25B6 readFile foo.ts \u00B7 4s \u00B7 3 tools')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      altitude: 'L0',
      type: 'tool_use',
      agent: 'resolver-r1',
      tool: 'readFile',
      arg: 'foo.ts',
    })
  })

  it('emits nothing when slot is cleared (line === null)', () => {
    const { emitted, reporter } = harness()
    reporter.slot?.('resolver-r1', null)
    expect(emitted).toHaveLength(0)
  })

  it('falls back to (unknown) tool with the full line as arg for an unrecognized shape', () => {
    const { emitted, reporter } = harness()
    reporter.slot?.('resolver-r1', 'something weird happened here')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      altitude: 'L0',
      type: 'tool_use',
      agent: 'resolver-r1',
      tool: '(unknown)',
    })
  })

  it('translates usage() into a step_finish event with token + cost delta', () => {
    const { emitted, reporter } = harness()
    reporter.usage?.({ input: 1200, output: 800, reasoning: 30, cost: 0.0142 })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 1200, output: 800, reasoning: 30 },
      costUsd: 0.0142,
    })
  })

  it('reports dynamic === false so withLivePhase skips its ticking path', () => {
    const { reporter } = harness()
    expect(reporter.dynamic).toBe(false)
  })

  it('treats event/log/live/clearLive as no-ops (do not emit)', () => {
    const { emitted, reporter } = harness()
    reporter.event('a scrolling line')
    reporter.log('a log line')
    reporter.live(['a live line'])
    reporter.clearLive()
    expect(emitted).toHaveLength(0)
  })

  it('treats optional diff/issue/statusSuffix hooks as no-ops when present', () => {
    const { emitted, reporter } = harness()
    reporter.diff?.('reviewer-r1', { added: 1, removed: 0 })
    reporter.issue?.({ type: 'round', round: 1, maxRounds: 3 })
    reporter.statusSuffix?.()
    expect(emitted).toHaveLength(0)
  })
})
