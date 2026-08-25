// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * The claude CLI's job-scoped filesystem — split from `claude-connect.ts`
 * when the native profile's document writer pushed that file past
 * `max-lines`, along the seam its own header had already drawn: the config
 * dir and what is written into it are the route's *durable scratch*, while
 * the spawn, env and kill stay how a process is started and addressed.
 */

/**
 * The job-scoped CLI config dir, under the OS tmp root and never the checkout
 * workspace — where a job's `--resume` session files live and die, so no
 * `~/.claude` state crosses jobs and `git add --all` in the implement phase
 * can never stage it.
 */
export const createClaudeConfigDir = (tmpRoot: string = tmpdir()): string =>
  mkdtempSync(path.join(tmpRoot, 'opencode-agent-claude-'))

/** The empty-MCP document's name inside the job-scoped config dir. */
export const EMPTY_MCP_CONFIG_NAME = 'empty-mcp.json'

/**
 * Writes the native profile's empty-MCP document into the config dir and
 * returns its path — the `--mcp-config` value that, beside
 * `--strict-mcp-config`, kills `.mcp.json` auto-connect (design D2 of the
 * native-OAuth change).
 *
 * Inert content, not a secret: one JSON object naming zero servers, so nothing
 * it says can connect wherever the CLI runs. Written at boot beside the
 * session files, giving it `createClaudeConfigDir`'s lifetime — one document
 * per job, best-effort removed with the dir at teardown. No env work happens
 * here: the credential's own crossing is `childEnv`'s rule.
 */
export const writeClaudeEmptyMcpConfig = (configDir: string): string => {
  const target = path.join(configDir, EMPTY_MCP_CONFIG_NAME)
  writeFileSync(target, `${JSON.stringify({ mcpServers: {} })}\n`, { mode: 0o600 })
  return target
}
