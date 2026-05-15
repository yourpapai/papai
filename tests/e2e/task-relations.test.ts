// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { z } from 'zod'

setDefaultTimeout(10000)

import { addTaskRelation } from '../../src/providers/kaneo/add-task-relation.js'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { getTask } from '../../src/providers/kaneo/get-task.js'
import { removeTaskRelation } from '../../src/providers/kaneo/remove-task-relation.js'
import { updateTaskRelation } from '../../src/providers/kaneo/update-task-relation.js'
import { kaneoApiJsonParsed } from './kaneo-api-helpers.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

const RawTaskRelationSchema = z.object({
  id: z.string(),
  sourceTaskId: z.string(),
  targetTaskId: z.string(),
  relationType: z.enum(['blocks', 'related', 'subtask']),
})

type RawTaskRelation = z.infer<typeof RawTaskRelationSchema>

function isRelationBetween(relation: RawTaskRelation, firstTaskId: string, secondTaskId: string): boolean {
  return (
    (relation.sourceTaskId === firstTaskId && relation.targetTaskId === secondTaskId) ||
    (relation.sourceTaskId === secondTaskId && relation.targetTaskId === firstTaskId)
  )
}

function requireRelation(
  relations: readonly RawTaskRelation[],
  sourceTaskId: string,
  targetTaskId: string,
): RawTaskRelation {
  const relation = relations.find((entry) => entry.sourceTaskId === sourceTaskId && entry.targetTaskId === targetTaskId)
  if (relation === undefined) {
    throw new Error(`Expected relation ${sourceTaskId} -> ${targetTaskId}`)
  }

  return relation
}

function requireSingleRelation(relations: readonly RawTaskRelation[]): RawTaskRelation {
  const [relation] = relations
  if (relation === undefined) {
    throw new Error('Expected a single relation')
  }

  return relation
}

