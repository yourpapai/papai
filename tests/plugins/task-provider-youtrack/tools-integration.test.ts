// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { YouTrackConfig } from '../../../plugins/task-provider-youtrack/client.js'
import { YouTrackProvider } from '../../../plugins/task-provider-youtrack/provider.js'
import { makeTools } from '../../../src/tools/index.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

const createConfig = (): YouTrackConfig => ({
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
})

const EXPECTED_TOOLS = [
  'create_task',
  'get_task',
  'update_task',
  'list_tasks',
  'search_tasks',
  'find_user',
  'get_current_user',
  'count_tasks',
  'get_project',
  'list_projects',
  'create_project',
  'update_project',
  'delete_project',
  'list_project_team',
  'add_project_member',
  'remove_project_member',
  'add_comment',
  'get_comments',
  'update_comment',
  'remove_comment',
  'add_comment_reaction',
  'remove_comment_reaction',
  'list_labels',
  'create_label',
  'update_label',
  'remove_label',
  'add_task_label',
  'remove_task_label',
  'add_task_relation',
  'update_task_relation',
  'remove_task_relation',
  'list_watchers',
  'add_watcher',
  'remove_watcher',
  'add_vote',
  'remove_vote',
  'set_visibility',
  'list_statuses',
  'create_status',
  'update_status',
  'delete_status',
  'reorder_statuses',
  'list_agiles',
  'list_sprints',
  'create_sprint',
  'update_sprint',
  'assign_task_to_sprint',
  'get_task_history',
  'list_saved_queries',
  'run_saved_query',
  'apply_youtrack_command',
  'get_current_time',
  'delete_task',
  'list_attachments',
  'upload_attachment',
  'remove_attachment',
  'list_work',
  'log_work',
  'update_work',
  'remove_work',
  'save_memo',
  'search_memos',
  'list_memos',
  'archive_memos',
  'promote_memo',
  'save_instruction',
  'list_instructions',
  'delete_instruction',
  'web_fetch',
  'create_deferred_prompt',
  'list_deferred_prompts',
  'get_deferred_prompt',
  'update_deferred_prompt',
  'cancel_deferred_prompt',
  'create_recurring_task',
  'list_recurring_tasks',
  'update_recurring_task',
  'pause_recurring_task',
  'resume_recurring_task',
  'skip_recurring_task',
  'delete_recurring_task',
] as const

describe('YouTrack provider tools integration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('makeTools exposes the expected YouTrack tool surface', async () => {
    const provider = new YouTrackProvider(createConfig())
    const tools = await makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
    const toolNames = Object.keys(tools).toSorted()

    for (const expected of EXPECTED_TOOLS) {
      expect(toolNames).toContain(expected)
    }

    for (const name of toolNames) {
      expect(tools[name]).toBeDefined()
      expect(typeof tools[name]!.execute).toBe('function')
    }
  })
})
