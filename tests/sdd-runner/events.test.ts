// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { AgentUsageSchema, appendEvent, readEvents, stampEvent } from '../../sdd-runner/src/events.js'
import { EventInputSchema, SddEventSchema } from '../../sdd-runner/src/events.js'
import type { SddEvent } from '../../sdd-runner/src/events.js'

const tmpDirs: string[] = []

function makeLog(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-events-'))
  tmpDirs.push(dir)
  return path.join(dir, 'events.ndjson')
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const at = (s: string): Date => new Date(`2026-08-10T10:00:${s}.000Z`)

describe('appendEvent + readEvents', () => {
  it('round-trips an L1 lifecycle event, stamping seq and ts', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L1', type: 'spawned', agent: 'drafter-1', role: 'drafter', model: 'test-model' },
      at('00'),
    )
    const events = readEvents(log)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      seq: 1,
      ts: '2026-08-10T10:00:00.000Z',
      altitude: 'L1',
      type: 'spawned',
      agent: 'drafter-1',
      role: 'drafter',
    })
  })

  it('assigns monotonically increasing seq across appends', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'stage_exit', stage: 'intake' }, at('01'))
    appendEvent(log, { altitude: 'L0', type: 'tool_use', agent: 'estimator-1', tool: 'code_search' }, at('02'))
    expect(readEvents(log).map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('rejects an invalid event at append time and writes nothing', () => {
    const log = makeLog()
    expect(() => appendEvent(log, JSON.parse('{"altitude":"L9","type":"spawned"}'), at('00'))).toThrow()
    expect(fs.existsSync(log)).toBe(false)
  })

  it('rejects a retrying event without a stall|validation reason', () => {
    const log = makeLog()
    const raw = '{"altitude":"L1","type":"retrying","agent":"drafter-1","reason":"vibes","attempt":1}'
    expect(() => appendEvent(log, JSON.parse(raw), at('00'))).toThrow()
  })

  it('throws naming the line when the log contains a corrupt entry', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    fs.appendFileSync(log, '{"altitude":"L2","type":"stage_enter"}\n')
    expect(() => readEvents(log)).toThrow(/line 2/u)
  })
})

describe('auto_decision event', () => {
  it('round-trips a preview decision with rule, evidence digest, and gate version', () => {
    const log = makeLog()
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R1',
        decision: 'preview',
        evidenceDigest: 'sha256:abc123',
        gateVersion: 2,
      },
      at('00'),
    )
    const events = readEvents(log)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      seq: 1,
      altitude: 'L2',
      type: 'auto_decision',
      rule: 'R1',
      decision: 'preview',
      evidenceDigest: 'sha256:abc123',
      gateVersion: 2,
    })
  })

  it('accepts every rule id including none and every decision kind', () => {
    const log = makeLog()
    const pairs = [
      { rule: 'R1', decision: 'preview' },
      { rule: 'R2', decision: 'approve' },
      { rule: 'R3', decision: 'extend' },
      { rule: 'R4', decision: 'accept-items' },
      { rule: 'R5', decision: 'gate' },
      { rule: 'none', decision: 'gate' },
    ] as const
    pairs.forEach((pair, i) => {
      appendEvent(
        log,
        {
          altitude: 'L2',
          type: 'auto_decision',
          rule: pair.rule,
          decision: pair.decision,
          evidenceDigest: 'd',
          gateVersion: 1,
        },
        at(String(i).padStart(2, '0')),
      )
    })
    const events = readEvents(log)
    expect(events).toHaveLength(pairs.length)
    pairs.forEach((pair, i) => {
      expect(events[i]).toMatchObject({ type: 'auto_decision', rule: pair.rule, decision: pair.decision })
    })
  })

  it('rejects a malformed auto_decision record', () => {
    const log = makeLog()
    expect(() =>
      appendEvent(
        log,
        { altitude: 'L2', type: 'auto_decision', rule: 'R9', decision: 'preview', evidenceDigest: 'd', gateVersion: 1 },
        at('00'),
      ),
    ).toThrow()
    expect(() =>
      appendEvent(
        log,
        { altitude: 'L2', type: 'auto_decision', rule: 'R1', decision: 'maybe', evidenceDigest: 'd', gateVersion: 1 },
        at('00'),
      ),
    ).toThrow()
    expect(() =>
      appendEvent(
        log,
        { altitude: 'L2', type: 'auto_decision', rule: 'R1', decision: 'preview', gateVersion: 1 },
        at('00'),
      ),
    ).toThrow()
    expect(() =>
      appendEvent(
        log,
        { altitude: 'L2', type: 'auto_decision', rule: 'R1', decision: 'preview', evidenceDigest: 'd', gateVersion: 0 },
        at('00'),
      ),
    ).toThrow()
    expect(fs.existsSync(log)).toBe(false)
  })

  it('old logs without auto_decision lines still parse unchanged', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 }, at('01'))
    expect(readEvents(log)).toHaveLength(2)
  })
})

