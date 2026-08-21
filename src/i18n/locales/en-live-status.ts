// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dictionary } from '../types.js'

/** English live-status texts; split out of `en.ts` to keep catalog files small. */
export const enLiveStatus: Dictionary['liveStatus'] = {
  thinking: '💭 Thinking…',
  preparingResponse: '💬 Preparing response…',
  runningTool: '⚙️ Running {tool}…',
  tools: {
    web_fetch: 'Fetching',
    fetch_chat_link: 'Reading link',
    search_memory: 'Searching memory',
    list_memory: 'Recalling memory',
    remember_memory: 'Saving a memory',
    search_memos: 'Searching memos',
    save_memo: 'Saving a memo',
    list_memos: 'Listing memos',
    create_task: 'Creating task',
    update_task: 'Updating task',
    delete_task: 'Deleting task',
    get_task: 'Reading task',
    list_tasks: 'Listing tasks',
    search_tasks: 'Searching tasks',
    count_tasks: 'Counting tasks',
    add_comment: 'Adding a comment',
    create_project: 'Creating project',
    list_projects: 'Listing projects',
    list_files: 'Listing files',
    search_staged_files: 'Searching files',
    upload_attachment: 'Attaching a file',
    resolve_staged_file: 'Attaching a file',
    create_recurring_task: 'Scheduling a recurring task',
    create_reminder: 'Setting up a reminder',
    create_alert: 'Setting up an alert',
    list_reminders: 'Listing reminders and alerts',
    get_reminder: 'Reading reminder details',
    update_reminder: 'Updating reminder',
    cancel_reminder: 'Cancelling reminder',
    lookup_group_history: 'Checking history',
    find_user: 'Looking up a user',
    get_current_time: 'Checking the time',
  },
}
