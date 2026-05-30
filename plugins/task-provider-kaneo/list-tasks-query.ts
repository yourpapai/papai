// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ListTasksParams } from 'papai/plugin-types'

/**
 * Build the query-string record for `GET /task/tasks/:projectId` from a
 * `ListTasksParams` object. Mirrors the parameter set accepted by the
 * upstream @kaneo/mcp `list_tasks` tool.
 */
export function buildListTasksQuery(params: ListTasksParams): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue
    }
    query[key] = String(value)
  }
  return query
}
