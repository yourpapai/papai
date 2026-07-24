// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ScenarioReply } from '../harness/chat.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

const permissionCallback = (
  world: Readonly<{ chat: { allReplies(): readonly ScenarioReply[] } }>,
  prefix: string,
  since: number,
): string | undefined =>
  world.chat
    .allReplies()
    .slice(since)
    .flatMap((reply) => {
      const options = reply.options
      if (typeof options !== 'object' || options === null || !('buttons' in options)) return []
      const { buttons } = options
      if (!Array.isArray(buttons)) return []
      const items: unknown[] = buttons
      return items.flatMap((button): string[] => {
        if (typeof button !== 'object' || button === null || !('callbackData' in button)) return []
        return typeof button.callbackData === 'string' ? [button.callbackData] : []
      })
    })
    .find((callbackData) => callbackData.startsWith(prefix))

const waitForPermissionCallback = async (
  world: Readonly<{ chat: { allReplies(): readonly ScenarioReply[] } }>,
  prefix: string,
): Promise<string | undefined> => {
  const since = world.chat.allReplies().length
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const callback = permissionCallback(world, prefix, since)
    if (callback !== undefined) return callback
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
  }
  return undefined
}

scenario('SCN-task-create-update: creates and renames a task through the tool loop', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Release 7' }),
    answer('Created “Release 7”.'),
  ])

  await when.message(alice, dm, 'Create task Release 7')
  then.replyTo(alice).equals('Created “Release 7”.')

  given.llm([
    callCapability('tasks.update', { taskId: 'task-1', title: 'Release 8' }),
    answer('Renamed to “Release 8”.'),
  ])
  await when.message(alice, dm, 'Rename it to Release 8')

  then.replyTo(alice).equals('Renamed to “Release 8”.')
  await then.task('Release 8').exists()
  await then.task('Release 7').absent()
})

scenario('SCN-task-query: counts and lists tasks with project filters', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.taskCapabilities(['tasks.count'])
  given.assign(dm, instance)
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Alpha' }),
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Beta' }),
    callCapability('tasks.create', { projectId: 'proj-2', title: 'Gamma' }),
    answer('Seeded three tasks.'),
  ])

  await when.message(alice, dm, 'Set up the demo tasks')

  given.llm([
    callCapability('tasks.count', { query: 'a' }),
    callCapability('tasks.list', { projectId: 'proj-1' }),
    answer('3 tasks match; 2 are in proj-1.'),
  ])
  await when.message(alice, dm, 'How many tasks and what is in proj-1?')

  then.replyTo(alice).equals('3 tasks match; 2 are in proj-1.')
  const creates = world.events.all().filter((event) => event.kind === 'task.create')
  expect(creates).toHaveLength(3)
})

scenario('SCN-task-delete: deletes with confidence and refuses without it', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.taskCapabilities(['tasks.delete'])
  given.assign(dm, instance)
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Doomed' }), answer('Created “Doomed”.')])

  await when.message(alice, dm, 'Create task Doomed')

  given.llm([
    callCapability('tasks.delete', { taskId: 'task-1', confidence: 0.5 }),
    answer('I need your confirmation to delete “Doomed”.'),
  ])
  await when.message(alice, dm, 'Delete the task')
  then.replyTo(alice).equals('I need your confirmation to delete “Doomed”.')
  await then.task('Doomed').exists()

  given.llm([callCapability('tasks.delete', { taskId: 'task-1', confidence: 0.9 }), answer('Deleted “Doomed”.')])
  await when.message(alice, dm, 'Really, delete it')

  then.replyTo(alice).equals('Deleted “Doomed”.')
  await then.task('Doomed').absent()
})

scenario('SCN-task-history: reads self-seeded task activities', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.taskCapabilities(['activities.read'])
  given.assign(dm, instance)
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Tracked' }),
    callCapability('tasks.update', { taskId: 'task-1', title: 'Tracked harder' }),
    answer('Created and renamed.'),
  ])

  await when.message(alice, dm, 'Create Tracked then rename it')

  given.llm([
    callCapability('tasks.history', { taskId: 'task-1' }),
    answer('It was created, then renamed to “Tracked harder”.'),
  ])
  await when.message(alice, dm, 'What happened to the task?')

  then.replyTo(alice).equals('It was created, then renamed to “Tracked harder”.')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('created'))
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('updated'))
})

