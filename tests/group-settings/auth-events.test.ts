import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup, removeAuthorizedGroup } from '../../src/authorized-groups.js'
import { addGroupMember, removeGroupMember } from '../../src/groups.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('auth:group_* events', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('addAuthorizedGroup emits auth:group_authorized event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    addAuthorizedGroup('group-1', 'admin-1')

    const authEvent = events.find((e) => e.type === 'auth:group_authorized')
    expect(authEvent).toBeDefined()
    expect(authEvent?.data['groupId']).toBe('group-1')
  })

  test('removeAuthorizedGroup emits auth:group_revoked event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    addAuthorizedGroup('group-1', 'admin-1')
    removeAuthorizedGroup('group-1')

    const revokedEvent = events.find((e) => e.type === 'auth:group_revoked')
    expect(revokedEvent).toBeDefined()
    expect(revokedEvent?.data['groupId']).toBe('group-1')
  })
})

describe('group_member:* events', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('addGroupMember emits group_member:added event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    addGroupMember('group-1', 'user-1', 'admin-1')

    const addedEvent = events.find((e) => e.type === 'group_member:added')
    expect(addedEvent).toBeDefined()
    expect(addedEvent?.data['groupId']).toBe('group-1')
    expect(addedEvent?.data['userId']).toBe('user-1')
  })

  test('removeGroupMember emits group_member:removed event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    addGroupMember('group-1', 'user-1', 'admin-1')
    removeGroupMember('group-1', 'user-1')

    const removedEvent = events.find((e) => e.type === 'group_member:removed')
    expect(removedEvent).toBeDefined()
    expect(removedEvent?.data['groupId']).toBe('group-1')
    expect(removedEvent?.data['userId']).toBe('user-1')
  })
})
