// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ListTasksParams } from 'papai/plugin-types'

/** Builds a YouTrack issue-search query string from normalized list params. */
export const buildYouTrackQuery = (params: Readonly<ListTasksParams> | undefined, projectShortName: string): string => {
  const queryParts: string[] = [`project: {${projectShortName}}`]
  if (params?.status !== undefined) queryParts.push(`State: {${params.status}}`)
  if (params?.priority !== undefined) queryParts.push(`Priority: {${params.priority}}`)
  if (params?.assigneeId !== undefined) queryParts.push(`Assignee: {${params.assigneeId}}`)
  if (params?.dueAfter !== undefined && params.dueBefore !== undefined) {
    queryParts.push(`Due date: >${params.dueAfter}`)
    queryParts.push(`Due date: <${params.dueBefore}`)
  } else if (params?.dueAfter !== undefined) {
    queryParts.push(`Due date: >${params.dueAfter}`)
  } else if (params?.dueBefore !== undefined) {
    queryParts.push(`Due date: <${params.dueBefore}`)
  }
  if (params?.sortBy !== undefined) {
    const sortField = params.sortBy === 'createdAt' ? 'created' : params.sortBy
    queryParts.push(`sort by: ${sortField} ${params.sortOrder ?? 'asc'}`)
  }
  return queryParts.join(' ')
}
