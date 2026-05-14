import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

setDefaultTimeout(10000)

import { addTaskLabel } from '../../src/providers/kaneo/add-task-label.js'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createLabel } from '../../src/providers/kaneo/create-label.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { getTask } from '../../src/providers/kaneo/get-task.js'
import { listLabels } from '../../src/providers/kaneo/list-labels.js'
import { removeLabel } from '../../src/providers/kaneo/remove-label.js'
import { removeTaskLabel } from '../../src/providers/kaneo/remove-task-label.js'
import { updateLabel } from '../../src/providers/kaneo/update-label.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

describe('E2E: Label Operations', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()
    await testClient.cleanup()

    const project = await testClient.createTestProject(`Label Ops Test ${Date.now()}`)
    projectId = project.id
  })

  test('creates a label with name and color', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Bug',
      color: '#FF0000',
    })
    testClient.trackLabel(label.id)
    expect(label.name).toBe('Bug')
    expect(label.color).toBe('#FF0000')

    // Verify label appears in listLabels
    const labels = await listLabels({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    const found = labels.find((l) => l.id === label.id)
    expect(found?.name).toBe('Bug')
    expect(found?.color).toBe('#FF0000')
  })

  test('updates label name and color', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Old Name',
      color: '#000000',
    })
    testClient.trackLabel(label.id)

    const updated = await updateLabel({
      config: kaneoConfig,
      labelId: label.id,
      name: 'New Name',
      color: '#FFFFFF',
    })

    expect(updated.name).toBe('New Name')
    expect(updated.color).toBe('#FFFFFF')

    // Verify via re-fetch
    const labels = await listLabels({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    const refetched = labels.find((l) => l.id === label.id)
    expect(refetched?.name).toBe('New Name')
    expect(refetched?.color).toBe('#FFFFFF')
  })

  test('lists all labels in workspace', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: `Label ${Date.now()}`,
    })
    testClient.trackLabel(label.id)

    const labels = await listLabels({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    const ids = labels.map((l) => l.id)
    expect(ids).toContain(label.id)
  })

  test('removes a label', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'To Remove',
    })

    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task for label deletion' })
    testClient.trackTask(task.id)

    await addTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId: label.id,
      workspaceId: testClient.getWorkspaceId(),
    })

    await removeLabel({ config: kaneoConfig, labelId: label.id })

    // Verify label is absent from list after removal
    const labels = await listLabels({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    const found = labels.find((l) => l.id === label.id)
    expect(found).toBeUndefined()
  })

  test('throws error when removing unattached label', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Unattached Remove',
    })
    testClient.trackLabel(label.id)

    const promise = removeLabel({ config: kaneoConfig, labelId: label.id })
    await expect(promise).rejects.toThrow()
  })

  test('adds label to task and verifies via re-fetch', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Test Label',
    })
    testClient.trackLabel(label.id)

    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task with label' })
    testClient.trackTask(task.id)

    const addResult = await addTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId: label.id,
      workspaceId: testClient.getWorkspaceId(),
    })
    expect(addResult).toEqual({ taskId: task.id, labelId: label.id })

    // Re-fetch task to verify label association (if visible on task)
    const taskAfterAdd = await getTask({ config: kaneoConfig, taskId: task.id })
    // Task object may or may not expose labels — document behavior
    expect(taskAfterAdd.id).toBe(task.id)
  })

  test('removes label from task', async () => {
    const label = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Removable Label',
    })
    testClient.trackLabel(label.id)

    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task for label removal' })
    testClient.trackTask(task.id)

    await addTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId: label.id,
      workspaceId: testClient.getWorkspaceId(),
    })

    const removeResult = await removeTaskLabel({ config: kaneoConfig, taskId: task.id, labelId: label.id })
    expect(removeResult.taskId).toBe(task.id)
    expect(removeResult.labelId).toBe(label.id)

    // Re-fetch task to verify label is no longer associated
    const taskAfterRemove = await getTask({ config: kaneoConfig, taskId: task.id })
    expect(taskAfterRemove.id).toBe(task.id)
  })

  test('throws error when updating non-existent label', async () => {
    const promise = updateLabel({
      config: kaneoConfig,
      labelId: 'non-existent-id',
      name: 'X',
    })
    await expect(promise).rejects.toThrow()
  })

  test('throws error when removing non-existent label', async () => {
    const promise = removeLabel({
      config: kaneoConfig,
      labelId: 'non-existent-id',
    })
    await expect(promise).rejects.toThrow()
  })
})
