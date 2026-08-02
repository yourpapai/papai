// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatDecidedLine, formatFoundLine } from './issue-format.js'
import { activitySummary, formatDuration, formatTokenCount, MIDDLE_DOT, truncate } from './live-format.js'
import type { IssueProgressEvent, ProgressReporter, UsageDelta } from './progress-log.js'

const ERASE_LINE = '\u001b[2K'
const CURSOR_DOWN = '\u001b[1B'

function cursorUp(n: number): string {
  return `\u001b[${n}A`
}

export interface RendererStream {
  write(chunk: string): boolean
  isTTY?: boolean
  columns?: number
}

export async function withLivePhase<T>(
  reporter: ProgressReporter,
  label: string,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  reporter.event(`[${label}] running...`)
  const start = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  if (reporter.dynamic) {
    timer = setInterval(() => {
      const line = `[${label}] ${formatDuration(Date.now() - start)}...`
      if (reporter.slot === undefined) {
        reporter.live([line])
      } else {
        reporter.slot(label, line)
      }
    }, 1000)
  }
  try {
    const result = await fn()
    return { result, durationMs: Date.now() - start }
  } finally {
    if (timer !== null) {
      clearInterval(timer)
    }
    if (reporter.slot === undefined) {
      reporter.clearLive()
    } else {
      reporter.slot(label, null)
    }
  }
}

export class LiveRenderer implements ProgressReporter {
  private readonly tty: boolean
  private broken = false
  private readonly stream: RendererStream
  private renderedLines = 0
  private startedAt = 0
  private round = 0
  private maxRounds = 0
  private readonly counts = { open: 0, fixed: 0, rejected: 0, needsHuman: 0 }
  private readonly usageTotals: UsageDelta = { input: 0, output: 0, reasoning: 0, cost: 0 }
  private readonly slots = new Map<string, string>()

  constructor(stream: RendererStream) {
    this.stream = stream
    this.tty = stream.isTTY === true
  }

  get dynamic(): boolean {
    return this.tty && !this.broken
  }

  issue(event: IssueProgressEvent): void {
    this.touch()
    switch (event.type) {
      case 'round':
        this.round = event.round
        this.maxRounds = event.maxRounds
        return
      case 'found':
        this.counts.open += 1
        this.event(formatFoundLine(event))
        return
      case 'decided':
        this.counts.open = Math.max(0, this.counts.open - 1)
        if (event.verdict === 'fixed') this.counts.fixed += 1
        else if (event.verdict === 'invalid') this.counts.rejected += 1
        else if (event.verdict === 'needs_human' || event.verdict === 'plan_drift') this.counts.needsHuman += 1
        this.event(formatDecidedLine(event))
    }
  }

  statusSuffix(): string {
    const parts: string[] = []
    if (this.round > 0) parts.push(`round ${this.round}/${this.maxRounds}`)
    const segments: string[] = []
    if (this.counts.open > 0) segments.push(`${this.counts.open} open`)
    if (this.counts.fixed > 0) segments.push(`${this.counts.fixed} fixed`)
    if (this.counts.rejected > 0) segments.push(`${this.counts.rejected} rejected`)
    if (this.counts.needsHuman > 0) segments.push(`${this.counts.needsHuman} needs human`)
    if (segments.length > 0) parts.push(`issues: ${segments.join(` ${MIDDLE_DOT} `)}`)
    return parts.join(` ${MIDDLE_DOT} `)
  }

  slot(key: string, line: string | null): void {
    this.touch()
    if (line === null) {
      this.slots.delete(key)
    } else {
      this.slots.set(key, line)
    }
    if (!this.dynamic) return
    this.renderBlock()
  }

  usage(delta: UsageDelta): void {
    this.touch()
    this.usageTotals.input += delta.input
    this.usageTotals.output += delta.output
    this.usageTotals.reasoning += delta.reasoning
    this.usageTotals.cost += delta.cost
  }

  event(message: string): void {
    this.touch()
    if (!this.dynamic) {
      this.writeSafe(`${message}\n`)
      return
    }
    this.clearBlock()
    this.writeSafe(`${message}\n`)
    this.renderBlock()
  }

  log(message: string): void {
    this.event(message)
  }

  live(lines: readonly string[]): void {
    if (!this.dynamic) {
      for (const line of lines) {
        this.writeSafe(`${line}\n`)
      }
      return
    }
    this.writeBlock([...lines])
  }

  clearLive(): void {
    this.clearBlock()
  }

  private touch(): void {
    if (this.startedAt === 0) this.startedAt = Date.now()
  }

  private statusLine(): string {
    if (this.slots.size === 0) return ''
    const parts: string[] = []
    if (this.round > 0) parts.push(`round ${this.round}/${this.maxRounds}`)
    const activity = activitySummary(this.slots.keys())
    if (activity !== '') parts.push(activity)
    if (this.startedAt !== 0) parts.push(formatDuration(Date.now() - this.startedAt))
    const segments: string[] = []
    if (this.counts.open > 0) segments.push(`${this.counts.open} open`)
    if (this.counts.fixed > 0) segments.push(`${this.counts.fixed} fixed`)
    if (this.counts.rejected > 0) segments.push(`${this.counts.rejected} rejected`)
    if (this.counts.needsHuman > 0) segments.push(`${this.counts.needsHuman} needs human`)
    if (segments.length > 0) parts.push(`issues: ${segments.join(` ${MIDDLE_DOT} `)}`)
    if (this.usageTotals.input > 0 || this.usageTotals.output > 0) {
      parts.push(`in ${formatTokenCount(this.usageTotals.input)} / out ${formatTokenCount(this.usageTotals.output)}`)
    }
    if (parts.length === 0) return ''
    return `  ${'status'.padEnd(10)} ${parts.join(` ${MIDDLE_DOT} `)}`
  }

  private renderBlock(): void {
    const status = this.statusLine()
    const lines = status === '' ? [...this.slots.values()] : [status, ...this.slots.values()]
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
