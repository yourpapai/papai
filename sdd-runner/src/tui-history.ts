// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SddEvent, EventInput } from './events.js'
import { formatTokenCount, MIDDLE_DOT } from './renderer.js'
import type { ReplayState } from './replay.js'
import { padDisplay } from './tui-panels.js'
import type { SlotState, WatchFinding } from './watch-view.js'

/**
 * tui-history (fancy-ui D6): the pure splitter for the running screen's
 * append-only region. Finalized rows — closed-round burndown rows, filed
 * findings, done-agent rows — are folded chronologically from events, in
 * memory only: no event-grammar, sidecar, or persisted-format change.
 * `ReplayState.autoDecisions` stays unrendered exactly as the running
 * screen renders today. Done rows key by agent label + spawn ordinal so a
 * re-spawned label never collides with its own history.
 */

export interface HistoryRow {
  readonly key: string
  readonly text: string
  readonly severity?: 'blocker' | 'material' | 'nitpick'
  /** Optional tone-tagged parts (done rows carry the cost segment); render resolves the token by color mode. */
  readonly parts?: readonly { readonly text: string; readonly tone?: 'known-cost' }[]
}

export interface HistoryFold {
  readonly state: ReplayState
  readonly slots: readonly SlotState[]
  readonly findings: readonly WatchFinding[]
  readonly history: readonly HistoryRow[]
}

/** The append-only rows for the history region — the complement is live. */
export function historyRows(fold: HistoryFold): readonly HistoryRow[] {
  return fold.history
}

function severityOf(value: string | undefined): 'blocker' | 'material' | 'nitpick' | undefined {
  if (value === 'BLOCKER') return 'blocker'
  if (value === 'MATERIAL') return 'material'
  if (value === 'NITPICK') return 'nitpick'
  return undefined
}

/**
 * Fold one event into the history rows (append-only: every output extends
 * the input as a stable prefix). `slots` is the post-fold slot model, used
 * only to key done rows by spawn ordinal.
 */
export function foldHistoryRows(
  rows: readonly HistoryRow[],
  event: SddEvent | EventInput,
  slots: readonly SlotState[],
): readonly HistoryRow[] {
  if (event.type === 'convergence') {
    return [
      ...rows,
      {
        key: `round:${String(event.round)}`,
        text: `round ${String(event.round)}: ${String(event.counts.blocker)}b ${String(event.counts.material)}m ${String(event.counts.nitpick)}n`,
      },
    ]
  }
  if (event.type === 'finding' && event.action === 'filed') {
    const severity = severityOf(event.class)
    return [
      ...rows,
      {
        key: `finding:${event.id}`,
        text: `${padDisplay(event.class ?? '?', 8)} ${event.id} r${String(event.round)}${event.detail === undefined ? '' : ` ${event.detail}`}`,
        ...(severity === undefined ? {} : { severity }),
      },
    ]
  }
  if (event.type === 'done') {
    const slot = slots.find((candidate) => candidate.agent === event.agent)
    const spawn = slot === undefined ? 0 : slot.spawn
    const modelPart = event.model === undefined ? '' : ` ${MIDDLE_DOT} ${event.model}`
    const cost = `$${event.usage.costUsd.toFixed(4)}`
    const prefix = `${event.agent} done${modelPart} ${MIDDLE_DOT} in ${formatTokenCount(event.usage.inputTokens)} out ${formatTokenCount(event.usage.outputTokens)} ${MIDDLE_DOT} `
    return [
      ...rows,
      {
        key: `done:${event.agent}:${String(spawn)}`,
        text: `${prefix}${cost}`,
        parts: [{ text: prefix }, { text: cost, tone: 'known-cost' }],
      },
    ]
  }
  return rows
}
