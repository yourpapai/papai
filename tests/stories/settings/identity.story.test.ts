// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

const IdentitySchema = z.object({
  contextId: z.string(),
  providerName: z.string(),
  mapping: z
    .object({
      providerUserId: z.string(),
      providerUserLogin: z.string().nullable(),
      displayName: z.string().nullable(),
    })
    .nullable(),
})

scenario(
  'SCN-settings-identity: identity saved through settings resolves me in the next chat turn',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const memory = given.taskInstance('memory-tasks')
    given.assign(dm, memory)
    const session = await given.settingsSession(alice)

    const saved = await when.settingsRequest(session, '/settings/api/identity', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerUserId: 'tracker-alice', providerUserLogin: 'alice', displayName: 'Alice' }),
    })
    then.responseStatus(saved, 200)

    const observed = await when.settingsRequest(session, '/settings/api/identity')
    then.responseStatus(observed, 200)
    expect(IdentitySchema.parse(await observed.json()).mapping?.providerUserId).toBe('tracker-alice')

    given.llm([callCapability('tasks.list', { projectId: 'project-1', assigneeId: 'me' }), answer('Nothing assigned.')])
    await when.message(alice, dm, 'List my tasks')

    then.replyTo(alice).equals('Nothing assigned.')
    expect(
      world.events
        .all()
        .filter(({ kind }) => kind === 'task.list')
        .map(({ data }) => data),
    ).toEqual([{ projectId: 'project-1', assigneeId: 'tracker-alice', count: 0 }])
  },
)
