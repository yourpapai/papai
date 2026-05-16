// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../logger.js'
import { providerError } from '../../../providers/errors.js'
import type { Activity } from '../../types.js'
import { YouTrackClassifiedError, classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ACTIVITY_FIELDS, DEFAULT_ACTIVITY_CATEGORIES } from '../constants.js'
import { mapActivity } from '../mappers.js'
import { ActivitySchema } from '../schemas/activity.js'

const log = logger.child({ scope: 'provider:youtrack:activities' })

const parseActivityBoundaryTimestamp = (field: 'start' | 'end', value: string): string => {
  const parsedValue = value.trim()
  const timezoneAwareIsoDatetime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u
  if (!timezoneAwareIsoDatetime.test(parsedValue)) {
    throw new YouTrackClassifiedError(
      `Invalid ${field}: ${value}`,
      providerError.validationFailed(field, 'Expected an ISO datetime with timezone information'),
    )
  }

  const timestamp = Date.parse(parsedValue)
  if (!Number.isFinite(timestamp)) {
    throw new YouTrackClassifiedError(
      `Invalid ${field}: ${value}`,
      providerError.validationFailed(field, 'Expected an ISO datetime with timezone information'),
    )
  }
  return String(timestamp)
}

export async function getYouTrackTaskHistory(
  config: YouTrackConfig,
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
  log.debug({ taskId, params }, 'getTaskHistory')
  try {
    const query: Record<string, string> = {
      fields: ACTIVITY_FIELDS,
      categories:
        params?.categories !== undefined && params.categories.length > 0
          ? params.categories.join(',')
          : DEFAULT_ACTIVITY_CATEGORIES,
    }
    if (params?.limit !== undefined) query['$top'] = String(params.limit)
    if (params?.offset !== undefined) query['$skip'] = String(params.offset)
    if (params?.reverse !== undefined) query['reverse'] = String(params.reverse)
    if (params?.start !== undefined) query['start'] = parseActivityBoundaryTimestamp('start', params.start)
    if (params?.end !== undefined) query['end'] = parseActivityBoundaryTimestamp('end', params.end)
    if (params?.author !== undefined) query['author'] = params.author

    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/activities`, {
      query,
    })
    const activities = ActivitySchema.array().parse(raw)
    log.info({ taskId, count: activities.length }, 'Task history retrieved')
    return activities.map(mapActivity)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get task history')
    throw classifyYouTrackError(error, { taskId })
  }
}
