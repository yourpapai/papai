// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TraceFixture } from './fixture-types.js'
import { runTraceFixture } from './trace-runner.js'

const baseFixture: TraceFixture = {
  kind: 'trace',
  meta: {
    id: 'trace-runner-unit',
    description: 'Trace runner unit fixture',
    ownerArea: 'orchestration',
    roadmapPhase: 'phase-0',
  },
  setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['create_task'] },
  script: [
    {
      type: 'tool_call',
      toolName: 'create_task',
      toolCallId: 'call-create',
      input: { title: 'Ship it' },
      output: { id: 't1' },
    },
    { type: 'assistant_text', text: 'Created Ship it.' },
  ],
  expected: {
    toolCalls: ['create_task'],
    forbiddenToolCalls: ['delete_task'],
    finalClassification: 'completes_action',
  },
}

describe('runTraceFixture', () => {
  test('returns the scripted trace when required calls, forbidden calls, and classification match', () => {
    const result = runTraceFixture(baseFixture)

    expect(result.toolCalls).toEqual(['create_task'])
    expect(result.finalClassification).toBe('completes_action')
  })

  test('fails when a required call is missing', () => {
    expect(() =>
      runTraceFixture({
        ...baseFixture,
        expected: { ...baseFixture.expected, toolCalls: ['update_task'] },
      }),
    ).toThrow('Expected trace to call update_task')
  })

  test('fails when a forbidden call is present', () => {
    expect(() =>
      runTraceFixture({
        ...baseFixture,
        expected: { ...baseFixture.expected, forbiddenToolCalls: ['create_task'] },
      }),
    ).toThrow('Expected trace not to call create_task')
  })

  test('fails when final classification does not match', () => {
    expect(() =>
      runTraceFixture({
        ...baseFixture,
        expected: { ...baseFixture.expected, finalClassification: 'requests_permission' },
      }),
    ).toThrow('Expected final classification requests_permission, received completes_action')
  })
})
