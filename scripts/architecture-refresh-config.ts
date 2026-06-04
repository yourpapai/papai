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

export const ARCHITECTURE_OUTPUT_DIR = 'docs/architecture'
export const INCLUDED_ROOTS = ['src', 'client'] as const
export const EXCLUDED_PREFIXES = [
  'tests/',
  'scripts/',
  'review-loop/',
  'docs/architecture/',
  'client/stories/',
] as const

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

const CLIENT_SURFACE_PREFIXES: Readonly<Record<ClientSurfaceId, readonly string[]>> = {
  settings: ['client/settings/'],
  admin: ['client/admin/'],
  debug: ['client/debug/'],
}

export const dependencyCruiserOptions = {
  tsConfig: 'tsconfig.json',
  exclude: { path: ['^tests/', '^review-loop/', '^docs/architecture/', '^client/stories/'] },
  doNotFollow: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'] },
  includeOnly: { path: ['^src/', '^client/'] },
}

export const FOCUSED_SERVER_AREA_IDS = [...focusedServerAreaIds]
export const CLIENT_SURFACE_IDS = [...clientSurfaceIds]

export const isArchitectureRuntimePath = (relativePath: string): boolean => {
  if (!INCLUDED_ROOTS.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))) {
    return false
  }

  return !EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
}

export const slugForArea = (areaId: string): string => areaId.replaceAll('/', '-')

export const serverAreaForPath = (relativePath: string): FocusedServerAreaId | null => {
  for (const areaId of focusedServerAreaIds) {
    if (SERVER_AREA_PREFIXES[areaId].some((prefix) => relativePath.startsWith(prefix))) {
      return areaId
    }
  }

  return null
}

export const clientSurfaceForPath = (relativePath: string): ClientSurfaceId | null => {
  for (const surfaceId of clientSurfaceIds) {
    if (CLIENT_SURFACE_PREFIXES[surfaceId].some((prefix) => relativePath.startsWith(prefix))) {
      return surfaceId
    }
  }

  return null
}
