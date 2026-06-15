// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { emitUser } from '../../src/debug/event-bus.js'
import type { DebugEvent } from '../../src/debug/event-bus.js'
import { addClient, init, removeClient } from '../../src/debug/state-collector.js'
import {
  recentTurns,
  recentNotifications,
  recentToolFailures,
  inFlightTurns,
  resetTurnBuffers,
  findTurnById,
  handleTurnAssembly,
} from '../../src/debug/turn-assembly.js'

function createMockController(): ReadableStreamDefaultController {
  return {
    enqueue: (): void => {},
    close: (): void => {},
    error: (): void => {},
    desiredSize: 1,
  }
}

describe('turn assembly', () => {
  const controllers: ReadableStreamDefaultController[] = []

  afterEach(() => {
    for (const ctrl of controllers) removeClient(ctrl)
    controllers.length = 0
    resetTurnBuffers()
  })

  function track(ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController {
    controllers.push(ctrl)
    return ctrl
  }

  test('turn:start creates an in-flight turn', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('turn:start', 'admin-1', { turnId: 't1' })

    expect(inFlightTurns.has('t1')).toBe(true)
    const turn = inFlightTurns.get('t1')
    assert.ok(turn !== undefined)
    expect(turn.turnId).toBe('t1')
    expect(turn.status).toBe('running')
  })

  test('turn:end finalizes turn and moves to recentTurns', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('turn:start', 'admin-1', { turnId: 't1' })
    emitUser('turn:end', 'admin-1', { turnId: 't1', status: 'ok' })

    expect(inFlightTurns.has('t1')).toBe(false)

    expect(recentTurns.length).toBe(1)
    expect(recentTurns[0]!.turnId).toBe('t1')
    expect(recentTurns[0]!.status).toBe('ok')
    expect(recentTurns[0]!.endedAt).toBeDefined()
  })

  test('overlapping turns for the admin user are tracked separately', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('turn:start', 'admin-1', { turnId: 't1' })
    emitUser('turn:start', 'admin-1', { turnId: 't2' })

    expect(inFlightTurns.size).toBe(2)
    expect(inFlightTurns.has('t1')).toBe(true)
    expect(inFlightTurns.has('t2')).toBe(true)
  })

  test('512-entry cap on recentTurns', () => {
    init('admin-1')
    addClient(track(createMockController()))

    for (let i = 0; i < 513; i++) {
      emitUser('turn:start', 'admin-1', { turnId: `t${i}` })
      emitUser('turn:end', 'admin-1', { turnId: `t${i}`, status: 'ok' })
    }

    expect(recentTurns.length).toBe(512)
    expect(recentTurns[0]!.turnId).toBe('t1')
    expect(recentTurns[511]!.turnId).toBe('t512')
  })

  test('tool calls are accumulated on in-flight turn', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('turn:start', 'admin-1', { turnId: 't1' })
    emitUser('tool:failure_classified', 'admin-1', {
      turnId: 't1',
      toolName: 'create_task',
      durationMs: 200,
      ok: false,
      failureReason: 'permission_denied',
    })
    emitUser('turn:end', 'admin-1', { turnId: 't1', status: 'ok' })

    expect(recentTurns.length).toBe(1)
    expect(recentTurns[0]!.toolCalls.length).toBe(1)
    expect(recentTurns[0]!.toolCalls[0]!.name).toBe('create_task')
    expect(recentTurns[0]!.toolCalls[0]!.ok).toBe(false)
  })

  test('turn:error sets error status and message', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('turn:start', 'admin-1', { turnId: 't1' })
    emitUser('turn:end', 'admin-1', { turnId: 't1', status: 'error', error: 'LLM failed' })

    expect(recentTurns[0]!.status).toBe('error')
    expect(recentTurns[0]!.error).toBe('LLM failed')
  })
})

describe('notification ring buffer', () => {
  const controllers: ReadableStreamDefaultController[] = []

  afterEach(() => {
    for (const ctrl of controllers) removeClient(ctrl)
    controllers.length = 0
    resetTurnBuffers()
  })

  function track(ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController {
    controllers.push(ctrl)
    return ctrl
  }

  test('reply:sent pushes to recentNotifications', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('reply:sent', 'admin-1', { turnId: 't1', durationMs: 300 })

    expect(recentNotifications.length).toBe(1)
    expect(recentNotifications[0]!.type).toBe('reply:sent')
  })

  test('typing events push to recentNotifications', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('typing:start', 'admin-1', {})
    emitUser('typing:stop', 'admin-1', {})

    expect(recentNotifications.length).toBe(2)
    expect(recentNotifications[0]!.type).toBe('typing:start')
    expect(recentNotifications[1]!.type).toBe('typing:stop')
  })

  test('notify:* events push to recentNotifications', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('notify:reminder', 'admin-1', { taskId: 'task-1' })

    expect(recentNotifications.length).toBe(1)
    expect(recentNotifications[0]!.type).toBe('notify:reminder')
  })

  test('2048-entry cap on recentNotifications', () => {
    init('admin-1')
    addClient(track(createMockController()))

    for (let i = 0; i < 2049; i++) {
      emitUser('reply:sent', 'admin-1', { turnId: `t${i}` })
    }

    expect(recentNotifications.length).toBe(2048)
  })
})

describe('tool failure ring buffer', () => {
  const controllers: ReadableStreamDefaultController[] = []

  afterEach(() => {
    for (const ctrl of controllers) removeClient(ctrl)
    controllers.length = 0
    resetTurnBuffers()
  })

  function track(ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController {
    controllers.push(ctrl)
    return ctrl
  }

  test('tool:failure_classified pushes to recentToolFailures', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('tool:failure_classified', 'admin-1', {
      toolName: 'create_task',
      failureReason: 'permission_denied',
    })

    expect(recentToolFailures.length).toBe(1)
    expect(recentToolFailures[0]!.data['toolName']).toBe('create_task')
  })

  test('1024-entry cap on recentToolFailures', () => {
    init('admin-1')
    addClient(track(createMockController()))

    for (let i = 0; i < 1025; i++) {
      emitUser('tool:failure_classified', 'admin-1', { toolName: `tool-${i}` })
    }

    expect(recentToolFailures.length).toBe(1024)
  })
})

const startEvent = (turnId: string): DebugEvent => ({
  type: 'turn:start',
  timestamp: 1,
  scope: { kind: 'user', userId: 'u' },
  data: { turnId, incomingMessageCount: 1 },
})

describe('findTurnById', () => {
  beforeEach(() => {
    resetTurnBuffers()
  })

  test('resolves a still-running (in-flight) turn', () => {
    handleTurnAssembly(startEvent('t-run'), () => {})
    const turn = findTurnById('t-run')
    expect(turn).toBeDefined()
    expect(turn!.status).toBe('running')
  })
})