describe('E2E: Task Relations', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    const project = await testClient.createTestProject(`Relations Test ${Date.now()}`)
    projectId = project.id
  })

  afterEach(async () => {
    await testClient.cleanup()
  })

  test('adds blocks relation between tasks', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Blocking task' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Blocked task' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    const relation = await addTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: task2.id,
      type: 'blocks',
    })

    expect(relation.taskId).toBe(task1.id)
    expect(relation.relatedTaskId).toBe(task2.id)
    expect(relation.type).toBe('blocks')

    const task1WithRel = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRel.relations).toContainEqual({ type: 'blocks', taskId: task2.id })
  })

  test('maps blocks to blocked_by on the target task', async () => {
    const blockingTask = await createTask({ config: kaneoConfig, projectId, title: 'Blocking task' })
    const blockedTask = await createTask({ config: kaneoConfig, projectId, title: 'Blocked task' })
    testClient.trackTask(blockingTask.id)
    testClient.trackTask(blockedTask.id)

    await addTaskRelation({
      config: kaneoConfig,
      taskId: blockingTask.id,
      relatedTaskId: blockedTask.id,
      type: 'blocks',
    })

    const blockedTaskWithRel = await getTask({ config: kaneoConfig, taskId: blockedTask.id })
    expect(blockedTaskWithRel.relations).toContainEqual({ type: 'blocked_by', taskId: blockingTask.id })

    const rawRelations = await kaneoApiJsonParsed(`/task-relation/${blockedTask.id}`, z.array(RawTaskRelationSchema))
    const rawRelation = requireRelation(rawRelations, blockingTask.id, blockedTask.id)
    expect(rawRelation.relationType).toBe('blocks')
  })

  test('adds related relation', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task A' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task B' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    const relation = await addTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: task2.id,
      type: 'related',
    })
    expect(relation.type).toBe('related')

    const task1WithRel = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRel.relations).toContainEqual({ type: 'related', taskId: task2.id })
  })

  test('adds parent relation', async () => {
    const parentTask = await createTask({ config: kaneoConfig, projectId, title: 'Parent task' })
    const childTask = await createTask({ config: kaneoConfig, projectId, title: 'Child task' })
    testClient.trackTask(parentTask.id)
    testClient.trackTask(childTask.id)

    const relation = await addTaskRelation({
      config: kaneoConfig,
      taskId: childTask.id,
      relatedTaskId: parentTask.id,
      type: 'parent',
    })
    expect(relation.type).toBe('parent')

    const childWithRel = await getTask({ config: kaneoConfig, taskId: childTask.id })
    expect(childWithRel.relations).toContainEqual({ type: 'parent', taskId: parentTask.id })
  })

  test('maps subtask relations back to parent and child in opposite directions', async () => {
    const parentTask = await createTask({ config: kaneoConfig, projectId, title: 'Parent task' })
    const childTask = await createTask({ config: kaneoConfig, projectId, title: 'Child task' })
    testClient.trackTask(parentTask.id)
    testClient.trackTask(childTask.id)

    await addTaskRelation({
      config: kaneoConfig,
      taskId: childTask.id,
      relatedTaskId: parentTask.id,
      type: 'parent',
    })

    const childWithRel = await getTask({ config: kaneoConfig, taskId: childTask.id })
    const parentWithRel = await getTask({ config: kaneoConfig, taskId: parentTask.id })
    expect(childWithRel.relations).toContainEqual({ type: 'parent', taskId: parentTask.id })
    expect(parentWithRel.relations).toContainEqual({ type: 'child', taskId: childTask.id })

    const rawRelations = await kaneoApiJsonParsed(`/task-relation/${parentTask.id}`, z.array(RawTaskRelationSchema))
    const rawRelation = requireRelation(rawRelations, childTask.id, parentTask.id)
    expect(rawRelation.relationType).toBe('subtask')
  })

  test('updates relation type', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task 1' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task 2' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id, type: 'related' })
    const updated = await updateTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: task2.id,
      type: 'blocks',
    })

    expect(updated.type).toBe('blocks')

    const task1WithRel = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRel.relations).toContainEqual({ type: 'blocks', taskId: task2.id })
    expect(task1WithRel.relations).not.toContainEqual({ type: 'related', taskId: task2.id })
  })

  test('relation update leaves exactly one live relation in the raw Kaneo payload', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task 1' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task 2' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id, type: 'related' })
    await updateTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id, type: 'blocks' })

    const task1WithRel = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRel.relations).toContainEqual({ type: 'blocks', taskId: task2.id })

    const rawRelations = await kaneoApiJsonParsed(`/task-relation/${task1.id}`, z.array(RawTaskRelationSchema))
    const liveRelations = rawRelations.filter((relation) => isRelationBetween(relation, task1.id, task2.id))

    expect(liveRelations).toHaveLength(1)
    const liveRelation = requireSingleRelation(liveRelations)
    expect(liveRelation.sourceTaskId).toBe(task1.id)
    expect(liveRelation.targetTaskId).toBe(task2.id)
    expect(liveRelation.relationType).toBe('blocks')
  })

  test('removes relation', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Task 1' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Task 2' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)

    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id, type: 'related' })
    const removed = await removeTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id })

    expect(removed.success).toBe(true)

    const task1WithRel = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRel.relations).not.toContainEqual({ type: 'related', taskId: task2.id })
  })

  test('handles multiple relations on same task', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Main task' })
    const task2 = await createTask({ config: kaneoConfig, projectId, title: 'Related task' })
    const task3 = await createTask({ config: kaneoConfig, projectId, title: 'Blocking task' })
    testClient.trackTask(task1.id)
    testClient.trackTask(task2.id)
    testClient.trackTask(task3.id)

    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task2.id, type: 'related' })
    await addTaskRelation({ config: kaneoConfig, taskId: task1.id, relatedTaskId: task3.id, type: 'blocks' })

    const task1WithRels = await getTask({ config: kaneoConfig, taskId: task1.id })
    expect(task1WithRels.relations).toContainEqual({ type: 'related', taskId: task2.id })
    expect(task1WithRels.relations).toContainEqual({ type: 'blocks', taskId: task3.id })
  })

  test('error when relating to non-existent task', async () => {
    const task1 = await createTask({ config: kaneoConfig, projectId, title: 'Existing task' })
    testClient.trackTask(task1.id)

    const promise = addTaskRelation({
      config: kaneoConfig,
      taskId: task1.id,
      relatedTaskId: 'non-existent-id',
      type: 'related',
    })
    await expect(promise).rejects.toThrow()
  })
})
