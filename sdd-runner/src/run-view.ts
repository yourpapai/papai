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
import { frameBodyLine, frameBottom, frameTop, joinOrStack, padDisplay, truncateDisplay } from './tui-panels.js'
import { costToken, retryToken, severityToken, stageToken } from './tui-tokens.js'
import type { ColorMode, InkColorProps, Severity, StageStatus } from './tui-tokens.js'
import { foldFindings, foldSlots } from './watch-view.js'
import type { SlotState, WatchFinding } from './watch-view.js'

/**
 * Running screen over the fold layer (D3): pipeline map, per-agent slots with
 * their current tool call, the burndown, and a status line (round/cap,
 * tokens, cost marker, elapsed) plus the `q` calm-stop affordance. Holds no
 * state of its own — a pure function of the folded replay state.
 *
 * Presentation (fancy-ui 6.2): framed panels in the one shared style —
 * findings beside burndown at wide width, stacked below the join threshold —
 * with severity/cost/retry/stage tokens decorating the existing text
 * markers (color never carries meaning alone). The status line and slots
 * keep their exact texts; the footer/overlay chrome lives one level up in
 * the session mount.
 */
export interface RunViewProps {
  readonly state: ReplayState
  readonly slots: readonly SlotState[]
  readonly findings: readonly WatchFinding[]
  readonly width: number
  readonly startedAt: number
  readonly now: number
  readonly colorMode?: ColorMode
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

interface RowPart {
  readonly text: string
  readonly tone?: InkColorProps
}

interface PanelRow {
  readonly key: string
  readonly parts: readonly RowPart[]
}

function row(key: string, text: string, tone: InkColorProps = {}): PanelRow {
  return { key, parts: [{ text, tone }] }
}

interface StatusPart extends RowPart {
  readonly key: string
}

function costSegments(props: RunViewProps): readonly StatusPart[] {
  const round = props.state.round === null ? '' : `round ${props.state.round.current}/${props.state.round.cap} · `
  const tokens = props.slots.reduce(
    (acc, slot) => ({
      input: acc.input + (slot.usage?.input ?? 0),
      output: acc.output + (slot.usage?.output ?? 0),
      cost: acc.cost + (slot.usage?.costUsd ?? 0),
    }),
    { input: 0, output: 0, cost: 0 },
  )
  const mode = props.colorMode ?? 'color'
  const cost =
    tokens.cost > 0 ? { key: 'cost', text: ` $${tokens.cost.toFixed(2)}`, tone: costToken(mode, 'known') } : undefined
  const elapsed =
    props.startedAt === 0 ? '' : ` ${MIDDLE_DOT} ${formatElapsed(Math.max(0, props.now - props.startedAt))}`
  return [
    {
      key: 'head',
      text: `${round}tokens in ${formatTokenCount(tokens.input)} out ${formatTokenCount(tokens.output)}`,
    },
    ...(cost === undefined ? [] : [cost]),
    { key: 'tail', text: `${elapsed} · q to stop` },
  ]
}

function severityOfClass(value: string): Severity | null {
  if (value === 'BLOCKER') return 'blocker'
  if (value === 'MATERIAL') return 'material'
  if (value === 'NITPICK') return 'nitpick'
  return null
}

/** Done-slot row: the cost rides the line end with the known-cost token; truncation never cuts the cost. */
function doneSlotRow(
  slot: SlotState & { readonly usage: { readonly input: number; readonly output: number; readonly costUsd: number } },
  mode: ColorMode,
  index: number,
  contentWidth: number,
): PanelRow {
  const modelPart = slot.model === undefined ? '' : ` ${MIDDLE_DOT} ${slot.model}`
  const cost = `$${slot.usage.costUsd.toFixed(4)}`
  const prefixWidth = contentWidth - cost.length
  const prefix = `${slot.agent} done${modelPart} ${MIDDLE_DOT} in ${formatTokenCount(slot.usage.input)} out ${formatTokenCount(slot.usage.output)} ${MIDDLE_DOT} `
  if (prefixWidth < 8) {
    return { key: `s-${String(index)}`, parts: [{ text: truncateDisplay(`${prefix}${cost}`, contentWidth) }] }
  }
  return {
    key: `s-${String(index)}`,
    parts: [
      { text: padDisplay(truncateDisplay(prefix, prefixWidth), prefixWidth) },
      { text: cost, tone: costToken(mode, 'known') },
    ],
  }
}

function slotRow(slot: SlotState, mode: ColorMode, index: number, contentWidth: number): PanelRow {
  if (slot.status === 'done' && slot.usage !== undefined) {
    return doneSlotRow({ ...slot, usage: slot.usage }, mode, index, contentWidth)
  }
  const badge = slot.status === 'retrying' ? ` [retry ${slot.attempt}]` : ''
  return row(
    `s-${String(index)}`,
    `${slot.agent} → ${slot.label}${badge}`,
    slot.status === 'retrying' ? retryToken(mode) : {},
  )
}

function stageStatusOfLine(line: string): StageStatus {
  if (line.startsWith('\u2713')) return 'done'
  if (line.startsWith('\u25b6')) return 'active'
  if (line.startsWith('\u2014')) return 'skipped'
  return 'pending'
}

function wideStageStatus(state: ReplayState): StageStatus {
  const statuses = Object.values(state.stages)
  if (statuses.includes('active')) return 'active'
  if (statuses.includes('done')) return 'done'
  return 'pending'
}

function panel(title: string, rows: readonly PanelRow[], width: number): ReturnType<typeof createElement>[] {
  const contentWidth = Math.max(1, width - 4)
  const bodyRow = (panelRow: PanelRow): ReturnType<typeof createElement> => {
    const single = panelRow.parts.length === 1 ? panelRow.parts[0] : undefined
    if (single !== undefined && (single.tone === undefined || Object.keys(single.tone).length === 0)) {
      return createElement(Text, { key: panelRow.key }, frameBodyLine(single.text, width))
    }
    const parts =
      single === undefined
        ? panelRow.parts
        : [{ text: padDisplay(truncateDisplay(single.text, contentWidth), contentWidth), tone: single.tone }]
    return createElement(
      Text,
      { key: panelRow.key },
      '│ ',
      ...parts.map((part, partIndex) =>
        createElement(Text, { key: `${panelRow.key}-${String(partIndex)}`, ...part.tone }, part.text),
      ),
      ' │',
    )
  }
  return [
    createElement(Text, { key: `${title}-top` }, frameTop(width, title)),
    ...rows.map(bodyRow),
    createElement(Text, { key: `${title}-bottom` }, frameBottom(width)),
  ]
}

interface RunRows {
  readonly pipeline: readonly PanelRow[]
  readonly agents: readonly PanelRow[]
  readonly burndown: readonly PanelRow[]
  readonly findings: readonly PanelRow[]
}

function runRows(props: RunViewProps, mode: ColorMode): RunRows {
  const contentWidth = Math.max(1, props.width - 4)
  const pipelineLines = renderPipelineMap(props.state, { width: props.width })
  const pipeline = pipelineLines.map((line, index) => {
    const status = pipelineLines.length === 1 ? wideStageStatus(props.state) : stageStatusOfLine(line)
    return row(`p-${String(index)}`, line, stageToken(mode, status))
  })
  const idle = props.slots.length === 0 && Object.values(props.state.stages).every((status) => status === 'pending')
  const agents = idle
    ? [row('idle', 'idle — waiting for events')]
    : props.slots.map((slot, index) => slotRow(slot, mode, index, contentWidth))
  const burndown = props.state.perRound.map((record) =>
    row(
      `b-${String(record.round)}`,
      `round ${record.round}: ${record.counts.blocker}b ${record.counts.material}m ${record.counts.nitpick}n`,
    ),
  )
  const findings = props.findings.map((finding) => {
    const severity = severityOfClass(finding.class)
    return row(
      `f-${finding.id}`,
      `${padDisplay(finding.class, 8)} ${finding.id} r${finding.round}${finding.detail === undefined ? '' : ` ${finding.detail}`}`,
      severity === null ? {} : severityToken(mode, severity),
    )
  })
  return { pipeline, agents, burndown, findings }
}

/** Findings beside burndown at wide width (each at half width), stacked below the join threshold. */
function historyRegion(rows: RunRows, width: number): ReturnType<typeof createElement> {
  const joined = joinOrStack(width) === 'join' && rows.burndown.length > 0 && rows.findings.length > 0
  const halfWidth = Math.floor(width / 2)
  if (joined) {
    return createElement(
      Box,
      { key: 'history', flexDirection: 'row' },
      createElement(Box, { key: 'f-col', flexDirection: 'column' }, ...panel('Findings', rows.findings, halfWidth)),
      createElement(
        Box,
        { key: 'b-col', flexDirection: 'column' },
        ...panel('Burndown', rows.burndown, width - halfWidth),
      ),
    )
  }
  return createElement(
    Box,
    { key: 'history', flexDirection: 'column' },
    ...(rows.findings.length > 0 ? panel('Findings', rows.findings, width) : []),
    ...(rows.burndown.length > 0 ? panel('Burndown', rows.burndown, width) : []),
  )
}

export function createRunView(): (props: RunViewProps) => ReturnType<typeof createElement> {
  return function RunView(props: RunViewProps): ReturnType<typeof createElement> {
    const mode = props.colorMode ?? 'color'
    const rows = runRows(props, mode)
    return createElement(
      Box,
      { flexDirection: 'column' },
      ...panel('Pipeline', rows.pipeline, props.width),
      ...panel('Agents', rows.agents, props.width),
      ...(rows.findings.length > 0 || rows.burndown.length > 0 ? [historyRegion(rows, props.width)] : []),
      createElement(
        Box,
        { key: 'status', flexDirection: 'row' },
        ...costSegments(props).map((segment) =>
          createElement(Text, { key: segment.key, ...segment.tone }, segment.text),
        ),
      ),
    )
  }
}
