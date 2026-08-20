// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { handleActivities, handleAttachments, handleWatchersAndVotes, handleWorkItems } from './router-collaboration.js'
import { handleDirectory } from './router-directory.js'
import { handleQueryEndpoints } from './router-queries.js'
import { errorResponse, fakeUser, findIssue, json, matchPath, noContent, visibilityProjection } from './shared.js'
import {
  type FakeYouTrackCtx,
  type FakeYouTrackState,
  nextId,
  nextTs,
  PRIORITY_BUNDLE_ID,
  PRIORITY_VALUES,
  STATE_BUNDLE_ID,
  STATE_VALUES,
  type StoredAgile,
  type StoredComment,
  type StoredIssue,
  type StoredLink,
  type StoredProject,
  type StoredSprint,
  type StoredStateValue,
  type StoredVisibility,
} from './state.js'

// ---------- Projection helpers ----------

const projectFields = (p: StoredProject): Record<string, unknown> => ({
  id: p.id,
  ringId: p.ringId,
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

const handleProjects = (ctx: FakeYouTrackCtx): Response | undefined => {
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
        ringId: `ring-${id}`,
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

const readIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const entries: unknown[] = value
  return entries.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return []
    const id = (entry as { id?: unknown }).id
    return typeof id === 'string' ? [id] : []
  })
}

/** The inverse of `visibilityProjection`: YouTrack switches on `$type`, and a
 *  limited visibility carries the users and groups permitted to see the issue. */
const readVisibilityPayload = (payload: unknown): StoredVisibility => {
  const body = (payload ?? {}) as { $type?: unknown; permittedUsers?: unknown; permittedGroups?: unknown }
  if (body.$type !== 'LimitedVisibility') return { kind: 'unlimited' }
  return {
    kind: 'limited',
    userIds: readIdList(body.permittedUsers),
    groupIds: readIdList(body.permittedGroups),
  }
}

// ---------- Issue projections (read path) ----------

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

const issueLinksProjection = (state: FakeYouTrackState, issue: StoredIssue): unknown[] => {
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

const issueProjection = (state: FakeYouTrackState, issue: StoredIssue): Record<string, unknown> => {
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
    votes: issue.voted ? 1 : 0,
    watchers: {
      issueWatchers: issue.watcherIds.map((userId) => ({ user: fakeUser(userId), isStarred: true })),
      hasStar: issue.watcherIds.length > 0,
    },
    visibility: visibilityProjection(issue.visibility),
  }
}

