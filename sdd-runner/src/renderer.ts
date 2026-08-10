// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { STAGE_ORDER } from './events.js'
import type { ReplayState, SddEvent } from './events.js'

export type Verbosity = 'brief' | 'normal' | 'debug'

export interface RendererStream {
  write(chunk: string): boolean
  readonly isTTY?: boolean
  readonly columns?: number
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

export function renderBurndown(
  verdict: {
    readonly round: number
    readonly verdict: 'converged' | 'open'
    readonly counts: { readonly blocker: number; readonly material: number; readonly nitpick: number }
  },
  _cap: number,
  resolved: number,
): string {
  const { blocker, material, nitpick } = verdict.counts
  return `round ${verdict.round}: ${blocker}b ${material}m ${nitpick}n \u00b7 ${resolved} resolved \u00b7 ${verdict.verdict}`
}

function shouldShow(altitude: string, verbosity: Verbosity): boolean {
  if (altitude === 'L2') return true
  if (altitude === 'L1') return verbosity === 'normal' || verbosity === 'debug'
  return verbosity === 'debug'
}

export function formatEvent(event: SddEvent, verbosity: Verbosity): string | null {
  if (!shouldShow(event.altitude, verbosity)) return null
  if (event.type === 'convergence')
    return `round ${event.round}: ${event.verdict} (${event.counts.blocker}b ${event.counts.material}m ${event.counts.nitpick}n)`
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
  if (event.type === 'done') return `${event.agent} done`
  return null
}

export function renderGateScreen(input: {
  readonly changeName: string
  readonly runId: string
  readonly assumptions: readonly { readonly id: string; readonly text: string; readonly blast_radius: string }[]
}): string {
  const lines = [`Gate \u2014 ${input.changeName}`, '']
  for (const assumption of input.assumptions) {
    lines.push(`  ${assumption.id}: ${assumption.text} (blast: ${assumption.blast_radius})`)
  }
  lines.push('', `Resume with: gate resume ${input.runId}`)
  return lines.join('\n')
}

export interface Renderer {
  readonly renderState: (state: ReplayState) => void
  readonly renderEvent: (event: SddEvent) => void
}

export function createRenderer(stream: RendererStream, verbosity: Verbosity): Renderer {
  return {
    renderState: (state) => {
      const lines = renderPipelineMap(state)
      const block = lines.join('\n')
      stream.write(`${block}\n`)
    },
    renderEvent: (event) => {
      const line = formatEvent(event, verbosity)
      if (line !== null) stream.write(`${line}\n`)
    },
  }
}
