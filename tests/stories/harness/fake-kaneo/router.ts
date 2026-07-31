// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  type FakeKaneoCtx,
  type FakeKaneoState,
  DEFAULT_COLUMN_NAME,
  nextId,
  nextTimestamp,
  slugify,
  type StoredColumn,
  type StoredProject,
  type StoredTask,
} from './state.js'

// ---------- Response helpers ----------

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const errorResponse = (status: number, message: string): Response => json({ error: message }, status)

const noContent = (): Response => new Response(null, { status: 204 })

// ---------- Path matcher ----------

const matchPath = (pattern: string, path: string): Record<string, string> | null => {
  const pp = pattern.split('/')
  const ap = path.split('/')
  if (pp.length !== ap.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i += 1) {
    const seg = pp[i] ?? ''
    const val = ap[i] ?? ''
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val)
    else if (seg !== val) return null
  }
  return params
}

// ---------- Projections ----------

const projectProjection = (p: StoredProject): Record<string, unknown> => ({
  id: p.id,
  workspaceId: p.workspaceId,
  slug: p.slug,
  icon: p.icon ?? null,
  name: p.name,
  description: p.description ?? null,
  createdAt: p.createdAt,
  isPublic: p.isPublic,
})

const columnProjection = (c: StoredColumn): Record<string, unknown> => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  icon: c.icon,
  color: c.color,
  isFinal: c.isFinal,
})

const taskProjection = (t: StoredTask): Record<string, unknown> => ({
  id: t.id,
  projectId: t.projectId,
  position: t.position,
  number: t.number,
  userId: t.userId,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  startDate: t.startDate ?? null,
  dueDate: t.dueDate ?? null,
  createdAt: t.createdAt,
})

const listTaskProjection = (t: StoredTask): Record<string, unknown> => ({
  id: t.id,
  title: t.title,
  number: t.number,
  status: t.status,
  priority: t.priority,
  description: t.description,
  position: t.position,
  createdAt: t.createdAt,
  userId: t.userId,
  projectId: t.projectId,
  dueDate: t.dueDate ?? null,
  labels: [],
  externalLinks: [],
})

const columnsFor = (state: FakeKaneoState, projectId: string): StoredColumn[] => {
  const project = state.projects.get(projectId)
  if (project === undefined) return []
  return [...state.columns.values()].filter((c) => c.projectId === projectId).sort((a, b) => a.position - b.position)
}

const tasksFor = (state: FakeKaneoState, projectId: string): StoredTask[] =>
  [...state.tasks.values()].filter((t) => t.projectId === projectId)

const createDefaultColumn = (state: FakeKaneoState, project: StoredProject): StoredColumn => {
  const id = nextId(state, 'column')
  const column: StoredColumn = {
    id,
    projectId: project.id,
    name: DEFAULT_COLUMN_NAME,
    slug: slugify(DEFAULT_COLUMN_NAME),
    icon: undefined,
    color: undefined,
    isFinal: false,
    position: 0,
  }
  state.columns.set(id, column)
  return column
}

// ---------- Body coercion helpers ----------

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'

const asObject = (body: unknown): Record<string, unknown> => (isRecord(body) ? body : {})

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

// ---------- Project handler ----------

const handleProjects = (ctx: FakeKaneoCtx): Response | undefined => {
  const { method, path, state, query, body } = ctx

  const one = matchPath('/api/project/:id', path)
  if (one !== null) {
    const id = one['id'] ?? ''
    const project = state.projects.get(id)
    if (project === undefined) return errorResponse(404, 'project not found')
    if (method === 'GET') return json(projectProjection(project))
    if (method === 'PUT') {
      const payload = asObject(body)
      if (asString(payload['name']) !== undefined) project.name = asString(payload['name']) ?? project.name
      if (asString(payload['slug']) !== undefined) project.slug = asString(payload['slug']) ?? project.slug
      if (asString(payload['icon']) !== undefined) project.icon = asString(payload['icon'])
      if (asString(payload['description']) !== undefined) project.description = asString(payload['description'])
      if (typeof payload['isPublic'] === 'boolean') project.isPublic = payload['isPublic']
      return json(projectProjection(project))
    }
    if (method === 'DELETE') {
      state.projects.delete(id)
      for (const column of [...state.columns.values()].filter((c) => c.projectId === id))
        state.columns.delete(column.id)
      for (const task of tasksFor(state, id)) state.tasks.delete(task.id)
      return noContent()
    }
  }

  if (path === '/api/project') {
    if (method === 'POST') {
      const payload = asObject(body)
      const workspaceId = asString(payload['workspaceId']) ?? ''
      const name = asString(payload['name']) ?? ''
      const id = nextId(state, 'project')
      const project: StoredProject = {
        id,
        workspaceId,
        name,
        slug: asString(payload['slug']) ?? slugify(name),
        icon: asString(payload['icon']),
        description: undefined,
        isPublic: false,
        createdAt: nextTimestamp(state),
      }
      state.projects.set(id, project)
      createDefaultColumn(state, project)
      return json(projectProjection(project))
    }
    if (method === 'GET') {
      const workspaceId = query.get('workspaceId')
      const all = [...state.projects.values()]
        .filter((p) => workspaceId === null || p.workspaceId === workspaceId)
        .map(projectProjection)
      return json(all)
    }
  }

  return undefined
}

