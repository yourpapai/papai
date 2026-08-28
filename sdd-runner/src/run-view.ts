// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Box, Static, Text } from 'ink'
import { createElement } from 'react'

import type { SddEvent, EventInput } from './events.js'
import { formatElapsed, formatTokenCount, MIDDLE_DOT, renderPipelineMap } from './renderer.js'
import { createReplayFolder, initialReplayState } from './replay.js'
import type { ReplayState } from './replay.js'
import { foldHistoryRows } from './tui-history.js'
import type { HistoryRow } from './tui-history.js'
import { frameBodyLine, frameBottom, frameTop, padDisplay, truncateDisplay } from './tui-panels.js'
import { costToken, retryToken, severityToken, stageToken } from './tui-tokens.js'
import type { ColorMode, InkColorProps, StageStatus } from './tui-tokens.js'
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
 * markers (color never carries meaning alone). Decomposition children ride
 * a live `Children` panel (their status keeps changing; only plan runs
 * show it). The status line and slots keep their exact texts; the
 * footer/overlay chrome lives one level up in the session mount.
 */
export interface RunViewProps {
  readonly state: ReplayState
  readonly slots: readonly SlotState[]
  readonly findings: readonly WatchFinding[]
  /** Finalized rows for the append-only region (fancy-ui D6). */
  readonly history: readonly HistoryRow[]
  readonly width: number
  readonly startedAt: number
  readonly now: number
  readonly colorMode?: ColorMode
}

export interface RunFold {
  readonly state: ReplayState
  readonly slots: readonly SlotState[]
  readonly findings: readonly WatchFinding[]
  /** Append-only finalized rows — grown by foldRunView, rendered once in `Static`. */
  readonly history: readonly HistoryRow[]
  /** Persistent replay folder — foldRunView keeps it per bag. */
  readonly folder: ReturnType<typeof createReplayFolder>
}

/** Empty fold bag (fresh run / before the first event). */
export function emptyRunFold(): RunFold {
  return { state: initialReplayState(), slots: [], findings: [], history: [], folder: createReplayFolder() }
}

/** Fold one event into the run-view aggregate (single loop for the bus). */
export function foldRunView(bag: RunFold, event: SddEvent | EventInput): RunFold {
  const slots = foldSlots(bag.slots, event)
  return {
    state: bag.folder.fold(event),
    slots,
    findings: foldFindings(bag.findings, event),
    history: foldHistoryRows(bag.history, event, slots),
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
  readonly children: readonly PanelRow[]
}

/** Live rows only: pipeline map, active/retrying slots, decomposition children — done agents live in the history region. */
function runRows(props: RunViewProps, mode: ColorMode): RunRows {
  const contentWidth = Math.max(1, props.width - 4)
  const pipelineLines = renderPipelineMap(props.state, { width: props.width })
  const pipeline = pipelineLines.map((line, index) => {
    const status = pipelineLines.length === 1 ? wideStageStatus(props.state) : stageStatusOfLine(line)
    return row(`p-${String(index)}`, line, stageToken(mode, status))
  })
  const idle = props.slots.length === 0 && Object.values(props.state.stages).every((status) => status === 'pending')
  const live = props.slots.filter((slot) => slot.status !== 'done')
  const agents = idle
    ? [row('idle', 'idle — waiting for events')]
    : live.map((slot, index) => slotRow(slot, mode, index, contentWidth))
  const children = childRows(props.state.children).map((line, index) => row(`c-${String(index)}`, line))
  return { pipeline, agents, children }
}

/** One append-only history row: a framed body line, toned where the row carries semantics. */
function historyElement(entry: HistoryRow, width: number, mode: ColorMode): ReturnType<typeof createElement> {
  const contentWidth = Math.max(1, width - 4)
  if (entry.parts !== undefined && entry.parts.length === 2) {
    const prefix = entry.parts[0]?.text ?? ''
    const cost = entry.parts[1]?.text ?? ''
    const prefixBudget = Math.max(0, contentWidth - cost.length)
    return createElement(
      Text,
      { key: entry.key },
      '│ ',
      padDisplay(truncateDisplay(prefix, prefixBudget), prefixBudget),
      createElement(Text, { key: `${entry.key}-cost`, ...costToken(mode, 'known') }, cost),
      ' │',
    )
  }
  return createElement(
    Text,
    { key: entry.key, ...(entry.severity === undefined ? {} : severityToken(mode, entry.severity)) },
    frameBodyLine(entry.text, width),
  )
}

/** Static's item type erases to `unknown` through createElement; this guard restores it without an assertion. */
function isHistoryRow(value: unknown): value is HistoryRow {
  return typeof value === 'object' && value !== null && 'key' in value && 'text' in value
}

/** The append-only `Static` region: finalized rows emitted exactly once, keyed stably. */
function historyRegion(props: RunViewProps, mode: ColorMode): ReturnType<typeof createElement> {
  return createElement(Static, {
    items: [...props.history],
    children: (item: unknown): ReturnType<typeof createElement> =>
      historyElement(isHistoryRow(item) ? item : { key: `raw:${String(item)}`, text: String(item) }, props.width, mode),
  })
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
    const mode = props.colorMode ?? 'color'
    const rows = runRows(props, mode)
    return createElement(
      Box,
      { flexDirection: 'column' },
      historyRegion(props, mode),
      ...panel('Pipeline', rows.pipeline, props.width),
      ...panel('Agents', rows.agents, props.width),
      ...(rows.children.length > 0 ? panel('Children', rows.children, props.width) : []),
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
