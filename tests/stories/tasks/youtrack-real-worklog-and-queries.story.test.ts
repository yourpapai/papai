// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-youtrack-real-worklog: time is logged, corrected and deleted through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance(undefined, 'youtrack'))

    given.llm([callCapability('tasks.projects.create', { name: 'Primary' }), answer('Project Primary created.')])
    await when.message(alice, dm, 'Create project Primary')
    then.replyTo(alice).equals('Project Primary created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = (await provider.listProjects?.())?.[0]?.id ?? ''
    const task = await provider.createTask({ projectId, title: 'Billable work' })

    given.llm([
      callCapability('tasks.worklog.create', {
        taskId: task.id,
        duration: '2h 30m',
        date: '2026-04-01',
        description: 'Pairing on the parser',
        type: 'Development',
      }),
      answer('Logged 2h 30m on Billable work.'),
    ])
    await when.message(alice, dm, 'Log 2h 30m of development on Billable work')
    then.replyTo(alice).contains('2h 30m')
    const logged = (await provider.listWorkItems?.(task.id)) ?? []
    expect(logged).toHaveLength(1)
    expect(logged[0]?.duration).toBe('PT2H30M')
    expect(logged[0]?.date).toBe('2026-04-01')
    expect(logged[0]?.type).toBe('Development')
    const workItemId = logged[0]?.id ?? ''

    given.llm([callCapability('tasks.worklog.list', { taskId: task.id }), answer('2h 30m logged so far.')])
    await when.message(alice, dm, 'How much time is on Billable work?')
    then.replyTo(alice).contains('2h 30m')

    given.llm([
      callCapability('tasks.worklog.update', {
        taskId: task.id,
        workItemId,
        duration: '3h',
        description: 'Pairing, then review',
        type: 'Testing',
      }),
      answer('Corrected the entry to 3h.'),
    ])
    await when.message(alice, dm, 'That was actually three hours of testing')
    then.replyTo(alice).contains('3h')
    const corrected = ((await provider.listWorkItems?.(task.id)) ?? [])[0]
    expect(corrected?.duration).toBe('PT3H')
    expect(corrected?.description).toBe('Pairing, then review')
    expect(corrected?.type).toBe('Testing')

    given.llm([
      callCapability('tasks.worklog.delete', { taskId: task.id, workItemId, confidence: 0.95 }),
      answer('Removed the entry.'),
    ])
    await when.message(alice, dm, 'Drop that time entry')
    then.replyTo(alice).contains('Removed')
    expect((await provider.listWorkItems?.(task.id)) ?? []).toEqual([])
  },
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-task-youtrack-real-queries: counting, saved queries and the YouTrack command language all run against the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance(undefined, 'youtrack'))

    given.llm([callCapability('tasks.projects.create', { name: 'Primary' }), answer('Project Primary created.')])
    await when.message(alice, dm, 'Create project Primary')
    then.replyTo(alice).equals('Project Primary created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = (await provider.listProjects?.())?.[0]?.id ?? ''
    const first = await provider.createTask({ projectId, title: 'Alpha' })
    await provider.createTask({ projectId, title: 'Beta' })

    given.llm([callCapability('tasks.count', { query: 'State: Open', projectId }), answer('Two tasks match.')])
    await when.message(alice, dm, 'How many open tasks are in Primary?')
    then.replyTo(alice).contains('Two')
    expect(await provider.countTasks?.({ query: 'State: Open', projectId })).toBe(2)

    given.llm([callCapability('tasks.queries.saved.list', {}), answer('Saved queries: Everything, Unset.')])
    await when.message(alice, dm, 'What saved queries do I have?')
    then.replyTo(alice).contains('Everything')
    const saved = (await provider.listSavedQueries?.()) ?? []
    expect(saved.map((query) => query.name)).toEqual(['Everything', 'Unset'])

    const everything = saved.find((query) => query.name === 'Everything')?.id ?? ''
    given.llm([
      callCapability('tasks.queries.saved.run', { queryId: everything }),
      answer('Everything returns Alpha and Beta.'),
    ])
    await when.message(alice, dm, 'Run the Everything query')
    then.replyTo(alice).contains('Alpha')
    expect(((await provider.runSavedQuery?.(everything)) ?? []).map((task) => task.title)).toEqual(['Alpha', 'Beta'])

    // A saved query with no search string is a real YouTrack shape, and the
    // provider refuses it rather than searching for everything.
    const unset = saved.find((query) => query.name === 'Unset')?.id ?? ''
    await expect(provider.runSavedQuery?.(unset)).rejects.toThrow('does not define a search query')

    given.llm([
      callCapability('tasks.commands.apply', {
        query: 'State In Progress',
        taskIds: [first.id],
        confidence: 0.95,
      }),
      answer('Alpha is now In Progress.'),
    ])
    await when.message(alice, dm, 'Run the YouTrack command "State In Progress" on Alpha')
    then.replyTo(alice).contains('In Progress')
    expect((await provider.getTask(first.id)).status).toBe('In Progress')
  },
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-task-youtrack-real-project-team: project membership resolves YouTrack ids into Hub ids in both directions',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance(undefined, 'youtrack'))

    given.llm([callCapability('tasks.projects.create', { name: 'Primary' }), answer('Project Primary created.')])
    await when.message(alice, dm, 'Create project Primary')
    then.replyTo(alice).equals('Project Primary created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = (await provider.listProjects?.())?.[0]?.id ?? ''

    given.llm([callCapability('tasks.identity.find', { query: 'bob' }), answer('Found bob.')])
    await when.message(alice, dm, 'Find the user bob')
    then.replyTo(alice).contains('bob')

    given.llm([callCapability('tasks.projects.team.add', { projectId, userId: 'bob' }), answer('Bob joined Primary.')])
    await when.message(alice, dm, 'Add bob to Primary')
    then.replyTo(alice).contains('joined')
    expect(((await provider.listProjectTeam?.(projectId)) ?? []).map((member) => member.login)).toEqual(['bob'])

    given.llm([callCapability('tasks.projects.team.list', { projectId }), answer('Primary team: bob.')])
    await when.message(alice, dm, 'Who is on Primary?')
    then.replyTo(alice).contains('bob')

    given.llm([callCapability('tasks.projects.team.remove', { projectId, userId: 'bob' }), answer('Bob left Primary.')])
    await when.message(alice, dm, 'Remove bob from Primary')
    then.replyTo(alice).contains('left')
    expect((await provider.listProjectTeam?.(projectId)) ?? []).toEqual([])
  },
  { realTaskProvider: 'youtrack' },
)
