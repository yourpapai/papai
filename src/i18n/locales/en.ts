// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dictionary } from '../types.js'

/** English catalog — the authoritative seed of the framework texts. */
export const en: Dictionary = {
  commands: {
    start: {
      welcome: `👋 **Welcome to papai!**

I'm your task management assistant. I can help you:

📋 **Create and manage tasks** via natural language
🔍 **Search and update** existing tasks
⚙️ **Configure integrations** with your task tracker

**Get Started:**
⚙️ **/config** - Open your settings (API keys, models, integrations) in the web UI
❓ **/help** - Show available commands

**Quick Tips:**
• Type your requests naturally (e.g., "create task: review PR #123")
• I'll remember our conversation context
• Use "/clear" to reset conversation history

Let's get you set up! 🎯`,
    },
    stop: {
      nothingRunning: 'Nothing is running right now.',
      stoppingNow: '🛑 Stopping immediately…',
      windingDown: '🛑 winding down after this step…',
    },
  },
  auth: {
    groupNotAllowed:
      'This group ({groupId}) is not authorized to use this bot. Ask the bot admin to authorize it in the settings web UI — they can open it with `/config` in a DM.',
    groupMemberNotAllowed:
      "You're not authorized to use this bot in this group. Ask a group admin to add you in the settings web UI — they can open it with `/config` in a DM.",
    dmNotAllowed: 'You are not authorized to use this bot.',
    userBlocked: 'You are not authorized to use this bot.',
  },
  progress: {
    toolStarted: 'Tool `{toolName}` started',
    toolFinished: 'Tool `{toolName}` {status}',
    statusSuccess: 'success',
    statusFailed: 'failed',
    durationSuffix: ' in {durationMs}ms',
    inputLabel: 'Input:',
    outputLabel: 'Output:',
    errorLabel: 'Error:',
    reasoningTitle: 'Reasoning',
    reasoningHidden: 'Provider reasoning available ({count} characters). Enable raw detail to view.',
  },
  picker: {
    prompt: 'Choose the language I will talk to you in:',
    english: 'English',
    russian: 'Русский',
    saved: 'Language saved.',
  },
}
