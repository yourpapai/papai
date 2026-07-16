// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch, PluginToolRuntimeContextLike } from './context.js'
import {
  ValidationError,
  readOptionalString,
  readRequiredString,
  toRecord,
  withGitLabGuards,
  type GitLabToolDefinition,
} from './guards.js'
import {
  gitlabCreateDiscussionSchema,
  gitlabPostCommentSchema,
  gitlabSetMrStateSchema,
  gitlabUpdateMrSchema,
} from './input-schema.js'

function executePostComment(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.postComment(
      readRequiredString(record, 'projectPath'),
      readRequiredString(record, 'mrIid'),
      readRequiredString(record, 'body'),
    )
  })
}

function executeCreateDiscussion(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.createDiscussion(
      readRequiredString(record, 'projectPath'),
      readRequiredString(record, 'mrIid'),
      readRequiredString(record, 'body'),
    )
  })
}

function executeUpdateMr(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    const fields = {
      title: readOptionalString(record, 'title'),
      description: readOptionalString(record, 'description'),
      targetBranch: readOptionalString(record, 'targetBranch'),
    }
    if (fields.title === undefined && fields.description === undefined && fields.targetBranch === undefined) {
      throw new ValidationError('provide at least one of title, description, targetBranch')
    }
    return client.updateMr(readRequiredString(record, 'projectPath'), readRequiredString(record, 'mrIid'), fields)
  })
}

function readStateEvent(record: Record<string, unknown>): 'close' | 'reopen' {
  const value = readRequiredString(record, 'stateEvent')
  if (value !== 'close' && value !== 'reopen') {
    throw new ValidationError('stateEvent must be "close" or "reopen"')
  }
  return value
}

function executeSetMrState(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withGitLabGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.setMrState(
      readRequiredString(record, 'projectPath'),
      readRequiredString(record, 'mrIid'),
      readStateEvent(record),
    )
  })
}

export function buildWriteToolDefinitions(getHttpFetch: () => HttpFetch | undefined): GitLabToolDefinition[] {
  return [
    {
      name: 'gitlab_post_comment',
      description: 'WRITE: post a comment on a GitLab merge request (mutates GitLab)',
      inputSchema: gitlabPostCommentSchema,
      execute: (input, runtimeContext) => executePostComment(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_create_discussion',
      description: 'WRITE: open a new discussion thread on a GitLab merge request (mutates GitLab)',
      inputSchema: gitlabCreateDiscussionSchema,
      execute: (input, runtimeContext) => executeCreateDiscussion(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_update_mr',
      description: 'WRITE: update a GitLab merge request title/description/target branch (mutates GitLab)',
      inputSchema: gitlabUpdateMrSchema,
      execute: (input, runtimeContext) => executeUpdateMr(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'gitlab_set_mr_state',
      description: 'WRITE: close or reopen a GitLab merge request (mutates GitLab)',
      inputSchema: gitlabSetMrStateSchema,
      execute: (input, runtimeContext) => executeSetMrState(input, runtimeContext, getHttpFetch()),
    },
  ]
}
