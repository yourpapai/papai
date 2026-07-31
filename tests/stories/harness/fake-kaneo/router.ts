// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  COMMENT_AUTHOR_USER_ID,
  type FakeKaneoCtx,
  type FakeKaneoState,
  DEFAULT_COLUMN_NAME,
  nextId,
  nextTimestamp,
  slugify,
  type StoredColumn,
  type StoredComment,
  type StoredLabel,
  type StoredProject,
  type StoredRelation,
  type StoredTask,
} from './state.js'

// ---------- Response helpers ----------

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const errorResponse = (status: number, message: string): Response => json({ error: message }, status)

const noContent = (): Response => new Response(null, { status: 204 })

const jsonWithHeaders = (body: unknown, status: number, headers: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

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

const commentProjection = (c: StoredComment): Record<string, unknown> => ({
  id: c.id,
  taskId: c.taskId,
  userId: c.userId,
  content: c.content,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
})

const labelProjection = (l: StoredLabel): Record<string, unknown> => ({
  id: l.id,
  name: l.name,
  color: l.color,
  createdAt: l.createdAt,
  taskId: l.taskId,
  workspaceId: l.workspaceId,
})

const relationProjection = (r: StoredRelation): Record<string, unknown> => ({
  id: r.id,
  sourceTaskId: r.sourceTaskId,
  targetTaskId: r.targetTaskId,
  relationType: r.relationType,
  createdAt: r.createdAt,
})

const memberProjection = (m: { id: string; name: string; email: string; role: string }): Record<string, unknown> => ({
  id: m.id,
  name: m.name,
  email: m.email,
  image: null,
  role: m.role,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asObject = (body: unknown): Record<string, unknown> => (isRecord(body) ? body : {})

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** Strict per-pattern dispatcher: the first rule whose pattern matches the
 *  path wins. If its method set does not include the request method, return
 *  405 instead of falling through — the fake models exact client route shapes,
 *  not a permissive catch-all. */
type RouteParams = Record<string, string>
type RouteRule = Readonly<{
  pattern: string
  allowed: ReadonlySet<string>
  run: (ctx: FakeKaneoCtx, params: RouteParams) => Response
}>

const dispatchRules = (ctx: FakeKaneoCtx, rules: ReadonlyArray<RouteRule>): Response | undefined => {
  for (const rule of rules) {
    const params = matchPath(rule.pattern, ctx.path)
    if (params === null) continue
    if (!rule.allowed.has(ctx.method)) {
      return errorResponse(405, `method ${ctx.method} not allowed for ${ctx.path}`)
    }
    return rule.run(ctx, params)
  }
  return undefined
}

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

// ---------- Comment handler ----------

const handleComments = (ctx: FakeKaneoCtx): Response | undefined =>
  dispatchRules(ctx, [
    {
      pattern: '/api/comment/:id',
      allowed: new Set(['POST', 'GET', 'PUT', 'DELETE']),
      run: (c, params): Response => {
        const id = params['id'] ?? ''
        if (c.method === 'POST') {
          if (!isRecord(c.body)) return errorResponse(400, 'comment body must be a JSON object')
          const content = asString(c.body['content'])
          if (content === undefined) return errorResponse(400, 'comment content is required')
          const commentId = nextId(c.state, 'comment')
          const now = nextTimestamp(c.state)
          const comment: StoredComment = {
            id: commentId,
            taskId: id,
            userId: COMMENT_AUTHOR_USER_ID,
            content,
            createdAt: now,
            updatedAt: now,
          }
          c.state.comments.set(commentId, comment)
          return json(commentProjection(comment))
        }
        if (c.method === 'GET') {
          const list = [...c.state.comments.values()].filter((cm) => cm.taskId === id).map(commentProjection)
          return json(list)
        }
        if (c.method === 'PUT') {
          const existing = c.state.comments.get(id)
          if (existing === undefined) return errorResponse(404, 'comment not found')
          if (!isRecord(c.body)) return errorResponse(400, 'comment body must be a JSON object')
          const content = asString(c.body['content'])
          if (content === undefined) return errorResponse(400, 'comment content is required')
          existing.content = content
          existing.updatedAt = nextTimestamp(c.state)
          return json(commentProjection(existing))
        }
        const toDelete = c.state.comments.get(id)
        if (toDelete === undefined) return errorResponse(404, 'comment not found')
        c.state.comments.delete(id)
        return json(commentProjection(toDelete))
      },
    },
  ])

// ---------- Label handler ----------

const handleLabels = (ctx: FakeKaneoCtx): Response | undefined =>
  dispatchRules(ctx, [
    {
      pattern: '/api/label',
      allowed: new Set(['POST']),
      run: (c): Response => {
        if (!isRecord(c.body)) return errorResponse(400, 'label body must be a JSON object')
        const workspaceId = asString(c.body['workspaceId']) ?? ''
        const name = asString(c.body['name']) ?? ''
        const id = nextId(c.state, 'label')
        const label: StoredLabel = {
          id,
          workspaceId,
          name,
          color: asString(c.body['color']) ?? '#6b7280',
          createdAt: nextTimestamp(c.state),
          taskId: null,
        }
        c.state.labels.set(id, label)
        return json(labelProjection(label))
      },
    },
    {
      pattern: '/api/label/workspace/:workspaceId',
      allowed: new Set(['GET']),
      run: (c, params): Response => {
        const workspaceId = params['workspaceId'] ?? ''
        const list = [...c.state.labels.values()].filter((l) => l.workspaceId === workspaceId).map(labelProjection)
        return json(list)
      },
    },
    {
      pattern: '/api/label/task/:taskId',
      allowed: new Set(['GET']),
      run: (c, params): Response => {
        const taskId = params['taskId'] ?? ''
        const list = [...c.state.labels.values()].filter((l) => l.taskId === taskId).map(labelProjection)
        return json(list)
      },
    },
    {
      pattern: '/api/label/:labelId/task',
      allowed: new Set(['PUT', 'DELETE']),
      run: (c, params): Response => {
        const labelId = params['labelId'] ?? ''
        const label = c.state.labels.get(labelId)
        if (label === undefined) return errorResponse(404, 'label not found')
        if (!isRecord(c.body)) return errorResponse(400, 'label task body must be a JSON object')
        const taskId = asString(c.body['taskId'])
        if (taskId === undefined) return errorResponse(400, 'taskId is required')
        if (c.method === 'DELETE') {
          label.taskId = null
          return json(labelProjection(label))
        }
        label.taskId = taskId
        return json(labelProjection(label))
      },
    },
    {
      pattern: '/api/label/:labelId',
      allowed: new Set(['GET', 'PUT', 'DELETE']),
      run: (c, params): Response => {
        const labelId = params['labelId'] ?? ''
        const label = c.state.labels.get(labelId)
        if (label === undefined) return errorResponse(404, 'label not found')
        if (c.method === 'GET') return json(labelProjection(label))
        if (c.method === 'DELETE') {
          c.state.labels.delete(labelId)
          return json(labelProjection(label))
        }
        if (!isRecord(c.body)) return errorResponse(400, 'label body must be a JSON object')
        const name = asString(c.body['name'])
        if (name !== undefined) label.name = name
        const color = asString(c.body['color'])
        if (color !== undefined) label.color = color
        return json(labelProjection(label))
      },
    },
  ])

// ---------- Task relation handler ----------

const handleRelations = (ctx: FakeKaneoCtx): Response | undefined =>
  dispatchRules(ctx, [
    {
      pattern: '/api/task-relation',
      allowed: new Set(['POST']),
      run: (c): Response => {
        if (!isRecord(c.body)) return errorResponse(400, 'task-relation body must be a JSON object')
        const sourceTaskId = asString(c.body['sourceTaskId'])
        const targetTaskId = asString(c.body['targetTaskId'])
        const relationType = asString(c.body['relationType'])
        if (sourceTaskId === undefined || targetTaskId === undefined || relationType === undefined) {
          return errorResponse(400, 'sourceTaskId, targetTaskId, and relationType are required')
        }
        const id = nextId(c.state, 'relation')
        const relation: StoredRelation = {
          id,
          sourceTaskId,
          targetTaskId,
          relationType,
          createdAt: nextTimestamp(c.state),
        }
        c.state.relations.set(id, relation)
        return json(relationProjection(relation))
      },
    },
    {
      pattern: '/api/task-relation/:id',
      allowed: new Set(['GET', 'DELETE']),
      run: (c, params): Response => {
        const id = params['id'] ?? ''
        if (c.method === 'GET') {
          const list = [...c.state.relations.values()]
            .filter((r) => r.sourceTaskId === id || r.targetTaskId === id)
            .map(relationProjection)
          return json(list)
        }
        const toDelete = c.state.relations.get(id)
        if (toDelete === undefined) return errorResponse(404, 'relation not found')
        c.state.relations.delete(id)
        return json(relationProjection(toDelete))
      },
    },
  ])

// ---------- Workspace member handler ----------

const handleMembers = (ctx: FakeKaneoCtx): Response | undefined =>
  dispatchRules(ctx, [
    {
      pattern: '/api/workspace/:workspaceId/members',
      allowed: new Set(['GET']),
      run: (c, params): Response => {
        const workspaceId = params['workspaceId'] ?? ''
        const list = [...c.state.members.values()].filter((m) => m.organizationId === workspaceId).map(memberProjection)
        return json(list)
      },
    },
  ])

// ---------- Auth handler (Better Auth sign-up / sign-in / invite / accept) ----------

const handleAuth = (ctx: FakeKaneoCtx): Response | undefined =>
  dispatchRules(ctx, [
    {
      pattern: '/api/auth/sign-up/email',
      allowed: new Set(['POST']),
      run: (c): Response => {
        if (!isRecord(c.body)) return errorResponse(400, 'sign-up body must be a JSON object')
        const email = asString(c.body['email'])
        const name = asString(c.body['name']) ?? email ?? ''
        if (email === undefined) return errorResponse(400, 'email is required')
        const id = nextId(c.state, 'user')
        c.state.users.set(id, { id, name, email })
        c.state.userIndex.set(email, id)
        return authSessionResponse(c.state, id)
      },
    },
    {
      pattern: '/api/auth/sign-in/email',
      allowed: new Set(['POST']),
      run: (c): Response => {
        if (!isRecord(c.body)) return errorResponse(400, 'sign-in body must be a JSON object')
        const email = asString(c.body['email'])
        if (email === undefined) return errorResponse(400, 'email is required')
        const userId = c.state.userIndex.get(email)
        if (userId === undefined) return errorResponse(401, 'invalid credentials')
        return authSessionResponse(c.state, userId)
      },
    },
    {
      pattern: '/api/auth/organization/invite-member',
      allowed: new Set(['POST']),
      run: (c): Response => {
        if (!isRecord(c.body)) return errorResponse(400, 'invite body must be a JSON object')
        const email = asString(c.body['email'])
        const organizationId = asString(c.body['organizationId']) ?? ''
        const role = asString(c.body['role']) ?? 'member'
        if (email === undefined) return errorResponse(400, 'email is required')
        const id = nextId(c.state, 'invitation')
        const userId = c.state.userIndex.get(email)
        c.state.invitations.set(id, { id, email, organizationId, role, userId })
        return json({ id })
      },
    },
    {
      pattern: '/api/auth/organization/accept-invitation',
      allowed: new Set(['POST']),
      run: (c): Response => {
        if (!isRecord(c.body)) return errorResponse(400, 'accept body must be a JSON object')
        const invitationId = asString(c.body['invitationId'])
        if (invitationId === undefined) return errorResponse(400, 'invitationId is required')
        const invitation = c.state.invitations.get(invitationId)
        if (invitation === undefined) return errorResponse(404, 'invitation not found')
        const userId = invitation.userId ?? nextId(c.state, 'member')
        const user = c.state.users.get(userId)
        c.state.members.set(`${invitation.organizationId}:${userId}`, {
          id: userId,
          organizationId: invitation.organizationId,
          name: user?.name ?? invitation.email,
          email: invitation.email,
          role: invitation.role,
        })
        return json({ success: true })
      },
    },
  ])

const authSessionResponse = (state: FakeKaneoState, userId: string): Response => {
  const token = nextId(state, 'token')
  return jsonWithHeaders({ user: { id: userId }, token }, 200, {
    'Set-Cookie': `better-auth.session_token=${token}; Path=/`,
  })
}

// ---------- Handler chain ----------

const handlers: ReadonlyArray<(ctx: FakeKaneoCtx) => Response | undefined> = [
  handleProjects,
  handleColumns,
  handleTasks,
  handleComments,
  handleLabels,
  handleRelations,
  handleMembers,
  handleAuth,
  handleSearch,
]

export const handleFakeKaneoRequest = (ctx: FakeKaneoCtx): Response => {
  for (const handler of handlers) {
    const response = handler(ctx)
    if (response !== undefined) return response
  }
  return errorResponse(404, `no route for ${ctx.method} ${ctx.path}`)
}
