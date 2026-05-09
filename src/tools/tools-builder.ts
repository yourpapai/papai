import type { ToolSet } from 'ai'

import {
  makeCancelDeferredPromptTool,
  makeCreateDeferredPromptTool,
  makeGetDeferredPromptTool,
  makeListDeferredPromptsTool,
  makeUpdateDeferredPromptTool,
} from '../deferred-prompts/tools.js'
import type { TaskProvider } from '../providers/types.js'
import { makeAddCommentReactionTool } from './add-comment-reaction.js'
import { makeAddCommentTool } from './add-comment.js'
import { makeAddProjectMemberTool } from './add-project-member.js'
import { makeAddTaskLabelTool } from './add-task-label.js'
import { makeAddTaskRelationTool } from './add-task-relation.js'
import { makeAddVoteTool } from './add-vote.js'
import { makeAddWatcherTool } from './add-watcher.js'
import { makeApplyYouTrackCommandTool } from './apply-youtrack-command.js'
import { makeArchiveMemosTool } from './archive-memos.js'
import { makeAssignTaskToSprintTool } from './assign-task-to-sprint.js'
import { makeListAttachmentsTool, makeRemoveAttachmentTool, makeUploadAttachmentTool } from './attachment-tools.js'
import { makeClearMyIdentityTool } from './clear-my-identity.js'
import { makeCoreTools } from './core-tools.js'
import { makeCountTasksTool } from './count-tasks.js'
import { makeCreateProjectTool } from './create-project.js'
import { makeCreateRecurringTaskTool } from './create-recurring-task.js'
import { makeCreateSprintTool } from './create-sprint.js'
import { makeCreateStatusTool } from './create-status.js'
import { makeDeleteProjectTool } from './delete-project.js'
import { makeDeleteRecurringTaskTool } from './delete-recurring-task.js'
import { makeDeleteStatusTool } from './delete-status.js'
import { makeDeleteTaskTool } from './delete-task.js'
import { makeFindUserTool } from './find-user.js'
import { makeGetCommentsTool } from './get-comments.js'
import { makeGetCurrentUserTool } from './get-current-user.js'
import { makeGetProjectTool } from './get-project.js'
import { makeGetTaskHistoryTool } from './get-task-history.js'
import { makeDeleteInstructionTool, makeListInstructionsTool, makeSaveInstructionTool } from './instructions.js'
import { makeCreateLabelTool, makeListLabelsTool, makeRemoveLabelTool, makeUpdateLabelTool } from './label-tools.js'
import { makeListAgilesTool } from './list-agiles.js'
import { makeListMemosTool } from './list-memos.js'
import { makeListProjectTeamTool } from './list-project-team.js'
import { makeListProjectsTool } from './list-projects.js'
import { makeListRecurringTasksTool } from './list-recurring-tasks.js'
import { makeListSavedQueriesTool } from './list-saved-queries.js'
import { makeListSprintsTool } from './list-sprints.js'
import { makeListStatusesTool } from './list-statuses.js'
import { makeListWatchersTool } from './list-watchers.js'
import { makeListWorkTool } from './list-work.js'
import { makeLogWorkTool } from './log-work.js'
import { makeLookupGroupHistoryTool } from './lookup-group-history.js'
import { makePauseRecurringTaskTool } from './pause-recurring-task.js'
import { makePromoteMemoTool } from './promote-memo.js'
import { makeUpdateRecurringTaskTool } from './recurring-tools.js'
import { makeRemoveCommentReactionTool } from './remove-comment-reaction.js'
import { makeRemoveCommentTool } from './remove-comment.js'
import { makeRemoveProjectMemberTool } from './remove-project-member.js'
import { makeRemoveTaskLabelTool } from './remove-task-label.js'
import { makeRemoveTaskRelationTool } from './remove-task-relation.js'
import { makeRemoveVoteTool } from './remove-vote.js'
import { makeRemoveWatcherTool } from './remove-watcher.js'
import { makeRemoveWorkTool } from './remove-work.js'
import { makeReorderStatusesTool } from './reorder-statuses.js'
import { makeResumeRecurringTaskTool } from './resume-recurring-task.js'
import { makeRunSavedQueryTool } from './run-saved-query.js'
import { makeSaveMemoTool } from './save-memo.js'
import { makeSearchMemosTool } from './search-memos.js'
import { makeSetMyIdentityTool } from './set-my-identity.js'
import { makeSetVisibilityTool } from './set-visibility.js'
import { makeSkipRecurringTaskTool } from './skip-recurring-task.js'
import type { ContextType, ToolMode } from './types.js'
import { makeUpdateCommentTool } from './update-comment.js'
import { makeUpdateProjectTool } from './update-project.js'
import { makeUpdateSprintTool } from './update-sprint.js'
import { makeUpdateStatusTool } from './update-status.js'
import { makeUpdateTaskRelationTool } from './update-task-relation.js'
import { makeUpdateWorkTool } from './update-work.js'
import { makeWebFetchTool } from './web-fetch.js'

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

