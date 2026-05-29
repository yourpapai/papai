// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CommentReaction, SetTaskVisibilityParams, TaskVisibility, UserRef } from 'papai/plugin-types'
import { providerError } from 'papai/plugin-types'
import { z } from 'zod'

import { logger } from '../../../src/logger.js'
import { YouTrackClassifiedError, classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ISSUE_WATCHER_FIELDS, REACTION_FIELDS, VISIBILITY_FIELDS } from '../constants.js'
import { mapCommentReaction, mapTaskVisibility, mapYouTrackWatchers } from '../mappers.js'
import { ReactionSchema } from '../schemas/reaction.js'
import { UserSchema } from '../schemas/user.js'
import { VisibilitySchema } from '../schemas/visibility.js'

const log = logger.child({ scope: 'provider:youtrack:collaboration' })

const IssueWatchersResponseSchema = z.object({
  watchers: z
    .object({
      issueWatchers: z.array(z.object({ user: UserSchema, isStarred: z.boolean() })).optional(),
      hasStar: z.boolean().optional(),
    })
    .optional(),
})

const VisibilityResponseSchema = z.object({
  visibility: VisibilitySchema,
})

const toVisibilityPayload = (params: SetTaskVisibilityParams): { visibility: unknown } => {
  if (params.kind === 'public') {
    return { visibility: { $type: 'UnlimitedVisibility' } }
  }

  if ((params.userIds?.length ?? 0) === 0 && (params.groupIds?.length ?? 0) === 0) {
    throw new YouTrackClassifiedError(
      'Restricted visibility requires at least one user or group',
      providerError.validationFailed('visibility', 'Restricted visibility requires at least one userId or groupId'),
    )
  }

  return {
    visibility: {
      $type: 'LimitedVisibility',
      permittedUsers: params.userIds?.map((id) => ({ id })),
      permittedGroups: params.groupIds?.map((id) => ({ id })),
    },
  }
}

const ensureVisibility = (visibility: TaskVisibility | undefined, taskId: string): TaskVisibility => {
  if (visibility !== undefined) {
    return visibility
  }

  throw new Error(`Missing visibility in YouTrack response for task ${taskId}`)
}

export async function listYouTrackWatchers(config: YouTrackConfig, taskId: string): Promise<UserRef[]> {
  log.debug({ taskId }, 'listWatchers')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
      query: { fields: `id,${ISSUE_WATCHER_FIELDS}` },
    })
    const issue = IssueWatchersResponseSchema.parse(raw)
    const watchers = mapYouTrackWatchers(issue.watchers) ?? []
    log.info({ taskId, count: watchers.length }, 'Watchers listed')
    return watchers
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to list watchers')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function addYouTrackWatcher(
  config: YouTrackConfig,
  taskId: string,
  userId: string,
): Promise<{ taskId: string; userId: string }> {
  log.debug({ taskId, userId }, 'addWatcher')
  try {
    await youtrackFetch(config, 'POST', `/api/issues/${taskId}/watchers/issueWatchers`, {
      body: { user: { id: userId }, isStarred: true },
    })
    log.info({ taskId, userId }, 'Watcher added')
    return { taskId, userId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, userId },
      'Failed to add watcher',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function removeYouTrackWatcher(
  config: YouTrackConfig,
  taskId: string,
  userId: string,
): Promise<{ taskId: string; userId: string }> {
  log.debug({ taskId, userId }, 'removeWatcher')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/watchers/issueWatchers/${userId}`)
    log.info({ taskId, userId }, 'Watcher removed')
    return { taskId, userId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, userId },
      'Failed to remove watcher',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function addYouTrackVote(config: YouTrackConfig, taskId: string): Promise<{ taskId: string }> {
  log.debug({ taskId }, 'addVote')
  try {
    await youtrackFetch(config, 'POST', `/api/issues/${taskId}/voters`, {
      body: { hasVote: true },
    })
    log.info({ taskId }, 'Vote added')
    return { taskId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to add vote')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function removeYouTrackVote(config: YouTrackConfig, taskId: string): Promise<{ taskId: string }> {
  log.debug({ taskId }, 'removeVote')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/voters`)
    log.info({ taskId }, 'Vote removed')
    return { taskId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to remove vote')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function setYouTrackVisibility(
  config: YouTrackConfig,
  taskId: string,
  params: SetTaskVisibilityParams,
): Promise<{ taskId: string; visibility: TaskVisibility }> {
  log.debug({ taskId, kind: params.kind }, 'setVisibility')
  try {
    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}`, {
      body: toVisibilityPayload(params),
      query: { fields: `id,visibility(${VISIBILITY_FIELDS})` },
    })
    const response = VisibilityResponseSchema.parse(raw)
    const visibility = ensureVisibility(mapTaskVisibility(response.visibility), taskId)
    log.info({ taskId, kind: visibility.kind }, 'Visibility updated')
    return { taskId, visibility }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to set visibility')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function addYouTrackCommentReaction(
  config: YouTrackConfig,
  taskId: string,
  commentId: string,
  reaction: string,
): Promise<CommentReaction> {
  log.debug({ taskId, commentId, reaction }, 'addCommentReaction')
  try {
    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}/comments/${commentId}/reactions`, {
      body: { reaction },
      query: { fields: REACTION_FIELDS },
    })
    const parsed = ReactionSchema.parse(raw)
    const mappedReaction = mapCommentReaction(parsed)
    log.info({ taskId, commentId, reactionId: mappedReaction.id }, 'Comment reaction added')
    return mappedReaction
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        taskId,
        commentId,
        reaction,
      },
      'Failed to add comment reaction',
    )
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}

export async function removeYouTrackCommentReaction(
  config: YouTrackConfig,
  taskId: string,
  commentId: string,
  reactionId: string,
): Promise<{ id: string; taskId: string; commentId: string }> {
  log.debug({ taskId, commentId, reactionId }, 'removeCommentReaction')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}/comments/${commentId}/reactions/${reactionId}`)
    log.info({ taskId, commentId, reactionId }, 'Comment reaction removed')
    return { id: reactionId, taskId, commentId }
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        taskId,
        commentId,
        reactionId,
      },
      'Failed to remove comment reaction',
    )
    throw classifyYouTrackError(error, { taskId, commentId })
  }
}
