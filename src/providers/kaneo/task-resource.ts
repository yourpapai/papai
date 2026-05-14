import { z } from 'zod'

import { logger } from '../../logger.js'
import type { ListTasksParams } from '../types.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { getTaskRelations } from './task-relations.js'
import type { TaskRelation } from '../types.js'
import { buildListTasksQuery } from './list-tasks-query.js'
import type { KaneoTaskListItem } from './list-tasks.js'
import { TaskSchema as KaneoCreateTaskResponseSchema } from './schemas/create-task.js'
import { TaskSchema as KaneoGetTaskResponseSchema } from './schemas/get-task.js'
import {
  GlobalSearchResponseSchema,
  RuntimeGlobalSearchResponseSchema,
  type GlobalSearchResponse,
  type RuntimeGlobalSearchResponse,
} from './schemas/global-search.js'
import { ListTasksResponseSchema } from './schemas/list-tasks.js'
import { type TaskStatusDeps, denormalizeStatus, validateStatus } from './task-status.js'
import { performUpdate } from './task-update-helpers.js'

const normalizeSearchResponse = (
  result: GlobalSearchResponse | RuntimeGlobalSearchResponse,
): GlobalSearchResponse => {
  if ('tasks' in result) {
    return result
  }

  return {
    tasks: result.results.flatMap((item) =>
      item.type !== 'task' || item.projectId === undefined
        ? []
        : [
            {
              id: item.id,
              projectId: item.projectId,
              position: null,
              number: item.taskNumber ?? null,
              userId: item.userId ?? null,
              title: item.title,
              description: item.description ?? null,
              status: item.status ?? 'to-do',
              priority:
                item.priority === 'low' ||
                item.priority === 'medium' ||
                item.priority === 'high' ||
                item.priority === 'urgent' ||
                item.priority === 'no-priority'
                  ? item.priority
                  : 'no-priority',
              createdAt: item.createdAt,
            },
          ],
    ),
    projects: [],
    workspaces: [],
    comments: [],
    activities: [],
  }
}

export class TaskResource {
  private log = logger.child({ scope: 'kaneo:task-resource' })
  private statusDeps: TaskStatusDeps | undefined

  constructor(
    private config: KaneoConfig,
    statusDeps?: TaskStatusDeps,
  ) {
    this.statusDeps = statusDeps
  }

