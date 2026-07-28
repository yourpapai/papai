// tests/platform/scenarios/catalog.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type PlatformStory = { scenarioId: string; title: string; file: string }

const FETCH_CHAT_LINK = 'tests/platform/scenarios/mattermost-fetch-chat-link.platform.ts'
const HTTP_ACTION = 'tests/platform/scenarios/mattermost-http-action.platform.ts'

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
} as const satisfies Record<string, PlatformStory>

export function platformStoryId(story: PlatformStory): string {
  return `${story.file}#${story.title}`
}

export const PLATFORM_STORY_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(PLATFORM_STORIES).map(([scenarioId, story]) => [scenarioId, platformStoryId(story)]),
)
