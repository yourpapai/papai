// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

/**
 * Kaneo models a project's statuses as columns, so every status operation is a
 * column write over REST. These stories drive them through the chat boundary
 * against the real plugin and read the result back through the same provider
 * the bot uses, which is the only way to tell a real column write from a model
 * that merely claimed one.
 */
scenario(
  'SCN-task-kaneo-status-lifecycle: creates, renames, reorders and deletes Kaneo statuses through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'kaneo')
    given.assign(dm, instance)

    given.llm([callCapability('tasks.projects.create', { name: 'Board' }), answer('Project created.')])
    await when.message(alice, dm, 'Create a project called Board')
    then.replyTo(alice).equals('Project created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = ((await provider.listProjects?.()) ?? [])[0]?.id ?? ''
    expect(projectId).not.toBe('')

    given.llm([
      callCapability('tasks.statuses.create', { projectId, name: 'Triage', color: '#ff0000' }),
      callCapability('tasks.statuses.create', { projectId, name: 'Shipping', isFinal: true }),
      answer('Added Triage and Shipping.'),
    ])
    await when.message(alice, dm, 'Add a Triage status and a final Shipping status to Board')
    then.replyTo(alice).equals('Added Triage and Shipping.')

    const created = await provider.listStatuses!(projectId)
    const triage = created.find((status) => status.name === 'Triage')
    const shipping = created.find((status) => status.name === 'Shipping')
    // `mapColumn` narrows a Kaneo column to id/name/isFinal, so the terminal
    // flag is the field that proves the create carried its options through.
    expect(triage?.isFinal).toBe(false)
    expect(shipping?.isFinal).toBe(true)

    // Rename in place, then swap the two positions: reorder is a distinct write
    // from update, and only reading the ordered list back proves it landed.
    given.llm([
      callCapability('tasks.statuses.update', { projectId, statusId: triage?.id ?? '', name: 'Intake' }),
      callCapability('tasks.statuses.reorder', {
        projectId,
        statuses: [
          { id: shipping?.id ?? '', position: 0 },
          { id: triage?.id ?? '', position: 1 },
        ],
      }),
      answer('Renamed and reordered.'),
    ])
    await when.message(alice, dm, 'Rename Triage to Intake and put Shipping first')
    then.replyTo(alice).equals('Renamed and reordered.')

    // A Kaneo project ships with default columns, so absolute positions say
    // nothing. Relative order does: Triage was created before Shipping and the
    // reorder inverts exactly that pair.
    const names = created.map((status) => status.name)
    expect(names.indexOf('Triage')).toBeLessThan(names.indexOf('Shipping'))

    const reordered = (await provider.listStatuses!(projectId)).map((status) => status.name)
    expect(reordered).toContain('Intake')
    expect(reordered).not.toContain('Triage')
    expect(reordered.indexOf('Shipping')).toBeLessThan(reordered.indexOf('Intake'))

    given.llm([
      callCapability('tasks.statuses.delete', {
        projectId,
        statusId: shipping?.id ?? '',
        label: 'Shipping',
        confidence: 0.95,
      }),
      answer('Deleted Shipping.'),
    ])
    await when.message(alice, dm, 'Delete the Shipping status')
    then.replyTo(alice).equals('Deleted Shipping.')

    const remaining = await provider.listStatuses!(projectId)
    expect(remaining.some((status) => status.name === 'Shipping')).toBe(false)
    expect(remaining.some((status) => status.name === 'Intake')).toBe(true)
  },
  { realTaskProvider: 'kaneo' },
)

