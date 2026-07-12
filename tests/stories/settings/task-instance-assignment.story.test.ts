// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { z } from 'zod'

import { CSRF_HEADER } from '../../../src/settings/request-auth.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

const AssignmentResponseSchema = z.object({
  contextId: z.string(),
  taskInstanceId: z.string().nullable(),
})

scenario(
  'settings task assignment changes the provider used by the next chat turn',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const memory = given.taskInstance('memory-tasks')
    const session = await given.settingsSession(alice)
    const body = JSON.stringify({ taskInstanceId: memory.id })

    const unauthenticated = await when.request('/settings/api/context/task-instance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(unauthenticated, 401)

    const rejected = await when.settingsRequest(session, '/settings/api/context/task-instance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', [CSRF_HEADER]: '' },
      body,
    })
    then.responseStatus(rejected, 403)

    const assigned = await when.settingsRequest(session, '/settings/api/context/task-instance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    then.responseStatus(assigned, 200)

    const observed = await when.settingsRequest(session, '/settings/api/context/task-instance')
    then.responseStatus(observed, 200)
    expect(AssignmentResponseSchema.parse(await observed.json()).taskInstanceId).toBe(memory.id)

    given.llm([
      callCapability('tasks.create', { projectId: 'project-1', title: 'Release 8' }),
      answer('Created “Release 8”.'),
    ])
    await when.message(alice, dm, 'Create task Release 8')

    then.replyTo(alice).equals('Created “Release 8”.')
    await then.task('Release 8').exists()
    expect(world.events.all().some(({ kind }) => kind === 'task.create')).toBe(true)
  },
)
