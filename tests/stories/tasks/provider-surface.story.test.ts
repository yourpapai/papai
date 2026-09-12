// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario('SCN-task-relations: links, retypes, and unlinks tasks', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['tasks.relations'])
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'First' }),
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Second' }),
    answer('Both created.'),
  ])

  await when.message(alice, dm, 'Create tasks First and Second')

  given.llm([
    callCapability('tasks.relations.add', { taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' }),
    answer('First now blocks Second.'),
  ])
  await when.message(alice, dm, 'Make First block Second')
  then.replyTo(alice).equals('First now blocks Second.')

  given.llm([
    callCapability('tasks.relations.add', { taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' }),
    answer('They are already linked.'),
    answer('They are already linked.'),
  ])
  await when.message(alice, dm, 'Link them again')
  then.replyTo(alice).equals('They are already linked.')

  given.llm([
    callCapability('tasks.relations.update', { taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' }),
    callCapability('tasks.relations.remove', { taskId: 'task-1', relatedTaskId: 'task-2' }),
    answer('Retyped, then unlinked.'),
  ])
  await when.message(alice, dm, 'Retype to related, then unlink')

  given.llm([
    callCapability('tasks.relations.remove', { taskId: 'task-1', relatedTaskId: 'task-2' }),
    answer('There is no link left to remove.'),
    answer('There is no link left to remove.'),
  ])
  await when.message(alice, dm, 'Unlink once more')
  then.replyTo(alice).equals('There is no link left to remove.')
})

scenario('SCN-task-statuses: confirms shared status mutations', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities([
    'projects.create',
    'statuses.list',
    'statuses.create',
    'statuses.update',
    'statuses.delete',
    'statuses.reorder',
  ])
  given.llm([callCapability('tasks.projects.create', { name: 'Core' }), answer('Project created.')])

  await when.message(alice, dm, 'Create project Core')

  given.llm([
    callCapability('tasks.statuses.create', { projectId: 'project-1', name: 'In Review' }),
    answer('Creating a status changes the shared set — please confirm.'),
  ])
  await when.message(alice, dm, 'Add a status In Review')
  then.replyTo(alice).equals('Creating a status changes the shared set — please confirm.')
  expect(await world.tasks.listStatuses('project-1')).toHaveLength(0)

  given.llm([
    callCapability('tasks.statuses.create', { projectId: 'project-1', name: 'In Review', confirm: true }),
    answer('Status “In Review” created.'),
  ])
  await when.message(alice, dm, 'Confirmed, add it')
  then.replyTo(alice).equals('Status “In Review” created.')
  expect((await world.tasks.listStatuses('project-1')).map((column) => column.name)).toEqual(['In Review'])

  given.llm([callCapability('tasks.statuses.list', { projectId: 'project-1' }), answer('One status: In Review.')])
  await when.message(alice, dm, 'What statuses exist?')
  then.replyTo(alice).equals('One status: In Review.')

  given.llm([
    callCapability('tasks.statuses.create', { projectId: 'project-1', name: 'Done', confirm: true }),
    answer('Status “Done” created.'),
  ])
  await when.message(alice, dm, 'Add a Done status')
  then.replyTo(alice).equals('Status “Done” created.')

  given.llm([
    callCapability('tasks.statuses.update', {
      projectId: 'project-1',
      statusId: 'status-1',
      name: 'In QA',
      confirm: true,
    }),
    answer('Renamed “In Review” to “In QA”.'),
  ])
  await when.message(alice, dm, 'Rename In Review to In QA')
  then.replyTo(alice).equals('Renamed “In Review” to “In QA”.')
  expect((await world.tasks.listStatuses('project-1')).map((column) => column.name)).toEqual(['In QA', 'Done'])

  given.llm([
    callCapability('tasks.statuses.reorder', {
      projectId: 'project-1',
      statuses: [
        { id: 'status-2', position: 0 },
        { id: 'status-1', position: 1 },
      ],
      confirm: true,
    }),
    answer('Reordered: Done is now first.'),
  ])
  await when.message(alice, dm, 'Move Done to the top')
  then.replyTo(alice).equals('Reordered: Done is now first.')
  expect((await world.tasks.listStatuses('project-1')).map((column) => column.id)).toEqual(['status-2', 'status-1'])

  given.llm([
    callCapability('tasks.statuses.delete', {
      projectId: 'project-1',
      statusId: 'status-1',
      confidence: 0.9,
      confirm: true,
    }),
    answer('Status deleted.'),
  ])
  await when.message(alice, dm, 'Delete the In QA status')
  expect((await world.tasks.listStatuses('project-1')).map((column) => column.name)).toEqual(['Done'])
})

scenario('SCN-task-projects: manages the project catalogue', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['projects.read', 'projects.list', 'projects.create', 'projects.update', 'projects.delete'])
  given.llm([
    callCapability('tasks.projects.create', { name: 'Core', description: 'core work' }),
    answer('Project “Core” created.'),
  ])

  await when.message(alice, dm, 'Create project Core')

  given.llm([
    callCapability('tasks.projects.get', { projectId: 'project-1' }),
    callCapability('tasks.projects.update', { projectId: 'project-1', name: 'Core 2' }),
    callCapability('tasks.projects.list', {}),
    answer('Renamed to “Core 2” — one project total.'),
  ])
  await when.message(alice, dm, 'Rename it and list projects')
  then.replyTo(alice).equals('Renamed to “Core 2” — one project total.')

  given.llm([
    callCapability('tasks.projects.create', { name: 'Core 2' }),
    answer('A project named “Core 2” already exists.'),
    answer('A project named “Core 2” already exists.'),
  ])
  await when.message(alice, dm, 'Create it again')
  then.replyTo(alice).equals('A project named “Core 2” already exists.')

  given.llm([callCapability('tasks.projects.delete', { projectId: 'project-1', confidence: 0.9 }), answer('Deleted.')])
  await when.message(alice, dm, 'Delete the project')
  expect(await world.tasks.listProjects()).toHaveLength(0)
})

scenario('SCN-task-project-team: manages project membership', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['projects.create', 'projects.team'])
  given.llm([callCapability('tasks.projects.create', { name: 'Core' }), answer('Project created.')])

  await when.message(alice, dm, 'Create project Core')

  given.llm([
    callCapability('tasks.projects.team.add', { projectId: 'project-1', userId: 'alice' }),
    callCapability('tasks.projects.team.list', { projectId: 'project-1' }),
    answer('alice is on the team.'),
  ])
  await when.message(alice, dm, 'Add me to the team and list it')
  then.replyTo(alice).equals('alice is on the team.')
  expect(await world.tasks.listProjectTeam('project-1')).toEqual([{ id: 'alice' }])

  given.llm([
    callCapability('tasks.projects.team.add', { projectId: 'project-1', userId: 'alice' }),
    answer('alice is already on the team.'),
    answer('alice is already on the team.'),
  ])
  await when.message(alice, dm, 'Add me again')
  then.replyTo(alice).equals('alice is already on the team.')

  given.llm([
    callCapability('tasks.projects.team.remove', { projectId: 'project-1', userId: 'alice' }),
    answer('Removed from the team.'),
  ])
  await when.message(alice, dm, 'Remove me')
  expect(await world.tasks.listProjectTeam('project-1')).toEqual([])
})

