// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildProactiveTrigger } from '../../src/deferred-prompts/proactive-trigger.js'
import { buildSystemPrompt } from '../../src/system-prompt.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('buildProactiveTrigger', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('systemContext includes PROACTIVE EXECUTION header', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Test prompt', 'UTC')
    expect(trigger.systemContext).toContain('[PROACTIVE EXECUTION]')
  })

  test('systemContext includes delivery mode instructions', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Test prompt', 'UTC')
    expect(trigger.systemContext).toContain('DELIVER the result to the user now')
    expect(trigger.systemContext).toContain('NOT as a new user request')
  })

  test('systemContext includes anti-recursion rule', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Test prompt', 'UTC')
    expect(trigger.systemContext).toContain('Do NOT create new deferred prompts')
  })

  test('systemContext includes trigger type', () => {
    const trigger = buildProactiveTrigger('alert', 'Test prompt', 'UTC')
    expect(trigger.systemContext).toContain('Trigger type: alert')
  })

  test('userContent wraps prompt with spotlighting delimiters', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Check the gigachat model', 'UTC')
    expect(trigger.userContent).toContain('===DEFERRED_TASK===')
    expect(trigger.userContent).toContain('Check the gigachat model')
    expect(trigger.userContent).toContain('===END_DEFERRED_TASK===')
  })

  test('userContent includes matched tasks summary for alerts', () => {
    const trigger = buildProactiveTrigger('alert', 'Report overdue tasks', 'UTC', 'Task A\nTask B')
    expect(trigger.userContent).toContain('===DEFERRED_TASK===')
    expect(trigger.userContent).toContain('Report overdue tasks')
    expect(trigger.userContent).toContain('===END_DEFERRED_TASK===')
    expect(trigger.userContent).toContain('Matched tasks:')
    expect(trigger.userContent).toContain('Task A\nTask B')
  })

  test('userContent without matched tasks has no Matched tasks section', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Just a reminder', 'UTC')
    expect(trigger.userContent).not.toContain('Matched tasks:')
  })

  test('falls back to UTC for invalid timezone', () => {
    const trigger = buildProactiveTrigger('scheduled', 'Test', 'Invalid/Zone')
    expect(trigger.systemContext).toContain('UTC')
  })
})

describe('buildSystemPrompt — deferred prompt sections', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  const provider = createMockProvider()

  test('includes PROMPT CONTENT guidance in DEFERRED PROMPTS section', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')
    expect(prompt).toContain('PROMPT CONTENT')
    expect(prompt).toContain('deliverable action, not the scheduling')
  })

  test('PROACTIVE MODE references spotlighting delimiters', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')
    expect(prompt).toContain('===DEFERRED_TASK===')
  })

  test('PROACTIVE MODE includes anti-recursion rule', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')
    expect(prompt).toContain('Never create new deferred prompts during proactive execution')
  })
})
