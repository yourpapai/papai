// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { isGroupMember } from '../../../src/groups.js'
import { isAuthorized } from '../../../src/users.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario('guest group turns can read tasks but cannot advertise writes', async ({ given, when, then, world }) => {
  const member = given.user('member-writer')
  const guest = given.guest('guest-reader')
  const group = given.group('public-release-team')
  given.member(group, member)
  const taskInstance = given.taskInstance()
  given.assign(group, taskInstance)
  given.guestMode(group, true)
  given.llm([
    callCapability('tasks.create', { projectId: 'project-1', title: 'Member-owned release task' }),
    answer('Created the member task.'),
    callCapability('tasks.list', { projectId: 'project-1' }),
    answer('The release task is visible.'),
  ])

  await when.message(member, group, 'Create a release task')
  then.replyIn(group).equals('Created the member task.')
  await then.task('Member-owned release task').exists()
  expect(world.runtime.resolveToolCapability('tasks.create')).toBe('create_task')
  expect(world.model.inspections().some(({ availableTools }) => availableTools.includes('create_task'))).toBe(true)
  const memberGenerationCount = world.model.inspections().length

  await when.message(guest, group, 'List release tasks')

  then.replyIn(group).equals('The release task is visible.')
  expect(world.events.all().some(({ kind }) => kind === 'task.list')).toBe(true)
  const guestGenerations = world.model.inspections().slice(memberGenerationCount)
  expect(guestGenerations.length).toBeGreaterThan(0)
  expect(guestGenerations.every(({ availableTools }) => !availableTools.includes('create_task'))).toBe(true)
  expect(guestGenerations.some(({ availableTools }) => availableTools.includes('list_tasks'))).toBe(true)
  expect(world.runtime.resolveToolCapability('tasks.create')).toBe('create_task')
  const scopedGroupId = toScopedContextId({
    platformInstanceId: group.platformInstanceId,
    nativeContextId: group.id,
  })
  expect(isAuthorized(guest.id, guest.platformInstanceId)).toBe(false)
  expect(isGroupMember(scopedGroupId, guest.id)).toBe(false)
})
