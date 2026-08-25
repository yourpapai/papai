// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Activity } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { classifyGitHubError } from '../classify-error.js'
import type { GitHubConfig } from '../client.js'
import { githubPaginate } from '../client.js'
import { GitHubIssueEventSchema } from '../schemas/event.js'
import type { GitHubIssueEvent } from '../schemas/event.js'

const log = logger.child({ scope: 'provider:github:activities' })

const eventPageSchema = z.array(GitHubIssueEventSchema)

export interface GitHubTaskEventsParams {
  categories?: string[]
  limit?: number
  offset?: number
  reverse?: boolean
  start?: string
  end?: string
  author?: string
}

/**
 * Maps a known issue event onto the normalized activity shape; unknown event
 * types return null and are dropped. The table is exactly the proposal's six.
 */
const mapEventToActivity = (event: GitHubIssueEvent): Activity | null => {
  const base = { id: String(event.id), timestamp: event.created_at, author: event.actor?.login }
  switch (event.event) {
    case 'assigned':
      return { ...base, category: 'assignee', added: event.assignee?.login }
    case 'labeled':
      return { ...base, category: 'label', added: event.label?.name }
    case 'unlabeled':
      return { ...base, category: 'label', removed: event.label?.name }
    case 'closed':
      return { ...base, category: 'status', added: 'closed' }
    case 'reopened':
      return { ...base, category: 'status', added: 'open' }
    case 'commented':
      return { ...base, category: 'comment' }
    default:
      return null
  }
}

/**
 * Issue events → activity history. The endpoint has no server-side filters,
 * so every page is fetched (bounded by events-per-issue), unknown types are
 * dropped, and params apply client-side in a fixed order: author/category
 * equality, start/end instant bounds, deterministic ascending timestamp
 * sort, optional reverse, then the limit/offset slice.
 */
export async function githubListTaskEvents(
  config: GitHubConfig,
  taskId: string,
  params?: GitHubTaskEventsParams,
): Promise<Activity[]> {
  log.debug({ repo: config.repo, taskId }, 'listTaskEvents')
  try {
    const events = await githubPaginate(config, `/repos/${config.repo}/issues/${taskId}/events`, {
      extractPage: (data: unknown): GitHubIssueEvent[] => eventPageSchema.parse(data),
    })
    const activities = events.map(mapEventToActivity).filter((activity): activity is Activity => activity !== null)
    const offset = params?.offset ?? 0
    const limit = params?.limit ?? Number.MAX_SAFE_INTEGER
    const filtered = activities.filter((activity) => {
      if (params?.author !== undefined && activity.author !== params.author) return false
      if (params?.categories !== undefined && !params.categories.includes(activity.category)) return false
      if (params?.start !== undefined && Date.parse(activity.timestamp) < Date.parse(params.start)) return false
      if (params?.end !== undefined && Date.parse(activity.timestamp) > Date.parse(params.end)) return false
      return true
    })
    filtered.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
    const ordered = params?.reverse === true ? filtered.reverse() : filtered
    const results = ordered.slice(offset, offset + limit)
    log.info({ taskId, count: results.length }, 'Task events listed')
    return results
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to list task events')
    throw classifyGitHubError(error, { taskId })
  }
}
