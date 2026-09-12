// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-youtrack-real-collaboration: watchers, votes and visibility move through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance(undefined, 'youtrack'))

    given.llm([callCapability('tasks.projects.create', { name: 'Primary' }), answer('Project Primary created.')])
    await when.message(alice, dm, 'Create project Primary')
    then.replyTo(alice).equals('Project Primary created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = (await provider.listProjects?.())?.[0]?.id ?? ''
    const task = await provider.createTask({ projectId, title: 'Watched work' })

    given.llm([
      callCapability('tasks.watchers.add', { taskId: task.id, userId: 'bob' }),
      answer('Bob now watches Watched work.'),
    ])
    await when.message(alice, dm, 'Have Bob watch Watched work')
    then.replyTo(alice).contains('watches')
    expect(((await provider.listWatchers?.(task.id)) ?? []).map((watcher) => watcher.login)).toEqual(['bob'])

    given.llm([callCapability('tasks.watchers.list', { taskId: task.id }), answer('Watchers: bob.')])
    await when.message(alice, dm, 'Who watches Watched work?')
    then.replyTo(alice).contains('bob')

    given.llm([
      callCapability('tasks.watchers.remove', { taskId: task.id, userId: 'bob' }),
      answer('Bob no longer watches it.'),
    ])
    await when.message(alice, dm, 'Stop Bob watching Watched work')
    then.replyTo(alice).contains('no longer')
    expect((await provider.listWatchers?.(task.id)) ?? []).toEqual([])

    given.llm([callCapability('tasks.votes.add', { taskId: task.id }), answer('Voted.')])
    await when.message(alice, dm, 'Vote for Watched work')
    then.replyTo(alice).equals('Voted.')
    expect((await provider.getTask(task.id)).votes).toBe(1)

    given.llm([callCapability('tasks.votes.remove', { taskId: task.id }), answer('Vote withdrawn.')])
    await when.message(alice, dm, 'Take my vote back')
    then.replyTo(alice).contains('withdrawn')
    expect((await provider.getTask(task.id)).votes).toBe(0)

    given.llm([
      callCapability('tasks.visibility.set', {
        taskId: task.id,
        visibility: 'restricted',
        userIds: ['bob'],
        groupIds: ['leads'],
      }),
      answer('Watched work is now restricted.'),
    ])
    await when.message(alice, dm, 'Restrict Watched work to Bob and the leads')
    then.replyTo(alice).contains('restricted')
    const restricted = (await provider.getTask(task.id)).visibility
    if (restricted?.kind !== 'restricted') throw new Error(`expected a restricted task, got ${restricted?.kind}`)
    expect(restricted.users?.map((user) => user.login)).toEqual(['bob'])
    expect(restricted.groups?.map((group) => group.name)).toEqual(['leads'])

    given.llm([
      callCapability('tasks.visibility.set', { taskId: task.id, visibility: 'public' }),
      answer('Watched work is public again.'),
    ])
    await when.message(alice, dm, 'Make Watched work public again')
    then.replyTo(alice).contains('public')
    expect((await provider.getTask(task.id)).visibility?.kind).toBe('public')
  },
  { realTaskProvider: 'youtrack' },
)

scenario(
  'SCN-task-youtrack-real-attachments-and-history: a relayed file is attached, listed, removed, and the activity feed reads back',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance(undefined, 'youtrack'))
    // Seeding the relay is a prerequisite, so it has to happen before the first turn.
    const file = await given.attachment(dm, { filename: 'spec.txt', content: 'hello relay' })

    given.llm([callCapability('tasks.projects.create', { name: 'Primary' }), answer('Project Primary created.')])
    await when.message(alice, dm, 'Create project Primary')
    then.replyTo(alice).equals('Project Primary created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = (await provider.listProjects?.())?.[0]?.id ?? ''
    const task = await provider.createTask({ projectId, title: 'Documented work' })
    await provider.addComment?.(task.id, 'Kicking this off')

    given.llm([
      callCapability('tasks.attachments.upload', { taskId: task.id, attachmentId: file.id }),
      answer('Attached spec.txt.'),
    ])
    await when.message(alice, dm, 'Attach spec.txt to Documented work')
    then.replyTo(alice).contains('spec.txt')
    const attached = (await provider.listAttachments?.(task.id)) ?? []
    expect(attached.map((attachment) => attachment.name)).toEqual(['spec.txt'])
    expect(attached[0]?.size).toBe('hello relay'.length)

    given.llm([callCapability('tasks.attachments.list', { taskId: task.id }), answer('Attachments: spec.txt.')])
    await when.message(alice, dm, 'What is attached to Documented work?')
    then.replyTo(alice).contains('spec.txt')

    given.llm([
      callCapability('tasks.attachments.delete', {
        taskId: task.id,
        attachmentId: attached[0]?.id ?? '',
        label: 'spec.txt',
        confidence: 0.95,
      }),
      answer('Removed spec.txt.'),
    ])
    await when.message(alice, dm, 'Remove spec.txt from Documented work')
    then.replyTo(alice).contains('Removed')
    expect((await provider.listAttachments?.(task.id)) ?? []).toEqual([])

    given.llm([
      callCapability('tasks.history', { taskId: task.id, limit: 10, reverse: true }),
      answer('The task was created, then commented on.'),
    ])
    await when.message(alice, dm, 'What has happened to Documented work?')
    then.replyTo(alice).contains('created')
    const history = (await provider.getTaskHistory?.(task.id, { limit: 10 })) ?? []
    expect(history.length).toBe(2)
    expect(history.map((entry) => entry.category)).toEqual(['IssueCreatedCategory', 'CommentsCategory'])
  },
  { realTaskProvider: 'youtrack' },
)
