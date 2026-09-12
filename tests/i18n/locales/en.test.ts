// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { en } from '../../../src/i18n/locales/en.js'
import type { Dictionary } from '../../../src/i18n/types.js'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const subtreeOf = (node: unknown, key: string): Record<string, unknown> => {
  const value = isRecord(node) ? node[key] : undefined
  return isRecord(value) ? value : {}
}

describe('en dictionary', () => {
  test('satisfies the Dictionary type', () => {
    const catalog: Dictionary = en
    expect(catalog).toBe(en)
  })

  test('pins the framework texts it is seeded with', () => {
    expect(en.commands.stop.nothingRunning).toBe('Nothing is running right now.')
    expect(en.commands.stop.stoppingNow).toBe('🛑 Stopping immediately…')
    expect(en.commands.stop.windingDown).toBe('🛑 winding down after this step…')
    expect(en.auth.groupNotAllowed).toBe(
      'This group ({groupId}) is not authorized to use this bot. Ask the bot admin to authorize it in the settings web UI — they can open it with `/config` in a DM.',
    )
    expect(en.auth.groupMemberNotAllowed).toBe(
      "You're not authorized to use this bot in this group. Ask a group admin to add you in the settings web UI — they can open it with `/config` in a DM.",
    )
    expect(en.auth.dmNotAllowed).toBe('You are not authorized to use this bot.')
    expect(en.auth.userBlocked).toBe('You are not authorized to use this bot.')
    expect(en.progress.toolStarted).toBe('Tool `{toolName}` started')
    expect(en.progress.toolFinished).toBe('Tool `{toolName}` {status}')
    expect(en.progress.reasoningHidden).toBe(
      'Provider reasoning available ({count} characters). Enable raw detail to view.',
    )
    expect(en.commands.start.welcome).toContain('Welcome to papai!')
  })

  test('pins announcements.emptyReleaseNote byte-identical to the pre-i18n EMPTY_RELEASE_NOTE constant', () => {
    const announcements = subtreeOf(en, 'announcements')
    expect(announcements['emptyReleaseNote']).toBe(
      'This release is all behind-the-scenes improvements — nothing new to learn.',
    )
  })

  test('pins the liveStatus seed texts byte-identical to the pre-i18n constants', () => {
    const liveStatus = subtreeOf(en, 'liveStatus')
    expect(liveStatus['thinking']).toBe('💭 Thinking…')
    expect(liveStatus['preparingResponse']).toBe('💬 Preparing response…')
    expect(liveStatus['runningTool']).toBe('⚙️ Running {tool}…')
  })

  test('pins liveStatus tool labels to the current REGISTRY labels (emoji and ellipsis excluded)', () => {
    const tools = subtreeOf(subtreeOf(en, 'liveStatus'), 'tools')
    const expectedLabels: Record<string, string> = {
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
    }
    for (const [tool, label] of Object.entries(expectedLabels)) {
      expect(tools[tool]).toBe(label)
    }
  })

  test('pins the contextView chrome byte-identical to the current renderer strings', () => {
    const contextView = subtreeOf(en, 'contextView')
    expect(contextView['headerWord']).toBe('Context')
    expect(contextView['tokensUnit']).toBe('tokens')
    expect(contextView['tokenSuffix']).toBe('tk')
    expect(contextView['approximateMarker']).toBe('(approximate)')
    expect(contextView['approximateFooter']).toBe('token counts are approximate')
  })

  test('pins the contextView sections and detail templates to the current collector strings', () => {
    const contextView = subtreeOf(en, 'contextView')
    const sections = subtreeOf(contextView, 'sections')
    expect(sections['system_prompt']).toBe('System prompt')
    expect(sections['base_instructions']).toBe('Base instructions')
    expect(sections['custom_instructions']).toBe('Custom instructions')
    expect(sections['provider_addendum']).toBe('Provider addendum')
    expect(sections['memory_context']).toBe('Memory context')
    expect(sections['summary']).toBe('Summary')
    expect(sections['known_entities']).toBe('Known entities')
    expect(sections['conversation_history']).toBe('Conversation history')
    expect(sections['tools']).toBe('Tools')
    expect(contextView['factSingular']).toBe('{count} fact')
    expect(contextView['factPaucal']).toBe('{count} facts')
    expect(contextView['factPlural']).toBe('{count} facts')
    expect(contextView['messageSingular']).toBe('{count} message')
    expect(contextView['messagePaucal']).toBe('{count} messages')
    expect(contextView['messagePlural']).toBe('{count} messages')
    expect(contextView['progressiveDisclosure']).toBe(
      '{active} active · {available} available (progressive disclosure)',
    )
  })
})
