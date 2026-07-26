// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Server } from 'bun'

/**
 * A stateful in-memory fake YouTrack REST server. It models exactly the request
 * shapes YouTrackProvider builds and the `fields=` projection shapes its mappers
 * parse (plugins/task-provider-youtrack/mappers.ts). It is NOT a fidelity model
 * of a real YouTrack — both this fake and the parity expectations are authored
 * here, so this lane proves request-building + response-mapping + contract
 * conformance, never drift against a live YouTrack.
 */

export type FakeYouTrackServer = {
  url: string
  stop(): Promise<void>
  reset(): void
}

// ---------- Stored entities ----------

type StoredProject = {
  id: string
  name: string
  shortName: string
  description: string | undefined
  archived: boolean
}

type StoredIssue = {
  id: string
  idReadable: string
  numberInProject: number
  summary: string
  description: string | undefined
  projectDbId: string
  created: number
  updated: number
  state: string | undefined
  priority: string | undefined
  dueDateMs: number | undefined
  assigneeLogin: string | undefined
}

type StoredComment = {
  id: string
  issueId: string
  text: string
  created: number
  updated: number | undefined
}

type StoredLink = {
  id: string
  ownerIssueId: string
  targetIssueId: string
  typeName: string
  direction: string
}

type State = {
  projects: Map<string, StoredProject>
  issues: Map<string, StoredIssue>
  issuesByReadable: Map<string, string>
  comments: Map<string, StoredComment>
  links: Map<string, StoredLink>
  seq: number
}

type Ctx = {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  state: State
}

// ---------- Bundle seeds (values the provider resolves status/priority against) ----------

const STATE_BUNDLE_ID = 'state-bundle-1'
const PRIORITY_BUNDLE_ID = 'enum-bundle-1'
const STATE_VALUES: readonly string[] = ['Open', 'In Progress', 'Done']
const PRIORITY_VALUES: readonly string[] = ['high', 'normal', 'low']

// ---------- State + id helpers ----------

const createState = (): State => ({
  projects: new Map(),
  issues: new Map(),
  issuesByReadable: new Map(),
  comments: new Map(),
  links: new Map(),
  seq: 0,
})

const nextId = (state: State, prefix: string): string => {
  state.seq += 1
  return `${prefix}-${state.seq}`
}

const nextTs = (state: State): number => {
  state.seq += 1
  return 1_700_000_000_000 + state.seq
}

// ---------- Response helpers ----------

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const noContent = (): Response => new Response(null, { status: 204 })

const errorResponse = (status: number, message: string): Response =>
  json({ error: message, error_description: message }, status)

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

// ---------- Projection helpers ----------

const projectFields = (p: StoredProject): Record<string, unknown> => ({
  id: p.id,
  $type: 'Project',
  name: p.name,
  shortName: p.shortName,
  description: p.description ?? null,
  archived: p.archived,
})

const projectCustomFieldsResponse = (): unknown => [
  {
    $type: 'StateProjectCustomField',
    canBeEmpty: true,
    isPublic: true,
    field: { id: 'f-state', name: 'State', fieldType: { id: 'state[1]', presentation: 'state' } },
    bundle: { id: STATE_BUNDLE_ID, $type: 'StateBundle' },
  },
  {
    $type: 'EnumProjectCustomField',
    canBeEmpty: true,
    isPublic: true,
    field: { id: 'f-priority', name: 'Priority', fieldType: { id: 'enum[1]', presentation: 'enum' } },
    bundle: { id: PRIORITY_BUNDLE_ID, $type: 'EnumBundle' },
  },
  {
    $type: 'SimpleProjectCustomField',
    canBeEmpty: true,
    isPublic: true,
    field: { id: 'f-due', name: 'Due Date', fieldType: { id: 'date[1]', presentation: 'date' } },
  },
]

const bundleValuesResponse = (segment: string): unknown => {
  const source = segment === 'state' ? STATE_VALUES : segment === 'enum' ? PRIORITY_VALUES : []
  return source.map((name, index) => ({ name, ordinal: index }))
}

// ---------- Project + custom-field-schema handler ----------

