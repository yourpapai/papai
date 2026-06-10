// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { isS3Configured } from '../attachments/index.js'
import type { StagedFileDownloadFn } from '../attachments/types.js'
import { getConfigContextIdFromStorageContextId, hasThreadContextId } from '../chat/scoped-context.js'
import type { ContextType } from '../chat/types.js'
import { makeArchiveMemosTool } from './archive-memos.js'
import { makeExpandResultTool } from './compaction/expand-result.js'
import { makeCreateRecurringTaskTool } from './create-recurring-task.js'
import { addDeferredPromptTools } from './deferred-tools-builder.js'
import { makeDeleteRecurringTaskTool } from './delete-recurring-task.js'
import { resolveReductionFlags } from './feature-flags.js'
import { makeGetCurrentTimeTool } from './get-current-time.js'
import { makeDeleteInstructionTool, makeListInstructionsTool, makeSaveInstructionTool } from './instructions.js'
import { makeListMemosTool } from './list-memos.js'
import { makeListRecurringTasksTool } from './list-recurring-tasks.js'
import { makeLookupGroupHistoryTool } from './lookup-group-history.js'
import { makePauseRecurringTaskTool } from './pause-recurring-task.js'
import { makeUpdateRecurringTaskTool } from './recurring-tools.js'
import { makeResumeRecurringTaskTool } from './resume-recurring-task.js'
import { makeSaveMemoTool } from './save-memo.js'
import { makeSearchMemosTool } from './search-memos.js'
import { makeSkipRecurringTaskTool } from './skip-recurring-task.js'
import { makeResolveStagedFileTool, makeSearchStagedFilesTool } from './staged-tools.js'
import type { ToolMode } from './types.js'
import { makeWebFetchTool } from './web-fetch.js'
import { makeDeleteFileTool, makeListFilesTool } from './workspace-files.js'

export function getStorageOwnerId(chatUserId: string | undefined, contextId: string | undefined): string | undefined {
  if (contextId === undefined) return chatUserId
  return getConfigContextIdFromStorageContextId(contextId)
}

function addMemoTools(tools: ToolSet, userId: string | undefined): void {
  if (userId === undefined) return
  tools['save_memo'] = makeSaveMemoTool(userId)
  tools['search_memos'] = makeSearchMemosTool(userId)
  tools['list_memos'] = makeListMemosTool(userId)
  tools['archive_memos'] = makeArchiveMemosTool(userId)
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

function addInstructionTools(tools: ToolSet, contextId: string | undefined): void {
  if (contextId === undefined) return
  tools['save_instruction'] = makeSaveInstructionTool(contextId)
  tools['list_instructions'] = makeListInstructionsTool(contextId)
  tools['delete_instruction'] = makeDeleteInstructionTool(contextId)
}

function addLookupGroupHistoryTool(tools: ToolSet, userId: string | undefined, contextId: string | undefined): void {
  if (userId === undefined || contextId === undefined) return
  if (!hasThreadContextId(contextId)) return
  tools['lookup_group_history'] = makeLookupGroupHistoryTool(userId, contextId)
}

type AddProviderIndependentToolsOptions = Readonly<{
  chatUserId: string | undefined
  contextId: string | undefined
  mode: ToolMode
  contextType: ContextType | undefined
  username: string | null | undefined
  stagedDownloadFn: StagedFileDownloadFn | undefined
  allowTaskDependentDeferredPrompts?: boolean
}>

export function addProviderIndependentTools(tools: ToolSet, options: AddProviderIndependentToolsOptions): void {
  const { chatUserId, contextId, mode, contextType, username, stagedDownloadFn } = options
  const storageOwnerId = getStorageOwnerId(chatUserId, contextId)

  tools['get_current_time'] = makeGetCurrentTimeTool(storageOwnerId)
  if (contextId !== undefined && resolveReductionFlags(contextId).resultCompaction) {
    tools['expand_result'] = makeExpandResultTool(contextId)
  }
  if (contextId !== undefined && isS3Configured()) {
    tools['list_files'] = makeListFilesTool(contextId)
    tools['delete_file'] = makeDeleteFileTool(contextId)
    tools['search_staged_files'] = makeSearchStagedFilesTool(contextId)
    if (stagedDownloadFn !== undefined) {
      tools['resolve_staged_file'] = makeResolveStagedFileTool(contextId, stagedDownloadFn)
    }
  }
  addRecurringTools(tools, storageOwnerId)
  addMemoTools(tools, storageOwnerId)
  addInstructionTools(tools, storageOwnerId)
  addLookupGroupHistoryTool(tools, chatUserId, contextId)
  if (contextId !== undefined) tools['web_fetch'] = makeWebFetchTool(contextId, storageOwnerId, contextType)
  if (mode === 'normal' && storageOwnerId !== undefined) {
    addDeferredPromptTools(
      tools,
      storageOwnerId,
      chatUserId,
      contextId,
      contextType,
      username,
      options.allowTaskDependentDeferredPrompts ?? true,
    )
  }
}
