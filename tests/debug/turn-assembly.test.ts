// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { emitUser } from '../../src/debug/event-bus.js'
import {
  addClient,
  init,
  removeClient,
  getRecentTurns,
  getRecentNotifications,
  getRecentToolFailures,
  getInFlightTurns,
  resetTurnBuffers,
} from '../../src/debug/state-collector.js'

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

    const inFlight = getInFlightTurns()
    expect(inFlight.has('t1')).toBe(true)
    const turn = inFlight.get('t1')
    assert.ok(turn !== undefined)
    expect(turn.turnId).toBe('t1')
    expect(turn.status).toBe('running')
  })

  test('turn:end finalizes turn and moves to recentTurns', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('turn:start', 'admin-1', { turnId: 't1' })
    emitUser('turn:end', 'admin-1', { turnId: 't1', status: 'ok' })

    const inFlight = getInFlightTurns()
    expect(inFlight.has('t1')).toBe(false)

    const recent = getRecentTurns()
    expect(recent.length).toBe(1)
    expect(recent[0]!.turnId).toBe('t1')
    expect(recent[0]!.status).toBe('ok')
    expect(recent[0]!.endedAt).toBeDefined()
  })

  test('overlapping turns for the admin user are tracked separately', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('turn:start', 'admin-1', { turnId: 't1' })
    emitUser('turn:start', 'admin-1', { turnId: 't2' })

    const inFlight = getInFlightTurns()
    expect(inFlight.size).toBe(2)
    expect(inFlight.has('t1')).toBe(true)
    expect(inFlight.has('t2')).toBe(true)
  })

  test('512-entry cap on recentTurns', () => {
    init('admin-1')
    addClient(track(createMockController()))

    for (let i = 0; i < 513; i++) {
      emitUser('turn:start', 'admin-1', { turnId: `t${i}` })
      emitUser('turn:end', 'admin-1', { turnId: `t${i}`, status: 'ok' })
    }

    const recent = getRecentTurns()
    expect(recent.length).toBe(512)
    expect(recent[0]!.turnId).toBe('t1')
    expect(recent[511]!.turnId).toBe('t512')
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

    const recent = getRecentTurns()
    expect(recent.length).toBe(1)
    expect(recent[0]!.toolCalls.length).toBe(1)
    expect(recent[0]!.toolCalls[0]!.name).toBe('create_task')
    expect(recent[0]!.toolCalls[0]!.ok).toBe(false)
  })

  test('turn:error sets error status and message', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('turn:start', 'admin-1', { turnId: 't1' })
    emitUser('turn:end', 'admin-1', { turnId: 't1', status: 'error', error: 'LLM failed' })

    const recent = getRecentTurns()
    expect(recent[0]!.status).toBe('error')
    expect(recent[0]!.error).toBe('LLM failed')
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

    const notifications = getRecentNotifications()
    expect(notifications.length).toBe(1)
    expect(notifications[0]!.type).toBe('reply:sent')
  })

  test('typing events push to recentNotifications', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('typing:start', 'admin-1', {})
    emitUser('typing:stop', 'admin-1', {})

    const notifications = getRecentNotifications()
    expect(notifications.length).toBe(2)
    expect(notifications[0]!.type).toBe('typing:start')
    expect(notifications[1]!.type).toBe('typing:stop')
  })

  test('notify:* events push to recentNotifications', () => {
    init('admin-1')
    addClient(track(createMockController()))

    emitUser('notify:reminder', 'admin-1', { taskId: 'task-1' })

    const notifications = getRecentNotifications()
    expect(notifications.length).toBe(1)
    expect(notifications[0]!.type).toBe('notify:reminder')
  })

  test('2048-entry cap on recentNotifications', () => {
    init('admin-1')
    addClient(track(createMockController()))

    for (let i = 0; i < 2049; i++) {
      emitUser('reply:sent', 'admin-1', { turnId: `t${i}` })
    }

    const notifications = getRecentNotifications()
    expect(notifications.length).toBe(2048)
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

    const failures = getRecentToolFailures()
    expect(failures.length).toBe(1)
    expect(failures[0]!.data['toolName']).toBe('create_task')
  })

  test('1024-entry cap on recentToolFailures', () => {
    init('admin-1')
    addClient(track(createMockController()))

    for (let i = 0; i < 1025; i++) {
      emitUser('tool:failure_classified', 'admin-1', { toolName: `tool-${i}` })
    }

    const failures = getRecentToolFailures()
    expect(failures.length).toBe(1024)
  })
})
