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
  const guest = given.guest('guest-reader')
  const group = given.group('public-release-team')
  const taskInstance = given.taskInstance()
  given.assign(group, taskInstance)
  given.guestMode(group, true)
  given.llm([callCapability('tasks.list', { projectId: 'project-1' }), answer('There are no release tasks yet.')])

  await when.message(guest, group, 'List release tasks')

  then.replyIn(group).equals('There are no release tasks yet.')
  expect(world.events.all().some(({ kind }) => kind === 'task.list')).toBe(true)
  expect(world.model.inspections().some(({ availableTools }) => availableTools.includes('create_task'))).toBe(false)
  expect(() => world.runtime.resolveToolCapability('tasks.create')).toThrow("Unknown tool capability id 'tasks.create'")
  const scopedGroupId = toScopedContextId({
    platformInstanceId: group.platformInstanceId,
    nativeContextId: group.id,
  })
  expect(isAuthorized(guest.id, guest.platformInstanceId)).toBe(false)
  expect(isGroupMember(scopedGroupId, guest.id)).toBe(false)
})