// ---------- Column handler ----------

const handleColumns = (ctx: FakeKaneoCtx): Response | undefined => {
  const { method, path, state, body } = ctx

  const reorder = matchPath('/api/column/reorder/:projectId', path)
  if (reorder !== null && method === 'PUT') {
    const projectId = reorder['projectId'] ?? ''
    if (state.projects.get(projectId) === undefined) return errorResponse(404, 'project not found')
    const payload = asObject(body)
    const rawColumns = payload['columns']
    const entries: unknown[] = Array.isArray(rawColumns) ? rawColumns : []
    for (const entry of entries) {
      const item = asObject(entry)
      const column = state.columns.get(asString(item['id']) ?? '')
      if (column === undefined) continue
      const position = item['position']
      if (typeof position === 'number') column.position = position
    }
    return json({ success: true })
  }

  const byId = matchPath('/api/column/:id', path)
  if (byId !== null) {
    const id = byId['id'] ?? ''
    if (method === 'GET') {
      const projectId = id
      if (state.projects.get(projectId) === undefined) return errorResponse(404, 'project not found')
      return json(columnsFor(state, projectId).map(columnProjection))
    }
    if (method === 'POST') {
      const projectId = id
      const project = state.projects.get(projectId)
      if (project === undefined) return errorResponse(404, 'project not found')
      const payload = asObject(body)
      const name = asString(payload['name']) ?? ''
      const newId = nextId(state, 'column')
      const column: StoredColumn = {
        id: newId,
        projectId: project.id,
        name,
        slug: asString(payload['slug']) ?? slugify(name),
        icon: asString(payload['icon']),
        color: asString(payload['color']),
        isFinal: typeof payload['isFinal'] === 'boolean' ? payload['isFinal'] : false,
        position: columnsFor(state, project.id).length,
      }
      state.columns.set(newId, column)
      return json(columnProjection(column))
    }
    if (method === 'PUT') {
      const column = state.columns.get(id)
      if (column === undefined) return errorResponse(404, 'column not found')
      const payload = asObject(body)
      if (asString(payload['name']) !== undefined) {
        column.name = asString(payload['name']) ?? column.name
        column.slug = asString(payload['slug']) ?? slugify(column.name)
      }
      if (asString(payload['icon']) !== undefined) column.icon = asString(payload['icon'])
      if (asString(payload['color']) !== undefined) column.color = asString(payload['color'])
      if (typeof payload['isFinal'] === 'boolean') column.isFinal = payload['isFinal']
      return json(columnProjection(column))
    }
    if (method === 'DELETE') {
      return state.columns.delete(id) ? noContent() : errorResponse(404, 'column not found')
    }
  }

  return undefined
}

// ---------- Task handler ----------

const resolveTaskBySlug = (state: FakeKaneoState, projectId: string, status: string): string => {
  const columns = columnsFor(state, projectId)
  const match = columns.find((c) => c.slug === status)
  return match === undefined ? status : match.slug
}

