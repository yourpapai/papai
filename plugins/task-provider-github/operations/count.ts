// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { GitHubClassifiedError, classifyGitHubError } from '../classify-error.js'
import type { GitHubConfig } from '../client.js'
import { githubFetch } from '../client.js'
import { buildGitHubIssueSearchQuery } from './tasks.js'

const log = logger.child({ scope: 'provider:github:count' })

const countResponseSchema = z.object({ total_count: z.number() })

export interface GitHubCountTasksParams {
  query: string
  projectId?: string
}

/**
 * Counts matching issues with one `per_page=1` search request; the response's
 * `total_count` reflects the full match count regardless of page size. One
 * instance = one repository: a defined `projectId` other than the configured
 * repo is rejected before any request is made.
 */
export async function githubCountTasks(config: GitHubConfig, params: GitHubCountTasksParams): Promise<number> {
  log.debug({ repo: config.repo, query: params.query, projectId: params.projectId }, 'countTasks')
  if (params.projectId !== undefined && params.projectId !== config.repo) {
    const error = new GitHubClassifiedError(
      `Project ${params.projectId} not found`,
      providerError.projectNotFound(params.projectId),
    )
    log.error({ projectId: params.projectId }, 'Project not found')
    throw error
  }
  try {
    const raw = await githubFetch(config, 'GET', '/search/issues', {
      query: {
        q: buildGitHubIssueSearchQuery({ repo: config.repo, query: params.query }),
        per_page: 1,
      },
    })
    const count = countResponseSchema.parse(raw).total_count
    log.info({ count }, 'Tasks counted')
    return count
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), query: params.query },
      'Failed to count tasks',
    )
    throw classifyGitHubError(error, { projectId: config.repo })
  }
}
