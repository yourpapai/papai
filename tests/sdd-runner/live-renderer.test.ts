// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { EventInput } from '../../sdd-runner/src/events.js'
import { DynamicRenderer } from '../../sdd-runner/src/live-renderer.js'
import type { ResolvedCost } from '../../sdd-runner/src/pricing.js'

interface MemoryStreamOptions {
  readonly isTTY: boolean
  readonly columns: number
}

class MemoryStream {
  readonly chunks: string[] = []
  readonly isTTY: boolean
  readonly columns: number

  constructor(opts: MemoryStreamOptions) {
    this.isTTY = opts.isTTY
    this.columns = opts.columns
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return true
  }
}

const REVIEW_STAGE_ENTER: EventInput = { altitude: 'L2', type: 'stage_enter', stage: 'review' }
const ROUND_OPEN_1_3: EventInput = { altitude: 'L2', type: 'round_open', round: 1, cap: 3 }
const RESOLVER_TOOL_USE: EventInput = {
  altitude: 'L0',
  type: 'tool_use',
  agent: 'resolver-r1',
  tool: 'readFile',
  arg: 'foo.ts',
}
const RESOLVER_DONE: EventInput = {
  altitude: 'L1',
  type: 'done',
  agent: 'resolver-r1',
  usage: { inputTokens: 5000, outputTokens: 1200, reasoningTokens: 10, costUsd: 0.01, wallMs: 1000 },
}

/**
 * Extract the status (footer) line from the last rendered block: it is always the
 * final line of a `writeBlock` emission, i.e. everything after the last
 * `\n` + ERASE_LINE boundary. The trailing duration segment is normalized because
 * it depends on wall-clock time.
 */
function lastStatusLine(out: string): string {
  const marker = '\n\u001b[2K'
  const idx = out.lastIndexOf(marker)
  const line = idx === -1 ? out : out.slice(idx + marker.length)
  return line.replace(/\d+(m\d{2})?s$/u, 'DUR')
}

describe('DynamicRenderer', () => {
  it('redraws a pipeline map + slot + status block on each event against a TTY stream', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 80 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent(REVIEW_STAGE_ENTER)
    renderer.renderEvent(ROUND_OPEN_1_3)
    renderer.renderEvent(RESOLVER_TOOL_USE)
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 5000, output: 1200, reasoning: 10 },
      costUsd: 0.01,
    })
    renderer.renderEvent(RESOLVER_DONE)

    const out = stream.chunks.join('')
    expect(out).toContain('\u25B6 review active (round 1/3)')
    expect(out).toContain('resolver-r1 \u25B6 readFile foo.ts')
    expect(out).toContain('5.0k')
    expect(out).toContain('1.2k')
    expect(out).toMatch(/\d+s/u)
    expect(out).toContain('\r')
    expect(out).toContain('\u001b[2K')
  })

  it('writes no ANSI escapes on a non-TTY stream', () => {
    const stream = new MemoryStream({ isTTY: false, columns: 80 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent(REVIEW_STAGE_ENTER)
    renderer.renderEvent(RESOLVER_TOOL_USE)
    const out = stream.chunks.join('')
    expect(out).not.toContain('\u001b[2K')
    expect(out).not.toContain('\r')
  })
})

