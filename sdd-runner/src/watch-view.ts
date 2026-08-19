// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Text } from 'ink'
import { createElement, useMemo } from 'react'

import type { SddEvent } from './events.js'
import { STAGE_ORDER } from './events.js'
import { renderPipelineMap, formatElapsed, formatTokenCount, MIDDLE_DOT } from './renderer.js'
import type { ReplayState } from './replay.js'
import type { DigestRecord } from './replay.js'

/** Per-agent slot model folded from spawned/retrying/done events (D8). */
export interface SlotState {
  readonly agent: string
  readonly model: string | undefined
  readonly status: 'running' | 'retrying' | 'done'
  readonly label: string
  readonly attempt: number
  readonly usage?: { readonly input: number; readonly output: number; readonly costUsd: number }
}

export interface WatchFinding {
  readonly id: string
  readonly class: string
  readonly round: number
  readonly detail?: string
}

export interface WatchViewProps {
  readonly state: ReplayState
  readonly stageTimes: ReadonlyMap<string, { wallMs: number; costUsd: number }>
  readonly slots: readonly SlotState[]
  readonly findings: readonly WatchFinding[]
  readonly width: number
}

/** Region 1: pipeline map + per-stage wall/cost on completed stages. */
function PipelineRegion(props: WatchViewProps): ReturnType<typeof createElement> {
  const lines = renderPipelineMap(props.state, {
    stageTimes: props.stageTimes,
  })
  return createElement(
    Box,
    { flexDirection: 'column' },
    ...lines.map((line) => createElement(Text, { key: line }, line)),
  )
}

/** Region 2: scrollable findings list (from folded `finding` events). */
function FindingsRegion(props: WatchViewProps): ReturnType<typeof createElement> {
  const rows = props.findings.map((finding) =>
    createElement(
      Text,
      { key: finding.id },
      `${finding.class.padEnd(8)} ${finding.id} r${finding.round}${finding.detail === undefined ? '' : ` ${finding.detail}`}`,
    ),
  )
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Text, { key: 'h' }, '## Findings'),
    ...(rows.length > 0 ? rows : [createElement(Text, { key: 'none' }, '(none)')]),
  )
}

/** Region 3: live burndown + autoDecisions list. */
function BurndownRegion(props: WatchViewProps): ReturnType<typeof createElement> {
  const rows = props.state.perRound.map((record: DigestRecord) =>
    createElement(
      Text,
      { key: record.round },
      `round ${record.round}: ${record.counts.blocker}b ${record.counts.material}m ${record.counts.nitpick}n`,
    ),
  )
  const decisions = props.state.autoDecisions.map((decision, index) =>
    createElement(Text, { key: `d${index}` }, `${decision.rule} ${decision.decision} v${decision.gateVersion}`),
  )
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Text, { key: 'h' }, '## Burndown'),
    ...rows,
    ...(decisions.length > 0 ? [createElement(Text, { key: 'dh' }, '## Auto-decisions'), ...decisions] : []),
  )
}

/** Region 4: per-agent slots folded into the live-renderer slot model. */
function SlotsRegion(props: WatchViewProps): ReturnType<typeof createElement> {
  const rows = props.slots.map((slot) => {
    const badge = slot.status === 'retrying' ? ` [retry ${slot.attempt}]` : ''
    if (slot.status === 'done' && slot.usage !== undefined) {
      const modelPart = slot.model === undefined ? '' : ` ${MIDDLE_DOT} ${slot.model}`
      return `${slot.agent} done${modelPart} ${MIDDLE_DOT} in ${formatTokenCount(slot.usage.input)} out ${formatTokenCount(
        slot.usage.output,
      )} ${MIDDLE_DOT} $${slot.usage.costUsd.toFixed(4)}`
    }
    return `${slot.agent} → ${slot.label}${badge}`
  })
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Text, { key: 'h' }, '## Agents'),
    ...rows.map((row, index) => createElement(Text, { key: `s${index}` }, row)),
  )
}

/**
 * Watch view (D8): four regions — pipeline map + stage times, scrollable
 * findings list, live burndown + autoDecisions, per-agent slots. Pure
 * function of the folded replay state; `watch.ts` owns the folding and the
 * replay-then-tail engine.
 */
export function WatchView(props: WatchViewProps): ReturnType<typeof createElement> {
  const regions = useMemo(
    () => [
      createElement(PipelineRegion, { key: 'p', ...props }),
      createElement(FindingsRegion, { key: 'f', ...props }),
      createElement(BurndownRegion, { key: 'b', ...props }),
      createElement(SlotsRegion, { key: 's', ...props }),
    ],
    [props],
  )
  return createElement(Box, { flexDirection: 'column' }, ...regions)
}

/** Fold events into the slot model (shared with the tail engine). */
export function foldSlots(
  slots: readonly SlotState[],
  event: SddEvent | import('./events.js').EventInput,
): readonly SlotState[] {
  if (event.type === 'spawned') {
    return [
      ...slots.filter((slot) => slot.agent !== event.agent),
      { agent: event.agent, model: event.model, status: 'running', label: 'spawned', attempt: 1 },
    ]
  }
  if (event.type === 'retrying') {
    return slots.map((slot) =>
      slot.agent === event.agent ? { ...slot, status: 'retrying' as const, attempt: event.attempt } : slot,
    )
  }
  if (event.type === 'done') {
    return slots.map((slot) =>
      slot.agent === event.agent
        ? {
            ...slot,
            status: 'done' as const,
            model: event.model ?? slot.model,
            usage: { input: event.usage.inputTokens, output: event.usage.outputTokens, costUsd: event.usage.costUsd },
          }
        : slot,
    )
  }
  if (event.type === 'tool_use') {
    return slots.map((slot) =>
      slot.agent === event.agent
        ? { ...slot, label: event.arg === undefined ? event.tool : `${event.tool} ${event.arg}` }
        : slot,
    )
  }
  return slots
}

/** Fold finding events into the findings list. */
export function foldFindings(
  findings: readonly WatchFinding[],
  event: SddEvent | import('./events.js').EventInput,
): readonly WatchFinding[] {
  if (event.type !== 'finding' || event.action !== 'filed') return findings
  return [
    ...findings,
    {
      id: event.id,
      class: event.class ?? '?',
      round: event.round,
      ...(event.detail === undefined ? {} : { detail: event.detail }),
    },
  ]
}

/** Format helper exported for the stage-times row. */
export function formatStageTime(entry: { wallMs: number; costUsd: number }): string {
  return `${formatElapsed(entry.wallMs)} $${entry.costUsd.toFixed(4)}`
}

export { STAGE_ORDER }
