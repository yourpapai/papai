import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import { z } from 'zod'

setDefaultTimeout(10000)

import { addTaskLabel } from '../../src/providers/kaneo/add-task-label.js'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createLabel } from '../../src/providers/kaneo/create-label.js'
import { createTask } from '../../src/providers/kaneo/create-task.js'
import { listLabels } from '../../src/providers/kaneo/list-labels.js'
import { removeLabel } from '../../src/providers/kaneo/remove-label.js'
import { removeTaskLabel } from '../../src/providers/kaneo/remove-task-label.js'
import { updateLabel } from '../../src/providers/kaneo/update-label.js'
import { kaneoApiJsonParsed } from './kaneo-api-helpers.js'
import { createTestClient, type KaneoTestClient } from './kaneo-test-client.js'

const RawWorkspaceLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  taskId: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  workspaceId: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
})

type RawWorkspaceLabel = z.infer<typeof RawWorkspaceLabelSchema>

function requireWorkspaceLabel(labels: readonly RawWorkspaceLabel[], labelId: string): RawWorkspaceLabel {
  const label = labels.find((entry) => entry.id === labelId)
  if (label === undefined) {
    throw new Error(`Expected workspace label ${labelId}`)
  }

  return label
}

describe('E2E: Label Operations', () => {
  let testClient: KaneoTestClient
  let kaneoConfig: KaneoConfig
  let projectId: string

  const cleanupUnattachedLabel = async (labelId: string): Promise<void> => {
    const task = await createTask({
      config: kaneoConfig,
      projectId,
      title: `Label cleanup ${Date.now()}`,
    })
    testClient.trackTask(task.id)

    await addTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId,
      workspaceId: testClient.getWorkspaceId(),
    })

    await removeLabel({ config: kaneoConfig, labelId })
  }

  beforeEach(async () => {
    testClient = createTestClient()
    kaneoConfig = testClient.getKaneoConfig()

    const project = await testClient.createTestProject(`Label Ops Test ${Date.now()}`)
    projectId = project.id
  })

  afterEach(async () => {
    await testClient.cleanup()
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

    await cleanupUnattachedLabel(label.id)
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

    await cleanupUnattachedLabel(label.id)
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

    await cleanupUnattachedLabel(label.id)
  })

  test('shows attached labels through the dedicated task-label endpoint and removes them after detach', async () => {
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

    const taskLabels = await kaneoApiJsonParsed(`/label/task/${task.id}`, z.array(RawWorkspaceLabelSchema))
    const attachedTaskLabel = requireWorkspaceLabel(taskLabels, label.id)
    expect(attachedTaskLabel.name).toBe(label.name)
    expect(attachedTaskLabel.color).toBe(label.color)
    expect(attachedTaskLabel.taskId).toBe(task.id)

    const workspaceLabelsAfterAttach = await kaneoApiJsonParsed(
      `/label/workspace/${testClient.getWorkspaceId()}`,
      z.array(RawWorkspaceLabelSchema),
    )
    const attachedWorkspaceLabel = requireWorkspaceLabel(workspaceLabelsAfterAttach, label.id)
    expect(attachedWorkspaceLabel.taskId).toBe(task.id)

    const removeResult = await removeTaskLabel({ config: kaneoConfig, taskId: task.id, labelId: label.id })
    expect(removeResult.taskId).toBe(task.id)
    expect(removeResult.labelId).toBe(label.id)

    const taskLabelsAfterDetach = await kaneoApiJsonParsed(`/label/task/${task.id}`, z.array(RawWorkspaceLabelSchema))
    expect(taskLabelsAfterDetach.map((taskLabel) => taskLabel.id)).not.toContain(label.id)

    const workspaceLabelsAfterDetach = await kaneoApiJsonParsed(
      `/label/workspace/${testClient.getWorkspaceId()}`,
      z.array(RawWorkspaceLabelSchema),
    )
    const detachedLabel = requireWorkspaceLabel(workspaceLabelsAfterDetach, label.id)
    expect(detachedLabel.taskId).not.toBe(task.id)

    await cleanupUnattachedLabel(label.id)
  })

  test('keeps unattached label deletion blocked and allows attached label deletion', async () => {
    const unattachedLabel = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Unattached Remove',
    })
    testClient.trackLabel(unattachedLabel.id)

    await expect(removeLabel({ config: kaneoConfig, labelId: unattachedLabel.id })).rejects.toThrow()

    const task = await createTask({ config: kaneoConfig, projectId, title: 'Task for label deletion' })
    testClient.trackTask(task.id)

    await addTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId: unattachedLabel.id,
      workspaceId: testClient.getWorkspaceId(),
    })

    await expect(removeLabel({ config: kaneoConfig, labelId: unattachedLabel.id })).resolves.toEqual({
      id: unattachedLabel.id,
      success: true,
    })

    const attachedLabel = await createLabel({
      config: kaneoConfig,
      workspaceId: testClient.getWorkspaceId(),
      name: 'Attached Remove',
    })
    testClient.trackLabel(attachedLabel.id)

    await addTaskLabel({
      config: kaneoConfig,
      taskId: task.id,
      labelId: attachedLabel.id,
      workspaceId: testClient.getWorkspaceId(),
    })

    await expect(removeLabel({ config: kaneoConfig, labelId: attachedLabel.id })).resolves.toEqual({
      id: attachedLabel.id,
      success: true,
    })

    const rawWorkspaceLabels = await kaneoApiJsonParsed(
      `/label/workspace/${testClient.getWorkspaceId()}`,
      z.array(RawWorkspaceLabelSchema),
    )
    expect(rawWorkspaceLabels.find((workspaceLabel) => workspaceLabel.id === attachedLabel.id)).toBeUndefined()

    const labels = await listLabels({ config: kaneoConfig, workspaceId: testClient.getWorkspaceId() })
    expect(labels.find((workspaceLabel) => workspaceLabel.id === attachedLabel.id)).toBeUndefined()
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
