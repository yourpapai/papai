// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  clientSurfaceIds,
  focusedServerAreaIds,
  type ClientSurfaceId,
  type FocusedServerAreaId,
} from './architecture-refresh-model.js'
export { dependencyCruiserOptions } from './architecture-refresh-dependency-cruiser-config.mjs'

export const ARCHITECTURE_OUTPUT_DIR = 'docs/architecture'
export const INCLUDED_ROOTS = ['src', 'client'] as const
export const EXCLUDED_PREFIXES = [
  'tests/',
  'scripts/',
  'review-loop/',
  'docs/architecture/',
  'client/stories/',
  'client/assets/',
] as const

const RUNTIME_SOURCE_PATH_PATTERN = /\.(?:js|jsx|svelte|ts|tsx)$/u
const NON_RUNTIME_PATH_PATTERNS = [/\.stories\.[^/]+$/u]
const SHARED_SERVER_AREA_ID = 'shared/runtime' as const
const runtimeServerAreaIds = [...focusedServerAreaIds, SHARED_SERVER_AREA_ID] as const
const runtimeClientSurfaceIds = [...clientSurfaceIds, 'shared'] as const

type RuntimeServerAreaId = (typeof runtimeServerAreaIds)[number]
type RuntimeClientSurfaceId = (typeof runtimeClientSurfaceIds)[number]

const SERVER_AREA_PREFIXES: Readonly<Record<FocusedServerAreaId, readonly string[]>> = {
  chat: ['src/chat/', 'src/bot.ts'],
  'llm-orchestrator': [
    'src/llm-orchestrator',
    'src/system-prompt.ts',
    'src/ai-progress-reporter.ts',
    'src/ai-output-settings.ts',
  ],
  tools: ['src/tools/'],
  'providers/plugins': ['src/providers/', 'src/plugins/'],
  attachments: ['src/attachments/', 'src/bot-attachments.ts'],
  'message-queue': ['src/message-queue/'],
  instances: ['src/instances/'],
  identity: ['src/identity/'],
  'deferred-prompts': ['src/deferred-prompts/', 'src/recurring', 'src/recurrence', 'src/recurring.ts', 'src/scheduler'],
  'memory/memos': ['src/memory', 'src/memos.ts', 'src/history.ts', 'src/conversation.ts'],
  'mcp/web': ['src/mcp/', 'src/web/'],
  'settings/debug': ['src/settings/', 'src/debug/'],
  'stats/usage': ['src/stats/', 'src/usage/'],
}

const SHARED_SERVER_RUNTIME_PREFIXES = [
  'src/announcements.ts',
  'src/auth.ts',
  'src/authorized-groups.ts',
  'src/bot-group-observation.ts',
  'src/bot-reply-tracking.ts',
  'src/cache',
  'src/changelog-reader.ts',
  'src/commands/',
  'src/config-editor/',
  'src/config',
  'src/dashboard-auth/',
  'src/db/',
  'src/embeddings.ts',
  'src/error-analysis.ts',
  'src/errors.ts',
  'src/group-settings/',
  'src/groups.ts',
  'src/index.ts',
  'src/instructions.ts',
  'src/logger.ts',
  'src/message-cache/',
  'src/reply-context.ts',
  'src/reply-typing-heartbeat.ts',
  'src/startup-helpers.ts',
  'src/system-config.ts',
  'src/tool-failure.ts',
  'src/types/',
  'src/users.ts',
  'src/utils/',
] as const

const CLIENT_SURFACE_PREFIXES: Readonly<Record<ClientSurfaceId, readonly string[]>> = {
  settings: ['client/settings/'],
  admin: ['client/admin/'],
  debug: ['client/debug/'],
}

export const FOCUSED_SERVER_AREA_IDS = [...focusedServerAreaIds]
export const CLIENT_SURFACE_IDS = [...clientSurfaceIds]
export const RUNTIME_SERVER_AREA_IDS = [...runtimeServerAreaIds]
export const RUNTIME_CLIENT_SURFACE_IDS = [...runtimeClientSurfaceIds]

export const isArchitectureRuntimePath = (relativePath: string): boolean => {
  if (!INCLUDED_ROOTS.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))) {
    return false
  }

  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    return false
  }

  return (
    RUNTIME_SOURCE_PATH_PATTERN.test(relativePath) &&
    !NON_RUNTIME_PATH_PATTERNS.some((pattern) => pattern.test(relativePath))
  )
}

export const slugForArea = (areaId: string): string => areaId.replaceAll('/', '-')

export const serverAreaForPath = (relativePath: string): RuntimeServerAreaId | null => {
  for (const areaId of focusedServerAreaIds) {
    if (SERVER_AREA_PREFIXES[areaId].some((prefix) => relativePath.startsWith(prefix))) {
      return areaId
    }
  }

  if (
    isArchitectureRuntimePath(relativePath) &&
    SHARED_SERVER_RUNTIME_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
  ) {
    return SHARED_SERVER_AREA_ID
  }

  return null
}

export const clientSurfaceForPath = (relativePath: string): RuntimeClientSurfaceId | null => {
  for (const surfaceId of clientSurfaceIds) {
    if (CLIENT_SURFACE_PREFIXES[surfaceId].some((prefix) => relativePath.startsWith(prefix))) {
      return surfaceId
    }
  }

  if (relativePath.startsWith('client/shared/') && isArchitectureRuntimePath(relativePath)) {
    return 'shared'
  }

  return null
}
