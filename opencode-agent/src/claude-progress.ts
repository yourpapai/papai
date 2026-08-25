// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ClaudeStreamLine } from './claude-contract.js'
import type { Logger } from './logger.js'
import type { ProgressSnapshot, ProgressTracker } from './progress.js'

/**
 * The claude route's progress translation — the `progress.ts` role for a
 * stream of decoded CLI lines instead of OpenCode events.
 *
 * Split from `claude-adapter.ts` when the session wiring pushed that file past
 * `max-lines`, along its own seam: this is what the run *says* about a turn in
 * progress, the adapter is the turn itself. They change for different reasons.
 *
 * The public Actions log rows carry **names, statuses and counts only** —
 * assistant text and tool content have nowhere to land, per the workspace rule
 * that keeps a world-readable CI log free of model output. The content-bearing
 * raw lines reach the encrypted transcript instead, redacted by credential
 * value, from the adapter's own transcript feed.
 */

/**
 * `stall()` is always `null` — the stall watcher stays wired but no-ops by
 * design (design D6): its second condition (retry evidence accumulated since
 * the last progress) is an OpenCode event-stream fact with no analog in a CLI
 * child, and synthesizing fake evidence would manufacture false stalls on long
 * generations. The whole-turn `AGENT_TIMEOUT_MS` deadline remains this route's
 * bound, recorded in the README's backend-selection notes.
 */
/** Recognizes the decoded lines this tracker is fed — the only events it knows. */
const isStreamLine = (event: unknown): event is ClaudeStreamLine =>
  typeof event === 'object' && event !== null && 'kind' in event

export const claudeTracker = (log: Logger): ProgressTracker => {
  const state: ProgressSnapshot = { lastAction: 'starting', toolCalls: 0, tokens: 0, cost: 0 }
  return {
    observe: (event: unknown): void => {
      if (!isStreamLine(event) || event.kind === 'init') return
      const line = event
      if (line.kind === 'assistant') {
        state.toolCalls += line.tools.length
        state.lastAction = `claude: ${line.tools.join(', ')}`
        log.info({ tools: [...line.tools] }, `claude: ${line.tools.length} tool call(s)`)
        return
      }
      if (line.kind === 'tool-results') {
        state.lastAction = `claude: tool result (${line.failed} failed)`
        log.info({ ok: line.succeeded, failed: line.failed }, 'claude: tool result')
        return
      }
      if (line.kind === 'stream-event') {
        state.lastAction = `claude: ${line.tool ?? 'streaming'}`
        return
      }
      // The subscription rate-limit fact is recorder evidence, never a
      // progress or budget input (design D4) — decoded so the corpus can pin
      // it, ignored everywhere the pipeline acts.
      if (line.kind === 'rate-limit-event') return
      state.lastAction = 'claude: turn result'
      log.info({ tokens: line.usage.total }, 'claude: turn result')
    },
    snapshot: (): ProgressSnapshot => ({ ...state }),
    stall: () => null,
  }
}
