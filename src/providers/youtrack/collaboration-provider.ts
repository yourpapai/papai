// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AppError } from '../../errors.js'
import type { CommentReaction, SetTaskVisibilityParams, TaskVisibility, UserRef } from '../types.js'
import { classifyYouTrackError } from './classify-error.js'
import type { YouTrackConfig } from './client.js'
import {
  addYouTrackCommentReaction,
  addYouTrackVote,
  addYouTrackWatcher,
  listYouTrackWatchers,
  removeYouTrackCommentReaction,
  removeYouTrackVote,
  removeYouTrackWatcher,
  setYouTrackVisibility,
} from './operations/collaboration.js'
import { addYouTrackProjectMember, listYouTrackProjectTeam, removeYouTrackProjectMember } from './operations/team.js'
import { getYouTrackCurrentUser, listYouTrackUsers } from './operations/users.js'
import { YOUTRACK_PROMPT_ADDENDUM } from './prompt-addendum.js'

export abstract class YouTrackCollaborationProvider {
  constructor(protected readonly config: YouTrackConfig) {}

  listUsers(query?: string, limit?: number): Promise<UserRef[]> {
    return listYouTrackUsers(this.config, query, limit)
  }

  getCurrentUser(): Promise<UserRef> {
    return getYouTrackCurrentUser(this.config)
  }

  listProjectTeam(projectId: string): Promise<UserRef[]> {
    return listYouTrackProjectTeam(this.config, projectId)
  }

  addProjectMember(projectId: string, userId: string): Promise<{ projectId: string; userId: string }> {
    return addYouTrackProjectMember(this.config, projectId, userId)
  }

  removeProjectMember(projectId: string, userId: string): Promise<{ projectId: string; userId: string }> {
    return removeYouTrackProjectMember(this.config, projectId, userId)
  }

  addCommentReaction(taskId: string, commentId: string, reaction: string): Promise<CommentReaction> {
    return addYouTrackCommentReaction(this.config, taskId, commentId, reaction)
  }

  removeCommentReaction(
    taskId: string,
    commentId: string,
    reactionId: string,
  ): Promise<{ id: string; taskId: string; commentId: string }> {
    return removeYouTrackCommentReaction(this.config, taskId, commentId, reactionId)
  }

  listWatchers(taskId: string): Promise<UserRef[]> {
    return listYouTrackWatchers(this.config, taskId)
  }

  addWatcher(taskId: string, userId: string): Promise<{ taskId: string; userId: string }> {
    return addYouTrackWatcher(this.config, taskId, userId)
  }

  removeWatcher(taskId: string, userId: string): Promise<{ taskId: string; userId: string }> {
    return removeYouTrackWatcher(this.config, taskId, userId)
  }

  addVote(taskId: string): Promise<{ taskId: string }> {
    return addYouTrackVote(this.config, taskId)
  }

  removeVote(taskId: string): Promise<{ taskId: string }> {
    return removeYouTrackVote(this.config, taskId)
  }

  setVisibility(
    taskId: string,
    params: SetTaskVisibilityParams,
  ): Promise<{ taskId: string; visibility: TaskVisibility }> {
    return setYouTrackVisibility(this.config, taskId, params)
  }

  buildTaskUrl(taskId: string): string {
    return `${this.config.baseUrl}/issue/${taskId}`
  }

  buildProjectUrl(projectId: string): string {
    return `${this.config.baseUrl}/projects/${projectId}`
  }

  classifyError(error: unknown): AppError {
    return classifyYouTrackError(error).appError
  }

  getPromptAddendum(): string {
    return YOUTRACK_PROMPT_ADDENDUM
  }
}
