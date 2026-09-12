// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Comment } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { classifyGitHubError } from '../classify-error.js'
import type { GitHubConfig } from '../client.js'
import { githubFetch, githubPaginate } from '../client.js'
import { mapCommentToComment } from '../mappers.js'
import type { GitHubComment } from '../schemas/comment.js'
import { GitHubCommentSchema } from '../schemas/comment.js'

const log = logger.child({ scope: 'provider:github:comments' })

const commentPageSchema = z.array(GitHubCommentSchema)

export interface GitHubListTaskCommentsParams {
  limit?: number
  offset?: number
}

export async function githubListTaskComments(
  config: GitHubConfig,
  taskId: string,
  params?: GitHubListTaskCommentsParams,
): Promise<Comment[]> {
  log.debug({ taskId, limit: params?.limit, offset: params?.offset }, 'listTaskComments')
  const offset = params?.offset ?? 0
  const limit = params?.limit ?? Number.MAX_SAFE_INTEGER
  try {
    // No GitHub endpoint accepts a comment offset: fetch only the pages
    // covering [offset, offset + limit), then slice the window client-side.
    const comments = await githubPaginate(config, `/repos/${config.repo}/issues/${taskId}/comments`, {
      extractPage: (data: unknown): GitHubComment[] => commentPageSchema.parse(data),
      maxItems: offset + limit,
    })
    const results = comments.slice(offset, offset + limit).map(mapCommentToComment)
    log.info({ taskId, count: results.length }, 'Task comments listed')
    return results
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to list task comments')
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubCreateTaskComment(config: GitHubConfig, taskId: string, body: string): Promise<Comment> {
  log.debug({ taskId, hasBody: body !== undefined }, 'createTaskComment')
  try {
    const raw = await githubFetch(config, 'POST', `/repos/${config.repo}/issues/${taskId}/comments`, {
      body: { body },
    })
    const comment: GitHubComment = GitHubCommentSchema.parse(raw)
    log.info({ taskId, commentId: String(comment.id) }, 'Task comment created')
    return mapCommentToComment(comment)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId },
      'Failed to create task comment',
    )
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubUpdateTaskComment(
  config: GitHubConfig,
  taskId: string,
  commentId: string,
  body: string,
): Promise<Comment> {
  log.debug({ taskId, commentId }, 'updateTaskComment')
  try {
    // Update addresses the repository's issue-comments collection by comment
    // id — the per-issue path supports only list/create. taskId rides along
    // solely as classification context.
    const raw = await githubFetch(config, 'PATCH', `/repos/${config.repo}/issues/comments/${commentId}`, {
      body: { body },
    })
    const comment: GitHubComment = GitHubCommentSchema.parse(raw)
    log.info({ commentId, taskId }, 'Task comment updated')
    return mapCommentToComment(comment)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), commentId, taskId },
      'Failed to update task comment',
    )
    throw classifyGitHubError(error, { taskId })
  }
}

export async function githubDeleteTaskComment(
  config: GitHubConfig,
  taskId: string,
  commentId: string,
): Promise<{ id: string }> {
  log.debug({ taskId, commentId }, 'deleteTaskComment')
  try {
    // GitHub answers 204 with no body; the deleted id is echoed locally.
    await githubFetch(config, 'DELETE', `/repos/${config.repo}/issues/comments/${commentId}`)
    log.info({ commentId, taskId }, 'Task comment deleted')
    return { id: commentId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), commentId, taskId },
      'Failed to delete task comment',
    )
    throw classifyGitHubError(error, { taskId })
  }
}
