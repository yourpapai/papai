// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  AgentUsageSchema,
  AutoDecisionKindSchema,
  AutoDecisionRuleSchema,
  EventInputSchema,
  SddEventSchema,
  STAGE_ORDER,
  StageIdSchema,
} from '../../afk-runner/src/event-schemas.js'
import { stampEvent } from '../../afk-runner/src/events.js'
import { pipelineMachine } from '../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../afk-runner/src/kernel/fold.js'
import { autoExtendsUsedOf } from '../../afk-runner/src/work/gate-prelude.js'

const usage = { inputTokens: 120, outputTokens: 45, reasoningTokens: 8, costUsd: 0.4, wallMs: 900 }

describe('EventInputSchema variants', () => {
  it('accepts one member per altitude tier', () => {
    expect(
      EventInputSchema.parse({ altitude: 'L0', type: 'tool_use', agent: 'skeptic-1', tool: 'read_file' }),
    ).toMatchObject({ altitude: 'L0', type: 'tool_use' })
    expect(EventInputSchema.parse({ altitude: 'L1', type: 'killed', agent: 'x', cause: 'timeout' })).toMatchObject({
      type: 'killed',
      cause: 'timeout',
    })
    expect(EventInputSchema.parse({ altitude: 'L2', type: 'stage_exit', stage: 'gate' })).toMatchObject({
      type: 'stage_exit',
      stage: 'gate',
    })
  })

  it("parses a gate event carrying the 'plan' mode", () => {
    expect(
      EventInputSchema.parse({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'plan', version: 3 }),
    ).toMatchObject({ mode: 'plan', version: 3 })
  })

  it('rejects unknown event types, altitudes, and negative costs', () => {
    expect(EventInputSchema.safeParse({ altitude: 'L2', type: 'teleport', stage: 'gate' }).success).toBe(false)
    expect(EventInputSchema.safeParse({ altitude: 'L9', type: 'stage_enter', stage: 'gate' }).success).toBe(false)
    expect(
      EventInputSchema.safeParse({
        altitude: 'L0',
        type: 'step_finish',
        agent: 'drafter',
        tokens: { input: 1, output: 1, reasoning: 0 },
        costUsd: -1,
      }).success,
    ).toBe(false)
  })

  it('auto_decision accepts known rule ids and kinds, rejects the rest', () => {
    expect(AutoDecisionRuleSchema.options).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'none'])
    expect(AutoDecisionKindSchema.options).toEqual(['preview', 'approve', 'extend', 'accept-items', 'gate', 'pending'])
    expect(
      EventInputSchema.parse({
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'none',
        decision: 'gate',
        evidenceDigest: 'sha256:0f',
        gateVersion: 2,
      }),
    ).toMatchObject({ rule: 'none', decision: 'gate' })
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R9',
        decision: 'gate',
        evidenceDigest: 'd',
        gateVersion: 1,
      }).success,
    ).toBe(false)
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R1',
        decision: 'maybe',
        evidenceDigest: 'd',
        gateVersion: 1,
      }).success,
    ).toBe(false)
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R1',
        decision: 'gate',
        evidenceDigest: 'd',
        gateVersion: 0,
      }).success,
    ).toBe(false)
  })

  it("parses a waiter's pending auto_decision (decision: 'pending')", () => {
    expect(
      EventInputSchema.parse({
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'none',
        decision: 'pending',
        evidenceDigest: 'd',
        gateVersion: 1,
      }),
    ).toMatchObject({ rule: 'none', decision: 'pending', gateVersion: 1 })
  })

  it('a folded pending record never inflates the auto-extend bound (fold inertness)', () => {
    const pending = stampEvent(
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'none',
        decision: 'pending',
        evidenceDigest: 'd',
        gateVersion: 1,
      },
      1,
      '2026-08-27T00:00:00.000Z',
    )
    const extend = stampEvent(
      {
        altitude: 'L2',
        type: 'auto_decision',
        rule: 'R2',
        decision: 'extend',
        evidenceDigest: 'd',
        gateVersion: 1,
      },
      2,
      '2026-08-27T00:00:00.000Z',
    )
    const pendingOnly = foldEvents(pipelineMachine, [pending]).snapshot.context
    expect(pendingOnly.autoDecisions).toHaveLength(1)
    expect(autoExtendsUsedOf(pendingOnly)).toBe(0)
    const withExtend = foldEvents(pipelineMachine, [pending, extend]).snapshot.context
    expect(autoExtendsUsedOf(withExtend)).toBe(1)
  })
})

describe('SddEventSchema stamp contract', () => {
  it('rejects the unstamped event input shape', () => {
    expect(SddEventSchema.safeParse({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }).success).toBe(false)
  })

  it('round-trips a stamped variant and rejects a non-positive seq', () => {
    const stamped = SddEventSchema.parse({
      altitude: 'L2',
      type: 'resume',
      path: 'stage-rebuild',
      stage: 'draft',
      seq: 4,
      ts: '2026-08-23T08:00:00.000Z',
    })
    expect(stamped).toMatchObject({ type: 'resume', path: 'stage-rebuild', seq: 4 })
    expect(
      SddEventSchema.safeParse({
        altitude: 'L2',
        type: 'resume',
        path: 'stage-rebuild',
        stage: 'draft',
        seq: 0,
        ts: '2026-08-23T08:00:00.000Z',
      }).success,
    ).toBe(false)
  })
})

