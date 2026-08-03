// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import type { StagedFileDownloadFn } from '../attachments/types.js'
import { getScopeKey } from '../chat/context-scope.js'
import type { ChatParticipantResolver } from '../chat/participants/roster.js'
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
import { makeDescribeProjectTool } from './describe-project.js'
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
import { makeResolveChatParticipantTool } from './resolve-chat-participant.js'
import { makeRunSavedQueryTool } from './run-saved-query.js'
import { makeSetMyIdentityTool } from './set-my-identity.js'
import { registerProviderBackedTool } from './tool-registration.js'
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
  | readonly [
      contextType: ContextType | undefined,
      username: string | null | undefined,
      stagedDownloadFn: StagedFileDownloadFn | undefined,
      chatParticipantResolver: ChatParticipantResolver | undefined,
    ]

function maybeAddProjectTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('projects.read') && provider.getProject !== undefined)
    registerProviderBackedTool(tools, 'get_project', makeGetProjectTool(provider))
  if (provider.capabilities.has('projects.list'))
    registerProviderBackedTool(tools, 'list_projects', makeListProjectsTool(provider))
  if (provider.traits.has('custom-fields') && provider.describeProjectFields !== undefined)
    registerProviderBackedTool(tools, 'describe_project', makeDescribeProjectTool(provider))
  if (provider.capabilities.has('projects.create'))
    registerProviderBackedTool(tools, 'create_project', makeCreateProjectTool(provider))
  if (provider.capabilities.has('projects.update'))
    registerProviderBackedTool(tools, 'update_project', makeUpdateProjectTool(provider))
  if (provider.capabilities.has('projects.delete'))
    registerProviderBackedTool(tools, 'delete_project', makeDeleteProjectTool(provider))
  if (provider.capabilities.has('projects.team'))
    registerProviderBackedTool(tools, 'list_project_team', makeListProjectTeamTool(provider))
  if (provider.capabilities.has('projects.team'))
    registerProviderBackedTool(tools, 'add_project_member', makeAddProjectMemberTool(provider))
  if (provider.capabilities.has('projects.team'))
    registerProviderBackedTool(tools, 'remove_project_member', makeRemoveProjectMemberTool(provider))
}

function maybeAddCommentTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('comments.read'))
    registerProviderBackedTool(tools, 'get_comments', makeGetCommentsTool(provider))
  if (provider.capabilities.has('comments.create'))
    registerProviderBackedTool(tools, 'add_comment', makeAddCommentTool(provider))
  if (provider.capabilities.has('comments.update'))
    registerProviderBackedTool(tools, 'update_comment', makeUpdateCommentTool(provider))
  if (provider.capabilities.has('comments.delete'))
    registerProviderBackedTool(tools, 'remove_comment', makeRemoveCommentTool(provider))
  if (provider.capabilities.has('comments.reactions')) {
    registerProviderBackedTool(tools, 'add_comment_reaction', makeAddCommentReactionTool(provider))
    registerProviderBackedTool(tools, 'remove_comment_reaction', makeRemoveCommentReactionTool(provider))
  }
}

function maybeAddLabelTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('labels.list')) {
    registerProviderBackedTool(tools, 'list_labels', makeListLabelsTool(provider))
  }
  if (provider.capabilities.has('labels.create')) {
    registerProviderBackedTool(tools, 'create_label', makeCreateLabelTool(provider))
  }
  if (provider.capabilities.has('labels.update')) {
    registerProviderBackedTool(tools, 'update_label', makeUpdateLabelTool(provider))
  }
  if (provider.capabilities.has('labels.delete')) {
    registerProviderBackedTool(tools, 'remove_label', makeRemoveLabelTool(provider))
  }
  if (provider.capabilities.has('labels.assign')) {
    registerProviderBackedTool(tools, 'add_task_label', makeAddTaskLabelTool(provider))
    registerProviderBackedTool(tools, 'remove_task_label', makeRemoveTaskLabelTool(provider))
  }
}

function maybeAddRelationTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('tasks.relations')) {
    registerProviderBackedTool(tools, 'add_task_relation', makeAddTaskRelationTool(provider))
    registerProviderBackedTool(tools, 'update_task_relation', makeUpdateTaskRelationTool(provider))
    registerProviderBackedTool(tools, 'remove_task_relation', makeRemoveTaskRelationTool(provider))
  }
}

function maybeAddStatusTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('statuses.list'))
    registerProviderBackedTool(tools, 'list_statuses', makeListStatusesTool(provider))
  if (provider.capabilities.has('statuses.create'))
    registerProviderBackedTool(tools, 'create_status', makeCreateStatusTool(provider))
  if (provider.capabilities.has('statuses.update'))
    registerProviderBackedTool(tools, 'update_status', makeUpdateStatusTool(provider))
  if (provider.capabilities.has('statuses.delete'))
    registerProviderBackedTool(tools, 'delete_status', makeDeleteStatusTool(provider))
  if (provider.capabilities.has('statuses.reorder'))
    registerProviderBackedTool(tools, 'reorder_statuses', makeReorderStatusesTool(provider))
}
function addAttachmentTools(
  tools: ToolSet,
  provider: TaskProvider,
  contextId: string | undefined,
  groupContextId: string | undefined,
): void {
  if (contextId === undefined) return
  if (provider.capabilities.has('attachments.list'))
    registerProviderBackedTool(tools, 'list_attachments', makeListAttachmentsTool(provider))
  if (provider.capabilities.has('attachments.upload'))
    registerProviderBackedTool(
      tools,
      'upload_attachment',
      makeUploadAttachmentTool(provider, contextId, groupContextId),
    )
  if (provider.capabilities.has('attachments.delete'))
    registerProviderBackedTool(tools, 'remove_attachment', makeRemoveAttachmentTool(provider))
}
function maybeAddWorkItemTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('workItems.list'))
    registerProviderBackedTool(tools, 'list_work', makeListWorkTool(provider))
  if (provider.capabilities.has('workItems.create'))
    registerProviderBackedTool(tools, 'log_work', makeLogWorkTool(provider))
  if (provider.capabilities.has('workItems.update'))
    registerProviderBackedTool(tools, 'update_work', makeUpdateWorkTool(provider))
  if (provider.capabilities.has('workItems.delete'))
    registerProviderBackedTool(tools, 'remove_work', makeRemoveWorkTool(provider))
}

function maybeAddPhaseFiveSprintTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('agiles.list') && provider.listAgiles !== undefined)
    registerProviderBackedTool(tools, 'list_agiles', makeListAgilesTool(provider))
  if (provider.capabilities.has('sprints.list') && provider.listSprints !== undefined)
    registerProviderBackedTool(tools, 'list_sprints', makeListSprintsTool(provider))
  if (provider.capabilities.has('sprints.create') && provider.createSprint !== undefined)
    registerProviderBackedTool(tools, 'create_sprint', makeCreateSprintTool(provider))
  if (provider.capabilities.has('sprints.update') && provider.updateSprint !== undefined)
    registerProviderBackedTool(tools, 'update_sprint', makeUpdateSprintTool(provider))
  if (provider.capabilities.has('sprints.assign') && provider.assignTaskToSprint !== undefined)
    registerProviderBackedTool(tools, 'assign_task_to_sprint', makeAssignTaskToSprintTool(provider))
}

function maybeAddPhaseFiveQueryTools(tools: ToolSet, provider: TaskProvider, mode: ToolMode): void {
  if (provider.capabilities.has('activities.read') && provider.getTaskHistory !== undefined)
    registerProviderBackedTool(tools, 'get_task_history', makeGetTaskHistoryTool(provider))
  if (provider.capabilities.has('queries.saved') && provider.listSavedQueries !== undefined)
    registerProviderBackedTool(tools, 'list_saved_queries', makeListSavedQueriesTool(provider))
  if (provider.capabilities.has('queries.saved') && provider.runSavedQuery !== undefined)
    registerProviderBackedTool(tools, 'run_saved_query', makeRunSavedQueryTool(provider))
  if (
    mode === 'normal' &&
    provider.traits.has('command-language:youtrack') &&
    provider.capabilities.has('tasks.commands') &&
    provider.applyCommand !== undefined
  )
    registerProviderBackedTool(tools, 'apply_youtrack_command', makeApplyYouTrackCommandTool(provider))
}

function maybeAddIdentityTools(
  tools: ToolSet,
  provider: TaskProvider,
  chatUserId: string | undefined,
  contextType: ContextType | undefined,
): void {
  if (chatUserId === undefined || provider.identityResolver === undefined) return
  if (contextType !== 'group') return

  registerProviderBackedTool(tools, 'set_my_identity', makeSetMyIdentityTool(provider, chatUserId))
  registerProviderBackedTool(tools, 'clear_my_identity', makeClearMyIdentityTool(provider, chatUserId))
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
  const chatParticipantResolver = args[3]
  const groupReadContextId =
    contextType === 'group' && contextId !== undefined
      ? getScopeKey('group', { storageContextId: contextId, chatUserId: chatUserId ?? contextId, contextType })
      : undefined
  const tools = makeCoreTools(provider, chatUserId, contextId)
  maybeAddProjectTools(tools, provider)
  maybeAddCommentTools(tools, provider)
  maybeAddLabelTools(tools, provider)
  maybeAddRelationTools(tools, provider)
  maybeAddStatusTools(tools, provider)
  if (provider.capabilities.has('tasks.delete'))
    registerProviderBackedTool(tools, 'delete_task', makeDeleteTaskTool(provider))
  maybeAddCollaborationTaskTools(tools, provider, chatUserId)
  addAttachmentTools(tools, provider, contextId, groupReadContextId)
  maybeAddWorkItemTools(tools, provider)
  maybeAddPhaseFiveSprintTools(tools, provider)
  maybeAddPhaseFiveQueryTools(tools, provider, mode)
  if (provider.capabilities.has('tasks.count') && provider.countTasks !== undefined)
    registerProviderBackedTool(tools, 'count_tasks', makeCountTasksTool(provider))
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
  if (storageOwnerId !== undefined)
    registerProviderBackedTool(tools, 'promote_memo', makePromoteMemoTool(provider, storageOwnerId))
  maybeAddIdentityTools(tools, provider, chatUserId, contextType)
  if (contextType === 'group' && chatParticipantResolver !== undefined && contextId !== undefined) {
    tools['resolve_chat_participant'] = makeResolveChatParticipantTool(chatParticipantResolver, contextId)
  }
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
  const chatParticipantResolver = args[3]
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
  if (contextType === 'group' && chatParticipantResolver !== undefined && contextId !== undefined) {
    tools['resolve_chat_participant'] = makeResolveChatParticipantTool(chatParticipantResolver, contextId)
  }
  return tools
}
