// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getIdentityMapping } from '../../../src/identity/mapping.js'
import { getContextSettings } from '../../../src/instances/context-store.js'
import { scenario } from '../harness/scenario.js'
import { answer } from '../harness/scripted-llm.js'

scenario('group members share durable config while retaining distinct identities', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const bob = given.user('bob')
  const group = given.group('release-team')
  given.member(group, alice)
  given.member(group, bob)
  const taskInstance = given.taskInstance()
  given.assign(group, taskInstance)
  given.identity(alice, { providerUserId: 'tracker-alice', login: 'alice.dev', displayName: 'Alice' })
  given.identity(bob, { providerUserId: 'tracker-bob', login: 'bob.dev', displayName: 'Bob' })
  given.llm([answer('Alice sees the release board.'), answer('Bob sees the release board.')])

  await when.message(alice, group, 'Show our release board')
  await when.message(bob, group, 'Show our release board too')

  then.replyIn(group).equals('Bob sees the release board.')
  const scopedGroupId = toScopedContextId({
    platformInstanceId: group.platformInstanceId,
    nativeContextId: group.id,
  })
  expect(getContextSettings(scopedGroupId)?.taskInstanceId).toBe(taskInstance.id)
  expect(getIdentityMapping(alice.id, 'kaneo')?.providerUserId).toBe('tracker-alice')
  expect(getIdentityMapping(bob.id, 'kaneo')?.providerUserId).toBe('tracker-bob')
})