const handleProjects = (ctx: Ctx): Response | undefined => {
  const { method, path, state, query } = ctx

  const cfPath = matchPath('/api/admin/projects/:id/customFields', path)
  if (cfPath !== null && method === 'GET') {
    const project = state.projects.get(cfPath['id'] ?? '')
    if (project === undefined) return errorResponse(404, 'project not found')
    return json(projectCustomFieldsResponse())
  }

  const bundlePath = matchPath('/api/admin/customFieldSettings/bundles/:segment/:bundleId/values', path)
  if (bundlePath !== null && method === 'GET') {
    return json(bundleValuesResponse(bundlePath['segment'] ?? ''))
  }

  const onePath = matchPath('/api/admin/projects/:id', path)
  if (onePath !== null) {
    const id = onePath['id'] ?? ''
    const project = state.projects.get(id)
    if (method === 'GET') {
      return project === undefined ? errorResponse(404, 'project not found') : json(projectFields(project))
    }
    if (method === 'POST') {
      if (project === undefined) return errorResponse(404, 'project not found')
      const body = (ctx.body ?? {}) as { name?: string; description?: string }
      if (body.name !== undefined) project.name = body.name
      if (body.description !== undefined) project.description = body.description
      return json(projectFields(project))
    }
    if (method === 'DELETE') {
      return state.projects.delete(id) ? noContent() : errorResponse(404, 'project not found')
    }
  }

  if (path === '/api/admin/projects') {
    if (method === 'POST') {
      const body = (ctx.body ?? {}) as { name?: string; shortName?: string; description?: string }
      const used = new Set([...state.projects.values()].map((p) => p.shortName))
      const requestedShortName = body.shortName ?? ''
      let shortName = requestedShortName
      while (used.has(shortName)) shortName = `${requestedShortName}${nextId(state, 's').slice(-2)}`
      const id = nextId(state, 'project')
      const project: StoredProject = {
        id,
        name: body.name ?? '',
        shortName,
        description: body.description,
        archived: false,
      }
      state.projects.set(id, project)
      return json(projectFields(project))
    }
    if (method === 'GET') {
      const all = [...state.projects.values()].map(projectFields)
      const top = Number(query.get('$top') ?? '100')
      const skip = Number(query.get('$skip') ?? '0')
      return json(all.slice(skip, skip + top))
    }
  }

  return undefined
}

// ---------- Custom-field payload parsing (write path) ----------

const readName = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    const named = (value as { name?: unknown }).name
    if (typeof named === 'string') return named
  }
  return undefined
}

const readLogin = (value: unknown): string | undefined => {
  if (value !== null && typeof value === 'object') {
    const login = (value as { login?: unknown }).login
    if (typeof login === 'string') return login
  }
  return undefined
}

const applyCustomFieldPayload = (issue: StoredIssue, payload: unknown): void => {
  if (!Array.isArray(payload)) return
  const items: unknown[] = payload
  for (const raw of items) {
    const item = (raw ?? {}) as { name?: string; value?: unknown }
    if (item.name === 'State') issue.state = readName(item.value)
    else if (item.name === 'Priority') issue.priority = readName(item.value)
    else if (item.name === 'Due Date') issue.dueDateMs = typeof item.value === 'number' ? item.value : undefined
    else if (item.name === 'Assignee') issue.assigneeLogin = readLogin(item.value)
  }
}

// ---------- Issue projections (read path) ----------

const findIssue = (state: State, ref: string): StoredIssue | undefined => {
  const direct = state.issues.get(ref)
  if (direct !== undefined) return direct
  const dbId = state.issuesByReadable.get(ref)
  return dbId === undefined ? undefined : state.issues.get(dbId)
}

const issueCustomFields = (issue: StoredIssue): unknown[] => {
  const fields: unknown[] = []
  if (issue.state !== undefined) {
    fields.push({
      $type: 'StateIssueCustomField',
      name: 'State',
      value: { $type: 'StateBundleElement', name: issue.state },
    })
  }
  if (issue.priority !== undefined) {
    fields.push({
      $type: 'SingleEnumIssueCustomField',
      name: 'Priority',
      value: { $type: 'EnumBundleElement', name: issue.priority },
    })
  }
  if (issue.dueDateMs !== undefined) {
    fields.push({ $type: 'DateIssueCustomField', name: 'Due Date', value: issue.dueDateMs })
  }
  if (issue.assigneeLogin !== undefined) {
    fields.push({ $type: 'SingleUserIssueCustomField', name: 'Assignee', value: { login: issue.assigneeLogin } })
  }
  return fields
}

