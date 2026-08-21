// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { createChatParticipantResolver } from '../../../src/chat/participants/router-binding.js'
import type { ResolveUserContext } from '../../../src/chat/types.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { groupMembers } from '../../../src/db/schema.js'
import { logger, logMultistream } from '../../../src/logger.js'
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

test('forwards chatUserId so log attribution survives the router binding', async () => {
  // No mockLogger here: attribution is asserted against actual egress via the roster
  // resolver's debug entry (mirrors tests/chat/participants/roster.test.ts).
  await setupTestDb()
  getDrizzleDb().insert(groupMembers).values({ groupId: 'g-binding', userId: 'u-1', addedBy: 'test' }).run()
  const resolver = createChatParticipantResolver({
    resolveUserLabel: () => Promise.resolve('Annabel'),
  })
  const logLines: string[] = []
  logMultistream.add({ level: 'debug', stream: { write: (chunk: string): void => void logLines.push(chunk) } })
  logger.level = 'debug'
  try {
    await resolver('g-binding', 'ann', 3, 'user-9')
  } finally {
    logger.level = 'silent'
  }
  const debugEntry = logLines.find((line) => line.includes('"msg":"resolveChatParticipant"}'))
  expect(debugEntry, 'expected a resolveChatParticipant debug log entry').toBeDefined()
  expect(debugEntry).toContain('"chatUserId":"user-9"')
})