export const issueListProjection = (state: FakeYouTrackState, issue: StoredIssue): Record<string, unknown> => {
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

const handleIssueQuery = (ctx: FakeYouTrackCtx): Response => {
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

const handleIssues = (ctx: FakeYouTrackCtx): Response | undefined => {
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
      const body = (ctx.body ?? {}) as {
        summary?: string
        description?: string
        customFields?: unknown
        visibility?: unknown
      }
      if (body.summary !== undefined) issue.summary = body.summary
      if (body.description !== undefined) issue.description = body.description
      if (body.customFields !== undefined) applyCustomFieldPayload(issue, body.customFields)
      if (body.visibility !== undefined) issue.visibility = readVisibilityPayload(body.visibility)
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
    if (typeof body.summary === 'string' && body.summary.includes('workflow-required')) {
      return json(
        {
          error: 'Assertion failed',
          error_description: 'Requires these custom fields: Priority, Due Date',
          error_type: 'workflow',
        },
        400,
      )
    }
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
      watcherIds: [],
      voted: false,
      visibility: { kind: 'unlimited' },
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

const handleComments = (ctx: FakeYouTrackCtx): Response | undefined => {
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

const decodeLinkId = (state: FakeYouTrackState, linkId: string): { typeName: string; direction: string } => {
  const stored = state.links.get(linkId)
  if (stored !== undefined) return { typeName: stored.typeName, direction: stored.direction }
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

const handleRelations = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state } = ctx

  if (path === '/api/issueLinkTypes' && method === 'GET') {
    return json(LINK_TYPES)
  }

  const addPath = matchPath('/api/issues/:id/links/:linkId/issues', path)
  if (addPath !== null && method === 'POST') {
    const owner = findIssue(state, addPath['id'] ?? '')
    if (owner === undefined) return errorResponse(404, 'issue not found')
    const targetId = readLinkTargetId(ctx.body)
    const target = targetId === '' ? undefined : findIssue(state, targetId)
    if (target === undefined) return errorResponse(404, 'target issue not found')
    const { typeName, direction } = decodeLinkId(state, addPath['linkId'] ?? '')
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
    const link = state.links.get(linkId)
    if (link === undefined || link.ownerIssueId !== owner.id) return errorResponse(404, 'link not found')
    state.links.delete(linkId)
    return noContent()
  }

  return undefined
}

// ---------- State-bundle handler ----------

const stateValueProjection = (v: StoredStateValue): Record<string, unknown> => ({
  id: v.id,
  name: v.name,
  ordinal: v.ordinal,
  isResolved: v.isResolved,
})

const handleStateBundles = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state, body } = ctx
  if (!path.startsWith('/api/admin/customFieldSettings/bundles/state/')) return undefined

  const metaPath = matchPath('/api/admin/customFieldSettings/bundles/state/:bundleId', path)
  if (metaPath !== null && method === 'GET') {
    const bundleId = metaPath['bundleId'] ?? ''
    const projects = [...state.projects.values()].map((p) => ({ id: p.id }))
    return json({
      id: bundleId,
      name: 'States',
      ...(projects.length > 0 ? { aggregated: { project: projects } } : {}),
    })
  }

  const collectionPath = matchPath('/api/admin/customFieldSettings/bundles/state/:bundleId/values', path)
  if (collectionPath !== null) {
    const bundleId = collectionPath['bundleId'] ?? ''
    if (method === 'GET') {
      const values = [...(state.stateValues.get(bundleId) ?? [])].sort((a, b) => a.ordinal - b.ordinal)
      return json(values.map(stateValueProjection))
    }
    if (method === 'POST') {
      const b = (body ?? {}) as { name?: string; isResolved?: boolean }
      const values = state.stateValues.get(bundleId) ?? []
      const created: StoredStateValue = {
        id: nextId(state, 'state-val'),
        name: b.name ?? '',
        ordinal: values.length,
        isResolved: b.isResolved ?? false,
      }
      state.stateValues.set(bundleId, [...values, created])
      return json(stateValueProjection(created))
    }
    return undefined
  }

  const statusPath = matchPath('/api/admin/customFieldSettings/bundles/state/:bundleId/values/:statusId', path)
  if (statusPath !== null) {
    const bundleId = statusPath['bundleId'] ?? ''
    const statusId = statusPath['statusId'] ?? ''
    const values = state.stateValues.get(bundleId) ?? []
    if (method === 'POST') {
      const b = (body ?? {}) as { name?: string; isResolved?: boolean; ordinal?: number }
      const existing = values.find((v) => v.id === statusId)
      if (existing === undefined) return errorResponse(404, 'state value not found')
      const updated: StoredStateValue = {
        ...existing,
        ...(b.name === undefined ? {} : { name: b.name }),
        ...(b.isResolved === undefined ? {} : { isResolved: b.isResolved }),
        ...(b.ordinal === undefined ? {} : { ordinal: b.ordinal }),
      }
      state.stateValues.set(
        bundleId,
        values.map((v) => (v.id === statusId ? updated : v)),
      )
      return json(stateValueProjection(updated))
    }
    if (method === 'DELETE') {
      state.stateValues.set(
        bundleId,
        values.filter((v) => v.id !== statusId),
      )
      return noContent()
    }
  }

  return undefined
}

// ---------- Agile/sprint handler ----------

const resolvedStateNames = (state: FakeYouTrackState): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const values of state.stateValues.values()) {
    for (const value of values) {
      if (value.isResolved) names.add(value.name)
    }
  }
  return names
}

const unresolvedIssuesCount = (state: FakeYouTrackState, sprint: StoredSprint): number => {
  const resolved = resolvedStateNames(state)
  return sprint.issueIds.filter((issueId) => {
    const issue = state.issues.get(issueId)
    if (issue === undefined) return false
    return issue.state === undefined || !resolved.has(issue.state)
  }).length
}

const agileProjection = (state: FakeYouTrackState, agile: StoredAgile): Record<string, unknown> => ({
  id: agile.id,
  $type: 'Agile',
  name: agile.name,
  sprints: [...state.sprints.values()].filter((s) => s.agileId === agile.id).map((s) => ({ id: s.id })),
})

const sprintProjection = (state: FakeYouTrackState, sprint: StoredSprint): Record<string, unknown> => ({
  id: sprint.id,
  $type: 'Sprint',
  name: sprint.name,
  archived: sprint.archived,
  goal: sprint.goal ?? null,
  isDefault: sprint.isDefault,
  start: sprint.start ?? null,
  finish: sprint.finish ?? null,
  unresolvedIssuesCount: unresolvedIssuesCount(state, sprint),
})

