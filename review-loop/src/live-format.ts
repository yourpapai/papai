// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

const ELLIPSIS = '\u2026'
const ARROW = '\u25B6'
const CHECK = '\u2713'
export const MIDDLE_DOT = '\u00B7'
const TIMES = '×'

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

export function truncate(value: string, max: number): string {
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

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

const ACTIVITY_VERB: Record<string, string> = {
  reviewer: 'review',
  matcher: 'match',
  fixer: 'fix',
  inspector: 'inspect',
  build: 'build',
}

export function activitySummary(keys: Iterable<string>): string {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const base = key.split('-')[0] ?? key
    const verb = ACTIVITY_VERB[base] ?? base
    counts.set(verb, (counts.get(verb) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const [verb, n] of counts) {
    parts.push(n === 1 ? verb : `${verb}${TIMES}${n}`)
  }
  return parts.join('+')
}