const issueLinksProjection = (state: State, issue: StoredIssue): unknown[] => {
  const out: unknown[] = []
  for (const link of state.links.values()) {
    if (link.ownerIssueId !== issue.id) continue
    const target = state.issues.get(link.targetIssueId)
    if (target === undefined) continue
    out.push({
      id: link.id,
      direction: link.direction,
      linkType: { id: `lt-${link.typeName}`, name: link.typeName },
      issues: [{ id: target.id, idReadable: target.idReadable, summary: target.summary, resolved: null }],
    })
  }
  return out
}

const issueProjection = (state: State, issue: StoredIssue): Record<string, unknown> => {
  const project = state.projects.get(issue.projectDbId)
  return {
    id: issue.id,
    $type: 'Issue',
    idReadable: issue.idReadable,
    numberInProject: issue.numberInProject,
    summary: issue.summary,
    description: issue.description ?? null,
    created: issue.created,
    updated: issue.updated,
    resolved: null,
    project: { id: issue.projectDbId, shortName: project?.shortName, name: project?.name },
    customFields: issueCustomFields(issue),
    links: issueLinksProjection(state, issue),
    tags: [],
    commentsCount: [...state.comments.values()].filter((c) => c.issueId === issue.id).length,
    votes: 0,
  }
}

const issueListProjection = (state: State, issue: StoredIssue): Record<string, unknown> => {
  const project = state.projects.get(issue.projectDbId)
  const customFields: unknown[] = []
  if (issue.state !== undefined) {
    customFields.push({ $type: 'StateIssueCustomField', name: 'State', value: { name: issue.state } })
  }
  if (issue.priority !== undefined) {
    customFields.push({ $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: issue.priority } })
  }
  return {
    id: issue.id,
    idReadable: issue.idReadable,
    numberInProject: issue.numberInProject,
    summary: issue.summary,
    resolved: null,
    created: issue.created,
    project: { id: issue.projectDbId, shortName: project?.shortName },
    customFields,
  }
}

// ---------- YouTrack query interpreter (list + search) ----------

type ParsedQuery = {
  shortName: string | undefined
  freeText: string
  sortField: string | undefined
  sortDir: string | undefined
}

const interpretQuery = (raw: string): ParsedQuery => {
  let rest = raw
  let shortName: string | undefined
  const projectMatch = /project:\s*\{([^}]+)\}/u.exec(rest)
  if (projectMatch !== null) {
    shortName = projectMatch[1]
    rest = rest.replace(projectMatch[0], ' ')
  }
  let sortField: string | undefined
  let sortDir: string | undefined
  const sortMatch = /sort by:\s*(\S+)\s+(asc|desc)/u.exec(rest)
  if (sortMatch !== null) {
    sortField = sortMatch[1]
    sortDir = sortMatch[2]
    rest = rest.replace(sortMatch[0], ' ')
  }
  // Strip any remaining `Field: {..}` and `Due date: <..` directives so only free text remains.
  rest = rest.replace(/[A-Za-z ]+:\s*\{[^}]*\}/gu, ' ').replace(/Due date:\s*[<>]\S+/giu, ' ')
  return { shortName, freeText: rest.trim(), sortField, sortDir }
}

const handleIssueQuery = (ctx: Ctx): Response => {
  const { state, query } = ctx
  const parsed = interpretQuery(query.get('query') ?? '')
  let issues = [...state.issues.values()]
  if (parsed.shortName !== undefined) {
    issues = issues.filter((i) => state.projects.get(i.projectDbId)?.shortName === parsed.shortName)
  }
  if (parsed.freeText.length > 0) {
    const needle = parsed.freeText.toLowerCase()
    issues = issues.filter((i) => i.summary.toLowerCase().includes(needle))
  }
  const byTitle = parsed.sortField === 'title' || parsed.sortField === 'summary'
  issues.sort((a, b) => {
    if (byTitle) {
      const cmp = a.summary.localeCompare(b.summary)
      return parsed.sortDir === 'desc' ? -cmp : cmp
    }
    return a.created - b.created
  })
  const top = Number(query.get('$top') ?? '100')
  const skip = Number(query.get('$skip') ?? '0')
  return json(issues.slice(skip, skip + top).map((i) => issueListProjection(state, i)))
}

