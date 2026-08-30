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
} from '../../sdd-runner/src/event-schemas.js'

const usage = {
  inputTokens: 120,
  outputTokens: 45,
  reasoningTokens: 8,
  costUsd: 0.4,
  wallMs: 900,
}

describe('EventInputSchema variants', () => {
  it('accepts one member per altitude tier', () => {
    expect(
      EventInputSchema.parse({
        altitude: 'L0',
        type: 'tool_use',
        agent: 'skeptic-1',
        tool: 'read_file',
      }),
    ).toMatchObject({ altitude: 'L0', type: 'tool_use' })
    expect(
      EventInputSchema.parse({
        altitude: 'L1',
        type: 'killed',
        agent: 'x',
        cause: 'timeout',
      }),
    ).toMatchObject({
      type: 'killed',
      cause: 'timeout',
    })
    expect(
      EventInputSchema.parse({
        altitude: 'L2',
        type: 'stage_exit',
        stage: 'gate',
      }),
    ).toMatchObject({
      type: 'stage_exit',
      stage: 'gate',
    })
  })

  it('parses killed events with a real agent name and every cause, rejecting an unknown cause', () => {
    for (const cause of ['timeout', 'inactivity', 'abort'] as const) {
      expect(EventInputSchema.parse({ altitude: 'L1', type: 'killed', agent: 'drafter-2', cause })).toMatchObject({
        type: 'killed',
        agent: 'drafter-2',
        cause,
      })
    }
    expect(
      EventInputSchema.safeParse({ altitude: 'L1', type: 'killed', agent: 'drafter-2', cause: 'crash' }).success,
    ).toBe(false)
  })

  it('parses assumption events with every action and rejects an unknown one', () => {
    for (const action of ['logged', 'confirmed', 'vetoed', 'applied'] as const) {
      expect(
        EventInputSchema.parse({ altitude: 'L2', type: 'assumption', action, id: 'A12', detail: 'why' }),
      ).toMatchObject({ type: 'assumption', action, id: 'A12' })
    }
    expect(
      EventInputSchema.safeParse({ altitude: 'L2', type: 'assumption', action: 'revoked', id: 'A1' }).success,
    ).toBe(false)
  })

  it('parses depth events from every source', () => {
    for (const source of ['override', 'estimator', 'prescreen'] as const) {
      expect(
        EventInputSchema.parse({ altitude: 'L2', type: 'depth', profile: 'M', rationale: 'multi-module', source }),
      ).toMatchObject({ type: 'depth', source })
    }
  })

  it('parses a human_edits event with multiple files and rejects an empty list', () => {
    expect(
      EventInputSchema.parse({ altitude: 'L2', type: 'human_edits', action: 'detected', files: ['a.ts', 'b.ts'] }),
    ).toMatchObject({ type: 'human_edits', files: ['a.ts', 'b.ts'] })
    expect(
      EventInputSchema.safeParse({ altitude: 'L2', type: 'human_edits', action: 'detected', files: [] }).success,
    ).toBe(false)
  })

  it('parses resume events with every path', () => {
    for (const resumePath of ['artifact-skip', 'session-continuation', 'stage-rebuild'] as const) {
      expect(
        EventInputSchema.parse({ altitude: 'L2', type: 'resume', path: resumePath, stage: 'review' }),
      ).toMatchObject({ type: 'resume', path: resumePath })
    }
    expect(
      EventInputSchema.parse({
        altitude: 'L2',
        type: 'resume',
        path: 'session-continuation',
        stage: 'draft',
        session: 'sess-9',
      }),
    ).toMatchObject({ session: 'sess-9' })
  })

  it("parses a gate event carrying the 'plan' mode", () => {
    expect(
      EventInputSchema.parse({
        altitude: 'L2',
        type: 'gate',
        action: 'presented',
        mode: 'plan',
        version: 3,
      }),
    ).toMatchObject({ mode: 'plan', version: 3 })
  })

  it('rejects unknown event types, altitudes, and negative costs', () => {
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'teleport',
        stage: 'gate',
      }).success,
    ).toBe(false)
    expect(
      EventInputSchema.safeParse({
        altitude: 'L9',
        type: 'stage_enter',
        stage: 'gate',
      }).success,
    ).toBe(false)
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
})