scenario('SCN-task-worklog: logs and edits work items', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['workItems.list', 'workItems.create', 'workItems.update', 'workItems.delete'])
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Worked' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Worked')

  given.llm([
    callCapability('tasks.worklog.create', { taskId: 'task-1', duration: 'PT1H30M', description: 'deep work' }),
    callCapability('tasks.worklog.list', { taskId: 'task-1' }),
    answer('Logged 1h 30m of deep work.'),
  ])
  await when.message(alice, dm, 'Log 90 minutes of deep work')
  then.replyTo(alice).equals('Logged 1h 30m of deep work.')
  expect(await world.tasks.listWorkItems('task-1')).toHaveLength(1)

  given.llm([
    callCapability('tasks.worklog.update', { taskId: 'task-1', workItemId: 'work-1', duration: 'PT2H' }),
    answer('Updated to 2 hours.'),
  ])
  await when.message(alice, dm, 'Make it 2 hours')
  expect((await world.tasks.listWorkItems('task-1')).at(0)?.duration).toBe('PT2H')

  given.llm([
    callCapability('tasks.worklog.delete', { taskId: 'task-1', workItemId: 'work-1', confidence: 0.9 }),
    answer('Work item removed.'),
  ])
  await when.message(alice, dm, 'Remove the work item')
  expect(await world.tasks.listWorkItems('task-1')).toHaveLength(0)
})

scenario('SCN-task-sprints: plans work on an agile board', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['agiles.list', 'sprints.list', 'sprints.create', 'sprints.update', 'sprints.assign'])
  world.tasks.addAgile({ name: 'Main Board' })
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Planned' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Planned')

  given.llm([
    callCapability('tasks.agiles.list', {}),
    callCapability('tasks.sprints.create', { agileId: 'agile-1', name: 'Sprint 1', goal: 'ship' }),
    answer('Sprint 1 created on Main Board.'),
  ])
  await when.message(alice, dm, 'Create Sprint 1 with goal ship')

  given.llm([
    callCapability('tasks.sprints.list', { agileId: 'agile-1' }),
    callCapability('tasks.sprints.assign', { taskId: 'task-1', sprintId: 'sprint-1' }),
    answer('“Planned” is in Sprint 1.'),
  ])
  await when.message(alice, dm, 'Put the task in the sprint')
  then.replyTo(alice).equals('“Planned” is in Sprint 1.')
  expect(world.tasks.taskSprintId('task-1')).toBe('sprint-1')
})

scenario('SCN-task-saved-queries: lists and runs saved queries', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['queries.saved'])
  world.tasks.addSavedQuery({ name: 'Releases', query: 'release' })
  world.tasks.addSavedQuery({ name: 'Everything' })
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Release 7' }),
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Backlog grooming' }),
    answer('Seeded.'),
  ])

  await when.message(alice, dm, 'Seed the demo tasks')

  given.llm([callCapability('tasks.queries.saved.list', {}), answer('Two saved queries: Releases and Everything.')])
  await when.message(alice, dm, 'What saved queries exist?')
  then.replyTo(alice).equals('Two saved queries: Releases and Everything.')

  given.llm([
    callCapability('tasks.queries.saved.run', { queryId: 'query-1' }),
    answer('Releases matches “Release 7”.'),
  ])
  await when.message(alice, dm, 'Run the Releases query')
  then.replyTo(alice).equals('Releases matches “Release 7”.')
})