function maybeAddAttachmentTools(tools: ToolSet, provider: TaskProvider, contextId: string | undefined): void {
  if (contextId === undefined) return
  if (provider.capabilities.has('attachments.list')) {
    tools['list_attachments'] = makeListAttachmentsTool(provider)
  }
  if (provider.capabilities.has('attachments.upload')) {
    tools['upload_attachment'] = makeUploadAttachmentTool(provider, contextId)
  }
  if (provider.capabilities.has('attachments.delete')) {
    tools['remove_attachment'] = makeRemoveAttachmentTool(provider)
  }
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
    provider.name === 'youtrack' &&
    provider.capabilities.has('tasks.commands') &&
    provider.applyCommand !== undefined
  )
    tools['apply_youtrack_command'] = makeApplyYouTrackCommandTool(provider)
}

function maybeAddCollaborationTaskTools(tools: ToolSet, provider: TaskProvider, chatUserId: string | undefined): void {
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
  if (provider.capabilities.has('tasks.visibility')) {
    tools['set_visibility'] = makeSetVisibilityTool(provider)
  }
}

function addInstructionTools(tools: ToolSet, contextId: string | undefined): void {
  if (contextId === undefined) return
  tools['save_instruction'] = makeSaveInstructionTool(contextId)
  tools['list_instructions'] = makeListInstructionsTool(contextId)
  tools['delete_instruction'] = makeDeleteInstructionTool(contextId)
}

function addWebFetchTool(tools: ToolSet, storageContextId: string | undefined, actorUserId: string | undefined): void {
  if (storageContextId === undefined) return
  tools['web_fetch'] = makeWebFetchTool(storageContextId, actorUserId)
}

function addMemoTools(tools: ToolSet, provider: TaskProvider, userId: string | undefined): void {
  if (userId === undefined) return
  tools['save_memo'] = makeSaveMemoTool(userId)
  tools['search_memos'] = makeSearchMemosTool(userId)
  tools['list_memos'] = makeListMemosTool(userId)
  tools['archive_memos'] = makeArchiveMemosTool(userId)
  tools['promote_memo'] = makePromoteMemoTool(provider, userId)
}

function addRecurringTools(tools: ToolSet, userId: string | undefined): void {
  if (userId === undefined) return
  tools['create_recurring_task'] = makeCreateRecurringTaskTool(userId)
  tools['list_recurring_tasks'] = makeListRecurringTasksTool(userId)
  tools['update_recurring_task'] = makeUpdateRecurringTaskTool(userId)
  tools['pause_recurring_task'] = makePauseRecurringTaskTool()
  tools['resume_recurring_task'] = makeResumeRecurringTaskTool()
  tools['skip_recurring_task'] = makeSkipRecurringTaskTool()
  tools['delete_recurring_task'] = makeDeleteRecurringTaskTool()
}

function addLookupGroupHistoryTool(tools: ToolSet, userId: string | undefined, contextId: string | undefined): void {
  if (userId === undefined || contextId === undefined) return
  if (!contextId.includes(':')) return
  tools['lookup_group_history'] = makeLookupGroupHistoryTool(userId, contextId)
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
  contextType?: ContextType,
  username?: string | null,
): ToolSet {
  const tools = makeCoreTools(provider, chatUserId, contextId)
  maybeAddProjectTools(tools, provider)
  maybeAddCommentTools(tools, provider)
  maybeAddLabelTools(tools, provider)
  maybeAddRelationTools(tools, provider)
  maybeAddStatusTools(tools, provider)
  if (provider.capabilities.has('tasks.delete')) tools['delete_task'] = makeDeleteTaskTool(provider)
  maybeAddCollaborationTaskTools(tools, provider, chatUserId)
  maybeAddAttachmentTools(tools, provider, contextId)
  maybeAddWorkItemTools(tools, provider)
  maybeAddPhaseFiveSprintTools(tools, provider)
  maybeAddPhaseFiveQueryTools(tools, provider, mode)
  if (provider.capabilities.has('tasks.count') && provider.countTasks !== undefined)
    tools['count_tasks'] = makeCountTasksTool(provider)
  addRecurringTools(tools, chatUserId)
  addMemoTools(tools, provider, chatUserId)
  addInstructionTools(tools, contextId)
  addLookupGroupHistoryTool(tools, chatUserId, contextId)
  addWebFetchTool(tools, contextId, chatUserId)
  maybeAddIdentityTools(tools, provider, chatUserId, contextType)
  if (mode === 'normal' && chatUserId !== undefined) {
    const ctxId = contextId ?? chatUserId
    const ctxType = contextType ?? 'dm'
    tools['create_deferred_prompt'] = makeCreateDeferredPromptTool(chatUserId, ctxId, ctxType, username)
    tools['list_deferred_prompts'] = makeListDeferredPromptsTool(chatUserId)
    tools['get_deferred_prompt'] = makeGetDeferredPromptTool(chatUserId)
    tools['update_deferred_prompt'] = makeUpdateDeferredPromptTool(chatUserId)
    tools['cancel_deferred_prompt'] = makeCancelDeferredPromptTool(chatUserId)
  }
  return tools
}
