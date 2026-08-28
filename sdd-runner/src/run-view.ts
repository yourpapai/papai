// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Text } from 'ink'
import { createElement } from 'react'

import type { SddEvent, EventInput } from './events.js'
import { formatElapsed, formatTokenCount, MIDDLE_DOT, renderPipelineMap } from './renderer.js'
import { createReplayFolder, initialReplayState } from './replay.js'
import type { ReplayState } from './replay.js'
import { foldFindings, foldSlots } from './watch-view.js'
import type { SlotState, WatchFinding } from './watch-view.js'

/**
 * Running screen over the fold layer (D3): pipeline map, per-agent slots with
 * their current tool call, the burndown, and a status line (round/cap,
 * tokens, cost marker, elapsed) plus the `q` calm-stop affordance. Holds no
 * state of its own — a pure function of the folded replay state.
 */
export interface RunViewProps {
  readonly state: ReplayState
  readonly slots: readonly SlotState[]
  readonly findings: readonly WatchFinding[]
  readonly width: number
  readonly startedAt: number
  readonly now: number
}

export interface RunFold {
  readonly state: ReplayState
  readonly slots: readonly SlotState[]
  readonly findings: readonly WatchFinding[]
  /** Persistent replay folder — foldRunView keeps it per bag. */
  readonly folder: ReturnType<typeof createReplayFolder>
}

/** Empty fold bag (fresh run / before the first event). */
export function emptyRunFold(): RunFold {
  return { state: initialReplayState(), slots: [], findings: [], folder: createReplayFolder() }
}

/** Fold one event into the run-view aggregate (single loop for the bus). */
export function foldRunView(bag: RunFold, event: SddEvent | EventInput): RunFold {
  return {
    state: bag.folder.fold(event),
    slots: foldSlots(bag.slots, event),
    findings: foldFindings(bag.findings, event),
    folder: bag.folder,
  }
}

function statusLine(props: RunViewProps): string {
  const round = props.state.round === null ? '' : `round ${props.state.round.current}/${props.state.round.cap} · `
  const tokens = props.slots.reduce(
    (acc, slot) => ({
      input: acc.input + (slot.usage?.input ?? 0),
      output: acc.output + (slot.usage?.output ?? 0),
      cost: acc.cost + (slot.usage?.costUsd ?? 0),
    }),
    { input: 0, output: 0, cost: 0 },
  )
  const cost = tokens.cost > 0 ? ` $${tokens.cost.toFixed(2)}` : ''
  const elapsed =
    props.startedAt === 0 ? '' : ` ${MIDDLE_DOT} ${formatElapsed(Math.max(0, props.now - props.startedAt))}`
  return `${round}tokens in ${formatTokenCount(tokens.input)} out ${formatTokenCount(tokens.output)}${cost}${elapsed} · q to stop`
}

function slotRow(slot: SlotState): string {
  const badge = slot.status === 'retrying' ? ` [retry ${slot.attempt}]` : ''
  if (slot.status === 'done' && slot.usage !== undefined) {
    const modelPart = slot.model === undefined ? '' : ` ${MIDDLE_DOT} ${slot.model}`
    return `${slot.agent} done${modelPart} ${MIDDLE_DOT} in ${formatTokenCount(slot.usage.input)} out ${formatTokenCount(slot.usage.output)} ${MIDDLE_DOT} $${slot.usage.costUsd.toFixed(4)}`
  }
  return `${slot.agent} → ${slot.label}${badge}`
}

/**
 * D8 children rows: one `<child-id> <status>` line per fold entry — the
 * first non-pending/non-done child (the in-flight or failed node) marks the
 * active tree position with the `▶` marker.
 */
function childRows(children: ReplayState['children']): string[] {
  let activeMarked = false
  return Object.entries(children).map(([childId, record]) => {
    const active = !activeMarked && record.status !== 'pending' && record.status !== 'done'
    if (active) activeMarked = true
    return `${active ? '▶ ' : ''}${childId} ${record.status}`
  })
}

export function createRunView(): (props: RunViewProps) => ReturnType<typeof createElement> {
  return function RunView(props: RunViewProps): ReturnType<typeof createElement> {
    const pipeline = renderPipelineMap(props.state, { width: props.width })
    const burndown = props.state.perRound.map(
      (record) =>
        `round ${record.round}: ${record.counts.blocker}b ${record.counts.material}m ${record.counts.nitpick}n`,
    )
    const findingRows = props.findings.map(
      (finding) =>
        `${finding.class.padEnd(8)} ${finding.id} r${finding.round}${finding.detail === undefined ? '' : ` ${finding.detail}`}`,
    )
    const idle = props.slots.length === 0 && Object.values(props.state.stages).every((status) => status === 'pending')
    const children = childRows(props.state.children)
    return createElement(
      Box,
      { flexDirection: 'column' },
      ...pipeline.map((line) => createElement(Text, { key: `p-${line}` }, line)),
      createElement(Text, { key: 'agents-h' }, '## Agents'),
      ...(idle
        ? [createElement(Text, { key: 'idle' }, 'idle — waiting for events')]
        : props.slots.map((slot, index) => createElement(Text, { key: `s-${index}` }, slotRow(slot)))),
      ...(burndown.length > 0
        ? [
            createElement(Text, { key: 'bd-h' }, '## Burndown'),
            ...burndown.map((row) => createElement(Text, { key: `b-${row}` }, row)),
          ]
        : []),
      ...(findingRows.length > 0
        ? [
            createElement(Text, { key: 'f-h' }, '## Findings'),
            ...findingRows.map((row) => createElement(Text, { key: `f-${row}` }, row)),
          ]
        : []),
      ...(children.length > 0
        ? [
            createElement(Text, { key: 'ch-h' }, '## Children'),
            ...children.map((row) => createElement(Text, { key: `c-${row}` }, row)),
          ]
        : []),
      createElement(Text, { key: 'status' }, statusLine(props)),
    )
  }
}
