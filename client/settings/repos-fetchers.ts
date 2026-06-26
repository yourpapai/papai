// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import { ReposResponseSchema, type ReposResponse } from './fetcher-schemas-repos.js'
import { ctxQuery, settingsFetch, writeJson } from './fetchers.js'

// --- Repos ---

export const fetchRepos = (contextId: string): Promise<ReposResponse> =>
  settingsFetch(`/settings/api/coding-repos?${ctxQuery(contextId)}`).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return ReposResponseSchema.parse(body)
  })

export const addRepo = (input: {
  contextId: string
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
}): Promise<unknown> => writeJson('/settings/api/coding-repos', 'POST', input, (b) => b)

export const deleteRepo = (input: { contextId: string; repoId: string }): Promise<unknown> =>
  settingsFetch(`/settings/api/coding-repos?repoId=${encodeURIComponent(input.repoId)}&${ctxQuery(input.contextId)}`, {
    method: 'DELETE',
  }).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return body
  })
