// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AiOutputSettings } from './ai-output-settings.js'
import type { ReplyFn } from './chat/types.js'

type ToolEventBase = {
  toolName: string
  toolCallId: string
  input: unknown
}

export type ToolStartedEvent = ToolEventBase

export type ToolFinishedEvent = ToolEventBase & {
  durationMs: number | undefined
  success: boolean
} & Partial<Record<'output' | 'error', unknown>>

export type AiProgressReporter = {
  toolStarted: (event: ToolStartedEvent) => void
  toolFinished: (event: ToolFinishedEvent) => void
  reasoning: (...args: [text: string | undefined] | [text: string | undefined, raw: unknown]) => void
  flush: () => Promise<void>
}

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization|cookie)/iu
const MAX_SANITIZED_STRING_LENGTH = 240
const MAX_ARRAY_ITEMS = 10
const MAX_OBJECT_ENTRIES = 20

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype === Object.prototype) return true
  return prototype === null
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return stableStringify(error)
}

function sanitizeString(value: string): string {
  return value.length > MAX_SANITIZED_STRING_LENGTH
    ? `${value.slice(0, MAX_SANITIZED_STRING_LENGTH)}... [truncated ${value.length} chars]`
    : value
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((nested) => sanitizeValue(nested))
  if (!isPlainRecord(value)) return `[${typeof value}]`

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_OBJECT_ENTRIES)
      .map(([key, nested]) => [key, SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeValue(nested)]),
  )
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatValue(value: unknown, settings: AiOutputSettings): string {
  return stableStringify(settings.detailLevel === 'raw' ? value : sanitizeValue(value))
}

function appendToolFinished(lines: string[], event: ToolFinishedEvent, settings: AiOutputSettings): void {
  const status = event.success ? 'success' : 'failed'
  const duration = event.durationMs === undefined ? '' : ` in ${event.durationMs}ms`
  lines.push(`- Tool \`${event.toolName}\` ${status}${duration}`)
  lines.push(`  Input: \`${formatValue(event.input, settings)}\``)
  if (event.output !== undefined) lines.push(`  Output: \`${formatValue(event.output, settings)}\``)
  if (event.error !== undefined) lines.push(`  Error: \`${formatValue(formatError(event.error), settings)}\``)
}

export function createAiProgressReporter(reply: ReplyFn, settings: AiOutputSettings): AiProgressReporter {
  const toolLines: string[] = []
  const reasoningLines: string[] = []

  return {
    toolStarted: (event) => {
      if (settings.toolVisibility !== 'on') return
      toolLines.push(`- Tool \`${event.toolName}\` started`)
      toolLines.push(`  Input: \`${formatValue(event.input, settings)}\``)
    },
    toolFinished: (event) => {
      if (settings.toolVisibility !== 'on') return
      appendToolFinished(toolLines, event, settings)
    },
    reasoning: (...args) => {
      const [text, raw] = args
      if (settings.reasoningVisibility !== 'on') return
      if (settings.detailLevel === 'raw' && raw !== undefined) {
        reasoningLines.push(formatValue(raw, settings))
        return
      }
      if (text === undefined || text.trim() === '') return
      reasoningLines.push(text.trim())
    },
    flush: async () => {
      if (toolLines.length === 0 && reasoningLines.length === 0) return
      const lines = ['AI execution details']
      if (toolLines.length > 0) lines.push('', 'Tool calls', ...toolLines)
      if (reasoningLines.length > 0) lines.push('', 'Reasoning', ...reasoningLines)
      await reply.formatted(lines.join('\n'))
      toolLines.length = 0
      reasoningLines.length = 0
    },
  }
}
