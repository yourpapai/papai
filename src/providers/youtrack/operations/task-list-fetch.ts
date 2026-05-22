// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { ListTasksParams } from '../../types.js'
import type { YouTrackConfig, YouTrackQueryValue } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ISSUE_LIST_FIELDS, YOUTRACK_INLINE_LIST_CUSTOM_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { IssueListSchema } from '../schemas/issue.js'

export function fetchTasksWithPagination(
  config: YouTrackConfig,
  query: string,
  params: ListTasksParams | undefined,
): Promise<z.infer<typeof IssueListSchema>[]> {
  if (params?.limit !== undefined) {
    return fetchTasksManual(config, query, params)
  }
  return fetchTasksAuto(config, query)
}

const fetchTasksAuto = (config: YouTrackConfig, query: string): Promise<z.infer<typeof IssueListSchema>[]> =>
  paginate(
    config,
    '/api/issues',
    { fields: ISSUE_LIST_FIELDS, query, customFields: YOUTRACK_INLINE_LIST_CUSTOM_FIELDS },
    IssueListSchema.array(),
    10,
    100,
  )

const fetchTasksManual = async (
  config: YouTrackConfig,
  query: string,
  params: ListTasksParams,
): Promise<z.infer<typeof IssueListSchema>[]> => {
  const limit = params.limit!
  const page = params.page ?? 1
  const skip = (page - 1) * limit

  const requestQuery: Record<string, YouTrackQueryValue> = {
    fields: ISSUE_LIST_FIELDS,
    query,
    $top: String(limit),
    customFields: YOUTRACK_INLINE_LIST_CUSTOM_FIELDS,
  }

  if (skip > 0) {
    requestQuery['$skip'] = String(skip)
  }

  const raw = await youtrackFetch(config, 'GET', '/api/issues', {
    query: requestQuery,
  })
  return IssueListSchema.array().parse(raw)
}
