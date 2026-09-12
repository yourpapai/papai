// tests/operational/scenarios/catalog.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type OperationalStory = { scenarioId: string; title: string; file: string }

const DEFERRED_POLLER_LIFECYCLE = 'tests/operational/scenarios/deferred-poller-lifecycle.operational.ts'

export const OPERATIONAL_STORIES = {
  'SCN-deferred-poller-lifecycle': {
    scenarioId: 'SCN-deferred-poller-lifecycle',
    title: 'starts, runs, and stops deferred pollers without residual scheduler tasks',
    file: DEFERRED_POLLER_LIFECYCLE,
  },
} as const satisfies Record<string, OperationalStory>

export function operationalStoryId(story: OperationalStory): string {
  return `${story.file}#${story.title}`
}

export const OPERATIONAL_STORY_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(OPERATIONAL_STORIES).map(([scenarioId, story]) => [scenarioId, operationalStoryId(story)]),
)
