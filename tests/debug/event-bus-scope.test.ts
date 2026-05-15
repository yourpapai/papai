import { afterEach, describe, expect, test } from 'bun:test'

import { emitGlobal, emitGroup, emitUser, subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'

describe('event-bus scope helpers', () => {
  const listeners: Array<(event: DebugEvent) => void> = []

  afterEach(() => {
    for (const fn of listeners) unsubscribe(fn)
    listeners.length = 0
  })

  const track = (fn: (event: DebugEvent) => void): typeof fn => {
    listeners.push(fn)
    return fn
  }

  test('emitUser injects user scope and userId onto __scope', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emitUser('user:event', 'user-123', { action: 'test' })

    expect(received).not.toBeNull()
    expect(received!.type).toBe('user:event')
    expect(received!.data).toEqual({ action: 'test' })
    expect(received!.__scope).toEqual({ kind: 'user', userId: 'user-123' })
    expect(received!.turnId).toBeUndefined()
  })

  test('emitUser injects turnId when provided as 4th argument', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emitUser('user:turn', 'user-456', { step: 1 }, 'turn-abc')

    expect(received).not.toBeNull()
    expect(received!.__scope).toEqual({ kind: 'user', userId: 'user-456' })
    expect(received!.turnId).toBe('turn-abc')
  })

  test('emitGroup injects group scope with groupId', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emitGroup('group:event', 'group-789', { msg: 'hello' })

    expect(received).not.toBeNull()
    expect(received!.type).toBe('group:event')
    expect(received!.data).toEqual({ msg: 'hello' })
    expect(received!.__scope).toEqual({ kind: 'group', groupId: 'group-789' })
    expect(received!.turnId).toBeUndefined()
  })

  test('emitGroup injects threadId when provided as 5th argument', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emitGroup('group:thread', 'group-abc', { x: 1 }, 'turn-xyz', 'thread-42')

    expect(received).not.toBeNull()
    expect(received!.__scope).toEqual({
      kind: 'group',
      groupId: 'group-abc',
      threadId: 'thread-42',
    })
    expect(received!.turnId).toBe('turn-xyz')
  })

  test('emitGlobal injects global scope', () => {
    let received: DebugEvent | null = null
    subscribe(
      track((e) => {
        received = e
      }),
    )

    emitGlobal('global:event', { status: 'ok' })

    expect(received).not.toBeNull()
    expect(received!.type).toBe('global:event')
    expect(received!.data).toEqual({ status: 'ok' })
    expect(received!.__scope).toEqual({ kind: 'global' })
  })
})
