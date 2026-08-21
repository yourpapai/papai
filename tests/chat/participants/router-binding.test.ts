// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { createChatParticipantResolver } from '../../../src/chat/participants/router-binding.js'
import type { ResolveUserContext } from '../../../src/chat/types.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { groupMembers } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type LabelCall = Readonly<{ userId: string; context: ResolveUserContext | undefined }>

test('binds the roster resolver to the router, labelling every candidate in a group context', async () => {
  mockLogger()
  await setupTestDb()
  getDrizzleDb().insert(groupMembers).values({ groupId: 'g-binding', userId: 'u-1', addedBy: 'test' }).run()
  const calls: LabelCall[] = []
  const resolver = createChatParticipantResolver({
    resolveUserLabel(userId, context) {
      calls.push({ userId, context })
      return Promise.resolve('Annabel')
    },
  })

  await expect(resolver('g-binding', 'ann', 3)).resolves.toEqual([
    { userId: 'u-1', displayName: 'Annabel', username: null, score: 2 },
  ])
  expect(calls).toEqual([{ userId: 'u-1', context: { contextId: 'g-binding', contextType: 'group' } }])
})
