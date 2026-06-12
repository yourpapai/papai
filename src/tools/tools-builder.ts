// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import type { StagedFileDownloadFn } from '../attachments/types.js'
import type { ContextType } from '../chat/types.js'
import type { TaskProvider } from '../providers/types.js'
import { makeAddCommentReactionTool } from './add-comment-reaction.js'
import { makeAddCommentTool } from './add-comment.js'
import { makeAddProjectMemberTool } from './add-project-member.js'
import { makeAddTaskLabelTool } from './add-task-label.js'
import { makeAddTaskRelationTool } from './add-task-relation.js'
import { makeApplyYouTrackCommandTool } from './apply-youtrack-command.js'
import { makeAssignTaskToSprintTool } from './assign-task-to-sprint.js'
import { makeListAttachmentsTool, makeRemoveAttachmentTool, makeUploadAttachmentTool } from './attachment-tools.js'
import { makeClearMyIdentityTool } from './clear-my-identity.js'
import { maybeAddCollaborationTaskTools } from './collaboration-tools-builder.js'
import { makeCoreTools } from './core-tools.js'
import { makeCountTasksTool } from './count-tasks.js'
import { makeCreateProjectTool } from './create-project.js'
import { makeCreateSprintTool } from './create-sprint.js'
import { makeCreateStatusTool } from './create-status.js'
import { makeDeleteProjectTool } from './delete-project.js'
import { makeDeleteStatusTool } from './delete-status.js'
import { makeDeleteTaskTool } from './delete-task.js'
import { makeGetCommentsTool } from './get-comments.js'
import { makeGetProjectTool } from './get-project.js'
import { makeGetTaskHistoryTool } from './get-task-history.js'
import { makeCreateLabelTool, makeListLabelsTool, makeRemoveLabelTool, makeUpdateLabelTool } from './label-tools.js'
import { makeListAgilesTool } from './list-agiles.js'
import { makeListProjectTeamTool } from './list-project-team.js'
import { makeListProjectsTool } from './list-projects.js'
import { makeListSavedQueriesTool } from './list-saved-queries.js'
import { makeListSprintsTool } from './list-sprints.js'
import { makeListStatusesTool } from './list-statuses.js'
import { makeListWorkTool } from './list-work.js'
import { makeLogWorkTool } from './log-work.js'
import { makePromoteMemoTool } from './promote-memo.js'
import { addProviderIndependentTools, getStorageOwnerId } from './provider-independent-tools-builder.js'
import { makeRemoveCommentReactionTool } from './remove-comment-reaction.js'
import { makeRemoveCommentTool } from './remove-comment.js'
import { makeRemoveProjectMemberTool } from './remove-project-member.js'
import { makeRemoveTaskLabelTool } from './remove-task-label.js'
import { makeRemoveTaskRelationTool } from './remove-task-relation.js'
import { makeRemoveWorkTool } from './remove-work.js'
import { makeReorderStatusesTool } from './reorder-statuses.js'
import { makeRunSavedQueryTool } from './run-saved-query.js'
import { makeSetMyIdentityTool } from './set-my-identity.js'
import type { ToolMode } from './types.js'
import { makeUpdateCommentTool } from './update-comment.js'
import { makeUpdateProjectTool } from './update-project.js'
import { makeUpdateSprintTool } from './update-sprint.js'
import { makeUpdateStatusTool } from './update-status.js'
import { makeUpdateTaskRelationTool } from './update-task-relation.js'
import { makeUpdateWorkTool } from './update-work.js'

type BuilderArgs =
  | readonly []
  | readonly [contextType: ContextType | undefined]
  | readonly [contextType: ContextType | undefined, username: string | null | undefined]
  | readonly [
      contextType: ContextType | undefined,
      username: string | null | undefined,
      stagedDownloadFn: StagedFileDownloadFn | undefined,
    ]

function maybeAddProjectTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('projects.read') && provider.getProject !== undefined)
    tools['get_project'] = makeGetProjectTool(provider)
  if (provider.capabilities.has('projects.list')) tools['list_projects'] = makeListProjectsTool(provider)
  if (provider.capabilities.has('projects.create')) tools['create_project'] = makeCreateProjectTool(provider)
  if (provider.capabilities.has('projects.update')) tools['update_project'] = makeUpdateProjectTool(provider)
  if (provider.capabilities.has('projects.delete')) tools['delete_project'] = makeDeleteProjectTool(provider)
  if (provider.capabilities.has('projects.team')) tools['list_project_team'] = makeListProjectTeamTool(provider)
  if (provider.capabilities.has('projects.team')) tools['add_project_member'] = makeAddProjectMemberTool(provider)
  if (provider.capabilities.has('projects.team')) tools['remove_project_member'] = makeRemoveProjectMemberTool(provider)
}

function maybeAddCommentTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('comments.read')) tools['get_comments'] = makeGetCommentsTool(provider)
  if (provider.capabilities.has('comments.create')) tools['add_comment'] = makeAddCommentTool(provider)
  if (provider.capabilities.has('comments.update')) tools['update_comment'] = makeUpdateCommentTool(provider)
  if (provider.capabilities.has('comments.delete')) tools['remove_comment'] = makeRemoveCommentTool(provider)
  if (provider.capabilities.has('comments.reactions')) {
    tools['add_comment_reaction'] = makeAddCommentReactionTool(provider)
    tools['remove_comment_reaction'] = makeRemoveCommentReactionTool(provider)
  }
}

function maybeAddLabelTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('labels.list')) {
    tools['list_labels'] = makeListLabelsTool(provider)
  }
  if (provider.capabilities.has('labels.create')) {
    tools['create_label'] = makeCreateLabelTool(provider)
  }
  if (provider.capabilities.has('labels.update')) {
    tools['update_label'] = makeUpdateLabelTool(provider)
  }
  if (provider.capabilities.has('labels.delete')) {
    tools['remove_label'] = makeRemoveLabelTool(provider)
  }
  if (provider.capabilities.has('labels.assign')) {
    tools['add_task_label'] = makeAddTaskLabelTool(provider)
    tools['remove_task_label'] = makeRemoveTaskLabelTool(provider)
  }
}

function maybeAddRelationTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('tasks.relations')) {
    tools['add_task_relation'] = makeAddTaskRelationTool(provider)
    tools['update_task_relation'] = makeUpdateTaskRelationTool(provider)
    tools['remove_task_relation'] = makeRemoveTaskRelationTool(provider)
  }
}

function maybeAddStatusTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('statuses.list')) tools['list_statuses'] = makeListStatusesTool(provider)
  if (provider.capabilities.has('statuses.create')) tools['create_status'] = makeCreateStatusTool(provider)
  if (provider.capabilities.has('statuses.update')) tools['update_status'] = makeUpdateStatusTool(provider)
  if (provider.capabilities.has('statuses.delete')) tools['delete_status'] = makeDeleteStatusTool(provider)
  if (provider.capabilities.has('statuses.reorder')) tools['reorder_statuses'] = makeReorderStatusesTool(provider)
}
function addAttachmentTools(tools: ToolSet, provider: TaskProvider, contextId: string | undefined): void {
  if (contextId === undefined) return
  if (provider.capabilities.has('attachments.list')) tools['list_attachments'] = makeListAttachmentsTool(provider)
  if (provider.capabilities.has('attachments.upload'))
    tools['upload_attachment'] = makeUploadAttachmentTool(provider, contextId)
  if (provider.capabilities.has('attachments.delete')) tools['remove_attachment'] = makeRemoveAttachmentTool(provider)
}
function maybeAddWorkItemTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('workItems.list')) tools['list_work'] = makeListWorkTool(provider)
  if (provider.capabilities.has('workItems.create')) tools['log_work'] = makeLogWorkTool(provider)
  if (provider.capabilities.has('workItems.update')) tools['update_work'] = makeUpdateWorkTool(provider)
  if (provider.capabilities.has('workItems.delete')) tools['remove_work'] = makeRemoveWorkTool(provider)
}

function maybeAddPhaseFiveSprintTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('agiles.list') && provider.listAgiles !== undefined)
    tools['list_agiles'] = makeListAgilesTool(provider)
  if (provider.capabilities.has('sprints.list') && provider.listSprints !== undefined)
    tools['list_sprints'] = makeListSprintsTool(provider)
  if (provider.capabilities.has('sprints.create') && provider.createSprint !== undefined)
    tools['create_sprint'] = makeCreateSprintTool(provider)
  if (provider.capabilities.has('sprints.update') && provider.updateSprint !== undefined)
    tools['update_sprint'] = makeUpdateSprintTool(provider)
  if (provider.capabilities.has('sprints.assign') && provider.assignTaskToSprint !== undefined)
    tools['assign_task_to_sprint'] = makeAssignTaskToSprintTool(provider)
}

function maybeAddPhaseFiveQueryTools(tools: ToolSet, provider: TaskProvider, mode: ToolMode): void {
  if (provider.capabilities.has('activities.read') && provider.getTaskHistory !== undefined)
    tools['get_task_history'] = makeGetTaskHistoryTool(provider)
  if (provider.capabilities.has('queries.saved') && provider.listSavedQueries !== undefined)
    tools['list_saved_queries'] = makeListSavedQueriesTool(provider)
  if (provider.capabilities.has('queries.saved') && provider.runSavedQuery !== undefined)
    tools['run_saved_query'] = makeRunSavedQueryTool(provider)
  if (
    mode === 'normal' &&
    provider.traits.has('command-language:youtrack') &&
    provider.capabilities.has('tasks.commands') &&
    provider.applyCommand !== undefined
  )
    tools['apply_youtrack_command'] = makeApplyYouTrackCommandTool(provider)
}

function maybeAddIdentityTools(
  tools: ToolSet,
  provider: TaskProvider,
  chatUserId: string | undefined,
  contextType: ContextType | undefined,
): void {
  if (chatUserId === undefined || provider.identityResolver === undefined) return
  if (contextType !== 'group') return

  tools['set_my_identity'] = makeSetMyIdentityTool(provider, chatUserId)
  tools['clear_my_identity'] = makeClearMyIdentityTool(provider, chatUserId)
}

export function buildTools(
  provider: TaskProvider,
  chatUserId: string | undefined,
  contextId: string | undefined,
  mode: ToolMode,
  ...args: BuilderArgs
): ToolSet {
  const contextType = args[0]
  const username = args[1]
  const stagedDownloadFn = args[2]
  const tools = makeCoreTools(provider, chatUserId, contextId)
  maybeAddProjectTools(tools, provider)
  maybeAddCommentTools(tools, provider)
  maybeAddLabelTools(tools, provider)
  maybeAddRelationTools(tools, provider)
  maybeAddStatusTools(tools, provider)
  if (provider.capabilities.has('tasks.delete')) tools['delete_task'] = makeDeleteTaskTool(provider)
  maybeAddCollaborationTaskTools(tools, provider, chatUserId)
  addAttachmentTools(tools, provider, contextId)
  maybeAddWorkItemTools(tools, provider)
  maybeAddPhaseFiveSprintTools(tools, provider)
  maybeAddPhaseFiveQueryTools(tools, provider, mode)
  if (provider.capabilities.has('tasks.count') && provider.countTasks !== undefined)
    tools['count_tasks'] = makeCountTasksTool(provider)
  addProviderIndependentTools(tools, {
    chatUserId,
    contextId,
    mode,
    contextType,
    username,
    stagedDownloadFn,
    allowTaskDependentDeferredPrompts: true,
  })
  const storageOwnerId = getStorageOwnerId(chatUserId, contextId)
  if (storageOwnerId !== undefined) tools['promote_memo'] = makePromoteMemoTool(provider, storageOwnerId)
  maybeAddIdentityTools(tools, provider, chatUserId, contextType)
  return tools
}

export function buildProviderlessTools(
  chatUserId: string | undefined,
  contextId: string | undefined,
  mode: ToolMode,
  ...args: BuilderArgs
): ToolSet {
  const contextType = args[0]
  const username = args[1]
  const stagedDownloadFn = args[2]
  const tools: ToolSet = {}
  addProviderIndependentTools(tools, {
    chatUserId,
    contextId,
    mode,
    contextType,
    username,
    stagedDownloadFn,
    allowTaskDependentDeferredPrompts: false,
  })
  return tools
}
