// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../logger.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { PROJECT_FIELDS } from '../constants.js'
import { ProjectSchema } from '../schemas/project.js'

const log = logger.child({ scope: 'provider:youtrack:count' })

const CountResponseSchema = z.object({
  count: z.number(),
})

const MAX_COUNT_RETRIES = 3
const COUNT_RETRY_DELAY_MS = 500

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

async function requestCount(config: YouTrackConfig, query: string, attempt = 0): Promise<number> {
  const raw = await youtrackFetch(config, 'POST', '/api/issuesGetter/count', {
    body: { query },
    query: { fields: 'count' },
  })
  const result = CountResponseSchema.parse(raw)
  if (result.count !== -1) return result.count
  if (attempt >= MAX_COUNT_RETRIES - 1) {
    throw new Error('YouTrack count API returned -1 after all retries')
  }
  log.debug({ attempt, query }, 'Count returned -1, retrying')
  await waitForRetry(COUNT_RETRY_DELAY_MS)
  return requestCount(config, query, attempt + 1)
}

export async function countYouTrackTasks(
  config: YouTrackConfig,
  params: { query: string; projectId?: string },
): Promise<number> {
  log.debug({ query: params.query, projectId: params.projectId }, 'countTasks')
  try {
    let effectiveQuery = params.query

    if (params.projectId !== undefined) {
      const projectRaw = await youtrackFetch(config, 'GET', `/api/admin/projects/${params.projectId}`, {
        query: { fields: PROJECT_FIELDS },
      })
      const project = ProjectSchema.parse(projectRaw)
      const shortName = project.shortName ?? project.id
      effectiveQuery = `project: {${shortName}} ${params.query}`.trim()
    }
    const count = await requestCount(config, effectiveQuery)
    log.info({ count, query: effectiveQuery }, 'Tasks counted')
    return count
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        query: params.query,
        projectId: params.projectId,
      },
      'Failed to count tasks',
    )
    if (params.projectId === undefined) {
      throw classifyYouTrackError(error)
    }
    throw classifyYouTrackError(error, { projectId: params.projectId })
  }
}
