// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { ProgressReporter } from './progress-log.js'

const ELLIPSIS = '\u2026'
const ARROW = '\u25B6'
const CHECK = '\u2713'
const MIDDLE_DOT = '\u00B7'

const CLEAR_LINE = '\r\u001b[2K'

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

export function formatLiveLine(label: string, tool: string, arg: string, elapsedMs: number, toolCount: number): string {
  const toolPart = tool === '' ? 'thinking' : arg === '' ? tool : `${tool} ${arg}`
  const tools = `${toolCount} tool${toolCount === 1 ? '' : 's'}`
  return `  ${label.padEnd(10)} ${ARROW} ${toolPart} ${MIDDLE_DOT} ${formatDuration(elapsedMs)} ${MIDDLE_DOT} ${tools}`
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
      reporter.live([`[${label}] ${formatDuration(Date.now() - start)}...`])
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
  readonly dynamic: boolean
  private readonly stream: RendererStream
  private liveActive = false

  constructor(stream: RendererStream) {
    this.stream = stream
    this.dynamic = stream.isTTY === true
  }

  event(message: string): void {
    this.clearLive()
    this.stream.write(`${message}\n`)
  }

  log(message: string): void {
    this.event(message)
  }

  live(lines: readonly string[]): void {
    if (!this.dynamic) {
      for (const line of lines) {
        this.stream.write(`${line}\n`)
      }
      return
    }
    const output = lines.map((line) => this.fit(line)).join('\n')
    this.stream.write(`${CLEAR_LINE}${output}`)
    this.liveActive = lines.length > 0
  }

  clearLive(): void {
    if (!this.liveActive) {
      return
    }
    this.stream.write(CLEAR_LINE)
    this.liveActive = false
  }

  private fit(line: string): string {
    const max = this.stream.columns ?? 80
    return truncate(line, max)
  }
}