describe('L2 semantic events', () => {
  it('accepts a depth-classified event with rationale and source', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'single-file bugfix', source: 'override' },
      at('00'),
    )
    const [e] = readEvents(log)
    expect(e).toMatchObject({ type: 'depth', profile: 'S', source: 'override' })
  })

  it('accepts finding and convergence events with class counts', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L2', type: 'finding', action: 'classified', id: 'F1', round: 1, class: 'BLOCKER' },
      at('00'),
    )
    appendEvent(
      log,
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'open',
        counts: { blocker: 1, material: 0, nitpick: 2 },
      },
      at('01'),
    )
    const events = readEvents(log)
    expect(events[1]).toMatchObject({ type: 'convergence', verdict: 'open', counts: { blocker: 1, nitpick: 2 } })
  })

  it('accepts a gate event with mode and version', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, at('00'))
    expect(readEvents(log)[0]).toMatchObject({ type: 'gate', mode: 'early', version: 1 })
  })
})

describe('depth event oversize verdict', () => {
  it('stamps a depth event carrying oversize and round-trips it through the log', () => {
    const input = {
      altitude: 'L2',
      type: 'depth',
      profile: 'M',
      rationale: 'declares a multi-module scope',
      source: 'estimator',
      oversize: true,
    } as const
    const stamped = stampEvent(input, 4, '2026-08-10T10:00:00.000Z')
    expect(stamped).toMatchObject({ seq: 4, type: 'depth', oversize: true })
    expect(EventInputSchema.parse(input)).toMatchObject({ type: 'depth', oversize: true })
    const log = makeLog()
    appendEvent(log, input, at('00'))
    expect(readEvents(log)[0]).toMatchObject({ seq: 1, type: 'depth', oversize: true })
  })

  it('parses pre-change depth lines without oversize, reading undefined as false', () => {
    const log = makeLog()
    appendEvent(
      log,
      { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'single-file bugfix', source: 'override' },
      at('00'),
    )
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('01'))
    const events = readEvents(log)
    expect(events).toHaveLength(2)
    const depth = events.find((e): e is Extract<SddEvent, { type: 'depth' }> => e.type === 'depth')
    assert(depth !== undefined)
    expect(depth.oversize).toBeUndefined()
  })

  it('rejects a depth event whose oversize is not a boolean', () => {
    const log = makeLog()
    const raw = '{"altitude":"L2","type":"depth","profile":"M","rationale":"x","source":"estimator","oversize":"yes"}'
    expect(() => appendEvent(log, JSON.parse(raw), at('00'))).toThrow()
    expect(fs.existsSync(log)).toBe(false)
  })
})

