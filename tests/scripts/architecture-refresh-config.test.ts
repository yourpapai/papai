// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { Glob } from 'bun'

import dependencyCruiserConfig from '../../.dependency-cruiser.mjs'
import {
  CLIENT_SURFACE_IDS,
  FOCUSED_SERVER_AREA_IDS,
  RUNTIME_CLIENT_SURFACE_IDS,
  RUNTIME_SERVER_AREA_IDS,
  clientSurfaceForPath,
  dependencyCruiserOptions,
  isArchitectureRuntimePath,
  serverAreaForPath,
  slugForArea,
} from '../../scripts/architecture-refresh-config.js'

describe('architecture refresh config', () => {
  test('loads the dependency-cruiser config under plain Node ESM semantics', () => {
    const result = Bun.spawnSync({
      cmd: ['node', '--input-type=module', '--eval', "await import('./.dependency-cruiser.mjs')"],
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    })

    expect(result.exitCode).toBe(0)
  })

  test('shares one dependency-cruiser options object across TS and Node entrypoints', () => {
    expect(dependencyCruiserConfig.options).toBe(dependencyCruiserOptions)
  })

  test('runs depcruise successfully with the checked-in config', () => {
    const result = Bun.spawnSync({
      cmd: ['bunx', 'depcruise', '--config', '.dependency-cruiser.mjs', '--output-type', 'err-long', 'src', 'client'],
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    })

    expect(result.exitCode).toBe(0)
  }, 20_000)

  test('runs the public architecture:refresh script entrypoint successfully', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'architecture:refresh'],
      cwd: process.cwd(),
      stderr: 'pipe',
      stdout: 'pipe',
    })

    expect(result.exitCode).toBe(0)
  }, 20_000)

  test('includes src and client runtime files, but excludes non-runtime paths', () => {
    expect(isArchitectureRuntimePath('src/chat/router.ts')).toBe(true)
    expect(isArchitectureRuntimePath('client/settings/App.svelte')).toBe(true)
    expect(isArchitectureRuntimePath('src/index.ts')).toBe(true)
    expect(isArchitectureRuntimePath('src/group-settings/registry.ts')).toBe(true)
    expect(isArchitectureRuntimePath('client/shared/Modal.svelte')).toBe(true)
    expect(isArchitectureRuntimePath('client/assets/design-canvas.jsx')).toBe(false)
    expect(isArchitectureRuntimePath('client/settings/theme.css')).toBe(false)
    expect(isArchitectureRuntimePath('client/stories/Button.stories.svelte')).toBe(false)
    expect(isArchitectureRuntimePath('client/admin/AdminApp.stories.svelte')).toBe(false)
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
    expect(serverAreaForPath('src/index.ts')).toBe('shared/runtime')
    expect(serverAreaForPath('src/group-settings/registry.ts')).toBe('shared/runtime')
    expect(serverAreaForPath('src/cache.ts')).toBe('shared/runtime')
    expect(serverAreaForPath('src/db/schema.ts')).toBe('shared/runtime')
    expect(serverAreaForPath('src/unknown/new-runtime.ts')).toBeNull()

    expect(CLIENT_SURFACE_IDS).toEqual(['settings', 'admin', 'debug'])
    expect(RUNTIME_SERVER_AREA_IDS).toContain('shared/runtime')
    expect(RUNTIME_CLIENT_SURFACE_IDS).toEqual(['settings', 'admin', 'debug', 'shared'])
    expect(clientSurfaceForPath('client/settings/App.svelte')).toBe('settings')
    expect(clientSurfaceForPath('client/admin/AdminApp.svelte')).toBe('admin')
    expect(clientSurfaceForPath('client/debug/DebugApp.svelte')).toBe('debug')
    expect(clientSurfaceForPath('client/shared/Modal.svelte')).toBe('shared')
    expect(clientSurfaceForPath('client/assets/design-canvas.jsx')).toBeNull()
    expect(clientSurfaceForPath('client/unknown/new-runtime.ts')).toBeNull()
  })

  test('classifies every current Task 1 runtime path', async () => {
    const glob = new Glob('{src,client}/**/*.{ts,tsx,js,jsx,svelte}')
    const runtimePaths = (await Array.fromAsync(glob.scan('.'))).filter(isArchitectureRuntimePath)
    const serverMisses = runtimePaths
      .filter((relativePath) => relativePath.startsWith('src/'))
      .filter((relativePath) => serverAreaForPath(relativePath) === null)
    const clientMisses = runtimePaths
      .filter((relativePath) => relativePath.startsWith('client/'))
      .filter((relativePath) => clientSurfaceForPath(relativePath) === null)
    const misses = [...serverMisses, ...clientMisses]

    expect(misses).toEqual([])
  })

  test('keeps every declared focused server area backed by at least one current runtime path', async () => {
    const glob = new Glob('src/**/*.{ts,tsx,js,jsx}')
    const runtimePaths = (await Array.fromAsync(glob.scan('.'))).filter(isArchitectureRuntimePath)

    for (const areaId of FOCUSED_SERVER_AREA_IDS) {
      expect(runtimePaths.some((relativePath) => serverAreaForPath(relativePath) === areaId)).toBe(true)
    }
  })
})
