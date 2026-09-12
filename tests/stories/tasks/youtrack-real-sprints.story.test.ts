// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-youtrack-real-sprint-lifecycle: board listing, sprint create/update, and task assignment through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)

    given.llm([callCapability('tasks.projects.create', { name: 'Primary' }), answer('Project Primary created.')])
    await when.message(alice, dm, 'Create project Primary')
    then.replyTo(alice).equals('Project Primary created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = (await provider.listProjects?.())?.[0]?.id ?? ''
    expect(projectId).not.toBe('')
    const task = await provider.createTask({ projectId, title: 'Sprint task' })

    given.llm([callCapability('tasks.agiles.list', {}), answer('Boards: Main Board.')])
    await when.message(alice, dm, 'List my agile boards')
    then.replyTo(alice).contains('Main Board')
    const agiles = (await provider.listAgiles?.()) ?? []
    const agileId = agiles.find((a) => a.name === 'Main Board')?.id ?? ''
    expect(agileId).not.toBe('')

    given.llm([
      callCapability('tasks.sprints.create', {
        agileId,
        name: 'Sprint 1',
        goal: 'Ship it',
        start: '2026-03-02T09:00:00.000Z',
        finish: '2026-03-13T17:00:00.000Z',
      }),
      answer('Sprint 1 created.'),
    ])
    await when.message(alice, dm, 'Create Sprint 1 with a goal and dates')
    then.replyTo(alice).contains('Sprint 1')
    const created = ((await provider.listSprints?.(agileId)) ?? []).find((s) => s.name === 'Sprint 1')
    expect(created).toBeDefined()
    expect(created?.start).toBe('2026-03-02T09:00:00.000Z')
    expect(created?.finish).toBe('2026-03-13T17:00:00.000Z')
    expect(created?.goal).toBe('Ship it')
    const sprintId = created!.id

    given.llm([
      callCapability('tasks.sprints.update', { agileId, sprintId, goal: null, archived: true }),
      answer('Sprint 1 updated.'),
    ])
    await when.message(alice, dm, 'Clear the sprint goal and archive it')
    then.replyTo(alice).contains('updated')
    const updated = ((await provider.listSprints?.(agileId)) ?? []).find((s) => s.id === sprintId)
    expect(updated?.goal ?? null).toBeNull()
    expect(updated?.archived).toBe(true)
    expect(updated?.unresolvedIssuesCount ?? 0).toBe(0)

    given.llm([
      callCapability('tasks.sprints.assign', { taskId: task.id, sprintId }),
      answer('Task assigned to Sprint 1.'),
    ])
    await when.message(alice, dm, 'Assign the task to Sprint 1')
    then.replyTo(alice).contains('assigned')
    const assigned = ((await provider.listSprints?.(agileId)) ?? []).find((s) => s.id === sprintId)
    expect(assigned?.unresolvedIssuesCount).toBe(1)
  },
  { realTaskProvider: 'youtrack' },
)