const handleTasks = (ctx: FakeKaneoCtx): Response | undefined => {
  const { method, path, state, body } = ctx

  const board = matchPath('/api/task/tasks/:projectId', path)
  if (board !== null && method === 'GET') {
    const projectId = board['projectId'] ?? ''
    const project = state.projects.get(projectId)
    if (project === undefined) return errorResponse(404, 'project not found')
    const columns = columnsFor(state, projectId)
    const tasks = tasksFor(state, projectId)
    const columnsWithTasks = columns.map((column) => ({
      ...columnProjection(column),
      tasks: tasks.filter((t) => resolveTaskBySlug(state, projectId, t.status) === column.slug).map(listTaskProjection),
    }))
    const planned = tasks
      .filter((t) => !columns.some((c) => c.slug === resolveTaskBySlug(state, projectId, t.status)))
      .map(listTaskProjection)
    return json({
      data: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        icon: project.icon ?? null,
        description: project.description ?? null,
        isPublic: project.isPublic,
        workspaceId: project.workspaceId,
        columns: columnsWithTasks,
        archivedTasks: [],
        plannedTasks: planned,
      },
      pagination: { total: tasks.length, page: 1, pageSize: tasks.length, totalPages: 1 },
    })
  }

  const one = matchPath('/api/task/:id', path)
  if (one !== null && (method === 'GET' || method === 'PUT' || method === 'DELETE')) {
    const id = one['id'] ?? ''
    const task = state.tasks.get(id)
    if (task === undefined) return errorResponse(404, 'task not found')
    if (method === 'GET') return json(taskProjection(task))
    if (method === 'PUT') {
      const payload = asObject(body)
      if (asString(payload['title']) !== undefined) task.title = asString(payload['title']) ?? task.title
      if (asString(payload['description']) !== undefined) task.description = asString(payload['description']) ?? ''
      if (asString(payload['status']) !== undefined) task.status = asString(payload['status']) ?? task.status
      if (asString(payload['priority']) !== undefined) task.priority = asString(payload['priority']) ?? task.priority
      if (asString(payload['dueDate']) !== undefined) task.dueDate = asString(payload['dueDate'])
      if (asString(payload['startDate']) !== undefined) task.startDate = asString(payload['startDate'])
      if (asString(payload['userId']) !== undefined) task.userId = asString(payload['userId']) ?? null
      if (typeof payload['position'] === 'number') task.position = payload['position']
      return json(taskProjection(task))
    }
    if (method === 'DELETE') {
      state.tasks.delete(id)
      return noContent()
    }
  }

  const byProject = matchPath('/api/task/:projectId', path)
  if (byProject !== null && method === 'POST') {
    const projectId = byProject['projectId'] ?? ''
    const project = state.projects.get(projectId)
    if (project === undefined) return errorResponse(404, 'project not found')
    const payload = asObject(body)
    const status = asString(payload['status']) ?? slugify(DEFAULT_COLUMN_NAME)
    const resolvedStatus = resolveTaskBySlug(state, projectId, status)
    const id = nextId(state, 'task')
    const number = tasksFor(state, projectId).length + 1
    const sameColumn = tasksFor(state, projectId).filter((t) => t.status === resolvedStatus).length
    const task: StoredTask = {
      id,
      projectId,
      position: sameColumn,
      number,
      userId: asString(payload['userId']) ?? null,
      title: asString(payload['title']) ?? '',
      description: asString(payload['description']) ?? '',
      status: resolvedStatus,
      priority: asString(payload['priority']) ?? 'no-priority',
      startDate: asString(payload['startDate']),
      dueDate: asString(payload['dueDate']),
      createdAt: nextTimestamp(state),
    }
    state.tasks.set(id, task)
    return json(taskProjection(task))
  }

  return undefined
}

// ---------- Search handler ----------

const handleSearch = (ctx: FakeKaneoCtx): Response | undefined => {
  const { method, path, state, query } = ctx
  if (path !== '/api/search' || method !== 'GET') return undefined

  const needle = (query.get('q') ?? '').toLowerCase()
  const workspaceId = query.get('workspaceId')
  const projectId = query.get('projectId')

  const tasks = [...state.tasks.values()]
    .filter((t) => workspaceId === null || state.projects.get(t.projectId)?.workspaceId === workspaceId)
    .filter((t) => projectId === null || t.projectId === projectId)
    .filter(
      (t) =>
        needle.length === 0 || t.title.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle),
    )
    .map(taskProjection)

  return json({ tasks, projects: [], workspaces: [], comments: [], activities: [] })
}

// ---------- Handler chain ----------

const handlers: ReadonlyArray<(ctx: FakeKaneoCtx) => Response | undefined> = [
  handleProjects,
  handleColumns,
  handleTasks,
  handleSearch,
]

export const handleFakeKaneoRequest = (ctx: FakeKaneoCtx): Response => {
  for (const handler of handlers) {
    const response = handler(ctx)
    if (response !== undefined) return response
  }
  return errorResponse(404, `no route for ${ctx.method} ${ctx.path}`)
}
