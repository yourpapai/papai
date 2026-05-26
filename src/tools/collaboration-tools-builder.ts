// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { makeAddVoteTool } from './add-vote.js'
import { makeAddWatcherTool } from './add-watcher.js'
import { makeFindUserTool } from './find-user.js'
import { makeGetCurrentUserTool } from './get-current-user.js'
import { makeListWatchersTool } from './list-watchers.js'
import { makeRemoveVoteTool } from './remove-vote.js'
import { makeRemoveWatcherTool } from './remove-watcher.js'
import { makeSetVisibilityTool } from './set-visibility.js'

export function maybeAddCollaborationTaskTools(
  tools: ToolSet,
  provider: TaskProvider,
  chatUserId: string | undefined,
): void {
  if (provider.listUsers !== undefined) tools['find_user'] = makeFindUserTool(provider)
  if (provider.identityResolver !== undefined && provider.getCurrentUser !== undefined)
    tools['get_current_user'] = makeGetCurrentUserTool(provider)
  if (provider.capabilities.has('tasks.watchers')) {
    tools['list_watchers'] = makeListWatchersTool(provider)
    tools['add_watcher'] = makeAddWatcherTool(provider, chatUserId)
    tools['remove_watcher'] = makeRemoveWatcherTool(provider, chatUserId)
  }
  if (provider.capabilities.has('tasks.votes')) {
    tools['add_vote'] = makeAddVoteTool(provider)
    tools['remove_vote'] = makeRemoveVoteTool(provider)
  }
  if (provider.capabilities.has('tasks.visibility')) tools['set_visibility'] = makeSetVisibilityTool(provider)
}
