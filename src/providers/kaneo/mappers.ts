import type { Column, Comment, Label, Project, Task, TaskListItem, TaskSearchResult } from '../types.js'
import type { TaskDetails } from './get-task.js'
import type { KaneoTaskListItem } from './list-tasks.js'
import type { CreateTaskResponse } from './schemas/create-task.js'
import type { TaskResult } from './search-tasks.js'

/** Safely convert an unknown Kaneo date field to a string or null/undefined. */
const toDateString = (value: unknown): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return null
}

const toOptionalDateString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return undefined
}

/** Map a Kaneo CreateTaskResponse to common Task type. */
export const mapCreateTaskResponse = (result: CreateTaskResponse, url: string): Task => ({
  id: result.id,
  title: result.title,
  description: result.description,
  status: result.status,
  priority: result.priority,
  assignee: result.userId,
  startDate: toDateString(result.startDate),
  dueDate: toDateString(result.dueDate),
  createdAt: toOptionalDateString(result.createdAt),
  projectId: result.projectId,
  url,
})

/** Map a Kaneo TaskDetails (from getTask) to common Task type. */
export const mapTaskDetails = (result: TaskDetails, url: string): Task => ({
  id: result.id,
  title: result.title,
  description: result.description,
  status: result.status,
  priority: result.priority,
  assignee: result.userId,
  startDate: toDateString(result.startDate),
  dueDate: result.dueDate,
  createdAt: result.createdAt,
  projectId: result.projectId,
  url,
  relations: result.relations,
})

/** Map Kaneo task list items to common TaskListItem type. */
export const mapTaskListItem = (t: KaneoTaskListItem, url: string): TaskListItem => ({
  id: t.id,
  title: t.title,
  number: t.number,
  status: t.status,
  priority: t.priority,
  dueDate: t.dueDate,
  url,
})

/** Map Kaneo search result to common TaskSearchResult type. */
export const mapTaskSearchResult = (t: TaskResult, url: string): TaskSearchResult => ({
  id: t.id,
  title: t.title,
  number: t.number ?? undefined,
  status: t.status,
  priority: t.priority,
  projectId: t.projectId,
  url,
})

/** Map Kaneo project to common Project type. */
export const mapProject = (p: { id: string; name: string; description?: string | null }, url: string): Project => ({
  id: p.id,
  name: p.name,
  description: p.description,
  url,
})

/** Map Kaneo comment to common Comment type. */
export const mapComment = (c: { id: string; comment: string; createdAt: string }): Comment => ({
  id: c.id,
  body: c.comment,
  createdAt: c.createdAt,
})

/** Map Kaneo label to common Label type. */
export const mapLabel = (l: { id: string; name: string; color?: string }): Label => ({
  id: l.id,
  name: l.name,
  color: l.color,
})

/** Map Kaneo column to common Column type. */
export const mapColumn = (c: { id: string; name: string; isFinal: boolean }): Column => ({
  id: c.id,
  name: c.name,
  isFinal: c.isFinal,
})