describe('decomposition events (part 1 data layer)', () => {
  it('stamps a plan event with childCount and digest through both unions', () => {
    const input = { altitude: 'L2', type: 'plan', childCount: 3, digest: 'a'.repeat(16) } as const
    const stamped = stampEvent(input, 7, '2026-08-10T10:00:00.000Z')
    expect(stamped).toMatchObject({
      seq: 7,
      ts: '2026-08-10T10:00:00.000Z',
      type: 'plan',
      childCount: 3,
      digest: 'a'.repeat(16),
    })
    expect(EventInputSchema.parse(input)).toMatchObject({ type: 'plan', childCount: 3 })
    const log = makeLog()
    appendEvent(log, input, at('00'))
    expect(readEvents(log)[0]).toMatchObject({ seq: 1, type: 'plan', childCount: 3, digest: 'a'.repeat(16) })
  })

  it('stamps child_spawned and child_done events through both unions', () => {
    const spawned = stampEvent(
      { altitude: 'L2', type: 'child_spawned', child: 'auth-module' },
      1,
      '2026-08-10T10:00:00.000Z',
    )
    expect(spawned).toMatchObject({ type: 'child_spawned', child: 'auth-module' })
    const done = stampEvent(
      { altitude: 'L2', type: 'child_done', child: 'auth-module', outcome: 'done' },
      2,
      '2026-08-10T10:00:01.000Z',
    )
    expect(done).toMatchObject({ type: 'child_done', child: 'auth-module', outcome: 'done' })
    expect(
      SddEventSchema.parse({ altitude: 'L2', type: 'child_done', child: 'x', outcome: 'failed', seq: 3, ts: 't' }),
    ).toMatchObject({ outcome: 'failed' })
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'auth-module' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'child_done', child: 'auth-module', outcome: 'failed' }, at('01'))
    const events = readEvents(log)
    expect(events.map((e) => e.type)).toEqual(['child_spawned', 'child_done'])
    expect(events[1]).toMatchObject({ child: 'auth-module', outcome: 'failed' })
  })

  it('rejects malformed decomposition events', () => {
    const log = makeLog()
    expect(() => appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 0, digest: 'd' }, at('00'))).toThrow()
    expect(() => appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 2 }, at('00'))).toThrow()
    expect(() => appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: '' }, at('00'))).toThrow()
    expect(() =>
      appendEvent(log, { altitude: 'L2', type: 'child_done', child: 'x', outcome: 'skipped' }, at('00')),
    ).toThrow()
    expect(fs.existsSync(log)).toBe(false)
  })

  it('parses a gate event with mode plan', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'plan', version: 1 }, at('00'))
    expect(readEvents(log)[0]).toMatchObject({ type: 'gate', mode: 'plan', version: 1 })
    expect(
      EventInputSchema.parse({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'plan', version: 1 }),
    ).toMatchObject({ mode: 'plan' })
  })

  it('old event lines still parse unchanged alongside the new variants', () => {
    const log = makeLog()
    appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' }, at('00'))
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1 }, at('01'))
    appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 2, digest: 'feedface' }, at('02'))
    const events = readEvents(log)
    expect(events).toHaveLength(3)
    expect(events[1]).toMatchObject({ type: 'gate', mode: 'final' })
    expect(events[2]).toMatchObject({ type: 'plan', childCount: 2 })
  })
})

describe('done event model field', () => {
  const baseUsage = { inputTokens: 1, outputTokens: 2, reasoningTokens: 0, costUsd: 0, wallMs: 10 }

  it('accepts a done event carrying its model', () => {
    const parsed = EventInputSchema.parse({
      altitude: 'L1',
      type: 'done',
      agent: 'reviewer-r1',
      model: 'zai-coding-plan/glm-5.2',
      usage: baseUsage,
    })
    expect(parsed).toMatchObject({ type: 'done', model: 'zai-coding-plan/glm-5.2' })
  })

  it('still accepts a done event without model (backward compat)', () => {
    const parsed = EventInputSchema.parse({
      altitude: 'L1',
      type: 'done',
      agent: 'reviewer-r1',
      usage: baseUsage,
    })
    expect(parsed).toMatchObject({ type: 'done' })
    expect(parsed).not.toHaveProperty('model')
  })
})

describe('cached token fields', () => {
  it('AgentUsageSchema accepts cache counters and rejects negatives', () => {
    const parsed = AgentUsageSchema.parse({
      inputTokens: 1005,
      outputTokens: 456,
      reasoningTokens: 0,
      cachedReadTokens: 18_175_552,
      cachedWriteTokens: 5_005_056,
      costUsd: 2.19,
      wallMs: 42_000,
    })
    expect(parsed.cachedReadTokens).toBe(18_175_552)
    expect(parsed.cachedWriteTokens).toBe(5_005_056)
    expect(
      AgentUsageSchema.safeParse({
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        cachedReadTokens: -1,
        costUsd: 0,
        wallMs: 1,
      }).success,
    ).toBe(false)
  })

  it('AgentUsageSchema defaults cache counters to 0 when absent (old events replay)', () => {
    const parsed = AgentUsageSchema.parse({
      inputTokens: 1,
      outputTokens: 2,
      reasoningTokens: 0,
      costUsd: 0,
      wallMs: 10,
    })
    expect(parsed.cachedReadTokens).toBe(0)
    expect(parsed.cachedWriteTokens).toBe(0)
  })

  it('step_finish events carry cache token deltas', () => {
    const parsed = EventInputSchema.parse({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'skeptic-r3',
      tokens: { input: 1757, output: 3, reasoning: 0, cacheRead: 8320, cacheWrite: 4096 },
      costUsd: 0,
    })
    expect(parsed).toMatchObject({
      type: 'step_finish',
      tokens: { input: 1757, output: 3, reasoning: 0, cacheRead: 8320, cacheWrite: 4096 },
    })
  })

  it('old step_finish event lines without cache fields still validate with cache 0', () => {
    const parsed = EventInputSchema.parse({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'drafter',
      tokens: { input: 5, output: 2, reasoning: 1 },
      costUsd: 0,
    })
    expect(parsed).toMatchObject({ type: 'step_finish', tokens: { cacheRead: 0, cacheWrite: 0 } })
  })
})