describe('SddEventSchema stamp contract', () => {
  it('rejects the unstamped event input shape', () => {
    expect(
      SddEventSchema.safeParse({
        altitude: 'L2',
        type: 'stage_enter',
        stage: 'intake',
      }).success,
    ).toBe(false)
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
    expect(stamped).toMatchObject({
      type: 'resume',
      path: 'stage-rebuild',
      seq: 4,
    })
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
    expect(
      AgentUsageSchema.parse({
        ...usage,
        cachedReadTokens: 3,
        cachedWriteTokens: 1,
      }),
    ).toMatchObject({
      cachedReadTokens: 3,
      cachedWriteTokens: 1,
    })
    expect(AgentUsageSchema.safeParse({ ...usage, inputTokens: -1 }).success).toBe(false)
  })
})

describe('variant strictness: every enum member and bound is load-bearing', () => {
  it('killed events require an agent id and accept exactly the documented causes', () => {
    expect(
      EventInputSchema.parse({
        altitude: 'L1',
        type: 'killed',
        agent: 'reviewer-r1',
        cause: 'inactivity',
      }),
    ).toMatchObject({ cause: 'inactivity' })
    expect(
      EventInputSchema.parse({
        altitude: 'L1',
        type: 'killed',
        agent: 'reviewer-r1',
        cause: 'abort',
      }),
    ).toMatchObject({ cause: 'abort' })
    expect(
      EventInputSchema.safeParse({
        altitude: 'L1',
        type: 'killed',
        agent: '',
        cause: 'timeout',
      }).success,
    ).toBe(false)
    expect(
      EventInputSchema.safeParse({
        altitude: 'L1',
        type: 'killed',
        agent: 'reviewer-r1',
        cause: 'exploded',
      }).success,
    ).toBe(false)
  })

  it('assumption events pin the L2 altitude, the type literal, every action member, and a non-empty id', () => {
    for (const action of ['logged', 'confirmed', 'vetoed', 'applied'] as const) {
      expect(
        EventInputSchema.parse({
          altitude: 'L2',
          type: 'assumption',
          action,
          id: 'A1',
        }),
      ).toMatchObject({
        action,
      })
    }
    expect(
      EventInputSchema.safeParse({
        altitude: 'L1',
        type: 'assumption',
        action: 'logged',
        id: 'A1',
      }).success,
    ).toBe(false)
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'assumption2',
        action: 'logged',
        id: 'A1',
      }).success,
    ).toBe(false)
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'assumption',
        action: 'pondered',
        id: 'A1',
      }).success,
    ).toBe(false)
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'assumption',
        action: 'logged',
        id: '',
      }).success,
    ).toBe(false)
  })

  it('depth events accept the prescreen source and reject unknown sources', () => {
    expect(
      EventInputSchema.parse({
        altitude: 'L2',
        type: 'depth',
        profile: 'M',
        rationale: 'r',
        source: 'prescreen',
      }),
    ).toMatchObject({ source: 'prescreen' })
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'depth',
        profile: 'M',
        rationale: 'r',
        source: 'vibes',
      }).success,
    ).toBe(false)
  })

  it('human_edits events require at least one file', () => {
    expect(
      EventInputSchema.parse({
        altitude: 'L2',
        type: 'human_edits',
        action: 'detected',
        files: ['a.ts'],
      }),
    ).toMatchObject({ type: 'human_edits' })
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'human_edits',
        action: 'detected',
        files: [],
      }).success,
    ).toBe(false)
  })

  it('resume events accept the artifact-skip path and reject unknown paths', () => {
    expect(
      EventInputSchema.parse({
        altitude: 'L2',
        type: 'resume',
        path: 'artifact-skip',
        stage: 'draft',
      }),
    ).toMatchObject({ path: 'artifact-skip' })
    expect(
      EventInputSchema.safeParse({
        altitude: 'L2',
        type: 'resume',
        path: 'artifact-skip2',
        stage: 'draft',
      }).success,
    ).toBe(false)
  })
})
