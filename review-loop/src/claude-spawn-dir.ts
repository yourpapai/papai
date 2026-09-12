// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** What the dir-creation seam answers: the ready child dir and its empty-MCP document, if any. */
export interface ClaudeSpawnDir {
  configDir: string
  /** `--mcp-config` value on the native profile; `null` on bare. */
  mcpConfigPath: string | null
}

/** The per-spawn config-dir creation seam (D8), injectable so tests need no filesystem. */
export type CreateClaudeSpawnDir = (context: import('./agent-runner.js').ClaudeRunContext) => Promise<ClaudeSpawnDir>

/**
 * The default seam: each spawn gets its own `mkdtemp` child under the run
 * parent — per-spawn, because the loop runs up to `poolSize` claude processes
 * concurrently and shared CLI state files were never recorded under that — and
 * the native profile's empty-MCP document is written into it by the same seam.
 */
export const defaultCreateClaudeSpawnDir: CreateClaudeSpawnDir = async (context) => {
  const configDir = await mkdtemp(path.join(context.configDirRoot, 'spawn-'))
  if (context.profile !== 'native') {
    return { configDir, mcpConfigPath: null }
  }
  const mcpConfigPath = path.join(configDir, 'empty-mcp.json')
  await writeFile(mcpConfigPath, `${JSON.stringify({ mcpServers: {} })}\n`, { mode: 0o600 })
  return { configDir, mcpConfigPath }
}
