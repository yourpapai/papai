// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { classifyHybrid } from '../../../src/analytics/intent/classifier.js'
import type { IntentClassifierInput, IntentPrediction } from '../../../src/analytics/intent/classifier.js'
import { resolveRephraseTerminalOutcome } from '../../../src/analytics/rephrase/outcome.js'
import type { RephraseTerminalEvidence } from '../../../src/analytics/turn-context.js'

const llmCompleted: RephraseTerminalEvidence = { kind: 'llm_completed' }
const llmFailed: RephraseTerminalEvidence = { kind: 'llm_failed' }

const tool = (
  toolSlug: string,
  executionOutcome: string,
  recoveredSameTurn = false,
  errorClass: string | null = null,
): RephraseTerminalEvidence => ({ kind: 'tool_completed', toolSlug, executionOutcome, recoveredSameTurn, errorClass })

const stubClassifier = (
  primary: IntentPrediction['primary'],
  abstained: boolean,
): { calls: IntentClassifierInput[]; classify: (input: IntentClassifierInput) => IntentPrediction } => {
  const calls: IntentClassifierInput[] = []
  const classify = (input: IntentClassifierInput): IntentPrediction => {
    calls.push(input)
    return {
      strategy: 'hybrid_v1',
      primary,
      goals: [],
      confidence: 0.5,
      abstained,
      tool_evidence_conflict: false,
    }
  }
  return { calls, classify }
}

describe('resolveRephraseTerminalOutcome', () => {
  test('a structured failure with a clarification error class wins over everything', () => {
    const outcome = resolveRephraseTerminalOutcome([
      llmCompleted,
      tool('create_task', 'semantic_success'),
      tool('update_task_fields', 'structured_failure', false, 'validation'),
    ])
    expect(outcome).toBe('clarification')
  })

  test.each(['not_found', 'permission', 'authorization', 'configuration'])(
    'error class %s maps to clarification',
    (errorClass) => {
      expect(resolveRephraseTerminalOutcome([tool('get_task', 'structured_failure', false, errorClass)])).toBe(
        'clarification',
      )
    },
  )

  test('a structured failure without a clarification class is not a clarification', () => {
    const outcome = resolveRephraseTerminalOutcome([
      llmCompleted,
      tool('get_task', 'structured_failure', false, 'internal'),
    ])
    expect(outcome).not.toBe('clarification')
  })

  test('the last llm evidence failing means failure', () => {
    expect(resolveRephraseTerminalOutcome([llmCompleted, llmFailed, tool('create_task', 'semantic_success')])).toBe(
      'failure',
    )
  })

  test('an unrecovered tool failure with zero semantic successes means failure', () => {
    expect(resolveRephraseTerminalOutcome([llmCompleted, tool('create_task', 'thrown_failure')])).toBe('failure')
    expect(
      resolveRephraseTerminalOutcome([llmCompleted, tool('create_task', 'structured_failure', false, 'internal')]),
    ).toBe('failure')
  })

  test('a recovered tool failure beside a semantic success is not a failure', () => {
    const outcome = resolveRephraseTerminalOutcome([
      llmCompleted,
      tool('create_task', 'thrown_failure', true),
      tool('find_tasks', 'semantic_success'),
    ])
    expect(outcome).toBe('success')
  })

  test('a completed turn with no tool evidence is no_action', () => {
    const { calls, classify } = stubClassifier('unknown', true)
    const outcome = resolveRephraseTerminalOutcome([llmCompleted], classify)
    expect(outcome).toBe('no_action')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command_family).toBe('none')
    expect(calls[0]?.tool_trace).toEqual([])
  })

  test('tool evidence the classifier cannot map to an intent is no_action', () => {
    const { classify } = stubClassifier('unknown', true)
    expect(resolveRephraseTerminalOutcome([llmCompleted, tool('some_meta_tool', 'semantic_success')], classify)).toBe(
      'no_action',
    )
  })

  test('a classified intent with a completed llm and a semantic success is success', () => {
    const outcome = resolveRephraseTerminalOutcome([llmCompleted, tool('create_task', 'semantic_success')])
    expect(outcome).toBe('success')
  })

  test('a classified intent without llm completion is discarded', () => {
    const outcome = resolveRephraseTerminalOutcome([tool('create_task', 'semantic_success')])
    expect(outcome).toBe('discard')
  })

  test('an empty evidence list is discarded', () => {
    expect(resolveRephraseTerminalOutcome([])).toBe('discard')
  })

  test('the production default classifier maps runtime slugs through the intent classifier', () => {
    const outcome = resolveRephraseTerminalOutcome([llmCompleted, tool('create_task', 'semantic_success')])
    expect(outcome).toBe('success')
    const direct = classifyHybrid({
      tool_trace: [{ tool_slug: 'create_task' }],
      feature_events: [],
      command_family: 'none',
    })
    expect(direct.abstained).toBe(false)
  })
})
