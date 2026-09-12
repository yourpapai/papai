// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { ClaudeRunContext } from '../../review-loop/src/agent-runner.js'
import { defaultCreateClaudeSpawnDir } from '../../review-loop/src/claude-spawn-dir.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

/** A minimal run context for the dir seam: it reads only `profile` and `configDirRoot`. */
function runContext(profile: 'bare' | 'native', configDirRoot: string): ClaudeRunContext {
  return {
    profile,
    credentialName: 'ANTHROPIC_API_KEY',
    credentialValue: 'sk-ant-secret-0123456789',
    configDirRoot,
    envSource: { PATH: '/usr/bin' },
  }
}

describe('defaultCreateClaudeSpawnDir', () => {
  test('bare profile: a spawn- child under the root, no MCP document', async () => {
    const root = makeTempDir('spawn-dir-bare-')
    const dir = await defaultCreateClaudeSpawnDir(runContext('bare', root))

    expect(dir.configDir.startsWith(root)).toBe(true)
    expect(path.basename(dir.configDir).startsWith('spawn-')).toBe(true)
    expect(dir.mcpConfigPath).toBeNull()
  })

  test('native profile: the empty-MCP document written inside the child dir', async () => {
    const root = makeTempDir('spawn-dir-native-')
    const dir = await defaultCreateClaudeSpawnDir(runContext('native', root))

    expect(dir.mcpConfigPath).not.toBeNull()
    const mcpConfigPath = dir.mcpConfigPath!
    expect(path.dirname(mcpConfigPath)).toBe(dir.configDir)
    expect(existsSync(mcpConfigPath)).toBe(true)
    expect(JSON.parse(readFileSync(mcpConfigPath, 'utf8'))).toEqual({ mcpServers: {} })
  })
})
