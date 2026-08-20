// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FakeYouTrackState, StoredIssue, StoredVisibility } from './state.js'

// ---------- Response helpers ----------

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export const noContent = (): Response => new Response(null, { status: 204 })

export const errorResponse = (status: number, message: string): Response =>
  json({ error: message, error_description: message }, status)

// ---------- Path matcher ----------

export const matchPath = (pattern: string, path: string): Record<string, string> | null => {
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

// ---------- Entity lookup + shared projections ----------

export const findIssue = (state: FakeYouTrackState, ref: string): StoredIssue | undefined => {
  const direct = state.issues.get(ref)
  if (direct !== undefined) return direct
  const dbId = state.issuesByReadable.get(ref)
  return dbId === undefined ? undefined : state.issues.get(dbId)
}

/** Every user the fake knows about is derived from its id: the provider only
 *  ever reads a watcher or an author back, so a stable derivation is enough. */
export const fakeUser = (userId: string): Record<string, unknown> => ({
  id: userId,
  $type: 'User',
  login: userId,
  fullName: `Fake ${userId}`,
  email: `${userId}@youtrack.invalid`,
})

export const visibilityProjection = (visibility: StoredVisibility): Record<string, unknown> =>
  visibility.kind === 'unlimited'
    ? { $type: 'UnlimitedVisibility' }
    : {
        $type: 'LimitedVisibility',
        permittedUsers: visibility.userIds.map((id) => ({ id, login: id })),
        permittedGroups: visibility.groupIds.map((id) => ({ id, name: id })),
      }
