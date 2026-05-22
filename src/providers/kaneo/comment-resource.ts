// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { CommentListResponseSchema, CreateCommentResponseSchema } from './schemas/create-comment.js'
import { UpdateCommentResponseSchema } from './schemas/update-comment.js'

const mapCommentResponse = (comment: {
  id: string
  content: string
  createdAt: string
}): { id: string; comment: string; createdAt: string } => ({
  id: comment.id,
  comment: comment.content,
  createdAt: comment.createdAt,
})

export class CommentResource {
  private log = logger.child({ scope: 'kaneo:comment-resource' })

  constructor(private config: KaneoConfig) {}

  async add(taskId: string, comment: string): Promise<{ id: string; comment: string; createdAt: string }> {
    this.log.debug({ taskId, commentLength: comment.length }, 'Adding comment')

    try {
      const created = await kaneoFetch(
        this.config,
        'POST',
        `/comment/${taskId}`,
        { content: comment },
        undefined,
        CreateCommentResponseSchema,
      )

      this.log.info({ taskId, commentId: created.id }, 'Comment added')
      return mapCommentResponse(created)
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to add comment')
      throw classifyKaneoError(error)
    }
  }

  async list(taskId: string): Promise<{ id: string; comment: string; createdAt: string }[]> {
    this.log.debug({ taskId }, 'Listing comments')

    try {
      const comments = await kaneoFetch(
        this.config,
        'GET',
        `/comment/${taskId}`,
        undefined,
        undefined,
        CommentListResponseSchema,
      )

      this.log.info({ taskId, count: comments.length }, 'Comments listed')
      return comments.map(mapCommentResponse)
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list comments')
      throw classifyKaneoError(error)
    }
  }

  async update(
    taskId: string,
    commentId: string,
    comment: string,
  ): Promise<{ id: string; comment: string; createdAt: string }> {
    this.log.debug({ taskId, commentId, commentLength: comment.length }, 'Updating comment')

    try {
      const updated = await kaneoFetch(
        this.config,
        'PUT',
        `/comment/${commentId}`,
        { content: comment },
        undefined,
        UpdateCommentResponseSchema,
      )

      this.log.info({ taskId, commentId }, 'Comment updated')
      return mapCommentResponse(updated)
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update comment')
      throw classifyKaneoError(error)
    }
  }

  async remove(commentId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ commentId }, 'Removing comment')

    try {
      const removed = await kaneoFetch(
        this.config,
        'DELETE',
        `/comment/${commentId}`,
        undefined,
        undefined,
        UpdateCommentResponseSchema,
      )
      this.log.info({ commentId }, 'Comment removed')
      return { id: removed.id, success: true }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to remove comment')
      throw classifyKaneoError(error)
    }
  }
}
