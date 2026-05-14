import { z } from 'zod'

import { providerError } from '../../errors.js'
import { logger } from '../../logger.js'
import { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { CreateLabelResponseSchema } from './schemas/create-label.js'

// Extended schema for labels with task association
const KaneoLabelWithTaskSchema = CreateLabelResponseSchema

export class LabelResource {
  private log = logger.child({ scope: 'kaneo:label-resource' })

  constructor(private config: KaneoConfig) {}

  async create(params: {
    workspaceId: string
    name: string
    color?: string
  }): Promise<z.infer<typeof CreateLabelResponseSchema>> {
    this.log.debug({ workspaceId: params.workspaceId, name: params.name }, 'Creating label')

    try {
      const label = await kaneoFetch(
        this.config,
        'POST',
        '/label',
        {
          name: params.name,
          color: params.color ?? '#6b7280',
          workspaceId: params.workspaceId,
        },
        undefined,
        CreateLabelResponseSchema,
      )
      this.log.info({ labelId: label.id, name: label.name }, 'Label created')
      return label
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create label')
      throw classifyKaneoError(error)
    }
  }

  async list(workspaceId: string): Promise<z.infer<typeof CreateLabelResponseSchema>[]> {
    this.log.debug({ workspaceId }, 'Listing labels')

    try {
      const labels = await kaneoFetch(
        this.config,
        'GET',
        `/label/workspace/${workspaceId}`,
        undefined,
        undefined,
        z.array(CreateLabelResponseSchema),
      )
      this.log.info({ count: labels.length }, 'Labels listed')
      return labels
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list labels')
      throw classifyKaneoError(error)
    }
  }

  async update(
    labelId: string,
    params: { name?: string; color?: string },
  ): Promise<z.infer<typeof CreateLabelResponseSchema>> {
    this.log.debug({ labelId, ...params }, 'Updating label')

    try {
      const existing = await kaneoFetch(
        this.config,
        'GET',
        `/label/${labelId}`,
        undefined,
        undefined,
        CreateLabelResponseSchema,
      )
      const body = {
        name: params.name ?? existing.name,
        color: params.color ?? existing.color,
      }
      const label = await kaneoFetch(
        this.config,
        'PUT',
        `/label/${labelId}`,
        body,
        undefined,
        CreateLabelResponseSchema,
      )
      this.log.info({ labelId, name: label.name }, 'Label updated')
      return label
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update label')
      throw classifyKaneoError(error)
    }
  }

  async remove(labelId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ labelId }, 'Removing label')

    try {
      const label = await kaneoFetch(
        this.config,
        'GET',
        `/label/${labelId}`,
        undefined,
        undefined,
        CreateLabelResponseSchema,
      )

      if (label.taskId === null) {
        throw new KaneoClassifiedError(
          `Label ${labelId} cannot be deleted because Kaneo only deletes labels that are attached to a task`,
          providerError.unsupportedOperation('remove unattached Kaneo label'),
        )
      }

      await kaneoFetch(this.config, 'DELETE', `/label/${labelId}`, undefined, undefined, z.unknown())
      this.log.info({ labelId }, 'Label removed')
      return { id: labelId, success: true }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to remove label')
      throw classifyKaneoError(error)
    }
  }

  async addToTask(taskId: string, labelId: string, _workspaceId: string): Promise<{ taskId: string; labelId: string }> {
    this.log.debug({ taskId, labelId }, 'Adding label to task')

    try {
      await kaneoFetch(this.config, 'PUT', `/label/${labelId}/task`, { taskId }, undefined, KaneoLabelWithTaskSchema)

      this.log.info({ taskId, labelId }, 'Label added to task')
      return { taskId, labelId }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to add label to task')
      throw classifyKaneoError(error)
    }
  }

  async removeFromTask(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string; success: true }> {
    this.log.debug({ taskId, labelId }, 'Removing label from task')

    try {
      await kaneoFetch(this.config, 'DELETE', `/label/${labelId}/task`, { taskId }, undefined, KaneoLabelWithTaskSchema)

      this.log.info({ taskId, labelId }, 'Label removed from task')
      return { taskId, labelId, success: true }
    } catch (error) {
      this.log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to remove label from task',
      )
      throw classifyKaneoError(error)
    }
  }
}
