import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { createTrackedLoggerMock, type LogCall, type TrackedLoggerMock } from './utils/logger-mock.js'
import { setupTestDb } from './utils/test-helpers.js'

type AuthorizedGroupsModule = typeof import('../src/authorized-groups.js')

const importAuthorizedGroupsModule = (): Promise<AuthorizedGroupsModule> =>
  import(`../src/authorized-groups.js?test=${crypto.randomUUID()}`)

const hasGroupLogMetadata = (value: unknown, groupId: string, addedBy: string): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return Reflect.get(value, 'groupId') === groupId && Reflect.get(value, 'addedBy') === addedBy
}

const hasAuthorizedGroupLog = (call: LogCall, message: string, groupId: string, addedBy: string): boolean => {
  const [metadata, logMessage] = call.args
  if (logMessage !== message) {
    return false
  }

  return hasGroupLogMetadata(metadata, groupId, addedBy)
}

describe('authorized groups', () => {
  const trackedLogger: TrackedLoggerMock = createTrackedLoggerMock()

  beforeEach(async () => {
    trackedLogger.clearCalls()
    void mock.module('../src/logger.js', () => ({
      getLogLevel: trackedLogger.getLogLevel,
      logger: trackedLogger.logger,
    }))

    await setupTestDb()
  })

  test('addAuthorizedGroup persists a group entry', async () => {
    const { addAuthorizedGroup, isAuthorizedGroup } = await importAuthorizedGroupsModule()

    addAuthorizedGroup('group-1', 'admin-1')

    expect(isAuthorizedGroup('group-1')).toBe(true)
  })

  test('listAuthorizedGroups returns stored entries with metadata', async () => {
    const { addAuthorizedGroup, listAuthorizedGroups } = await importAuthorizedGroupsModule()

    addAuthorizedGroup('group-1', 'admin-1')
    addAuthorizedGroup('group-2', 'admin-2')

    const groups = listAuthorizedGroups()
    const [firstGroup, secondGroup] = groups

    assert(firstGroup !== undefined, 'expected firstGroup to be defined')
    assert(secondGroup !== undefined, 'expected secondGroup to be defined')

    expect(groups).toHaveLength(2)
    expect(firstGroup.group_id).toBe('group-2')
    expect(firstGroup.added_by).toBe('admin-2')
    expect(typeof firstGroup.added_at).toBe('string')
    expect(firstGroup.added_at.length).toBeGreaterThan(0)
    expect(secondGroup.group_id).toBe('group-1')
    expect(secondGroup.added_by).toBe('admin-1')
    expect(typeof secondGroup.added_at).toBe('string')
    expect(secondGroup.added_at.length).toBeGreaterThan(0)
  })

  test('addAuthorizedGroup is a no-op for duplicates', async () => {
    const { addAuthorizedGroup, listAuthorizedGroups } = await importAuthorizedGroupsModule()

    addAuthorizedGroup('group-1', 'admin-1')
    trackedLogger.clearCalls()
    addAuthorizedGroup('group-1', 'admin-2')

    const groups = listAuthorizedGroups()
    const [firstGroup] = groups

    assert(firstGroup !== undefined, 'expected one authorized group')

    expect(groups).toHaveLength(1)
    expect(firstGroup.group_id).toBe('group-1')
    expect(firstGroup.added_by).toBe('admin-1')

    const infoCalls = trackedLogger.getCallsByLevel('info')
    expect(infoCalls.some((call) => hasAuthorizedGroupLog(call, 'Authorized group added', 'group-1', 'admin-2'))).toBe(
      false,
    )
    expect(
      infoCalls.some((call) => hasAuthorizedGroupLog(call, 'Authorized group already present', 'group-1', 'admin-2')),
    ).toBe(true)
  })

  test('removeAuthorizedGroup deletes existing groups and reports whether it removed one', async () => {
    const { addAuthorizedGroup, isAuthorizedGroup, removeAuthorizedGroup } = await importAuthorizedGroupsModule()

    addAuthorizedGroup('group-1', 'admin-1')

    expect(removeAuthorizedGroup('group-1')).toBe(true)
    expect(removeAuthorizedGroup('group-1')).toBe(false)
    expect(isAuthorizedGroup('group-1')).toBe(false)
  })
})
