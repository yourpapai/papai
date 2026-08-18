// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { STAGE_ORDER } from './events.js'
import type { EventInput } from './events.js'
import { formatEvent } from './renderer.js'
import { MIDDLE_DOT } from './renderer.js'
import { formatTokenCount } from './renderer.js'
import { renderPipelineMap, truncateVisible } from './renderer.js'
import type { Renderer, RendererStream, Verbosity } from './renderer.js'
import { createReplayFolder } from './replay.js'
import type { ReplayFolder, ReplayState } from './replay.js'
import type { ResolveCostFn } from './usage-aggregate.js'

const ARROW = '\u25B6'
const ERASE_LINE = '\u001b[2K'
const CURSOR_DOWN = '\u001b[1B'
const TOKEN_SCALE = 1_000_000

type StepFinishInput = Extract<EventInput, { type: 'step_finish' }>

function cursorUp(n: number): string {
  return `\u001b[${n}A`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

/**
 * Dynamic TTY renderer (design D3 + D4). Redraws a fixed-position block:
 * pipeline map (top), per-agent slot lines (middle), status line (bottom).
 * The ANSI block primitives are inlined from `review-loop/src/live-renderer.ts`
 * rather than imported cross-workspace; the shared-tui-renderer proposal can
 * consolidate them later.
 *
 * Non-TTY streams fall back to plain `formatEvent` line output so the renderer
 * is safe to construct even when the picker would normally have chosen
 * `LineRenderer` instead.
 */
export class DynamicRenderer implements Renderer {
  private readonly tty: boolean
  private broken = false
  private renderedLines = 0
  private startedAt = 0
  private readonly folder: ReplayFolder
  private readonly slots = new Map<string, string>()
  private readonly totals = { input: 0, output: 0, reasoning: 0, cachedRead: 0, cachedWrite: 0, cost: 0 }
  private readonly agentModels = new Map<string, string>()
  private readonly retryAttempts = new Map<string, number>()
  private readonly stageEnteredAt = new Map<string, number>()
  private readonly stageTimes = new Map<string, { wallMs: number; costUsd: number }>()
  private readonly stageCostAtEnter = new Map<string, number>()
  private costEstimated = false
  private readonly resolveCost: ResolveCostFn | undefined
  private readonly segmenter: Intl.Segmenter | undefined

  constructor(
    private readonly stream: RendererStream,
    private readonly verbosity: Verbosity,
    folder?: ReplayFolder,
    resolveCost?: ResolveCostFn,
  ) {
    this.tty = stream.isTTY === true
    this.folder = folder ?? createReplayFolder()
    this.resolveCost = resolveCost
    this.segmenter =
      typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined
  }

  renderState = (state: ReplayState): void => {
    if (!this.tty) {
      this.writeSafe(`${renderPipelineMap(state).join('\n')}\n`)
      return
    }
    this.writeBlock(renderPipelineMap(state))
  }

  renderEvent = (event: EventInput): void => {
    this.folder.fold(event)
    this.track(event)
    if (!this.tty) {
      const line = formatEvent(event, this.verbosity)
      if (line !== null) this.writeSafe(`${line}\n`)
      return
    }
    this.redraw()
  }

  private track(event: EventInput): void {
    if (this.startedAt === 0) this.startedAt = Date.now()
    if (event.type === 'tool_use') {
      const arg = event.arg
      const retry = this.retryAttempts.get(event.agent)
      const badge = retry === undefined ? '' : ` [retry ${retry}]`
      this.slots.set(
        event.agent,
        arg === undefined
          ? `${event.agent} ${ARROW} ${event.tool}${badge}`
          : `${event.agent} ${ARROW} ${event.tool} ${arg}${badge}`,
      )
    } else if (event.type === 'spawned') {
      this.agentModels.set(event.agent, event.model)
    } else if (event.type === 'retrying') {
      this.retryAttempts.set(event.agent, event.attempt)
    } else if (event.type === 'done') {
      const model = event.model ?? this.agentModels.get(event.agent)
      const modelPart = model === undefined ? '' : ` ${MIDDLE_DOT} ${model}`
      this.slots.set(
        event.agent,
        `${event.agent} done${modelPart} ${MIDDLE_DOT} in ${formatTokenCount(event.usage.inputTokens)} out ${formatTokenCount(
          event.usage.outputTokens,
        )} ${MIDDLE_DOT} $${event.usage.costUsd.toFixed(4)}`,
      )
    } else if (event.type === 'stage_enter') {
      this.stageEnteredAt.set(event.stage, Date.now())
      this.stageCostAtEnter.set(event.stage, this.totals.cost)
    } else if (event.type === 'stage_exit') {
      const entered = this.stageEnteredAt.get(event.stage)
      if (entered !== undefined) {
        this.stageTimes.set(event.stage, {
          wallMs: Date.now() - entered,
          costUsd: Math.max(0, this.totals.cost - (this.stageCostAtEnter.get(event.stage) ?? 0)),
        })
      }
    } else if (event.type === 'step_finish') {
      this.totals.input += event.tokens.input
      this.totals.output += event.tokens.output
      this.totals.reasoning += event.tokens.reasoning
      this.totals.cachedRead += event.tokens.cacheRead ?? 0
      this.totals.cachedWrite += event.tokens.cacheWrite ?? 0
      this.totals.cost += event.costUsd + this.estimateStepCost(event)
    }
  }

  /**
   * Display-time estimate for an unmetered step, using the `spawned`-event
   * agent→model association and the same formula as `repriceEvent` so live and
   * gate figures agree. Returns 0 (today's behavior) when no resolver was
   * injected, the model is unknown, or pricing cannot resolve it.
   */
  private estimateStepCost(event: StepFinishInput): number {
    if (this.resolveCost === undefined || event.costUsd > 0) return 0
    const { input, output, reasoning } = event.tokens
    const cacheRead = event.tokens.cacheRead ?? 0
    const cacheWrite = event.tokens.cacheWrite ?? 0
    if (input === 0 && output === 0 && reasoning === 0 && cacheRead === 0 && cacheWrite === 0) return 0
    const model = this.agentModels.get(event.agent)
    if (model === undefined) return 0
    const resolved = this.resolveCost(model)
    if (resolved === null) return 0
    this.costEstimated = true
    return (
      ((input + reasoning) * resolved.input +
        output * resolved.output +
        cacheRead * (resolved.cache_read ?? 0) +
        cacheWrite * (resolved.cache_write ?? 0)) /
      TOKEN_SCALE
    )
  }

  private statusLine(): string {
    const parts: string[] = []
    const round = this.folder.state.round
    if (round !== null) parts.push(`round ${round.current}/${round.cap}`)
    const eta = this.etaOf()
    if (eta !== null) parts.push(`eta ${eta}`)
    if (this.totals.input > 0 || this.totals.output > 0 || this.totals.cachedRead > 0) {
      const cachedPart =
        this.totals.cachedRead > 0 ? ` ${MIDDLE_DOT} cached ${formatTokenCount(this.totals.cachedRead)}` : ''
      parts.push(`in ${formatTokenCount(this.totals.input)}${cachedPart} / out ${formatTokenCount(this.totals.output)}`)
    }
    if (this.totals.cost > 0) parts.push(`${this.costEstimated ? '~' : ''}$${this.totals.cost.toFixed(4)}`)
    if (this.startedAt !== 0) parts.push(formatDuration(Date.now() - this.startedAt))
    if (parts.length === 0) return ''
    return `  ${'status'.padEnd(10)} ${parts.join(` ${MIDDLE_DOT} `)}`
  }

  /** ETA from the median completed review-round duration (D10). */
  private etaOf(): string | null {
    const round = this.folder.state.round
    if (round === null || round.current <= 1) return null
    const stageEntered = this.stageEnteredAt.get('review')
    if (stageEntered === undefined) return null
    const perRound = (Date.now() - stageEntered) / round.current
    const remaining = Math.max(0, round.cap - round.current)
    return formatDuration(perRound * remaining)
  }

  private activeStageElapsed(): number | undefined {
    for (const stage of STAGE_ORDER) {
      if (this.folder.state.stages[stage] === 'active') {
        const entered = this.stageEnteredAt.get(stage)
        return entered === undefined ? 0 : Date.now() - entered
      }
    }
    return undefined
  }

  private redraw(): void {
    const status = this.statusLine()
    const lines = [
      ...renderPipelineMap(this.folder.state, {
        stageTimes: this.stageTimes,
        ...(this.activeStageElapsed() === undefined ? {} : { activeElapsedMs: this.activeStageElapsed() }),
      }),
      ...this.slots.values(),
    ]
    if (status !== '') lines.push(status)
    if (lines.length === 0) {
      this.clearBlock()
      return
    }
    this.writeBlock(lines)
  }

  private writeBlock(lines: string[]): void {
    let out = '\r'
    if (this.renderedLines > 1) out += cursorUp(this.renderedLines - 1)
    out += ERASE_LINE + lines.map((line) => this.fit(line)).join(`\n${ERASE_LINE}`)
    const leftover = this.renderedLines - lines.length
    for (let i = 0; i < leftover; i++) {
      out += `\n${ERASE_LINE}`
    }
    if (leftover > 0) out += cursorUp(leftover)
    this.writeSafe(out)
    this.renderedLines = lines.length
  }

  private clearBlock(): void {
    if (this.renderedLines === 0) return
    let out = '\r'
    if (this.renderedLines > 1) out += cursorUp(this.renderedLines - 1)
    for (let i = 0; i < this.renderedLines; i++) {
      out += ERASE_LINE
      if (i < this.renderedLines - 1) out += CURSOR_DOWN
    }
    if (this.renderedLines > 1) out += cursorUp(this.renderedLines - 1)
    this.writeSafe(out)
    this.renderedLines = 0
  }

  private writeSafe(chunk: string): void {
    if (this.broken) return
    try {
      this.stream.write(chunk)
    } catch {
      this.broken = true
    }
  }

  private fit(line: string): string {
    const max = this.stream.columns ?? 80
    return truncateVisible(line, max, this.segmenter)
  }
}