describe('DynamicRenderer cost estimation', () => {
  const GLM_MODEL = 'zai-coding-plan/glm-5.2'
  const PRICED: ResolvedCost = { input: 1, output: 2, source: 'primary' }
  const resolvePriced = (modelId: string): ResolvedCost | null => (modelId === GLM_MODEL ? PRICED : null)

  const SPAWNED_GLM: EventInput = {
    altitude: 'L1',
    type: 'spawned',
    agent: 'resolver-r1',
    role: 'reviewer',
    model: GLM_MODEL,
  }
  // ((1000 + 100) * 1 + 500 * 2) / 1_000_000 = 0.0021
  const UNMETERED_STEP: EventInput = {
    altitude: 'L0',
    type: 'step_finish',
    agent: 'resolver-r1',
    tokens: { input: 1000, output: 500, reasoning: 100 },
    costUsd: 0,
  }
  const METERED_STEP: EventInput = {
    altitude: 'L0',
    type: 'step_finish',
    agent: 'resolver-r1',
    tokens: { input: 2000, output: 300, reasoning: 0 },
    costUsd: 0.01,
  }

  function makeTty(): MemoryStream {
    return new MemoryStream({ isTTY: true, columns: 120 })
  }

  it('estimates an unmetered step from the spawned model and prefixes the footer with ~$', () => {
    const stream = makeTty()
    const renderer = new DynamicRenderer(stream, 'normal', undefined, resolvePriced)
    renderer.renderEvent(SPAWNED_GLM)
    renderer.renderEvent(UNMETERED_STEP)
    expect(stream.chunks.join('')).toContain('~$0.0021')
  })

  it('renders a metered step cost with a plain $ prefix (no tilde)', () => {
    const stream = makeTty()
    const renderer = new DynamicRenderer(stream, 'normal', undefined, resolvePriced)
    renderer.renderEvent(SPAWNED_GLM)
    renderer.renderEvent(METERED_STEP)
    const out = stream.chunks.join('')
    expect(out).toContain('$0.0100')
    expect(out).not.toContain('~$')
  })

  it('hides the cost segment when the resolver returns null', () => {
    const stream = makeTty()
    const renderer = new DynamicRenderer(stream, 'normal', undefined, () => null)
    renderer.renderEvent(SPAWNED_GLM)
    renderer.renderEvent(UNMETERED_STEP)
    const out = stream.chunks.join('')
    expect(out).not.toContain('$')
    expect(out).toContain('in 1.0k / out 500')
  })

  it('marks the footer ~$ when metered and estimated steps mix', () => {
    const stream = makeTty()
    const renderer = new DynamicRenderer(stream, 'normal', undefined, resolvePriced)
    renderer.renderEvent(SPAWNED_GLM)
    renderer.renderEvent(METERED_STEP)
    renderer.renderEvent(UNMETERED_STEP)
    expect(stream.chunks.join('')).toContain('~$0.0121')
  })

  it('renders a byte-identical footer when no resolver is passed', () => {
    const stream = makeTty()
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent(SPAWNED_GLM)
    renderer.renderEvent(UNMETERED_STEP)
    expect(lastStatusLine(stream.chunks.join(''))).toBe('  status     in 1.0k / out 500 \u00B7 DUR')
  })
})

describe('DynamicRenderer totals accounting', () => {
  it('counts step deltas once when done repeats their cumulative usage', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 120 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 1000, output: 200, reasoning: 0 },
      costUsd: 0.005,
    })
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 500, output: 100, reasoning: 0 },
      costUsd: 0.003,
    })
    renderer.renderEvent({
      altitude: 'L1',
      type: 'done',
      agent: 'resolver-r1',
      usage: { inputTokens: 1500, outputTokens: 300, reasoningTokens: 0, costUsd: 0.008, wallMs: 1000 },
    })
    const status = lastStatusLine(stream.chunks.join(''))
    expect(status).toContain('in 1.5k / out 300')
    expect(status).toContain('$0.0080')
    expect(status).not.toContain('3.0k')
    expect(status).not.toContain('$0.0160')
  })

  it('shows cached reads as a footer segment hidden when zero', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 120 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 1000, output: 200, reasoning: 0, cacheRead: 8320, cacheWrite: 4096 },
      costUsd: 0,
    })
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 500, output: 100, reasoning: 0, cacheRead: 1000, cacheWrite: 0 },
      costUsd: 0,
    })
    const status = lastStatusLine(stream.chunks.join(''))
    expect(status).toContain('in 1.5k \u00B7 cached 9.3k / out 300')
  })

  it('footer byte-identical when cache deltas are zero', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 120 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 1000, output: 200, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
    })
    const status = lastStatusLine(stream.chunks.join(''))
    expect(status).toContain('in 1.0k / out 200')
    expect(status).not.toContain('cached')
  })

  const CACHE_PRICED_MODEL = 'zai-coding-plan/glm-5.2'
  const CACHE_PRICED: ResolvedCost = { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25, source: 'primary' }
  const resolveCachePriced = (modelId: string): ResolvedCost | null =>
    modelId === CACHE_PRICED_MODEL ? CACHE_PRICED : null

  it('prices cached reads/writes in the step estimate with the same formula as the gate', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 120 })
    const renderer = new DynamicRenderer(stream, 'normal', undefined, resolveCachePriced)
    renderer.renderEvent({
      altitude: 'L1',
      type: 'spawned',
      agent: 'resolver-r1',
      role: 'reviewer',
      model: CACHE_PRICED_MODEL,
    })
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 1_000_000, output: 1_000_000, reasoning: 0, cacheRead: 2_000_000, cacheWrite: 1_000_000 },
      costUsd: 0,
    })
    // ((1M * 1) + (1M * 2) + (2M * 0.1) + (1M * 1.25)) / 1M = 4.45
    expect(stream.chunks.join('')).toContain('$4.4500')
  })
})

