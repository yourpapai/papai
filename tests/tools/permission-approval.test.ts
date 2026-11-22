// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ToolApprovalStatus } from 'ai'

import { type DebugEvent, subscribe, unsubscribe } from '../../src/debug/event-bus.js'
import { emitToolPermissionDenied } from '../../src/llm-orchestrator-tool-events.js'
import { buildToolApproval, type AskPermissionFn, type ToolDenial } from '../../src/tools/permission-gate.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'perm-approval-ctx'

const runtimeContext = {
  contextId: CTX,
  chatUserId: 'user-1',
  contextType: 'dm' as const,
  model: 'main-model',
  modelRole: 'main' as const,
  turnId: 'turn-1',
}

type ToolCallFixture = { toolName: string; toolCallId: string; input: unknown }

const toolCall = (toolName: string, input: unknown = { id: 'X', _permission_reason: 'cleanup' }): ToolCallFixture => ({
  toolName,
  toolCallId: 'tc1',
  input,
})

const setPermission = (toolName: string, permission: 'allow' | 'ask' | 'deny'): void => {
  setToolPrefs(CTX, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { [toolName]: permission } })
}

const denialReason = (decision: ToolApprovalStatus): string =>
  typeof decision === 'object' && decision !== null && decision.type === 'denied' ? (decision.reason ?? '') : ''

