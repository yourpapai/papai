// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ListTasksParams, Task, TaskListItem, TaskSearchResult } from 'papai/plugin-types'

import type { KaneoConfig } from '../client.js'
import { createTask } from '../create-task.js'
import { deleteTask } from '../delete-task.js'
import { getTask } from '../get-task.js'
import { listTasks } from '../list-tasks.js'
import { mapCreateTaskResponse, mapGlobalSearchTaskResults, mapTaskDetails, mapTaskListItem } from '../mappers.js'
import { searchTasks } from '../search-tasks.js'
import { updateTask } from '../update-task.js'
import { buildTaskUrl } from '../url-builder.js'

export async function kaneoCreateTask(
  config: KaneoConfig,
  workspaceId: string,
  params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    startDate?: string
    dueDate?: string
    assignee?: string
  },
): Promise<Task> {
  const { projectId, title, description, priority, status, startDate, dueDate, assignee } = params
  const result = await createTask({
    config,
    projectId,
    title,
    description,
    priority,
    status,
    startDate,
    dueDate,
    userId: assignee,
  })
  return mapCreateTaskResponse(result, buildTaskUrl(config.baseUrl, workspaceId, result.projectId, result.id))
}

export async function kaneoGetTask(config: KaneoConfig, workspaceId: string, taskId: string): Promise<Task> {
  const result = await getTask({ config, taskId })
  return mapTaskDetails(result, buildTaskUrl(config.baseUrl, workspaceId, result.projectId, result.id))
}

export async function kaneoUpdateTask(
  config: KaneoConfig,
  workspaceId: string,
  taskId: string,
  params: {
    title?: string
    description?: string
    status?: string
    priority?: string
    startDate?: string
    dueDate?: string
    projectId?: string
    assignee?: string
  },
): Promise<Task> {
  const { title, description, status, priority, startDate, dueDate, projectId, assignee } = params
  const result = await updateTask({
    config,
    taskId,
    title,
    description,
    status,
    priority,
    startDate,
    dueDate,
    projectId,
    userId: assignee,
  })
  return mapCreateTaskResponse(result, buildTaskUrl(config.baseUrl, workspaceId, result.projectId, result.id))
}

export async function kaneoListTasks(
  config: KaneoConfig,
  workspaceId: string,
  projectId: string,
  params?: ListTasksParams,
): Promise<TaskListItem[]> {
  const results = await listTasks({ config, projectId, params })
  return results.map((t) => mapTaskListItem(t, buildTaskUrl(config.baseUrl, workspaceId, projectId, t.id)))
}

export async function kaneoSearchTasks(
  config: KaneoConfig,
  workspaceId: string,
  params: {
    query: string
    projectId?: string
    assigneeId?: string
    limit?: number
    offset?: number
  },
): Promise<TaskSearchResult[]> {
  const result = await searchTasks({
    config,
    query: params.query,
    workspaceId,
    projectId: params.projectId,
    assigneeId: params.assigneeId,
    limit: params.limit,
    offset: params.offset,
  })

  return mapGlobalSearchTaskResults(result, (task) =>
    buildTaskUrl(config.baseUrl, workspaceId, task.projectId, task.id),
  )
}

export async function kaneoDeleteTask(config: KaneoConfig, taskId: string): Promise<{ id: string }> {
  const result = await deleteTask({ config, taskId })
  return { id: result.id }
}
