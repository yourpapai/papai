// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-youtrack-real-create: activates the real YouTrack plugin and creates a task over fake REST',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Real YouTrack' }), answer('Project created.')])

    await when.message(alice, dm, 'Create a project called Real YouTrack')
    then.replyTo(alice).equals('Project created.')
  },
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-task-youtrack-real-fields: maps YouTrack custom fields through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)
    given.llm([callCapability('tasks.projects.create', { name: 'Fields' }), answer('Project created.')])

    await when.message(alice, dm, 'Create a project called Fields')
    then.replyTo(alice).equals('Project created.')

    const provider = await resolveRealTaskProvider(dm)
    const projects = (await provider.listProjects?.()) ?? []
    const projectId = projects[0]?.id ?? ''

    given.llm([
      callCapability('tasks.create', { projectId, title: 'Field Mapped', status: 'In Progress', priority: 'high' }),
      answer('Task created.'),
    ])
    await when.message(alice, dm, 'Create Field Mapped in progress at high priority')
    then.replyTo(alice).equals('Task created.')

    const tasks = await provider.listTasks(projectId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.status).toBe('In Progress')
    expect(tasks[0]?.priority).toBe('high')
  },
  { realTaskProvider: 'youtrack' },
)