type SprintWriteBody = Readonly<{
  name?: string
  goal?: string | null
  start?: number | null
  finish?: number | null
  isDefault?: boolean
  archived?: boolean
}>

const handleAgiles = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state, query } = ctx
  if (!path.startsWith('/api/agiles')) return undefined

  const assignPath = matchPath('/api/agiles/:id/sprints/:sprintId/issues', path)
  if (assignPath !== null && method === 'POST') {
    const sprint = state.sprints.get(assignPath['sprintId'] ?? '')
    if (sprint === undefined || sprint.agileId !== (assignPath['id'] ?? ''))
      return errorResponse(404, 'sprint not found')
    const body = (ctx.body ?? {}) as { id?: string }
    const issue = body.id === undefined ? undefined : state.issues.get(body.id)
    if (issue === undefined) return errorResponse(404, 'issue not found')
    if (!sprint.issueIds.includes(issue.id))
      state.sprints.set(sprint.id, { ...sprint, issueIds: [...sprint.issueIds, issue.id] })
    return json(sprintProjection(state, state.sprints.get(sprint.id) ?? sprint))
  }

  const oneSprintPath = matchPath('/api/agiles/:id/sprints/:sprintId', path)
  if (oneSprintPath !== null && method === 'POST') {
    const sprint = state.sprints.get(oneSprintPath['sprintId'] ?? '')
    if (sprint === undefined || sprint.agileId !== (oneSprintPath['id'] ?? ''))
      return errorResponse(404, 'sprint not found')
    const body = (ctx.body ?? {}) as SprintWriteBody
    const updated: StoredSprint = {
      ...sprint,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.goal === undefined ? {} : { goal: body.goal ?? undefined }),
      ...(body.start === undefined ? {} : { start: body.start ?? undefined }),
      ...(body.finish === undefined ? {} : { finish: body.finish ?? undefined }),
      ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
      ...(body.archived === undefined ? {} : { archived: body.archived }),
    }
    state.sprints.set(sprint.id, updated)
    return json(sprintProjection(state, updated))
  }

  const sprintsPath = matchPath('/api/agiles/:id/sprints', path)
  if (sprintsPath !== null) {
    const agile = state.agiles.get(sprintsPath['id'] ?? '')
    if (agile === undefined) return errorResponse(404, 'agile board not found')
    if (method === 'GET') {
      const list = [...state.sprints.values()].filter((s) => s.agileId === agile.id)
      const top = Number(query.get('$top') ?? '100')
      const skip = Number(query.get('$skip') ?? '0')
      return json(list.slice(skip, skip + top).map((s) => sprintProjection(state, s)))
    }
    if (method === 'POST') {
      const body = (ctx.body ?? {}) as SprintWriteBody
      const sprint: StoredSprint = {
        id: nextId(state, 'sprint'),
        agileId: agile.id,
        name: body.name ?? '',
        goal: body.goal ?? undefined,
        start: typeof body.start === 'number' ? body.start : undefined,
        finish: typeof body.finish === 'number' ? body.finish : undefined,
        archived: false,
        isDefault: body.isDefault ?? false,
        issueIds: [],
      }
      state.sprints.set(sprint.id, sprint)
      return json(sprintProjection(state, sprint))
    }
    return undefined
  }

  if (path === '/api/agiles' && method === 'GET') {
    const all = [...state.agiles.values()].map((a) => agileProjection(state, a))
    const top = Number(query.get('$top') ?? '100')
    const skip = Number(query.get('$skip') ?? '0')
    return json(all.slice(skip, skip + top))
  }

  return undefined
}

// ---------- Handler chain ----------

const handlers: ReadonlyArray<(ctx: FakeYouTrackCtx) => Response | undefined> = [
  handleStateBundles,
  handleAgiles,
  handleProjects,
  handleIssues,
  handleComments,
  handleRelations,
  handleWatchersAndVotes,
  handleAttachments,
  handleWorkItems,
  handleActivities,
  handleQueryEndpoints,
  handleDirectory,
]

export const handleFakeYouTrackRequest = (ctx: FakeYouTrackCtx): Response => {
  for (const handler of handlers) {
    const response = handler(ctx)
    if (response !== undefined) return response
  }
  return errorResponse(404, `no route for ${ctx.method} ${ctx.path}`)
}
