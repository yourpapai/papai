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

export const nextTs = (state: State): number => {
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

// ---------- Server bootstrap ----------

export const startFakeYouTrackServer = (): FakeYouTrackServer => {
  const state = createState()
  const handlers: Array<(ctx: Ctx) => Response | undefined> = [handleProjects]

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
