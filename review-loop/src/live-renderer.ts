// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { formatDecidedLine, formatFoundLine } from './issue-format.js'
import type { IssueProgressEvent, ProgressReporter, UsageDelta } from './progress-log.js'

const ELLIPSIS = '\u2026'
const ARROW = '\u25B6'
const CHECK = '\u2713'
const MIDDLE_DOT = '\u00B7'

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

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

function truncate(value: string, max: number): string {
  if (max <= 0) {
    return ''
  }
  if (value.length <= max) {
    return value
  }
  return `${value.slice(0, max - 1)}${ELLIPSIS}`
}

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return ''
}

function firstStringValue(obj: Record<string, unknown>): string {
  for (const value of Object.values(obj)) {
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export function formatToolArg(tool: string, input: unknown): string {
  const obj = isRecord(input) ? input : {}
  switch (tool) {
    case 'read':
    case 'edit':
    case 'write': {
      const filePath = pickString(obj, ['filePath', 'path'])
      return filePath === '' ? '' : path.basename(filePath)
    }
    case 'bash':
      return truncate(pickString(obj, ['command']), 40)
    case 'grep':
    case 'glob':
      return truncate(pickString(obj, ['pattern']), 40)
    case 'task':
      return truncate(pickString(obj, ['description', 'subagent_type']), 40)
    default:
      return truncate(firstStringValue(obj), 40)
  }
}

export function formatLiveLine(
  label: string,
  tool: string,
  arg: string,
  elapsedMs: number,
  toolCount: number,
  status = '',
): string {
  const toolPart = tool === '' ? 'thinking' : arg === '' ? tool : `${tool} ${arg}`
  const tools = `${toolCount} tool${toolCount === 1 ? '' : 's'}`
  const suffix = status === '' ? '' : ` ${MIDDLE_DOT} ${status}`
  return `  ${label.padEnd(10)} ${ARROW} ${toolPart} ${MIDDLE_DOT} ${formatDuration(elapsedMs)} ${MIDDLE_DOT} ${tools}${suffix}`
}

export function formatStepFooter(
  label: string,
  elapsedMs: number,
  toolCount: number,
  tokens: { input: number; output: number },
): string {
  const tools = `${toolCount} tool${toolCount === 1 ? '' : 's'}`
  return `  ${label} ${CHECK} ${formatDuration(elapsedMs)} ${MIDDLE_DOT} ${tools} ${MIDDLE_DOT} in ${tokens.input} / out ${tokens.output}`
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
      const status = reporter.statusSuffix?.() ?? ''
      const suffix = status === '' ? '' : ` ${MIDDLE_DOT} ${status}`
      reporter.live([`[${label}] ${formatDuration(Date.now() - start)}...${suffix}`])
    }, 1000)
  }
  try {
    const result = await fn()
    return { result, durationMs: Date.now() - start }
  } finally {
    if (timer !== null) {
      clearInterval(timer)
    }
    reporter.clearLive()
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
    const suffix = this.statusSuffix()
    return suffix === '' ? '' : `  ${'status'.padEnd(10)} ${suffix}`
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