describe('buildToolApproval', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an allow tool resolves not-applicable without prompting', async () => {
    setPermission('get_task', 'allow')
    const prompts: unknown[] = []
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: (req) => {
        prompts.push(req)
        return Promise.resolve('allow')
      },
    })

    await expect(resolver({ toolCall: toolCall('get_task') })).resolves.toBe('not-applicable')
    expect(prompts).toHaveLength(0)
  })

  test('a deny tool resolves not-applicable without prompting (absent from the toolset)', async () => {
    setPermission('get_task', 'deny')
    const prompts: unknown[] = []
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: (req) => {
        prompts.push(req)
        return Promise.resolve('allow')
      },
    })

    await expect(resolver({ toolCall: toolCall('get_task') })).resolves.toBe('not-applicable')
    expect(prompts).toHaveLength(0)
  })

  test('an ask tool awaits the prompt once with the stripped reason and args, then approves', async () => {
    setPermission('delete_task', 'ask')
    const prompts: { toolName: string; reason: string; args: Record<string, unknown> }[] = []
    const askPermission: AskPermissionFn = (req) => {
      prompts.push(req)
      return Promise.resolve('allow')
    }
    const resolver = buildToolApproval({ contextId: CTX, askPermission })

    await expect(resolver({ toolCall: toolCall('delete_task') })).resolves.toBe('approved')
    expect(prompts).toEqual([{ toolName: 'delete_task', reason: 'cleanup', args: { id: 'X' } }])
  })

  test('a denial returns the user-denied reason and reports the denial', async () => {
    setPermission('delete_task', 'ask')
    const denials: ToolDenial[] = []
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: () => Promise.resolve('deny'),
      onDenied: (denial) => {
        denials.push(denial)
      },
    })

    await expect(resolver({ toolCall: toolCall('delete_task'), runtimeContext })).resolves.toEqual({
      type: 'denied',
      reason: "User denied execution of 'delete_task'.",
    })
    expect(denials).toHaveLength(1)
    expect(denials[0]).toMatchObject({
      toolName: 'delete_task',
      toolCallId: 'tc1',
      runtime: { contextId: CTX, turnId: 'turn-1' },
    })
    expect(denials[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('an ignored (timeout) decision returns the timeout reason', async () => {
    setPermission('delete_task', 'ask')
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: () => Promise.resolve('ignored'),
    })

    const result = await resolver({ toolCall: toolCall('delete_task') })
    expect(result).toMatchObject({ type: 'denied' })
    expect(denialReason(result)).toContain('five minutes')
  })

  test('a missing prompt surface denies without prompting and names the surface', async () => {
    setPermission('delete_task', 'ask')
    const denials: ToolDenial[] = []
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: undefined,
      onDenied: (denial) => {
        denials.push(denial)
      },
    })

    const result = await resolver({ toolCall: toolCall('delete_task') })
    expect(result).toMatchObject({ type: 'denied' })
    expect(denialReason(result)).toContain('no chat surface')
    expect(denials).toHaveLength(1)
  })

  test('a mid-turn preference tightened to ask still prompts', async () => {
    setPermission('create_task', 'allow')
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: () => Promise.resolve('deny'),
    })
    setPermission('create_task', 'ask')

    await expect(resolver({ toolCall: toolCall('create_task') })).resolves.toMatchObject({ type: 'denied' })
  })

  test('a denied call emits the permission_denied analytics terminal', async () => {
    setPermission('delete_task', 'ask')
    const events: DebugEvent[] = []
    const listener = (event: DebugEvent): void => {
      events.push(event)
    }
    subscribe(listener)
    try {
      const resolver = buildToolApproval({
        contextId: CTX,
        askPermission: () => Promise.resolve('deny'),
        onDenied: (denial) => {
          if (denial.runtime === null) return
          emitToolPermissionDenied(denial.runtime, denial)
        },
      })
      await resolver({ toolCall: toolCall('delete_task'), runtimeContext })
    } finally {
      unsubscribe(listener)
    }

    const terminals = events.filter((event) => event.type === 'tool:analytics_completed')
    expect(terminals).toHaveLength(1)
    expect(terminals[0]!.turnId).toBe('turn-1')
    expect(terminals[0]!.data['executionOutcome']).toBe('permission_denied')
    expect(terminals[0]!.data['resultBytes']).toBe(0)
    expect(JSON.stringify(terminals[0]!.data)).not.toContain('cleanup')
  })

  test('runtime context matrix: malformed attribution is dropped, valid attribution is kept', async () => {
    type RuntimeRow = Row<{ runtime: unknown; accepted: boolean }>
    const rows: readonly RuntimeRow[] = [
      { label: 'valid dm/main', runtime: runtimeContext, accepted: true },
      {
        label: 'valid group/small',
        runtime: { ...runtimeContext, contextType: 'group', modelRole: 'small' },
        accepted: true,
      },
      { label: 'non-object runtime', runtime: 'nope', accepted: false },
      { label: 'missing contextId', runtime: { ...runtimeContext, contextId: 42 }, accepted: false },
      { label: 'missing chatUserId', runtime: { ...runtimeContext, chatUserId: 42 }, accepted: false },
      { label: 'missing model', runtime: { ...runtimeContext, model: 42 }, accepted: false },
      { label: 'missing turnId', runtime: { ...runtimeContext, turnId: 42 }, accepted: false },
      { label: 'unknown contextType', runtime: { ...runtimeContext, contextType: 'channel' }, accepted: false },
      { label: 'unknown modelRole', runtime: { ...runtimeContext, modelRole: 'other' }, accepted: false },
    ]
    await assertEach(rows, async (row) => {
      setPermission('delete_task', 'ask')
      const denials: ToolDenial[] = []
      const resolver = buildToolApproval({
        contextId: CTX,
        askPermission: () => Promise.resolve('deny'),
        onDenied: (denial) => {
          denials.push(denial)
        },
      })
      await resolver({ toolCall: toolCall('delete_task'), runtimeContext: row.runtime })
      expect(denials[0]!.runtime !== null).toBe(row.accepted)
    })
  })

  test('the denial duration is the approval latency', async () => {
    setPermission('delete_task', 'ask')
    const clock = [1000, 1250]
    const denials: ToolDenial[] = []
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: () => Promise.resolve('deny'),
      onDenied: (denial) => {
        denials.push(denial)
      },
      now: () => clock.shift() ?? 1250,
    })

    await resolver({ toolCall: toolCall('delete_task') })
    expect(denials[0]!.durationMs).toBe(250)
  })

  test('a backwards clock clamps the denial duration at zero', async () => {
    setPermission('delete_task', 'ask')
    const clock = [1000, 900]
    const denials: ToolDenial[] = []
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: () => Promise.resolve('deny'),
      onDenied: (denial) => {
        denials.push(denial)
      },
      now: () => clock.shift() ?? 900,
    })

    await resolver({ toolCall: toolCall('delete_task') })
    expect(denials[0]!.durationMs).toBe(0)
  })

  test('a non-string _permission_reason is not forwarded to the prompt', async () => {
    setPermission('delete_task', 'ask')
    const prompts: { reason: string; args: Record<string, unknown> }[] = []
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: (req) => {
        prompts.push(req)
        return Promise.resolve('deny')
      },
    })

    await resolver({ toolCall: toolCall('delete_task', { id: 'X', _permission_reason: 42 }) })
    expect(prompts[0]!.reason).toBe('')
    expect(prompts[0]!.args).toEqual({ id: 'X' })
  })

  test('a non-object call input is prompted with empty args', async () => {
    setPermission('delete_task', 'ask')
    const prompts: { reason: string; args: Record<string, unknown> }[] = []
    const resolver = buildToolApproval({
      contextId: CTX,
      askPermission: (req) => {
        prompts.push(req)
        return Promise.resolve('deny')
      },
    })

    await resolver({ toolCall: { toolName: 'delete_task', toolCallId: 'tc1', input: 'raw' } })
    expect(prompts[0]!.args).toEqual({})
  })
})