describe('Tier 0 dynamic details (13.2-13.4)', () => {
  it('completed stages show wall time and cost; the active stage shows an elapsed marker', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 100 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({ altitude: 'L2', type: 'stage_enter', stage: 'intake' })
    renderer.renderEvent({ altitude: 'L2', type: 'stage_exit', stage: 'intake' })
    renderer.renderEvent({ altitude: 'L2', type: 'stage_enter', stage: 'draft' })
    const out = stream.chunks.join('')
    expect(out).toMatch(/intake done .* · \$0\.0{4}/u)
    expect(out).toMatch(/draft active/u)
  })

  it('slot lines truncate by visible width so wide chars never overflow the terminal', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 20 })
    const renderer = new DynamicRenderer(stream, 'normal')
    const agent = 'レビューアー'
    renderer.renderEvent({ altitude: 'L1', type: 'spawned', agent, role: 'reviewer', model: 'm' })
    renderer.renderEvent({
      altitude: 'L0',
      type: 'tool_use',
      agent,
      tool: 'readFile',
      arg: 'src/very/long/path/that/would/overflow.ts',
    })
    const out = stream.chunks.join('')
    const lines = out.split('\n').filter((l) => l.includes('レビューアー'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(20)
    }
  })

  it('a retrying agent slot shows a retry badge', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 80 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({ altitude: 'L1', type: 'spawned', agent: 'a', role: 'reviewer', model: 'm' })
    renderer.renderEvent({ altitude: 'L1', type: 'retrying', agent: 'a', reason: 'stall', attempt: 2 })
    renderer.renderEvent({ altitude: 'L0', type: 'tool_use', agent: 'a', tool: 'readFile' })
    const out = stream.chunks.join('')
    expect(out).toMatch(/retry 2/u)
  })

  it('a done slot line reads <agent> done · <model> · in X out Y · $Z', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 100 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({ altitude: 'L1', type: 'spawned', agent: 'resolver-r1', role: 'resolver', model: 'glm' })
    renderer.renderEvent({ altitude: 'L0', type: 'tool_use', agent: 'resolver-r1', tool: 'readFile' })
    renderer.renderEvent({
      altitude: 'L1',
      type: 'done',
      agent: 'resolver-r1',
      model: 'glm',
      usage: { inputTokens: 5000, outputTokens: 1200, reasoningTokens: 10, costUsd: 0.01, wallMs: 1000 },
    })
    const out = stream.chunks.join('')
    expect(out).toMatch(/resolver-r1 done · glm · in 5.0k out 1.2k · \$0\.0100/u)
  })

  it('status line shows ETA from completed rounds and hides reasoning tokens when zero', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 100 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({ altitude: 'L2', type: 'stage_enter', stage: 'review' })
    renderer.renderEvent({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 })
    renderer.renderEvent({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'a',
      tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd: 0,
    })
    renderer.renderEvent({ altitude: 'L2', type: 'round_close', round: 1, cap: 3 })
    renderer.renderEvent({ altitude: 'L2', type: 'round_open', round: 2, cap: 3 })
    const status = lastStatusLine(stream.chunks.join(''))
    expect(status).not.toContain('reasoning')
  })
})

/** Rough visible-width model: ANSI escapes count 0, wide chars count 2. */
function visibleWidth(line: string): number {
  const escape = String.fromCharCode(27)
  const stripped = line
    .split(escape)
    .map((piece) => piece.replace(/^\[[0-9]*[A-Za-z]/u, ''))
    .join('')
  let width = 0
  for (const char of stripped) {
    width += isWide(char) ? 2 : 1
  }
  return width
}

function isWide(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3))
}

describe('DynamicRenderer non-TTY and duration formatting', () => {
  it('non-TTY writes rendered event lines and stays silent for filtered ones', () => {
    const stream = new MemoryStream({ isTTY: false, columns: 100 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({ altitude: 'L2', type: 'stage_enter', stage: 'draft' })
    renderer.renderEvent({ altitude: 'L0', type: 'tool_use', agent: 'a', tool: 't' })
    const out = stream.chunks.join('')
    expect(out).toContain('[draft] entered\n')
    expect(out).not.toContain('tool')
  })

  it('formatDuration tiers are pinned through stage elapsed rendering', async () => {
    const { formatElapsed } = await import('../../sdd-runner/src/renderer.js')
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(59_000)).toBe('59s')
    expect(formatElapsed(60_000)).toBe('1m00s')
    expect(formatElapsed(605_000)).toBe('10m05s')
  })

  it('a done event without a spawned model records no model part', () => {
    const stream = new MemoryStream({ isTTY: true, columns: 100 })
    const renderer = new DynamicRenderer(stream, 'normal')
    renderer.renderEvent({
      altitude: 'L1',
      type: 'done',
      agent: 'lonely-agent',
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0, costUsd: 0, wallMs: 0 },
    })
    const out = stream.chunks.join('')
    expect(out).toMatch(/lonely-agent done · in 10 out 5 · \$0\.0000/u)
    expect(out).not.toMatch(/lonely-agent done · ·/u)
  })
})
