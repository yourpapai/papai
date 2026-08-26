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
    expect(AutoDecisionKindSchema.options).toEqual(['preview', 'approve', 'extend', 'accept-items', 'gate'])
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
