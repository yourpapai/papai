// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { enforceTdd } from '../../.hooks/tdd/checks/enforce-tdd.mjs'
import { enforceWritePolicy } from '../../.hooks/tdd/checks/enforce-write-policy.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

/**
 * @param {string} filePath
 * @param {string} cwd
 * @returns {string}
 */
const normalizeChangedFilePath = (filePath, cwd) => {
  if (!path.isAbsolute(filePath)) return filePath
  return path.relative(cwd, filePath)
}

try {
  /** @type {{ tool_name?: string, tool_input: { file_path?: string }, session_id: string, cwd: string }} */
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  const writePolicy = enforceWritePolicy(ctx)
  if (writePolicy) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: writePolicy.reason,
        },
      }),
    )
    process.exit(0)
  }

  const gate = enforceTdd(ctx)
  if (gate) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: gate.reason,
        },
      }),
    )
    process.exit(0)
  }

  const state = new SessionState(ctx.session_id, getSessionsDir(ctx.cwd))
  state.setNeedsRecheck(true)

  const filePath = ctx.tool_input?.file_path
  if (filePath != null) {
    const { trackSourceWrite } = await import('../../.hooks/docs/track-source-write.mjs')
    if (trackSourceWrite(filePath, ctx.cwd)) {
      state.addChangedSourceFile(normalizeChangedFilePath(filePath, ctx.cwd))
    }
  }
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Hook execution failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

process.exit(0)