scenario(
  'SCN-task-kaneo-status-delete-unconfirmed: an unconfident status delete is blocked and the column survives',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'kaneo')
    given.assign(dm, instance)

    given.llm([callCapability('tasks.projects.create', { name: 'Guarded' }), answer('Project created.')])
    await when.message(alice, dm, 'Create a project called Guarded')
    then.replyTo(alice).equals('Project created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = ((await provider.listProjects?.()) ?? [])[0]?.id ?? ''

    given.llm([callCapability('tasks.statuses.create', { projectId, name: 'Fragile' }), answer('Added Fragile.')])
    await when.message(alice, dm, 'Add a Fragile status')
    then.replyTo(alice).equals('Added Fragile.')

    const fragile = (await provider.listStatuses!(projectId)).find((status) => status.name === 'Fragile')

    // 0.4 is below the 0.85 confidence threshold, so the tool returns a
    // confirmation request instead of deleting.
    given.llm([
      callCapability('tasks.statuses.delete', {
        projectId,
        statusId: fragile?.id ?? '',
        label: 'Fragile',
        confidence: 0.4,
      }),
      answer('I need you to confirm that first.'),
    ])
    await when.message(alice, dm, 'Maybe clean up some statuses')
    then.replyTo(alice).equals('I need you to confirm that first.')

    // The durable oracle: the column is still there, so the gate stopped the
    // REST write rather than merely changing what the model said.
    expect((await provider.listStatuses!(projectId)).some((status) => status.name === 'Fragile')).toBe(true)
  },
  { realTaskProvider: 'kaneo' },
)

scenario(
  'SCN-task-kaneo-label-lifecycle: attaches, renames and detaches a Kaneo label through the real provider',
  async ({ given, when, then, resolveRealTaskProvider }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance(undefined, 'kaneo')
    given.assign(dm, instance)

    given.llm([callCapability('tasks.projects.create', { name: 'Labelled' }), answer('Project created.')])
    await when.message(alice, dm, 'Create a project called Labelled')
    then.replyTo(alice).equals('Project created.')

    const provider = await resolveRealTaskProvider(dm)
    const projectId = ((await provider.listProjects?.()) ?? [])[0]?.id ?? ''

    given.llm([
      callCapability('tasks.create', { projectId, title: 'Ship it' }),
      callCapability('tasks.labels.create', { name: 'urgent', color: '#ffaa00' }),
      answer('Created the task and the urgent label.'),
    ])
    await when.message(alice, dm, 'Add a Ship it task and an urgent label')
    then.replyTo(alice).equals('Created the task and the urgent label.')

    const taskId = (await provider.listTasks(projectId))[0]?.id ?? ''
    expect(taskId).not.toBe('')
    // Unattached, the label is a reusable workspace label and lists as one.
    expect(((await provider.listLabels?.()) ?? []).map((label) => label.name)).toContain('urgent')
    const urgent = ((await provider.listLabels?.()) ?? []).find((label) => label.name === 'urgent')

    given.llm([
      callCapability('tasks.labels.assign', { taskId, labelId: urgent?.id ?? '' }),
      callCapability('tasks.labels.update', { labelId: urgent?.id ?? '', name: 'critical' }),
      answer('Attached it and renamed it to critical.'),
    ])
    await when.message(alice, dm, 'Put the urgent label on Ship it and rename it to critical')
    then.replyTo(alice).equals('Attached it and renamed it to critical.')

    // Attaching moves the label out of the reusable pool: `kaneoListLabels`
    // keeps only labels with no task, so an attached one stops being offered
    // for reuse while still living on its task.
    expect((await provider.listLabels?.()) ?? []).toEqual([])
    expect((await provider.listTaskLabels?.(taskId))?.map((label) => label.name)).toEqual(['critical'])

    // Kaneo does not declare `labels.delete` -- its REST delete only accepts a
    // label that is attached to a task -- so detaching is the operation the bot
    // actually has here, and it returns the label to the reusable pool.
    given.llm([
      callCapability('tasks.labels.unassign', { taskId, labelName: 'critical' }),
      answer('Took critical off Ship it.'),
    ])
    await when.message(alice, dm, 'Take the critical label off Ship it')
    then.replyTo(alice).equals('Took critical off Ship it.')

    expect((await provider.listTaskLabels?.(taskId)) ?? []).toEqual([])
    expect(((await provider.listLabels?.()) ?? []).map((label) => label.name)).toEqual(['critical'])
  },
  { realTaskProvider: 'kaneo' },
)
