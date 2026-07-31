// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  classifyHybrid,
  classifyMetadata,
  classifyToolTrace,
  toClassifierToolSlug,
  type IntentClassifierInput,
} from '../../../src/analytics/intent/classifier.js'

const inputOf = (partial: Partial<IntentClassifierInput>): IntentClassifierInput => ({
  tool_trace: [],
  feature_events: [],
  command_family: 'none',
  ...partial,
})

describe('deterministic A+B classifiers', () => {
  test('tool trace maps an unambiguous registered tool to its intent', () => {
    const prediction = classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'create_task' }] }))
    expect(prediction.primary).toBe('task.create')
    expect(prediction.goals).toEqual(['task.create'])
    expect(prediction.abstained).toBe(false)
    expect(prediction.confidence).toBe(0.99)
  })

  test('meta-tool-only traces abstain without conflict', () => {
    const prediction = classifyToolTrace(
      inputOf({
        tool_trace: [{ tool_slug: 'search_tools' }, { tool_slug: 'load_tool' }, { tool_slug: 'expand_result' }],
      }),
    )
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(true)
    expect(prediction.tool_evidence_conflict).toBe(false)
  })

  test('an unmapped goal tool with no mapped evidence abstains without conflict', () => {
    const prediction = classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'external_other' }] }))
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(true)
    expect(prediction.tool_evidence_conflict).toBe(false)
  })

  test('an unmapped goal tool alongside mapped evidence abstains with conflict', () => {
    const prediction = classifyToolTrace(
      inputOf({ tool_trace: [{ tool_slug: 'create_task' }, { tool_slug: 'apply_youtrack_command' }] }),
    )
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(true)
    expect(prediction.tool_evidence_conflict).toBe(true)
  })

  test('more than three goals fails closed to unknown', () => {
    const prediction = classifyToolTrace(
      inputOf({
        tool_trace: [
          { tool_slug: 'create_task' },
          { tool_slug: 'find_tasks' },
          { tool_slug: 'get_task' },
          { tool_slug: 'delete_task' },
        ],
      }),
    )
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(true)
  })

  test('two or three goals become a taxonomy-ordered multi_goal', () => {
    const two = classifyToolTrace(inputOf({ tool_trace: [{ tool_slug: 'find_tasks' }, { tool_slug: 'create_task' }] }))
    expect(two.primary).toBe('multi_goal')
    expect(two.goals).toEqual(['task.create', 'task.find_list'])
    const three = classifyToolTrace(
      inputOf({
        tool_trace: [{ tool_slug: 'delete_task' }, { tool_slug: 'find_tasks' }, { tool_slug: 'create_task' }],
      }),
    )
    expect(three.primary).toBe('multi_goal')
    expect(three.goals).toEqual(['task.create', 'task.find_list', 'task.delete'])
  })

  test('no evidence abstains everywhere', () => {
    const tool = classifyToolTrace(inputOf({}))
    const metadata = classifyMetadata(inputOf({}))
    const hybrid = classifyHybrid(inputOf({}))
    expect(tool.abstained).toBe(true)
    expect(metadata.abstained).toBe(true)
    expect(hybrid.abstained).toBe(true)
    expect(hybrid.primary).toBe('unknown')
  })

  test('stop command family yields a deterministic no_action', () => {
    const prediction = classifyMetadata(inputOf({ command_family: 'stop' }))
    expect(prediction.primary).toBe('no_action')
    expect(prediction.goals).toEqual(['no_action'])
    expect(prediction.abstained).toBe(false)
    expect(prediction.confidence).toBe(0.99)
  })

  test('help and config command families map to their intents', () => {
    expect(classifyMetadata(inputOf({ command_family: 'help' })).primary).toBe('help_context')
    expect(classifyMetadata(inputOf({ command_family: 'config' })).primary).toBe('configuration_permissions')
  })

  test('the unsupported-goal signal yields a non-abstained unknown', () => {
    const prediction = classifyMetadata(inputOf({ feature_events: ['turn:unsupported_goal'] }))
    expect(prediction.primary).toBe('unknown')
    expect(prediction.abstained).toBe(false)
    expect(prediction.confidence).toBe(0.95)
  })

  test('structured feature signals map to their intents', () => {
    const prediction = classifyMetadata(inputOf({ feature_events: ['provider:task:create'] }))
    expect(prediction.primary).toBe('task.create')
    expect(prediction.abstained).toBe(false)
  })

  test('hybrid accepts decisive tool evidence before metadata', () => {
    const prediction = classifyHybrid(inputOf({ tool_trace: [{ tool_slug: 'create_task' }], command_family: 'help' }))
    expect(prediction.strategy).toBe('hybrid_v1')
    expect(prediction.primary).toBe('task.create')
  })

  test('hybrid falls back to metadata after tool abstention and ORs conflict flags', () => {
    const fallback = classifyHybrid(inputOf({ command_family: 'stop' }))
    expect(fallback.strategy).toBe('hybrid_v1')
    expect(fallback.primary).toBe('no_action')
    const conflicted = classifyHybrid(inputOf({ tool_trace: [{ tool_slug: 'create_task' }, { tool_slug: 'zzz' }] }))
    expect(conflicted.tool_evidence_conflict).toBe(true)
    expect(conflicted.abstained).toBe(true)
  })

  test('runtime tool slugs translate into classifier vocabulary or stay unmapped', () => {
    expect(toClassifierToolSlug('create_task')).toBe('create_task')
    expect(toClassifierToolSlug('list_tasks')).toBe('find_tasks')
    expect(toClassifierToolSlug('search_tasks')).toBe('find_tasks')
    expect(toClassifierToolSlug('web_fetch')).toBe('fetch_public_web_page')
    expect(toClassifierToolSlug('load_tool')).toBe('load_tool')
    expect(toClassifierToolSlug('external_other')).toBe('external_other')
    expect(toClassifierToolSlug('apply_youtrack_command')).toBe('apply_youtrack_command')
  })
})
