// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Activity, Agile, SavedQuery, Sprint, TaskSearchResult } from 'papai/plugin-types'

import { YouTrackCollaborationProvider } from './collaboration-provider.js'
import { getYouTrackTaskHistory } from './operations/activities.js'
import {
  assignYouTrackTaskToSprint,
  createYouTrackSprint,
  listYouTrackAgiles,
  listYouTrackSprints,
  updateYouTrackSprint,
} from './operations/agiles.js'
import { countYouTrackTasks } from './operations/count.js'
import { listYouTrackSavedQueries, runYouTrackSavedQuery } from './operations/saved-queries.js'

export abstract class YouTrackPhaseFiveProvider extends YouTrackCollaborationProvider {
  listAgiles(): Promise<Agile[]> {
    return listYouTrackAgiles(this.config)
  }

  listSprints(agileId: string): Promise<Sprint[]> {
    return listYouTrackSprints(this.config, agileId)
  }

  createSprint(
    agileId: string,
    params: {
      name: string
      goal?: string
      start?: string
      finish?: string
      previousSprintId?: string
      isDefault?: boolean
    },
  ): Promise<Sprint> {
    return createYouTrackSprint(this.config, agileId, params)
  }

  updateSprint(
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
  ): Promise<Sprint> {
    return updateYouTrackSprint(this.config, agileId, sprintId, params)
  }

  assignTaskToSprint(taskId: string, sprintId: string): Promise<{ taskId: string; sprintId: string }> {
    return assignYouTrackTaskToSprint(this.config, taskId, sprintId)
  }

  getTaskHistory(
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
  ): Promise<Activity[]> {
    return getYouTrackTaskHistory(this.config, taskId, params)
  }

  listSavedQueries(): Promise<SavedQuery[]> {
    return listYouTrackSavedQueries(this.config)
  }

  runSavedQuery(queryId: string): Promise<TaskSearchResult[]> {
    return runYouTrackSavedQuery(this.config, queryId)
  }

  countTasks(params: { query: string; projectId?: string }): Promise<number> {
    return countYouTrackTasks(this.config, params)
  }
}
