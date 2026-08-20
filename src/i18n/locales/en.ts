// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dictionary } from '../types.js'
import { enSystemPrompt } from './en-system-prompt.js'

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
    help: {
      dmUser: [
        'papai — AI assistant for Kaneo task management',
        '',
        'Commands:',
        '/help — Show this message',
        '/config — Open your settings in the web UI (single-use link)',
        '/clear — Clear conversation history and memory',
        '/context — Show current memory context (summary and known entities)',
        '/stop — Stop or steer the running task (send again to stop immediately)',
        '',
        'Any other message is sent to the AI assistant.',
      ].join('\n'),
      dmAdmin: [
        '',
        'Admin commands:',
        "/clear <user_id> — Clear a specific user's history",
        "/clear all — Clear all users' history",
        '/dashboard — Open the operator dashboard (single-use link)',
        '',
        'Authorized users, groups, plugins, and announcements are managed in the web UI — open /config.',
      ].join('\n'),
      groupUser: [
        'papai — AI assistant for Kaneo task management',
        '',
        'Group commands:',
        '/help — Show this message',
        '/context — Show current memory context',
        '/clear — Clear group conversation history',
        '',
        'Mention me with @botname for natural language queries',
      ].join('\n'),
      groupAdmin: [
        '',
        'Group settings, membership, and authorization are configured in the web UI.',
        'Open a DM with me and run /config.',
      ].join('\n'),
      mentionHint: 'Use {helpCommand} to see commands, or mention me with a question.',
    },
    clear: {
      selfCleared: 'Conversation history, memory, and facts cleared.',
      allCleared: 'Cleared history, memory, and facts for all {count} users.',
      userCleared: 'Cleared history, memory, and facts for user {userId}.',
      onlyGroupAdmins: 'Only group admins can run this command.',
      onlyAdminOtherUsers: "Only the admin can clear other users' history.",
      targetNotAuthorized: 'Target user is not authorized on this platform.',
    },
    config: {
      groupRedirect:
        'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.',
      groupAdminOnly:
        'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
      notConfigured:
        'The settings UI is not configured on this deployment. Ask the administrator to set SETTINGS_PUBLIC_BASE_URL.',
      linkIssued:
        '🔧 Open your settings: {url}\n\n⚠️ This link is single-use and expires in 10 minutes. Do not share it.',
      rateLimited: 'Too many settings links requested. Please try again in {minutes} minute(s).',
    },
    context: {
      buildFailed: 'Sorry — could not build context view right now.',
    },
    dashboard: {
      dmOnly: 'Open this in a DM with me — `/dashboard` is DM-only.',
      adminOnly: 'Only bot admins can claim a dashboard session.',
      disabled: 'The dashboard is disabled on this deployment (DEBUG_SERVER is not enabled).',
      userIdMissing: 'Could not identify the requesting user.',
      issueFailed: 'Could not issue a sign-in link. Please try again.',
      claimLink:
        'Open this link, then press "Sign in" on the page:\n\n{url}\n\nLink expires in {ttlMinutes} min and can be used once.',
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
  steer: {
    ack: '✋ folding that into the current run…',
  },
  messageEdit: {
    promptEditLine: 'Your edit: "{editedText}".',
    adjustButton: 'Adjust for me',
    noteButton: 'Just note it',
    adjustingAck: '✏️ Adjusting…',
    notedAck: '✏️ Noted',
    superseded: '⟲ Superseded by your edit.',
  },
  orchestrator: {
    toolFailed: '⚠️ Tool "{toolName}" failed: {userMessage}',
    apiCallFailed: 'API call failed. Please try again.',
    unexpectedError: 'An unexpected error occurred. Please try again later.',
    missingConfig: 'Missing configuration: {missing}.\nUse /config to finish setup in the settings web UI.',
    botMisconfigured:
      '⚠️ The bot is not fully configured. Ask the administrator to run /config and complete setup in the web UI.',
    byokIncomplete:
      'BYOK is enabled for this context, but LLM setup is incomplete. Missing: {missing}. Use /config to finish BYOK setup in the settings web UI.',
    byokUnreadable:
      'BYOK credentials for this context are unreadable. Use /config to re-enter the BYOK LLM credentials in the settings web UI.',
    stopSummaryHead: '🛑 Stopped.',
    stopSummaryHeadForced: '🛑 Stopped immediately.',
    stopSummaryNoActions: 'No actions had been taken yet.',
    stopSummaryDoneOne: 'Completed {count} action: {list}.',
    stopSummaryDoneMany: 'Completed {count} actions: {list}.',
    stopSummaryForcedTail: 'An in-flight action may have been cut off — verify recent changes.',
  },
  interactions: {
    actionFailed: '❌ Something went wrong processing your action. Please try again.',
    staleAction: 'Action is no longer available.',
    allowedTool: 'Allowed {toolName} ✅',
    deniedTool: 'Denied {toolName} 🚫',
    expiredDenied: '⌛ Expired — denied.',
    permissionPrompt: '🔐 Run `{toolName}`?',
    argumentsLabel: '**Arguments:**',
    allowButton: '✅ Allow',
    denyButton: '🚫 Deny',
  },
  announcements: {
    adminNotice:
      '🆕 papai v{version} is ready to announce!\n\n{body}\n\n_Review and broadcast to subscribers in Settings → Release notes._',
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
  errors: {
    llm: {
      apiError: 'AI service error: {message}. Please try again.',
      rateLimited: 'AI service rate limit reached. Please wait a moment and try again.',
      timeout: 'AI service request timed out. Please try again.',
      tokenLimit: 'Message is too long. Please shorten your request and try again.',
      fallback: 'An AI service error occurred. Please try again later.',
    },
    validation: {
      invalidInput: 'Invalid {field}: {reason}',
      missingRequired: 'Missing required field: {field}',
      fallback: 'Invalid input provided.',
    },
    system: {
      configMissing:
        'Configuration error: {variable} is not set. Please use /config to finish setup in the settings web UI.',
      networkError: 'Network error: {message}. Please check your connection and try again.',
      unexpected: 'An unexpected error occurred. Please try again later.',
    },
    webFetch: {
      invalidUrl: `That URL doesn't look valid.`,
      blockedHost: `I can't fetch that address because it isn't on the public web.`,
      blockedContentType: `That content type isn't supported.`,
      tooLarge: `That page is too large for me to read safely.`,
      timeout: `Fetching that page took too long.`,
      rateLimited: `You're fetching URLs too quickly. Please try again in a moment.`,
      extractFailed: `I couldn't extract readable content from that page.`,
      upstreamError: `The site returned an error.`,
      fallback: `I couldn't fetch that page.`,
    },
    provider: {
      taskNotFound: 'Task "{taskId}" was not found. Please check the task ID and try again.',
      projectNotFound: 'Project "{projectId}" was not found.',
      workspaceNotFound: 'Workspace configuration error. Please check your workspace settings.',
      commentNotFound: 'Comment "{commentId}" was not found.',
      labelNotFound: 'Label "{labelName}" was not found. Use list_labels to see available labels.',
      relationNotFound: 'Relation between tasks "{taskId}" and "{relatedTaskId}" was not found.',
      notFound: '{resourceType} "{resourceId}" was not found.',
      accessDenied:
        "You don't have access to {resource}. You need to be a member of it (or it must be a public channel) for me to read it.",
      authFailed: 'Failed to connect to the task tracker. Please check your API key.',
      rateLimited: 'API rate limit reached. Please wait a moment and try again.',
      validationFailed: 'Invalid {field}: {reason}',
      workflowPrefixKnown: 'The project workflow blocked this request in project "{projectId}"',
      workflowPrefixUnknown: 'The project workflow blocked this request',
      workflowValidationNoFields: '{prefix}: {message}.',
      workflowValidationWithFields: '{prefix}: {message}. Required fields: {fields}.',
      unsupportedOperation: 'Operation "{operation}" is not supported by this provider.',
      statusNotFound: 'Status "{statusName}" is not recognised. Available statuses: {available}.',
      linkTypeNotFound: 'Link type "{linkTypeName}" was not recognised. Available link types: {available}.',
      invalidResponse: 'The task tracker returned an unexpected response. Please try again.',
      fallback: 'Task tracker API error occurred. Please try again later.',
    },
    toolFailure: {
      providerScopeMissing: 'That action failed: an internal analytics scope was missing. Please try again.',
      actionFailed: 'That action failed: {errorMessage}.',
      interrupted: `That action did not finish cleanly.`,
    },
  },
  systemPrompt: enSystemPrompt,
  completion: {
    verifierSystem: `You are finalizing an assistant turn in a task-management chat bot.
The conversation so far — including the tools the assistant just called and their results — is provided.
Determine whether the user's most recent request was actually carried out, then write ONE short reply to the user.
Rules:
- Reply in the same language the user used.
- Be truthful. Never claim something succeeded unless the tool results (or a read-back) confirm it.
- You MAY call read-only tools to re-check current state before answering. Never attempt to change anything.
- If a tool failed, tell the user plainly what did not work.
{rule}
Output only the user-facing reply text, nothing else.`,
    verifierSummarizeRule: '- Summarize what was done, naming the affected item(s).',
    verifierTruncatedRule:
      '- This turn did a lot of work but ran out of room before fully finishing. Summarize what was completed (naming the affected item(s)) and briefly what remains. Do not apologize or dwell on limits; you may offer that the user can say "continue" if they want you to pick up where you left off.',
    neutralFallback: 'I ran the requested actions but could not confirm the result — please double-check.',
    finalizeMessage: '[FINALIZE] Write the reply now, following your instructions.',
    doneFallback: 'Done.',
  },
}
