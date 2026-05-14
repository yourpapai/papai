import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import { addTaskRelation } from '../../src/providers/kaneo/add-task-relation.js'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { getTask } from '../../src/providers/kaneo/get-task.js'
import { removeTaskRelation } from '../../src/providers/kaneo/remove-task-relation.js'
import { updateTaskRelation } from '../../src/providers/kaneo/update-task-relation.js'
import { createTestClient, KaneoTestClient } from './kaneo-test-client.js'

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
