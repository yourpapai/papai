import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { listManageableGroups, matchManageableGroup } from '../../src/group-settings/access.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('group settings access', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('lists only groups where the user is a known admin', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertKnownGroupContext({
      contextId: 'group-2',
      provider: 'telegram',
      displayName: 'Security',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-2',
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
    })
    addAuthorizedGroup('group-1', 'admin-1')
    addAuthorizedGroup('group-2', 'admin-1')

    expect(listManageableGroups('user-1').map((group) => group.contextId)).toEqual(['group-1'])
  })

  test('does not list observed admin groups that are no longer allowlisted', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    expect(listManageableGroups('user-1')).toEqual([])
  })

  test('matches by context id and display name and reports ambiguity', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertKnownGroupContext({
      contextId: 'group-2',
      provider: 'telegram',
      displayName: 'Operations Europe',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-2',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })
    addAuthorizedGroup('group-1', 'admin-1')
    addAuthorizedGroup('group-2', 'admin-1')

    const exactMatch = matchManageableGroup('user-1', 'group-1')
    expect(exactMatch.kind).toBe('match')
    assert(exactMatch.kind === 'match')
    expect(exactMatch.group.contextId).toBe('group-1')

    const ambiguousMatch = matchManageableGroup('user-1', 'operations')
    expect(ambiguousMatch.kind).toBe('ambiguous')
    assert(ambiguousMatch.kind === 'ambiguous')
    expect(ambiguousMatch.matches.map((group) => group.contextId)).toEqual(['group-1', 'group-2'])
  })
})
