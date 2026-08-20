// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/platform/scenarios/catalog.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type PlatformStory = { scenarioId: string; title: string; file: string }

const FETCH_CHAT_LINK = 'tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts'
const HTTP_ACTION = 'tests/platform/scenarios/mattermost-http-action.platform.ts'
const DISCORD_INTERACTIONS = 'tests/platform/scenarios/discord-interactions.platform.ts'
const DISCORD_CALLBACK_ROUTING = 'tests/platform/scenarios/discord-callback-routing.platform.ts'
const DISCORD_REPLY_MENTION = 'tests/platform/scenarios/discord-reply-mention.platform.ts'
const DISCORD_LIVE_STATUS = 'tests/platform/scenarios/discord-live-status.platform.ts'
const KONTUR_TALK_REPLIES = 'tests/platform/scenarios/kontur-talk-replies.platform.ts'
const TELEGRAM_ADMIN_AUTHORIZATION = 'tests/platform/scenarios/telegram-admin-authorization.platform.ts'
const TELEGRAM_CALLBACK_ROUTING = 'tests/platform/scenarios/telegram-callback-routing.platform.ts'

export const PLATFORM_STORIES = {
  'SCN-fetch-chat-link': {
    scenarioId: 'SCN-fetch-chat-link',
    title: 'resolves a Mattermost permalink thread through fetch_chat_link against a fake server',
    file: FETCH_CHAT_LINK,
  },
  'SCN-http-mattermost-action': {
    scenarioId: 'SCN-http-mattermost-action',
    title: 'verifies a signed action context and dispatches over POST /mattermost/actions',
    file: HTTP_ACTION,
  },
  'SCN-http-mattermost-action-bad-signature': {
    scenarioId: 'SCN-http-mattermost-action-bad-signature',
    title: 'rejects a context signed with the wrong secret (seam gates)',
    file: HTTP_ACTION,
  },
  'SCN-interaction-discord-command-routing': {
    scenarioId: 'SCN-interaction-discord-command-routing',
    title: 'routes a Discord command through the provider adapter',
    file: DISCORD_INTERACTIONS,
  },
  'SCN-interaction-discord-format-chunking': {
    scenarioId: 'SCN-interaction-discord-format-chunking',
    title: 'splits oversized formatted Discord replies into balanced chunks',
    file: DISCORD_INTERACTIONS,
  },
  'SCN-interaction-discord-response-lifecycle': {
    scenarioId: 'SCN-interaction-discord-response-lifecycle',
    title: 'preserves the Discord interaction response lifecycle after defer failure',
    file: DISCORD_INTERACTIONS,
  },
  'SCN-interaction-discord-reply-mention': {
    scenarioId: 'SCN-interaction-discord-reply-mention',
    title: 'dispatches a reply to a bot message exactly as an explicit Discord mention',
    file: DISCORD_REPLY_MENTION,
  },
  'SCN-interaction-discord-status-lifecycle': {
    scenarioId: 'SCN-interaction-discord-status-lifecycle',
    title: 'creates, updates in order, and dismisses the Discord live status',
    file: DISCORD_LIVE_STATUS,
  },
  'SCN-interaction-discord-status-send-failure': {
    scenarioId: 'SCN-interaction-discord-status-send-failure',
    title: 'delivers the reply without status edits when the Discord status send fails',
    file: DISCORD_LIVE_STATUS,
  },
  'SCN-interaction-kontur-reply-formatting': {
    scenarioId: 'SCN-interaction-kontur-reply-formatting',
    title: 'formats Kontur Talk replies with thread overrides',
    file: KONTUR_TALK_REPLIES,
  },
  'SCN-interaction-telegram-admin-authorization': {
    scenarioId: 'SCN-interaction-telegram-admin-authorization',
    title: 'authorizes Telegram group admins through the Bot API',
    file: TELEGRAM_ADMIN_AUTHORIZATION,
  },
  'SCN-interaction-discord-router-wrapped': {
    scenarioId: 'SCN-interaction-discord-router-wrapped',
    title: 'routes a Discord permission callback through ChatRouter and production setupBot',
    file: DISCORD_CALLBACK_ROUTING,
  },
  'SCN-interaction-discord-standalone-fallback': {
    scenarioId: 'SCN-interaction-discord-standalone-fallback',
    title: 'defers an unmatched Discord callback to the standalone message fallback',
    file: DISCORD_CALLBACK_ROUTING,
  },
  'SCN-interaction-telegram-callback': {
    scenarioId: 'SCN-interaction-telegram-callback',
    title: 'routes a Telegram permission callback through ChatRouter and production setupBot',
    file: TELEGRAM_CALLBACK_ROUTING,
  },
} as const satisfies Record<string, PlatformStory>

export function platformStoryId(story: PlatformStory): string {
  return `${story.file}#${story.title}`
}

export const PLATFORM_STORY_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_STORIES).map(([scenarioId, story]) => [scenarioId, platformStoryId(story)]),
)

export const PLATFORM_COVERAGE_FILES: readonly string[] = [
  'src/chat/discord/commands.ts',
  'src/chat/discord/format-chunking.ts',
  'src/chat/discord/interaction-helpers.ts',
  'src/chat/kontur-talk/reply-helpers.ts',
  'src/chat/telegram/admin-helpers.ts',
  'src/chat/discord/button-dispatch.ts',
  'src/chat/telegram/interaction-helpers.ts',
  'src/chat/router-helpers.ts',
]
