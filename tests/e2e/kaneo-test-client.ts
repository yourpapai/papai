import { z } from 'zod'

import { logger } from '../../src/logger.js'
import type { KaneoConfig } from '../../src/providers/kaneo/client.js'
import { createProject } from '../../src/providers/kaneo/create-project.js'
import { deleteProject } from '../../src/providers/kaneo/delete-project.js'
import { deleteTask } from '../../src/providers/kaneo/delete-task.js'
import { removeLabel } from '../../src/providers/kaneo/remove-label.js'
import { getE2EConfigSync, type E2EConfig } from './global-setup.js'
import { generateUniqueSuffix } from './test-helpers.js'

const log = logger.child({ scope: 'e2e:client' })
const WorkspaceLabelSchema = z.object({ id: z.string(), taskId: z.string().nullable() })
const WorkspaceLabelListSchema = z.array(WorkspaceLabelSchema)

export class KaneoTestClient {
  private readonly config: E2EConfig
  private readonly kaneoConfig: KaneoConfig
  private readonly createdProjectIds: string[]
  private readonly createdTaskIds: string[]
  private readonly createdLabelIds: string[]

  constructor() {
    this.config = getE2EConfigSync()
    this.kaneoConfig = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
    }
    this.createdProjectIds = []
    this.createdTaskIds = []
    this.createdLabelIds = []
  }

  async createTestProject(name?: string): Promise<{ id: string; name: string; slug: string }> {
    const projectName = name ?? `Test Project ${generateUniqueSuffix()}`
    log.debug({ name: projectName }, 'createTestProject called')

    const project = await createProject({
      config: this.kaneoConfig,
      workspaceId: this.config.workspaceId,
      name: projectName,
    })

    this.createdProjectIds.push(project.id)
    log.info({ projectId: project.id, name: projectName }, 'Test project created')

    return project
  }

  trackTask(taskId: string): void {
    this.createdTaskIds.push(taskId)
    log.debug({ taskId }, 'Task tracked for cleanup')
  }

  trackLabel(labelId: string): void {
    this.createdLabelIds.push(labelId)
    log.debug({ labelId }, 'Label tracked for cleanup')
  }

  getKaneoConfig(): KaneoConfig {
    return { ...this.kaneoConfig }
  }

  getWorkspaceId(): string {
    return this.config.workspaceId
  }

  async cleanup(): Promise<void> {
    const projectCount = this.createdProjectIds.length
    const taskCount = this.createdTaskIds.length
    const labelCount = this.createdLabelIds.length

    log.info({ projectCount, taskCount, labelCount }, 'Starting cleanup')

    // Delete all tasks
    for (const taskId of this.createdTaskIds) {
      try {
        await deleteTask({ config: this.kaneoConfig, taskId })
        log.debug({ taskId }, 'Task deleted during cleanup')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn({ taskId, error: message }, 'Failed to delete task during cleanup')
      }
    }

    // Delete all projects
    for (const projectId of this.createdProjectIds) {
      try {
        await deleteProject({ config: this.kaneoConfig, projectId })
        log.debug({ projectId }, 'Project deleted during cleanup')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn({ projectId, error: message }, 'Failed to delete project during cleanup')
      }
    }

    // Remove all labels
    for (const labelId of this.createdLabelIds) {
      try {
        const labels = await fetch(`${this.kaneoConfig.baseUrl}/api/label/workspace/${this.config.workspaceId}`, {
          headers: { Authorization: `Bearer ${this.kaneoConfig.apiKey}` },
        }).then(async (response) => (response.ok ? WorkspaceLabelListSchema.parse(await response.json()) : []))

        const matchingLabel = labels.find((label) => label.id === labelId)
        if (matchingLabel?.taskId !== undefined && matchingLabel.taskId !== null) {
          await removeLabel({ config: this.kaneoConfig, labelId })
          log.debug({ labelId }, 'Label removed during cleanup')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn({ labelId, error: message }, 'Failed to remove label during cleanup')
      }
    }

    this.createdTaskIds.length = 0
    this.createdProjectIds.length = 0
    this.createdLabelIds.length = 0

    log.info({ projectCount, taskCount, labelCount }, 'Cleanup complete')
  }
}

export function createTestClient(): KaneoTestClient {
  return new KaneoTestClient()
}
