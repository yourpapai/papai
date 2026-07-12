// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getContextSettings } from '../../../src/instances/context-store.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'group members share durable config while retaining distinct identities',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const group = given.group('release-team')
    given.member(group, alice)
    given.member(group, bob)
    const taskInstance = given.taskInstance()
    given.assign(group, taskInstance)
    given.providerUser({ id: 'tracker-alice', login: 'alice', name: 'Alice' })
    given.providerUser({ id: 'tracker-bob', login: 'bob', name: 'Bob' })
    given.llm([
      callCapability('tasks.list', { projectId: 'project-1', assigneeId: 'me' }),
      answer('Alice sees her release tasks.'),
      callCapability('tasks.list', { projectId: 'project-1', assigneeId: 'me' }),
      answer('Bob sees his release tasks.'),
    ])

    await when.message(alice, group, 'Show my release tasks')
    await when.message(bob, group, 'Show my release tasks too')

    then.replyIn(group).equals('Bob sees his release tasks.')
    const scopedGroupId = toScopedContextId({
      platformInstanceId: group.platformInstanceId,
      nativeContextId: group.id,
    })
    expect(getContextSettings(scopedGroupId)?.taskInstanceId).toBe(taskInstance.id)
    expect(
      world.events
        .all()
        .filter(({ kind }) => kind === 'identity.search')
        .map(({ data }) => data),
    ).toEqual([
      { queryLength: 5, limit: 10, matchedUserIds: ['tracker-alice'] },
      { queryLength: 3, limit: 10, matchedUserIds: ['tracker-bob'] },
    ])
    expect(
      world.events
        .all()
        .filter(({ kind }) => kind === 'task.list')
        .map(({ data }) => data),
    ).toEqual([
      { projectId: 'project-1', assigneeId: 'tracker-alice', count: 0 },
      { projectId: 'project-1', assigneeId: 'tracker-bob', count: 0 },
    ])
  },
)
