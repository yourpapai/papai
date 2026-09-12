// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

/**
 * The GitHub provider models one repository as the single project and issues
 * as tasks; comments and labels are the session-2 surface. Issue creation is
 * not an offered capability, so every scenario runs against a repository that
 * already holds one issue. These stories drive comments and labels through the
 * chat boundary against the real plugin and read the result back through the
 * same provider the bot uses, which is the only way to tell a real REST write
 * from a model that merely claimed one.
 */
scenario(
  'SCN-task-github-real-comments: adds, edits, lists and removes GitHub issue comments through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'github')
    given.assign(dm, instance)

    given.llm([callCapability('tasks.projects.list', {}), answer('One project: acme/papai.')])
    await when.message(alice, dm, 'List projects')
    then.replyTo(alice).equals('One project: acme/papai.')

    const provider = await resolveRealTaskProvider(dm)
    const taskId = (await provider.listTasks('acme/papai'))[0]?.id ?? ''
    expect(taskId).not.toBe('')

    given.llm([
      callCapability('tasks.comments.create', { taskId, comment: 'First note' }),
      callCapability('tasks.comments.list', { taskId }),
      answer('One comment: First note.'),
    ])
    await when.message(alice, dm, 'Comment First note and list the comments')
    then.replyTo(alice).equals('One comment: First note.')

    const comments = await provider.getComments!(taskId)
    expect(comments).toHaveLength(1)
    expect(comments[0]?.body).toBe('First note')
    expect(comments[0]?.author).toBe('octocat')

    const commentId = comments[0]?.id ?? ''
    given.llm([
      callCapability('tasks.comments.update', { taskId, activityId: commentId, comment: 'Edited note' }),
      answer('Comment edited.'),
    ])
    await when.message(alice, dm, 'Edit the comment to Edited note')
    then.replyTo(alice).equals('Comment edited.')
    expect((await provider.getComments!(taskId))[0]?.body).toBe('Edited note')

    given.llm([callCapability('tasks.comments.delete', { taskId, commentId }), answer('Comment removed.')])
    await when.message(alice, dm, 'Remove the comment')
    then.replyTo(alice).equals('Comment removed.')
    expect(await provider.getComments!(taskId)).toEqual([])
  },
  { realTaskProvider: 'github' },
)

scenario(
  'SCN-task-github-real-labels: creates, assigns, renames and removes GitHub labels through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'github')
    given.assign(dm, instance)

    given.llm([callCapability('tasks.projects.list', {}), answer('One project: acme/papai.')])
    await when.message(alice, dm, 'List projects')
    then.replyTo(alice).equals('One project: acme/papai.')

    const provider = await resolveRealTaskProvider(dm)
    const taskId = (await provider.listTasks('acme/papai'))[0]?.id ?? ''
    expect(taskId).not.toBe('')
    const urgent = ((await provider.listLabels!()) ?? []).find((label) => label.name === 'urgent')
    expect(urgent).toBeUndefined()

    given.llm([
      callCapability('tasks.labels.create', { name: 'urgent', color: 'ffaa00' }),
      answer('Created the urgent label.'),
    ])
    await when.message(alice, dm, 'Create an urgent label')
    then.replyTo(alice).equals('Created the urgent label.')

    const created = ((await provider.listLabels!()) ?? []).find((label) => label.name === 'urgent')
    expect(created?.color).toBe('ffaa00')

    // Assign passes the numeric label id, exercising the id→name resolution
    // path (one repository-label list, matched by id) before the REST write.
    given.llm([
      callCapability('tasks.labels.assign', { taskId, labelId: created?.id ?? '' }),
      callCapability('tasks.labels.update', { labelId: created?.id ?? '', name: 'critical' }),
      answer('Attached urgent and renamed it to critical.'),
    ])
    await when.message(alice, dm, 'Put the urgent label on the task and rename it to critical')
    then.replyTo(alice).equals('Attached urgent and renamed it to critical.')

    // A rename re-labels every issue that carries the label, so the task's
    // label set must now read back under the new name.
    expect(((await provider.listTaskLabels!(taskId)) ?? []).map((label) => label.name)).toEqual(['critical'])

    given.llm([
      callCapability('tasks.labels.unassign', { taskId, labelName: 'critical' }),
      answer('Took critical off the task.'),
    ])
    await when.message(alice, dm, 'Take the critical label off the task')
    then.replyTo(alice).equals('Took critical off the task.')
    expect((await provider.listTaskLabels!(taskId)) ?? []).toEqual([])

    given.llm([
      callCapability('tasks.labels.delete', { labelId: created?.id ?? '', label: 'critical', confidence: 0.9 }),
      answer('Deleted the critical label.'),
    ])
    await when.message(alice, dm, 'Delete the critical label')
    then.replyTo(alice).equals('Deleted the critical label.')
    expect((await provider.listLabels!()) ?? []).toEqual([])
  },
  { realTaskProvider: 'github' },
)
