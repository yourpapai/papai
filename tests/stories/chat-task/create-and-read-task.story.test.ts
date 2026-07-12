// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario('creates and reads a task through the real chat tool loop', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const taskInstance = given.taskInstance()
  given.assign(dm, taskInstance)
  given.llm([
    callCapability('tasks.create', { projectId: 'project-1', title: 'Release 7' }),
    answer('Created “Release 7”.'),
  ])

  await when.message(alice, dm, 'Create task Release 7')

  then.replyTo(alice).equals('Created “Release 7”.')
  await then.task('Release 7').exists()
  expect(world.events.all().some(({ kind }) => kind === 'task.create')).toBe(true)

  given.llm([callCapability('tasks.get', { taskId: 'task-1' }), answer('Release 7 is ready.')])

  await when.message(alice, dm, 'Read the task you just created')

  then.replyTo(alice).equals('Release 7 is ready.')
  expect(world.events.all().some(({ kind }) => kind === 'task.get')).toBe(true)
  const finalInspection = world.model.inspections().at(-1)
  expect(finalInspection?.hasToolResult).toBe(true)
  expect(finalInspection?.promptTokenFingerprints).toContain(promptTextFingerprint('Create'))
  expect(finalInspection?.promptTokenFingerprints).toContain(promptTextFingerprint('Created'))
  expect(JSON.stringify(world.events.all())).not.toContain('scenario-api-key')
})