  async create(params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    dueDate?: string
    startDate?: string
    userId?: string
  }): Promise<z.infer<typeof KaneoCreateTaskResponseSchema>> {
    this.log.debug({ projectId: params.projectId, title: params.title }, 'Creating task')

    try {
      const status = await validateStatus(this.config, params.projectId, params.status ?? 'to-do', this.statusDeps)
      const task = await kaneoFetch(
        this.config,
        'POST',
        `/task/${params.projectId}`,
        {
          title: params.title,
          description: params.description ?? '',
          priority: params.priority ?? 'no-priority',
          status,
          dueDate: params.dueDate,
          startDate: params.startDate,
          userId: params.userId,
        },
        undefined,
        KaneoCreateTaskResponseSchema,
      )
      // Denormalize status from column ID to slug
      task.status = await denormalizeStatus(this.config, params.projectId, task.status, this.statusDeps)
      this.log.info({ taskId: task.id, number: task.number }, 'Task created')
      return task
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create task')
      throw classifyKaneoError(error)
    }
  }

  async list(projectId: string, params?: ListTasksParams): Promise<KaneoTaskListItem[]> {
    this.log.debug({ projectId, params }, 'Listing tasks')

    try {
      const query: Record<string, string> | undefined = params === undefined ? undefined : buildListTasksQuery(params)
      const result = await kaneoFetch(
        this.config,
        'GET',
        `/task/tasks/${projectId}`,
        undefined,
        query,
        ListTasksResponseSchema,
      )
      const rawTasks = result.data.columns.flatMap((col) => col.tasks).concat(result.data.plannedTasks)
      const tasks: KaneoTaskListItem[] = rawTasks.map((task) => ({
        id: task.id,
        title: task.title,
        number: task.number,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate ?? null,
      }))
      // Denormalize status from column slug to normalized slug for each task
      for (const task of tasks) {
        const column = result.data.columns.find((c) => c.id === task.status)
        if (column !== undefined) {
          task.status = column.name.toLowerCase().replace(/\s+/g, '-')
        }
      }
      this.log.info({ count: tasks.length }, 'Tasks listed')
      return tasks
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list tasks')
      throw classifyKaneoError(error)
    }
  }

  async get(taskId: string): Promise<{
    id: string
    title: string
    description: string
    number: number
    status: string
    priority: string
    startDate: string | null
    dueDate: string | null
    createdAt: string
    projectId: string
    userId: string | null
    relations: TaskRelation[]
  }> {
    this.log.debug({ taskId }, 'Getting task')

    try {
      const task = await kaneoFetch(
        this.config,
        'GET',
        `/task/${taskId}`,
        undefined,
        undefined,
        KaneoGetTaskResponseSchema,
      )
      // Denormalize status from column ID to slug
      task.status = await denormalizeStatus(this.config, task.projectId, task.status, this.statusDeps)
      const relations = await getTaskRelations(this.config, taskId)
      this.log.info({ taskId, number: task.number, relationCount: relations.length }, 'Task fetched')
      return {
        ...task,
        number: task.number ?? 0,
        description: task.description ?? '',
        relations,
        createdAt: typeof task.createdAt === 'string' ? task.createdAt : '',
        startDate: task.startDate ?? null,
        dueDate:
          task.dueDate === null || task.dueDate === undefined
            ? null
            : typeof task.dueDate === 'string'
              ? task.dueDate
              : JSON.stringify(task.dueDate),
      }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get task')
      throw classifyKaneoError(error, { taskId })
    }
  }

  async update(
    taskId: string,
    params: {
      title?: string
      description?: string
      status?: string
      priority?: string
      dueDate?: string
      startDate?: string
      userId?: string
    },
  ): Promise<z.infer<typeof KaneoCreateTaskResponseSchema>> {
    this.log.debug({ taskId, ...params }, 'Updating task')

    try {
      const task = await performUpdate(this.config, taskId, params, this.statusDeps)
      this.log.info({ taskId, number: task.number }, 'Task updated')
      return task
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update task')
      throw classifyKaneoError(error, { taskId })
    }
  }

  async delete(taskId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ taskId }, 'Deleting task')

    try {
      await kaneoFetch(this.config, 'DELETE', `/task/${taskId}`, undefined, undefined, z.unknown())
      this.log.info({ taskId }, 'Task deleted')
      return { id: taskId, success: true }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to delete task')
      throw classifyKaneoError(error, { taskId })
    }
  }

  async search(params: {
    query: string
    workspaceId: string
    projectId?: string
    assigneeId?: string
    limit?: number
    offset?: number
  }): Promise<GlobalSearchResponse> {
    this.log.debug(params, 'Searching tasks')
    try {
      const shouldPaginateLocally = params.assigneeId !== undefined
      const queryParams: Record<string, string> = {
        q: params.query,
        type: 'tasks',
        workspaceId: params.workspaceId,
        ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
        ...(shouldPaginateLocally || params.limit === undefined ? {} : { limit: String(params.limit) }),
        ...(shouldPaginateLocally || params.offset === undefined ? {} : { offset: String(params.offset) }),
      }
      const result = await kaneoFetch(
        this.config,
        'GET',
        '/search',
        undefined,
        queryParams,
        z.union([GlobalSearchResponseSchema, RuntimeGlobalSearchResponseSchema]),
      )
      const normalizedResult = normalizeSearchResponse(result)
      this.log.info({ taskCount: normalizedResult.tasks.length, assigneeId: params.assigneeId }, 'Tasks searched')
      return normalizedResult
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to search tasks')
      throw classifyKaneoError(error)
    }
  }

  async addRelation(
    taskId: string,
    relatedTaskId: string,
    type: TaskRelation['type'],
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return (await import('./task-relations.js')).addTaskRelation(this.config, taskId, relatedTaskId, type)
  }
  async removeRelation(
    taskId: string,
    relatedTaskId: string,
  ): Promise<{ taskId: string; relatedTaskId: string; success: true }> {
    return (await import('./task-relations.js')).removeTaskRelation(this.config, taskId, relatedTaskId)
  }
  async updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: TaskRelation['type'],
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return (await import('./task-relations.js')).updateTaskRelation(this.config, taskId, relatedTaskId, type)
  }
}
