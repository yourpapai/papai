// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../logger.js'
import type { Comment } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { COMMENT_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { mapComment } from '../mappers.js'
import { CommentSchema } from '../schemas/comment.js'

const log = logger.child({ scope: 'provider:youtrack:comments' })

type CommentPaginationParams = Partial<Record<'limit' | 'offset', number>>

type YouTrackComment = z.infer<typeof CommentSchema>

export async function addYouTrackComment(config: YouTrackConfig, taskId: string, body: string): Promise<Comment> {
  log.debug({ taskId }, 'addComment')
  try {
    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}/comments`, {
      body: { text: body },
      query: { fields: COMMENT_FIELDS },
    })
    const comment = CommentSchema.parse(raw)
    log.info({ taskId, commentId: comment.id }, 'Comment added')
    return mapComment(comment)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to add comment')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function getYouTrackComment(config: YouTrackConfig, taskId: string, commentId: string): Promise<Comment> {
  log.debug({ taskId, commentId }, 'getComment')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments/${commentId}`, {
      query: { fields: COMMENT_FIELDS },
    })
    const comment = CommentSchema.parse(raw)
    log.info({ taskId, commentId: comment.id }, 'Comment retrieved')
    return mapComment(comment)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, commentId },
      'Failed to get comment',
    )
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}

export function getYouTrackComments(config: YouTrackConfig, taskId: string): Promise<Comment[]>
export function getYouTrackComments(
  config: YouTrackConfig,
  taskId: string,
  params: CommentPaginationParams | undefined,
): Promise<Comment[]>
export async function getYouTrackComments(
  config: YouTrackConfig,
  taskId: string,
  ...rest: [] | [params: CommentPaginationParams | undefined]
): Promise<Comment[]> {
  const params = rest[0]
  log.debug({ taskId, params }, 'getComments')
  try {
    if (params !== undefined && params.limit !== undefined) {
      const query: Record<string, string> = {
        fields: COMMENT_FIELDS,
        $top: String(params.limit),
      }
      if (params.offset !== undefined) {
        query['$skip'] = String(params.offset)
      }

      const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments`, { query })
      const comments = CommentSchema.array().parse(raw)
      log.info({ taskId, count: comments.length }, 'Comments retrieved')
      return comments.map((comment) => mapComment(comment))
    }

    if (params !== undefined && params.offset !== undefined) {
      const comments = await paginateYouTrackCommentsFromOffset(config, taskId, params.offset, 100, 10)
      log.info({ taskId, count: comments.length }, 'Comments retrieved')
      return comments.map((comment) => mapComment(comment))
    }

    const comments = await paginate(
      config,
      `/api/issues/${taskId}/comments`,
      { fields: COMMENT_FIELDS },
      CommentSchema.array(),
    )
    log.info({ taskId, count: comments.length }, 'Comments retrieved')
    return comments.map((comment) => mapComment(comment))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get comments')
    throw classifyYouTrackError(error, { taskId })
  }
}

function paginateYouTrackCommentsFromOffset(
  config: YouTrackConfig,
  taskId: string,
  offset: number,
  pageSize: number,
  maxPages: number,
): Promise<readonly YouTrackComment[]> {
  return paginateYouTrackCommentsPage(config, taskId, offset, pageSize, maxPages, [])
}

async function paginateYouTrackCommentsPage(
  config: YouTrackConfig,
  taskId: string,
  offset: number,
  pageSize: number,
  maxPages: number,
  accumulated: readonly YouTrackComment[],
): Promise<readonly YouTrackComment[]> {
  if (accumulated.length >= maxPages * pageSize) {
    return accumulated
  }

  const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/comments`, {
    query: {
      fields: COMMENT_FIELDS,
      $top: String(pageSize),
      $skip: String(offset),
    },
  })
  const comments = CommentSchema.array().parse(raw)
  const nextAccumulated = [...accumulated, ...comments]

  if (comments.length < pageSize) {
    return nextAccumulated
  }

  return paginateYouTrackCommentsPage(config, taskId, offset + pageSize, pageSize, maxPages, nextAccumulated)
}

export async function updateYouTrackComment(
  config: YouTrackConfig,
  params: { taskId: string; commentId: string; body: string },
): Promise<Comment> {
  const { taskId, commentId } = params
  log.debug({ taskId, commentId }, 'updateComment')
  try {
    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}/comments/${commentId}`, {
      body: { text: params.body },
      query: { fields: COMMENT_FIELDS },
    })
    const comment = CommentSchema.parse(raw)
    log.info({ commentId: comment.id }, 'Comment updated')
    return mapComment(comment)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), commentId }, 'Failed to update comment')
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}

export async function removeYouTrackComment(
  config: YouTrackConfig,
  params: { taskId: string; commentId: string },
): Promise<{ id: string }> {
  const { taskId, commentId } = params
  log.debug({ taskId, commentId }, 'removeComment')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/comments/${commentId}`)
    log.info({ taskId, commentId }, 'Comment removed')
    return { id: commentId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), commentId }, 'Failed to remove comment')
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}
