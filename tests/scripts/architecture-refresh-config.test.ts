// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  CLIENT_SURFACE_IDS,
  FOCUSED_SERVER_AREA_IDS,
  clientSurfaceForPath,
  isArchitectureRuntimePath,
  serverAreaForPath,
  slugForArea,
} from '../../scripts/architecture-refresh-config.js'

describe('architecture refresh config', () => {
  test('includes src and client runtime files, but excludes non-runtime paths', () => {
    expect(isArchitectureRuntimePath('src/chat/router.ts')).toBe(true)
    expect(isArchitectureRuntimePath('client/settings/App.svelte')).toBe(true)
    expect(isArchitectureRuntimePath('client/stories/Button.stories.svelte')).toBe(false)
    expect(isArchitectureRuntimePath('tests/scripts/run-semgrep.test.ts')).toBe(false)
    expect(isArchitectureRuntimePath('scripts/build-client.ts')).toBe(false)
    expect(isArchitectureRuntimePath('docs/architecture/overview.md')).toBe(false)
  })

  test('maps fixed server areas to stable slugs', () => {
    expect(FOCUSED_SERVER_AREA_IDS).toEqual([
      'chat',
      'llm-orchestrator',
      'tools',
      'providers/plugins',
      'attachments',
      'message-queue',
      'instances',
      'identity',
      'deferred-prompts',
      'memory/memos',
      'mcp/web',
      'settings/debug',
      'stats/usage',
    ])
    expect(slugForArea('providers/plugins')).toBe('providers-plugins')
    expect(slugForArea('memory/memos')).toBe('memory-memos')
  })

  test('classifies representative server and client paths', () => {
    expect(serverAreaForPath('src/chat/router.ts')).toBe('chat')
    expect(serverAreaForPath('src/llm-orchestrator.ts')).toBe('llm-orchestrator')
    expect(serverAreaForPath('src/tools/tools-builder.ts')).toBe('tools')
    expect(serverAreaForPath('src/debug/settings/server.ts')).toBe('settings/debug')

    expect(CLIENT_SURFACE_IDS).toEqual(['settings', 'admin', 'debug'])
    expect(clientSurfaceForPath('client/settings/App.svelte')).toBe('settings')
    expect(clientSurfaceForPath('client/admin/AdminApp.svelte')).toBe('admin')
    expect(clientSurfaceForPath('client/debug/DebugApp.svelte')).toBe('debug')
  })
})
