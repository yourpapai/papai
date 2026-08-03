// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'

import { buildAnalyticsReviewPrompt } from '../../.hooks/docs/build-analytics-review-prompt.mjs'
import { mapFilesToAnalytics } from '../../.hooks/docs/map-files-to-analytics.mjs'
import { getSessionsDir } from '../../.hooks/tdd/paths.mjs'
import { SessionState } from '../../.hooks/tdd/session-state.mjs'

try {
  /** @type {{ session_id: string, cwd: string }} */
  const ctx = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'))
  const { session_id, cwd } = ctx

  const state = new SessionState(session_id, getSessionsDir(cwd))
  const changedFiles = state.getChangedSourceFiles()

  if (changedFiles.length === 0) {
    process.exit(0)
  }

  if (state.getAnalyticsReviewSuggested()) {
    process.exit(0)
  }

  const areas = mapFilesToAnalytics(changedFiles)
  if (areas.length === 0) {
    process.exit(0)
  }

  const prompt = buildAnalyticsReviewPrompt(areas)

  state.setAnalyticsReviewSuggested(true)

  console.log(JSON.stringify({ decision: 'block', reason: prompt }))
  process.exit(1)
} catch (err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Analytics review stop hook failed',
      error: err instanceof Error ? err.message : String(err),
    }),
  )
}

process.exit(0)
