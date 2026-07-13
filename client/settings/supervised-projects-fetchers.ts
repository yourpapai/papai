// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import {
  SupervisedProjectResponseSchema,
  type SupervisedProjectResponse,
} from './fetcher-schemas-supervised-projects.js'
import { ctxQuery, settingsFetch, writeJson } from './fetchers.js'

export const fetchSupervisedProject = (contextId: string): Promise<SupervisedProjectResponse> =>
  settingsFetch(`/settings/api/supervised-projects?${ctxQuery(contextId)}`).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return SupervisedProjectResponseSchema.parse(body)
  })

export const saveSupervisedProject = (input: {
  contextId: string
  repositories: { projectPath: string; repoUrl?: string; baseBranch?: string }[]
  autoReview?: boolean
  selfReviewEnabled?: boolean
  costBudgetUsd?: number | null
}): Promise<unknown> => writeJson('/settings/api/supervised-projects', 'PUT', input, (b) => b)

export const deleteSupervisedProject = (contextId: string): Promise<unknown> =>
  settingsFetch(`/settings/api/supervised-projects?${ctxQuery(contextId)}`, { method: 'DELETE' }).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return body
  })