scenario('SCN-task-comments: adds, edits, and removes a comment', async ({ given, when, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.taskCapabilities(['comments.read', 'comments.create', 'comments.update', 'comments.delete'])
  given.assign(dm, instance)
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Discussed' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Discussed')

  given.llm([
    callCapability('tasks.comments.create', { taskId: 'task-1', comment: 'first draft' }),
    callCapability('tasks.comments.list', { taskId: 'task-1' }),
    answer('Comment added.'),
  ])
  await when.message(alice, dm, 'Comment "first draft" on it')
  expect(await world.tasks.getComments('task-1')).toHaveLength(1)

  given.llm([
    callCapability('tasks.comments.update', { taskId: 'task-1', activityId: 'comment-1', comment: 'final edit' }),
    answer('Comment updated.'),
  ])
  await when.message(alice, dm, 'Edit the comment to "final edit"')
  expect((await world.tasks.getComments('task-1')).at(0)?.body).toBe('final edit')

  given.llm([
    callCapability('tasks.comments.delete', { taskId: 'task-1', commentId: 'comment-1' }),
    answer('Comment removed.'),
  ])
  await when.message(alice, dm, 'Remove the comment')
  expect(await world.tasks.getComments('task-1')).toHaveLength(0)
})

scenario('SCN-task-labels: creates and assigns a label by name', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.taskCapabilities(['labels.create', 'labels.assign'])
  given.assign(dm, instance)
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Labeled' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Labeled')

  given.llm([
    callCapability('tasks.labels.create', { name: 'urgent' }),
    callCapability('tasks.labels.assign', { taskId: 'task-1', labelName: 'urgent' }),
    answer('Labeled “urgent”.'),
  ])
  await when.message(alice, dm, 'Label it urgent')

  then.replyTo(alice).equals('Labeled “urgent”.')
  expect((await world.tasks.listTaskLabels('task-1')).map((label) => label.name)).toEqual(['urgent'])

  given.llm([
    callCapability('tasks.labels.unassign', { taskId: 'task-1', labelName: 'urgent' }),
    answer('Label removed.'),
  ])
  await when.message(alice, dm, 'Unlabel it')
  expect(await world.tasks.listTaskLabels('task-1')).toHaveLength(0)
})

scenario(
  'SCN-task-not-configured: refuses task work without an assigned provider',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.llm([answer('I cannot manage tasks yet — no task tracker is configured here.')])

    await when.message(alice, dm, 'Create task Nope')

    then.replyTo(alice).equals('I cannot manage tasks yet — no task tracker is configured here.')
    expect(() => world.runtime.resolveToolCapability('tasks.create')).toThrow('Unknown tool capability id')
  },
)

scenario('SCN-task-ask-confirm: ask permission gates a mutating task tool', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.toolPrefs(dm, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Guarded', _permission_reason: 'creates a task' }),
    answer('Created “Guarded”.'),
  ])

  await when.dispatchMessage(alice, dm, 'Create task Guarded')
  const allowCallback = await waitForPermissionCallback(world, 'perm:a:')
  expect(allowCallback).toBeDefined()
  await when.interaction(alice, dm, allowCallback ?? '')

  then.replyTo(alice).equals('Created “Guarded”.')
  await then.task('Guarded').exists()

  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Refused', _permission_reason: 'creates a task' }),
    answer('I could not create “Refused” without your permission.'),
  ])
  await when.dispatchMessage(alice, dm, 'Create task Refused')
  const denyCallback = await waitForPermissionCallback(world, 'perm:d:')
  expect(denyCallback).toBeDefined()
  await when.interaction(alice, dm, denyCallback ?? '')

  then.replyTo(alice).equals('I could not create “Refused” without your permission.')
  await then.task('Refused').absent()
})

scenario('SCN-task-deny: denied tools leave the advertised toolset', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.toolPrefs(dm, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
  given.llm([answer('I am not allowed to create tasks here.')])

  await when.message(alice, dm, 'Create task Nope')

  then.replyTo(alice).equals('I am not allowed to create tasks here.')
  expect(() => world.runtime.resolveToolCapability('tasks.create')).toThrow('Unknown tool capability id')
  expect(world.runtime.resolveToolCapability('tasks.list')).toBe('list_tasks')
})
