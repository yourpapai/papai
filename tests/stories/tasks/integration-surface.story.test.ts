// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { kaneoWorkspaceMembers, type KaneoWorkspaceMember } from '../../../src/db/schema.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

const waitFor = async (condition: () => boolean): Promise<boolean> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return true
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
  }
  return false
}

const readWorkspaceMember = (chatUserId: string): KaneoWorkspaceMember | undefined =>
  getDrizzleDb().select().from(kaneoWorkspaceMembers).where(eq(kaneoWorkspaceMembers.chatUserId, chatUserId)).get()

scenario('SCN-task-collaboration: manages watchers, votes, and visibility', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['tasks.watchers', 'tasks.votes', 'tasks.visibility'])
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Watched' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Watched')

  given.llm([
    callCapability('tasks.watchers.add', { taskId: 'task-1', userId: 'alice' }),
    callCapability('tasks.watchers.list', { taskId: 'task-1' }),
    answer('alice is watching.'),
  ])
  await when.message(alice, dm, 'Watch it for me')
  then.replyTo(alice).equals('alice is watching.')
  expect(await world.tasks.listWatchers('task-1')).toEqual([{ id: 'alice' }])

  given.llm([
    callCapability('tasks.votes.add', { taskId: 'task-1' }),
    callCapability('tasks.votes.remove', { taskId: 'task-1' }),
    answer('Voted, then unvoted.'),
  ])
  await when.message(alice, dm, 'Vote for it, then take the vote back')
  then.replyTo(alice).equals('Voted, then unvoted.')

  given.llm([
    callCapability('tasks.visibility.set', { taskId: 'task-1', visibility: 'restricted', userIds: ['alice'] }),
    answer('Now restricted to you.'),
  ])
  await when.message(alice, dm, 'Restrict it to me')
  expect(world.tasks.getTaskVisibility('task-1')).toEqual({ kind: 'restricted', users: [{ id: 'alice' }] })

  given.llm([
    callCapability('tasks.watchers.remove', { taskId: 'task-1', userId: 'alice' }),
    callCapability('tasks.visibility.set', { taskId: 'task-1', visibility: 'public' }),
    answer('Unwatched and public again.'),
  ])
  await when.message(alice, dm, 'Unwatch and make it public')
  expect(await world.tasks.listWatchers('task-1')).toEqual([])
  expect(world.tasks.getTaskVisibility('task-1')).toEqual({ kind: 'public' })
})

scenario(
  'SCN-task-identity: finds users and provisions members on group turns',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const team = given.group('team')
    given.member(team, alice)
    const instance = given.taskInstance()
    given.assign(team, instance)
    given.taskCapabilities(['members.provision'])
    given.providerUser({ id: 'ku-alice', login: 'alice', name: 'Alice A' })
    world.tasks.setCurrentUser({ id: 'ku-alice', login: 'alice' })
    given.llm([
      callCapability('tasks.identity.find', { query: 'ali' }),
      callCapability('tasks.identity.current', {}),
      answer('Found Alice; you are alice.'),
    ])

    await when.message(alice, team, 'Who am I on the tracker?')

    then.replyIn(team).contains('alice')
    const provisioned = await waitFor(() => world.tasks.provisionCalls.length >= 1)
    expect(provisioned).toBe(true)
    expect(world.tasks.provisionCalls.at(0)?.member.chatUserId).toBe('alice')
    expect(await readWorkspaceMember('alice')).toMatchObject({ providerUserId: 'prov-alice' })
  },
)

scenario(
  'SCN-task-attachments: uploads from the relay and removes attachments',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance()
    given.assign(dm, instance)
    given.taskCapabilities(['attachments.list', 'attachments.upload', 'attachments.delete'])
    const file = await given.attachment(dm, { filename: 'spec.txt', content: 'relay payload' })
    given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Documented' }), answer('Created.')])

    await when.message(alice, dm, 'Create task Documented')

    given.llm([
      callCapability('tasks.attachments.upload', { taskId: 'task-1', attachmentId: file.id }),
      callCapability('tasks.attachments.list', { taskId: 'task-1' }),
      answer('Attached “spec.txt”.'),
    ])
    await when.message(alice, dm, 'Attach the file to it')
    then.replyTo(alice).equals('Attached “spec.txt”.')
    expect(await world.tasks.listAttachments('task-1')).toHaveLength(1)

    given.llm([
      callCapability('tasks.attachments.upload', { taskId: 'task-1', attachmentId: 'att_missing' }),
      answer('That file is no longer available.'),
    ])
    await when.message(alice, dm, 'Attach it again from the old link')
    then.replyTo(alice).equals('That file is no longer available.')
    expect(await world.tasks.listAttachments('task-1')).toHaveLength(1)

    given.llm([
      callCapability('tasks.attachments.delete', { taskId: 'task-1', attachmentId: 'attachment-1', confidence: 0.9 }),
      answer('Attachment removed.'),
    ])
    await when.message(alice, dm, 'Remove the attachment')
    expect(await world.tasks.listAttachments('task-1')).toHaveLength(0)
  },
)

scenario(
  'SCN-task-youtrack-command: applies a YouTrack command to one task only',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance()
    given.assign(dm, instance)
    given.taskCapabilities(['tasks.commands'])
    world.tasks.setTraits(['command-language:youtrack', 'supports-command-language'])
    given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Commanded' }), answer('Created.')])

    await when.message(alice, dm, 'Create task Commanded')

    given.llm([
      callCapability('tasks.commands.apply', { query: 'state Fixed', taskIds: ['task-1'], confidence: 0.9 }),
      answer('Marked it Fixed.'),
    ])
    await when.message(alice, dm, 'Mark it Fixed with a command')
    then.replyTo(alice).equals('Marked it Fixed.')
    expect(world.tasks.commandCalls).toEqual([{ query: 'state Fixed', taskIds: ['task-1'] }])

    given.llm([
      callCapability('tasks.commands.apply', { query: 'state Fixed', taskIds: ['task-1', 'task-2'], confidence: 0.9 }),
      answer('I can only run commands on one task at a time.'),
      answer('I can only run commands on one task at a time.'),
    ])
    await when.message(alice, dm, 'Mark both tasks Fixed')
    then.replyTo(alice).equals('I can only run commands on one task at a time.')
    expect(world.tasks.commandCalls).toHaveLength(1)
  },
)
