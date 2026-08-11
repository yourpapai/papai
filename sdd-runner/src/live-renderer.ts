// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { EventInput } from './events.js'
import { formatEvent } from './renderer.js'
import { MIDDLE_DOT } from './renderer.js'
import { formatTokenCount } from './renderer.js'
import { renderPipelineMap } from './renderer.js'
import type { Renderer, RendererStream, Verbosity } from './renderer.js'
import { createReplayFolder } from './replay.js'
import type { ReplayFolder, ReplayState } from './replay.js'

const ARROW = '\u25B6'
const ERASE_LINE = '\u001b[2K'
const CURSOR_DOWN = '\u001b[1B'
const ELLIPSIS = '\u2026'

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

function truncate(value: string, max: number): string {
  if (max <= 0) return ''
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}${ELLIPSIS}`
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
  private readonly totals = { input: 0, output: 0, reasoning: 0, cost: 0 }

  constructor(
    private readonly stream: RendererStream,
    private readonly verbosity: Verbosity,
    folder?: ReplayFolder,
  ) {
    this.tty = stream.isTTY === true
    this.folder = folder ?? createReplayFolder()
  }

  renderState(state: ReplayState): void {
    if (!this.tty) {
      this.writeSafe(`${renderPipelineMap(state).join('\n')}\n`)
      return
    }
    this.writeBlock(renderPipelineMap(state))
  }

  renderEvent(event: EventInput): void {
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
      this.slots.set(
        event.agent,
        arg === undefined ? `${event.agent} ${ARROW} ${event.tool}` : `${event.agent} ${ARROW} ${event.tool} ${arg}`,
      )
    } else if (event.type === 'done') {
      this.slots.delete(event.agent)
      this.totals.input += event.usage.inputTokens
      this.totals.output += event.usage.outputTokens
      this.totals.reasoning += event.usage.reasoningTokens
      this.totals.cost += event.usage.costUsd
    } else if (event.type === 'step_finish') {
      this.totals.input += event.tokens.input
      this.totals.output += event.tokens.output
      this.totals.reasoning += event.tokens.reasoning
      this.totals.cost += event.costUsd
    }
  }

  private statusLine(): string {
    const parts: string[] = []
    const round = this.folder.state.round
    if (round !== null) parts.push(`round ${round.current}/${round.cap}`)
    if (this.totals.input > 0 || this.totals.output > 0) {
      parts.push(`in ${formatTokenCount(this.totals.input)} / out ${formatTokenCount(this.totals.output)}`)
    }
    if (this.totals.cost > 0) parts.push(`$${this.totals.cost.toFixed(4)}`)
    if (this.startedAt !== 0) parts.push(formatDuration(Date.now() - this.startedAt))
    if (parts.length === 0) return ''
    return `  ${'status'.padEnd(10)} ${parts.join(` ${MIDDLE_DOT} `)}`
  }

  private redraw(): void {
    const status = this.statusLine()
    const lines = [...renderPipelineMap(this.folder.state), ...this.slots.values()]
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
    return truncate(line, max)
  }
}
