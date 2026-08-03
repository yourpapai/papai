// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/smoke/scenarios/catalog.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type SmokeStory = { scenarioId: string; title: string; file: string }

const CONTAINER_P = 'tests/smoke/scenarios/container-p.smoke.ts'
const CONTAINER_D = 'tests/smoke/scenarios/container-d.smoke.ts'
const CONTAINER_E = 'tests/smoke/scenarios/container-e.smoke.ts'

export const SMOKE_STORIES = {
  'SCN-boot-serve-empty-db': {
    scenarioId: 'SCN-boot-serve-empty-db',
    title: 'boots, migrates an empty DB, and serves GET /settings with 200',
    file: CONTAINER_P,
  },
  'SCN-required-env-admin': {
    scenarioId: 'SCN-required-env-admin',
    title: 'exits 1 and logs the missing-required-env message when ADMIN_USER_ID is blank',
    file: CONTAINER_E,
  },
  'SCN-debug-surface-gated-off': {
    scenarioId: 'SCN-debug-surface-gated-off',
    title: 'returns 404 for GET /debug when DEBUG_SERVER is unset',
    file: CONTAINER_P,
  },
  'SCN-debug-surface-gated-on': {
    scenarioId: 'SCN-debug-surface-gated-on',
    title: 'returns 401 for GET /debug when DEBUG_SERVER is true',
    file: CONTAINER_D,
  },
  'SCN-protected-surfaces-bind': {
    scenarioId: 'SCN-protected-surfaces-bind',
    title: 'serves 401 for unauthenticated mcp, admin, and recurring surfaces',
    file: CONTAINER_P,
  },
  'SCN-plugin-registry-served': {
    scenarioId: 'SCN-plugin-registry-served',
    title: 'serves the shipped plugin set to an authenticated settings session',
    file: CONTAINER_P,
  },
  'SCN-chat-turn-tool-loop': {
    scenarioId: 'SCN-chat-turn-tool-loop',
    title: 'runs one full chat turn through the disclosure tool loop and posts a reply',
    file: CONTAINER_P,
  },
  'SCN-graceful-shutdown': {
    scenarioId: 'SCN-graceful-shutdown',
    title: 'drains and exits 0 on SIGTERM',
    file: CONTAINER_P,
  },
} as const satisfies Record<string, SmokeStory>

export function smokeStoryId(story: SmokeStory): string {
  return `${story.file}#${story.title}`
}

export const SMOKE_STORY_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(SMOKE_STORIES).map(([scenarioId, story]) => [scenarioId, smokeStoryId(story)]),
)