describe('supporting schemas', () => {
  it('STAGE_ORDER lists exactly the StageIdSchema options', () => {
    expect(STAGE_ORDER).toEqual([...StageIdSchema.options])
  })

  it('AgentUsageSchema rejects negative counters', () => {
    expect(AgentUsageSchema.parse({ ...usage, cachedReadTokens: 3, cachedWriteTokens: 1 })).toMatchObject({
      cachedReadTokens: 3,
      cachedWriteTokens: 1,
    })
    expect(AgentUsageSchema.safeParse({ ...usage, inputTokens: -1 }).success).toBe(false)
  })
})

describe('convergence event open counts', () => {
  const raised = { blocker: 1, material: 2, nitpick: 3 }
  const open = { blocker: 0, material: 1, nitpick: 0 }

  it('stamps a convergence event carrying both count sets', () => {
    const stamped = stampEvent(
      { altitude: 'L2', type: 'convergence', round: 2, verdict: 'open', counts: raised, open },
      4,
      't',
    )
    expect(stamped).toMatchObject({ type: 'convergence', counts: raised, open })
  })

  it('accepts the needs-review verdict the split introduced', () => {
    const stamped = stampEvent(
      { altitude: 'L2', type: 'convergence', round: 1, verdict: 'needs-review', counts: raised, open },
      1,
      't',
    )
    expect(stamped).toMatchObject({ verdict: 'needs-review' })
  })

  it('parses a pre-change convergence line that carries no open set', () => {
    const stamped = stampEvent(
      { altitude: 'L2', type: 'convergence', round: 1, verdict: 'open', counts: raised },
      1,
      't',
    )
    expect(stamped).toMatchObject({ counts: raised })
  })

  it('round-trips both sets through append and read', async () => {
    const { appendEvent, readEvents } = await import('../../afk-runner/src/events.js')
    const os = await import('node:os')
    const path = await import('node:path')
    const fs = await import('node:fs')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-evschema-'))
    try {
      const log = path.join(dir, 'events.ndjson')
      appendEvent(log, { altitude: 'L2', type: 'convergence', round: 1, verdict: 'converged', counts: raised, open })
      expect(readEvents(log)[0]).toMatchObject({ type: 'convergence', counts: raised, open })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the finding action values unchanged so the log stays as narrow as it was', () => {
    // The verdict deliberately does not depend on distinguishing edited from
    // assumed in the log — replay folds counts from the convergence event — so
    // widening this enum would be scope the change decided against.
    const actions = ['filed', 'classified', 'resolved', 'dismissed'] as const
    for (const action of actions) {
      expect(() => stampEvent({ altitude: 'L2', type: 'finding', action, id: 'F1', round: 1 }, 1, 't')).not.toThrow()
    }
    // A resolution kind the enum does not carry must still be rejected, so the
    // narrowness this change relies on cannot be widened by accident later.
    const widened = { altitude: 'L2', type: 'finding', action: 'edited', id: 'F1', round: 1 }
    expect(EventInputSchema.safeParse(widened).success).toBe(false)
  })
})

describe('loop-memory additive fields (D5)', () => {
  it('a finding event carries an optional fingerprint; the action enum is unchanged', () => {
    const stamped = EventInputSchema.parse({ ...baseFindingEvent(), fingerprint: 'id names never proposal scope' })
    expect(stamped).toMatchObject({ type: 'finding', fingerprint: 'id names never proposal scope' })
    expect(EventInputSchema.parse(baseFindingEvent())).not.toHaveProperty('fingerprint')
    expect(EventInputSchema.safeParse({ ...baseFindingEvent(), action: 'merged' }).success).toBe(false)
  })

  it('a convergence event carries optional concerns cluster ids', () => {
    const base = {
      altitude: 'L2',
      type: 'convergence',
      round: 3,
      verdict: 'open',
      counts: { blocker: 0, material: 1, nitpick: 0 },
    } as const
    expect(EventInputSchema.parse({ ...base, concerns: ['id names never proposal scope'] })).toMatchObject({
      type: 'convergence',
      concerns: ['id names never proposal scope'],
    })
    expect(EventInputSchema.parse(base)).not.toHaveProperty('concerns')
    expect(EventInputSchema.safeParse({ ...base, concerns: [] }).success).toBe(true)
  })
})

function baseFindingEvent(): {
  altitude: 'L2'
  type: 'finding'
  action: 'classified'
  id: string
  round: number
  class: 'MATERIAL'
} {
  return {
    altitude: 'L2',
    type: 'finding',
    action: 'classified',
    id: 'F1',
    round: 1,
    class: 'MATERIAL',
  } as const
}
