// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

scenario(
  'SCN-task-youtrack-real-status-lifecycle: shared-bundle status lifecycle through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'youtrack')
    given.assign(dm, instance)

    given.llm([
      callCapability('tasks.projects.create', { name: 'Primary' }),
      callCapability('tasks.projects.create', { name: 'Secondary' }),
      answer('Two projects created.'),
    ])
    await when.message(alice, dm, 'Create projects Primary and Secondary')
    then.replyTo(alice).equals('Two projects created.')

    const provider = await resolveRealTaskProvider(dm)
    const projects = (await provider.listProjects?.()) ?? []
    const projectId = projects[0]?.id ?? ''
    expect(projectId).not.toBe('')

    const initial = (await provider.listStatuses?.(projectId)) ?? []
    expect(initial.length).toBeGreaterThanOrEqual(3)

    given.llm([
      callCapability('tasks.statuses.create', { projectId, name: 'Review' }),
      answer('Creating a status on a shared bundle needs confirmation.'),
    ])
    await when.message(alice, dm, 'Add a status called Review')
    then.replyTo(alice).contains('confirmation')
    const beforeCreate = (await provider.listStatuses?.(projectId)) ?? []
    expect(beforeCreate.every((s) => s.name !== 'Review')).toBe(true)

    given.llm([
      callCapability('tasks.statuses.create', { projectId, name: 'Review', confirm: true }),
      answer('Status Review created.'),
    ])
    await when.message(alice, dm, 'Confirm, add Review')
    then.replyTo(alice).contains('Review')
    const afterCreate = (await provider.listStatuses?.(projectId)) ?? []
    const reviewStatus = afterCreate.find((s) => s.name === 'Review')
    expect(reviewStatus).toBeDefined()

    given.llm([
      callCapability('tasks.statuses.update', {
        projectId,
        statusId: reviewStatus!.id,
        name: 'In QA',
        confirm: true,
      }),
      answer('Renamed Review to In QA.'),
    ])
    await when.message(alice, dm, 'Rename Review to In QA')
    then.replyTo(alice).contains('In QA')
    const afterUpdate = (await provider.listStatuses?.(projectId)) ?? []
    const qaStatus = afterUpdate.find((s) => s.name === 'In QA')
    expect(qaStatus).toBeDefined()
    expect(afterUpdate.some((s) => s.name === 'Review')).toBe(false)

    const firstOther = afterUpdate.find((s) => s.id !== qaStatus!.id)
    given.llm([
      callCapability('tasks.statuses.reorder', {
        projectId,
        statuses: [
          { id: qaStatus!.id, position: 0 },
          ...(firstOther === undefined ? [] : [{ id: firstOther.id, position: 1 }]),
        ],
        confirm: true,
      }),
      answer('Reordered statuses.'),
    ])
    await when.message(alice, dm, 'Move In QA to the top')
    then.replyTo(alice).contains('Reorder')
    const afterReorder = (await provider.listStatuses?.(projectId)) ?? []
    expect(afterReorder[0]?.id).toBe(qaStatus!.id)

    given.llm([
      callCapability('tasks.statuses.delete', {
        projectId,
        statusId: qaStatus!.id,
        confidence: 0.9,
        confirm: true,
      }),
      answer('Status In QA deleted.'),
    ])
    await when.message(alice, dm, 'Delete the In QA status')
    then.replyTo(alice).contains('deleted')
    const afterDelete = (await provider.listStatuses?.(projectId)) ?? []
    expect(afterDelete.every((s) => s.name !== 'In QA')).toBe(true)
  },
  { realTaskProvider: 'youtrack' },
)
