// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Activity, Agile, SavedQuery, Sprint, TaskSearchResult } from './domain-types.js'

export interface TaskProviderPhaseFive {
  listAgiles?(): Promise<Agile[]>
  listSprints?(agileId: string): Promise<Sprint[]>
  createSprint?(
    agileId: string,
    params: {
      name: string
      goal?: string
      start?: string
      finish?: string
      previousSprintId?: string
      isDefault?: boolean
    },
  ): Promise<Sprint>
  updateSprint?(
    agileId: string,
    sprintId: string,
    params: {
      name?: string
      goal?: string | null
      start?: string | null
      finish?: string | null
      previousSprintId?: string | null
      isDefault?: boolean
      archived?: boolean
    },
  ): Promise<Sprint>
  assignTaskToSprint?(taskId: string, sprintId: string): Promise<{ taskId: string; sprintId: string }>
  getTaskHistory?(
    taskId: string,
    params?: {
      categories?: string[]
      limit?: number
      offset?: number
      reverse?: boolean
      start?: string
      end?: string
      author?: string
    },
  ): Promise<Activity[]>
  listSavedQueries?(): Promise<SavedQuery[]>
  runSavedQuery?(queryId: string): Promise<TaskSearchResult[]>
  countTasks?(params: { query: string; projectId?: string }): Promise<number>
}
