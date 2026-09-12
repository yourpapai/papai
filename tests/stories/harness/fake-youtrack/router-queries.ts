// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The query-shaped endpoints that answer about issues without being an issue
 * sub-resource: the command language, the counter, and saved queries.
 */

import { errorResponse, findIssue, json, matchPath } from './shared.js'
import type { FakeYouTrackCtx, StoredSavedQuery } from './state.js'

// ---------- Commands ----------

/**
 * The fake understands the one command shape the stories need -- `State <name>`
 * -- and ignores anything else, the way YouTrack ignores a command that matches
 * no rule. Applying it keeps the issue and the command response consistent.
 */
const applyCommand = (issue: { state: string | undefined }, command: string): void => {
  const stateMatch = /^\s*(?:State|state)\s+(.+?)\s*$/u.exec(command)
  if (stateMatch !== null) issue.state = stateMatch[1]
}

const handleCommands = (ctx: FakeYouTrackCtx): Response | undefined => {
  if (ctx.path !== '/api/commands' || ctx.method !== 'POST') return undefined
  const body = (ctx.body ?? {}) as { query?: string; issues?: { idReadable?: string; id?: string }[] }
  const refs = body.issues ?? []
  const resolved: { id: string; idReadable: string }[] = []
  for (const ref of refs) {
    const issue = findIssue(ctx.state, ref.idReadable ?? ref.id ?? '')
    if (issue === undefined) return errorResponse(404, `issue not found: ${ref.idReadable ?? ref.id ?? ''}`)
    applyCommand(issue, body.query ?? '')
    resolved.push({ id: issue.id, idReadable: issue.idReadable })
  }
  return json({ query: body.query ?? '', issues: resolved })
}

// ---------- Count ----------

const handleCount = (ctx: FakeYouTrackCtx): Response | undefined => {
  if (ctx.path !== '/api/issuesGetter/count' || ctx.method !== 'POST') return undefined
  const query = ((ctx.body ?? {}) as { query?: string }).query ?? ''
  // YouTrack answers `-1` while its index is still catching up with a query it
  // has not seen; the provider retries. The fake reproduces that once per
  // distinct query so callers never observe it, but the retry path is real.
  if ((ctx.state.countFlakes.get(query) ?? 0) === 0) {
    ctx.state.countFlakes.set(query, 1)
    return json({ count: -1 })
  }
  // The counter answers about the same corpus `GET /api/issues` searches, so it
  // reuses the shortName filter rather than re-deriving one.
  const projectMatch = /project:\s*\{([^}]+)\}/u.exec(query)
  const shortName = projectMatch?.[1]
  const issues = [...ctx.state.issues.values()].filter(
    (issue) => shortName === undefined || ctx.state.projects.get(issue.projectDbId)?.shortName === shortName,
  )
  return json({ count: issues.length })
}

// ---------- Saved queries ----------

const savedQueryProjection = (q: StoredSavedQuery): Record<string, unknown> => ({
  id: q.id,
  name: q.name,
  query: q.query,
})

const handleSavedQueries = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state, query } = ctx

  if (path === '/api/savedQueries' && method === 'GET') {
    const all = [...state.savedQueries.values()].map(savedQueryProjection)
    const top = Number(query.get('$top') ?? '100')
    const skip = Number(query.get('$skip') ?? '0')
    return json(all.slice(skip, skip + top))
  }

  const onePath = matchPath('/api/savedQueries/:queryId', path)
  if (onePath !== null && method === 'GET') {
    const saved = state.savedQueries.get(onePath['queryId'] ?? '')
    return saved === undefined ? errorResponse(404, 'saved query not found') : json(savedQueryProjection(saved))
  }

  return undefined
}

export const handleQueryEndpoints = (ctx: FakeYouTrackCtx): Response | undefined =>
  handleCommands(ctx) ?? handleCount(ctx) ?? handleSavedQueries(ctx)