// ---------- Issue handler ----------

const handleIssues = (ctx: Ctx): Response | undefined => {
  const { method, path, state } = ctx

  if (path === '/api/issues' && method === 'GET') {
    return handleIssueQuery(ctx)
  }

  const cfPath = matchPath('/api/issues/:id/customFields', path)
  if (cfPath !== null && method === 'GET') {
    const issue = findIssue(state, cfPath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    const out = issue.dueDateMs === undefined ? [] : [{ name: 'Due Date', value: issue.dueDateMs }]
    return json(out)
  }

  const onePath = matchPath('/api/issues/:id', path)
  if (onePath !== null) {
    const issue = findIssue(state, onePath['id'] ?? '')
    if (method === 'GET') {
      return issue === undefined ? errorResponse(404, 'issue not found') : json(issueProjection(state, issue))
    }
    if (method === 'POST') {
      if (issue === undefined) return errorResponse(404, 'issue not found')
      const body = (ctx.body ?? {}) as { summary?: string; description?: string; customFields?: unknown }
      if (body.summary !== undefined) issue.summary = body.summary
      if (body.description !== undefined) issue.description = body.description
      if (body.customFields !== undefined) applyCustomFieldPayload(issue, body.customFields)
      issue.updated = nextTs(state)
      return json(issueProjection(state, issue))
    }
    if (method === 'DELETE') {
      if (issue === undefined) return errorResponse(404, 'issue not found')
      state.issues.delete(issue.id)
      state.issuesByReadable.delete(issue.idReadable)
      return noContent()
    }
  }

  if (path === '/api/issues' && method === 'POST') {
    const body = (ctx.body ?? {}) as {
      project?: { id?: string }
      summary?: string
      description?: string
      customFields?: unknown
    }
    const projectId = body.project?.id ?? ''
    const project = state.projects.get(projectId)
    if (project === undefined) return errorResponse(404, 'project not found')
    const dbId = nextId(state, 'issue')
    const number = [...state.issues.values()].filter((i) => i.projectDbId === project.id).length + 1
    const issue: StoredIssue = {
      id: dbId,
      idReadable: `${project.shortName}-${number}`,
      numberInProject: number,
      summary: body.summary ?? '',
      description: body.description,
      projectDbId: project.id,
      created: nextTs(state),
      updated: nextTs(state),
      state: undefined,
      priority: undefined,
      dueDateMs: undefined,
      assigneeLogin: undefined,
    }
    applyCustomFieldPayload(issue, body.customFields)
    state.issues.set(dbId, issue)
    state.issuesByReadable.set(issue.idReadable, dbId)
    return json(issueProjection(state, issue))
  }

  return undefined
}

// ---------- Comments handler ----------

const commentProjection = (c: StoredComment): unknown => ({
  id: c.id,
  $type: 'IssueComment',
  text: c.text,
  author: { id: 'fake-user-1', $type: 'User', login: 'fake.user', name: 'Fake User' },
  created: c.created,
  updated: c.updated ?? null,
  reactions: [],
})

const handleComments = (ctx: Ctx): Response | undefined => {
  const { method, path, state, query } = ctx

  const onePath = matchPath('/api/issues/:id/comments/:commentId', path)
  if (onePath !== null) {
    const issue = findIssue(state, onePath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    const comment = state.comments.get(onePath['commentId'] ?? '')
    if (comment === undefined || comment.issueId !== issue.id) return errorResponse(404, 'comment not found')
    if (method === 'GET') return json(commentProjection(comment))
    if (method === 'POST') {
      const body = (ctx.body ?? {}) as { text?: string }
      if (body.text !== undefined) {
        comment.text = body.text
        comment.updated = nextTs(state)
      }
      return json(commentProjection(comment))
    }
    if (method === 'DELETE') {
      state.comments.delete(comment.id)
      return noContent()
    }
  }

  const collPath = matchPath('/api/issues/:id/comments', path)
  if (collPath !== null) {
    const issue = findIssue(state, collPath['id'] ?? '')
    if (issue === undefined) return errorResponse(404, 'issue not found')
    if (method === 'POST') {
      const body = (ctx.body ?? {}) as { text?: string }
      const id = nextId(state, 'comment')
      const comment: StoredComment = {
        id,
        issueId: issue.id,
        text: body.text ?? '',
        created: nextTs(state),
        updated: undefined,
      }
      state.comments.set(id, comment)
      return json(commentProjection(comment))
    }
    if (method === 'GET') {
      const list = [...state.comments.values()].filter((c) => c.issueId === issue.id)
      const top = Number(query.get('$top') ?? '100')
      const skip = Number(query.get('$skip') ?? '0')
      return json(list.slice(skip, skip + top).map(commentProjection))
    }
  }

  return undefined
}

// ---------- Relations handler ----------

const LINK_TYPES: ReadonlyArray<{ id: string; name: string; directed: boolean }> = [
  { id: 'lt-depend', name: 'Depend', directed: true },
  { id: 'lt-relate', name: 'Relates', directed: false },
  { id: 'lt-duplicate', name: 'Duplicate', directed: true },
  { id: 'lt-subtask', name: 'Subtask', directed: true },
]

const decodeLinkId = (linkId: string): { typeName: string; direction: string } => {
  const suffix = linkId.slice(-1)
  if (suffix === 's' || suffix === 't') {
    const base = linkId.slice(0, -1)
    const type = LINK_TYPES.find((t) => t.id === base)
    if (type !== undefined) return { typeName: type.name, direction: suffix === 's' ? 'OUTWARD' : 'INWARD' }
  }
  const exact = LINK_TYPES.find((t) => t.id === linkId)
  return { typeName: exact?.name ?? 'Relates', direction: 'BOTH' }
}

const readLinkTargetId = (body: unknown): string => {
  if (body !== null && typeof body === 'object') {
    const id = (body as { id?: unknown }).id
    if (typeof id === 'string') return id
  }
  return ''
}

const handleRelations = (ctx: Ctx): Response | undefined => {
  const { method, path, state } = ctx

  if (path === '/api/issueLinkTypes' && method === 'GET') {
    return json(LINK_TYPES)
  }

  const addPath = matchPath('/api/issues/:id/links/:linkId/issues', path)
  if (addPath !== null && method === 'POST') {
    const owner = findIssue(state, addPath['id'] ?? '')
    if (owner === undefined) return errorResponse(404, 'issue not found')
    const targetId = readLinkTargetId(ctx.body)
    const target = targetId === '' ? undefined : (state.issues.get(targetId) ?? findIssue(state, targetId))
    if (target === undefined) return errorResponse(404, 'target issue not found')
    const { typeName, direction } = decodeLinkId(addPath['linkId'] ?? '')
    const id = nextId(state, 'link')
    const link: StoredLink = { id, ownerIssueId: owner.id, targetIssueId: target.id, typeName, direction }
    state.links.set(id, link)
    return json({ id })
  }

  const delPath = matchPath('/api/issues/:id/links/:linkId', path)
  if (delPath !== null && method === 'DELETE') {
    const owner = findIssue(state, delPath['id'] ?? '')
    if (owner === undefined) return errorResponse(404, 'issue not found')
    const linkId = delPath['linkId'] ?? ''
    return state.links.delete(linkId) ? noContent() : errorResponse(404, 'link not found')
  }

  return undefined
}

// ---------- Server bootstrap ----------

export const startFakeYouTrackServer = (): FakeYouTrackServer => {
  const state = createState()
  const handlers: Array<(ctx: Ctx) => Response | undefined> = [
    handleProjects,
    handleIssues,
    handleComments,
    handleRelations,
  ]

  const server: Server<undefined> = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      const hasBody = req.method === 'POST' || req.method === 'PUT'
      const bodyText = hasBody ? await req.text() : ''
      const body: unknown = bodyText.length > 0 ? JSON.parse(bodyText) : undefined
      const ctx: Ctx = { method: req.method, path: url.pathname, query: url.searchParams, body, state }
      for (const handler of handlers) {
        const res = handler(ctx)
        if (res !== undefined) return res
      }
      return errorResponse(404, `no route for ${req.method} ${url.pathname}`)
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    stop: async (): Promise<void> => {
      await server.stop(true)
    },
    reset: (): void => {
      state.projects.clear()
      state.issues.clear()
      state.issuesByReadable.clear()
      state.comments.clear()
      state.links.clear()
      state.seq = 0
    },
  }
}
