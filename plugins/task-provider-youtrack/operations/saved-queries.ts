// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SavedQuery, TaskSearchResult } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'

import { logger } from '../../../src/logger.js'
import { YouTrackClassifiedError, classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ISSUE_LIST_FIELDS, SAVED_QUERY_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { mapIssueToSearchResult, mapSavedQuery } from '../mappers.js'
import { IssueListSchema } from '../schemas/issue.js'
import { SavedQuerySchema } from '../schemas/saved-query.js'

const log = logger.child({ scope: 'provider:youtrack:saved-queries' })

export async function listYouTrackSavedQueries(config: YouTrackConfig): Promise<SavedQuery[]> {
  log.debug({}, 'listSavedQueries')
  try {
    const queries = await paginate(
      config,
      '/api/savedQueries',
      { fields: SAVED_QUERY_FIELDS },
      SavedQuerySchema.array(),
    )
    log.info({ count: queries.length }, 'Saved queries listed')
    return queries.map(mapSavedQuery)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list saved queries')
    throw classifyYouTrackError(error)
  }
}

export async function runYouTrackSavedQuery(config: YouTrackConfig, queryId: string): Promise<TaskSearchResult[]> {
  log.debug({ queryId }, 'runSavedQuery')
  try {
    const queryRaw = await youtrackFetch(config, 'GET', `/api/savedQueries/${queryId}`, {
      query: { fields: SAVED_QUERY_FIELDS },
    })
    const savedQuery = SavedQuerySchema.parse(queryRaw)
    if (savedQuery.query === undefined || savedQuery.query === null) {
      throw new YouTrackClassifiedError(
        `Saved query ${queryId} does not define a search query`,
        providerError.validationFailed('query', 'Saved query does not define a search query'),
      )
    }
    const queryString = savedQuery.query

    log.debug({ queryId, queryString }, 'Executing saved query')

    const issues = await paginate(
      config,
      '/api/issues',
      { fields: ISSUE_LIST_FIELDS, query: queryString },
      IssueListSchema.array(),
    )
    log.info({ queryId, count: issues.length }, 'Saved query executed')
    return issues.map((issue) => mapIssueToSearchResult(issue, config.baseUrl))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), queryId }, 'Failed to run saved query')
    throw classifyYouTrackError(error, { queryId })
  }
}
