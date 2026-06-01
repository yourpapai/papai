// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'

import { checkFull } from '../../.hooks/tdd/checks/check-full.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

try {
  /** @type {{ session_id: string, cwd: string }} */
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
  const { session_id, cwd } = ctx

  const state = new SessionState(session_id, getSessionsDir(cwd))

  if (!state.getNeedsRecheck()) {
    state.setNeedsRecheck(true)
    process.exit(0)
  }

  const result = checkFull(ctx)

  if (result) {
    state.setNeedsRecheck(false)
    console.log(JSON.stringify({ decision: 'block', reason: result.reason }))
    process.exit(1)
  }
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Stop hook execution failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

process.exit(0)
