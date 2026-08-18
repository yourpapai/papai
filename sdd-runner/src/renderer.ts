// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { STAGE_ORDER } from './events.js'
import type { EventInput } from './events.js'
import { DynamicRenderer } from './live-renderer.js'
import { createReplayFolder } from './replay.js'
import type { DigestRecord, ReplayFolder, ReplayState } from './replay.js'
import type { ResolveCostFn } from './usage-aggregate.js'

export type Verbosity = 'brief' | 'normal' | 'debug'

export interface RendererStream {
  write(chunk: string): boolean
  readonly isTTY?: boolean
  readonly columns?: number
}

export interface RendererOptions {
  readonly dynamic?: boolean
  readonly resolveCost?: ResolveCostFn
}

export const MIDDLE_DOT = '\u00B7'

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

const STAGE_ICONS: Record<string, string> = {
  done: '\u2713',
  active: '\u25b6',
  pending: '\u00b7',
  skipped: '\u2014',
}

export function renderPipelineMap(state: ReplayState): string[] {
  return STAGE_ORDER.map((stage) => {
    let status: 'done' | 'active' | 'pending' | 'skipped' = state.stages[stage]
    if (stage === 'atomicity' && state.depth === 'S') status = 'skipped'
    const icon = STAGE_ICONS[status] ?? STAGE_ICONS['pending']
    let suffix = ''
    if (status === 'active' && state.round !== null) suffix = ` (round ${state.round.current}/${state.round.cap})`
    return `${icon} ${stage} ${status}${suffix}`
  })
}

export function formatDigestBody(record: DigestRecord): string {
  const { blocker, material, nitpick } = record.counts
  return `${blocker}b ${material}m ${nitpick}n ${MIDDLE_DOT} ${record.resolved} resolved ${MIDDLE_DOT} ${record.dismissed} dismissed ${MIDDLE_DOT} ${record.verdict}`
}

export function formatBurndownLine(record: DigestRecord): string {
  return `round ${record.round}: ${formatDigestBody(record)}`
}

export function formatTrajectoryBlock(records: readonly DigestRecord[]): string {
  if (records.length === 0) return ''
  const lines = records.map(formatBurndownLine)
  return ['### Cap-hit trajectory', ...lines].join('\n')
}

function shouldShow(altitude: string, verbosity: Verbosity): boolean {
  if (altitude === 'L2') return true
  if (altitude === 'L1') return verbosity === 'normal' || verbosity === 'debug'
  return verbosity === 'debug'
}

export function formatEvent(event: EventInput, verbosity: Verbosity): string | null {
  if (!shouldShow(event.altitude, verbosity)) return null
  if (event.type === 'stage_enter') return `[${event.stage}] entered`
  if (event.type === 'stage_exit') return `[${event.stage}] done`
  if (event.type === 'round_open') return `round ${event.round}/${event.cap} opened`
  if (event.type === 'round_close') return `round ${event.round}/${event.cap} closed`
  if (event.type === 'depth') return `depth classified: ${event.profile} (${event.source})`
  if (event.type === 'gate') return `gate ${event.action} (${event.mode}, v${event.version})`
  if (event.type === 'finding')
    return `finding ${event.id} ${event.action} (${event.class ?? '?'}) round ${event.round}`
  if (event.type === 'assumption') return `assumption ${event.id} ${event.action}`
  if (event.type === 'artifact') return `materialized ${event.path}`
  if (event.type === 'human_edits') return `hand edits detected: ${event.files.join(', ')}`
  if (event.type === 'tool_use') return `${event.agent}: ${event.tool}`
  if (event.type === 'step_finish') return `${event.agent} step done (${event.tokens.output} out)`
  if (event.type === 'spawned') return `${event.agent} spawned (${event.role}, ${event.model})`
  if (event.type === 'retrying') return `${event.agent} retrying (${event.reason}, attempt ${event.attempt})`
  if (event.type === 'killed') return `${event.agent} killed (${event.cause})`
  if (event.type === 'done') {
    const usage = event.usage
    const cachedRead = usage.cachedReadTokens ?? 0
    const cachedPart = cachedRead > 0 ? ` ${MIDDLE_DOT} cached ${formatTokenCount(cachedRead)}` : ''
    return `${event.agent} done ${MIDDLE_DOT} in ${formatTokenCount(usage.inputTokens)}${cachedPart} out ${formatTokenCount(
      usage.outputTokens,
    )} ${MIDDLE_DOT} $${usage.costUsd.toFixed(4)}`
  }
  return null
}

export interface Renderer {
  readonly renderState: (state: ReplayState) => void
  readonly renderEvent: (event: EventInput) => void
}

/**
 * Append-only line renderer — the CI / pipe / log-file contract. Byte-identical
 * to the original `createRenderer` output; the body now lives on a class so the
 * `createRenderer` picker can choose between this and the dynamic renderer.
 */
export class LineRenderer implements Renderer {
  private readonly folder: ReplayFolder

  constructor(
    private readonly stream: RendererStream,
    private readonly verbosity: Verbosity,
    folder?: ReplayFolder,
  ) {
    this.folder = folder ?? createReplayFolder()
  }

  renderState = (state: ReplayState): void => {
    const lines = renderPipelineMap(state)
    const block = lines.join('\n')
    this.stream.write(`${block}\n`)
  }

  renderEvent = (event: EventInput): void => {
    this.folder.fold(event)
    if (event.type === 'round_close') {
      const perRound = this.folder.state.perRound
      const last = perRound[perRound.length - 1]
      if (last !== undefined) this.stream.write(`${formatBurndownLine(last)}\n`)
      return
    }
    const line = formatEvent(event, this.verbosity)
    if (line !== null) this.stream.write(`${line}\n`)
  }
}

/**
 * Pick a renderer for the run. `opts.dynamic` defaults to `true`; CI / non-TTY /
 * `--verbosity brief` always get the append-only `LineRenderer`. The dynamic
 * branch returns `DynamicRenderer` (see `live-renderer.ts`) when a TTY is
 * present and verbosity is not `brief`.
 */
export function createRenderer(stream: RendererStream, verbosity: Verbosity, opts?: RendererOptions): Renderer {
  const wantsDynamic = opts?.dynamic !== false
  if (wantsDynamic && stream.isTTY === true && verbosity !== 'brief') {
    return new DynamicRenderer(stream, verbosity, undefined, opts?.resolveCost)
  }
  return new LineRenderer(stream, verbosity)
}
