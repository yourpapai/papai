// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The user directory and the Hub-side project team. YouTrack splits these:
 * `/api/users` is YouTrack's own view of a user, while team membership lives in
 * Hub under `/hub/api/rest/...` and is keyed by `ringId`, not by the YouTrack
 * id. The fake keeps that split, because resolving one id into the other is the
 * bulk of what the provider's team operations do.
 */

import { errorResponse, json, matchPath, noContent } from './shared.js'
import type { FakeYouTrackCtx, StoredUser } from './state.js'

const AUTHENTICATED_LOGIN = 'me'

const userProjection = (user: StoredUser): Record<string, unknown> => ({
  id: user.id,
  login: user.login,
  fullName: user.fullName,
  name: user.fullName,
  email: user.email,
  ringId: user.ringId,
})

/** The provider searches with `nameStartsWith:<prefix>`; anything else is a
 *  literal it applies client-side, so the fake only has to honour the prefix. */
const matchesUserQuery = (user: StoredUser, raw: string | null): boolean => {
  if (raw === null || raw.length === 0) return true
  const prefix = (raw.startsWith('nameStartsWith:') ? raw.slice('nameStartsWith:'.length) : raw).toLowerCase()
  return user.login.toLowerCase().startsWith(prefix) || user.fullName.toLowerCase().startsWith(prefix)
}

const handleUsers = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state, query } = ctx
  if (method !== 'GET') return undefined

  if (path === '/api/users/me') {
    const me = state.users.get(AUTHENTICATED_LOGIN)
    return me === undefined ? errorResponse(404, 'user not found') : json(userProjection(me))
  }

  if (path === '/api/users') {
    const matched = [...state.users.values()].filter((user) => matchesUserQuery(user, query.get('query')))
    const top = Number(query.get('$top') ?? '100')
    return json(matched.slice(0, top).map(userProjection))
  }

  const onePath = matchPath('/api/users/:userId', path)
  if (onePath === null) return undefined
  const user = state.users.get(onePath['userId'] ?? '')
  return user === undefined ? errorResponse(404, 'user not found') : json(userProjection(user))
}

const findProjectByRingId = (ctx: FakeYouTrackCtx, ringId: string): boolean =>
  [...ctx.state.projects.values()].some((project) => project.ringId === ringId)

const handleTeam = (ctx: FakeYouTrackCtx): Response | undefined => {
  const { method, path, state } = ctx

  const memberPath = matchPath('/hub/api/rest/projects/:ringId/team/users/:userRingId', path)
  if (memberPath !== null && method === 'DELETE') {
    const ringId = memberPath['ringId'] ?? ''
    if (!findProjectByRingId(ctx, ringId)) return errorResponse(404, 'project not found')
    const roster = state.teams.get(ringId) ?? []
    state.teams.set(
      ringId,
      roster.filter((member) => member !== (memberPath['userRingId'] ?? '')),
    )
    return noContent()
  }

  const teamPath = matchPath('/hub/api/rest/projects/:ringId/team/users', path)
  if (teamPath === null) return undefined
  const ringId = teamPath['ringId'] ?? ''
  if (!findProjectByRingId(ctx, ringId)) return errorResponse(404, 'project not found')
  const roster = state.teams.get(ringId) ?? []

  if (method === 'GET') {
    const members = roster.flatMap((memberRingId) => {
      const user = [...state.users.values()].find((candidate) => candidate.ringId === memberRingId)
      return user === undefined ? [] : [userProjection(user)]
    })
    const top = Number(ctx.query.get('$top') ?? '100')
    const skip = Number(ctx.query.get('$skip') ?? '0')
    return json(members.slice(skip, skip + top))
  }

  if (method === 'POST') {
    const userRingId = ((ctx.body ?? {}) as { id?: string }).id
    if (userRingId === undefined) return errorResponse(400, 'team membership requires an id')
    if (!roster.includes(userRingId)) state.teams.set(ringId, [...roster, userRingId])
    return json({ id: userRingId })
  }

  return undefined
}

export const handleDirectory = (ctx: FakeYouTrackCtx): Response | undefined => handleTeam(ctx) ?? handleUsers(ctx)
