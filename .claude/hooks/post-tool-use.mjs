// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'

import { trackTestWrite } from '../../.hooks/tdd/checks/track-test-write.mjs'
import { verifyTestImport } from '../../.hooks/tdd/checks/verify-test-import.mjs'

try {
  /** @type {{ tool_input: { file_path?: string, content?: string }, session_id: string, cwd: string }} */
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))

  trackTestWrite(ctx)

  const importResult = verifyTestImport(ctx)
  if (importResult) {
    console.log(JSON.stringify(importResult))
    process.exit(0)
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
