// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { addGroupMember, isGroupMember, listGroupMembers, removeGroupMember } from '../src/groups.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('groups', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('addGroupMember adds member to group', () => {
    addGroupMember('group1', 'user1', 'admin1')
    expect(isGroupMember('group1', 'user1')).toBe(true)
  })

  test('isGroupMember returns false for non-member', () => {
    expect(isGroupMember('group1', 'user2')).toBe(false)
  })

  test('removeGroupMember removes member', () => {
    addGroupMember('group1', 'user1', 'admin1')
    removeGroupMember('group1', 'user1')
    expect(isGroupMember('group1', 'user1')).toBe(false)
  })

  test('listGroupMembers returns all members', () => {
    addGroupMember('group1', 'user1', 'admin1')
    addGroupMember('group1', 'user2', 'admin1')
    const members = listGroupMembers('group1')
    expect(members).toHaveLength(2)
    expect(members.map((m) => m.user_id).sort()).toEqual(['user1', 'user2'])
  })

  test('addGroupMember is no-op for duplicate member', () => {
    addGroupMember('group1', 'user1', 'admin1')
    addGroupMember('group1', 'user1', 'admin1')
    const members = listGroupMembers('group1')
    expect(members).toHaveLength(1)
  })

  test('listGroupMembers returns added_by and added_at', () => {
    addGroupMember('group1', 'user1', 'admin1')
    const members = listGroupMembers('group1')
    expect(members[0]).toHaveProperty('user_id', 'user1')
    expect(members[0]).toHaveProperty('added_by', 'admin1')
    expect(members[0]).toHaveProperty('added_at')
  })

  test('listGroupMembers returns empty array for unknown group', () => {
    const members = listGroupMembers('unknown-group')
    expect(members).toHaveLength(0)
  })

  test('removeGroupMember is no-op for non-member', () => {
    // Should not throw
    removeGroupMember('group1', 'nonexistent')
  })
})
