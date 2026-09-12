// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AiOutputSettings } from './ai-output-settings.js'
import type { ReplyFn } from './chat/types.js'
import { t, type Locale } from './i18n/index.js'

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
const SECRET_VALUE_PATTERN = /(api[_-]?key|token|secret|password|authorization|cookie)\s*[:=]\s*\S+|bearer\s+\S+/iu
const URL_VALUE_PATTERN = /https?:\/\/\S+/iu
const URL_KEY_PATTERN = /(^|[_-])(url|uri|href|link)([_-]|$)|url$/iu
const PAYLOAD_KEY_PATTERN = /(attachment|blob|body|content|file[_-]?content)/iu
const MAX_SANITIZED_STRING_LENGTH = 240
const MAX_ARRAY_ITEMS = 10
const MAX_OBJECT_ENTRIES = 20

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype === Object.prototype) return true
  return prototype === null
}

function sanitizeString(value: string): string {
  if (SECRET_VALUE_PATTERN.test(value)) return '[redacted]'
  if (URL_VALUE_PATTERN.test(value)) return '[redacted]'
  return value.length > MAX_SANITIZED_STRING_LENGTH
    ? `${value.slice(0, MAX_SANITIZED_STRING_LENGTH)}... [truncated ${value.length} chars]`
    : value
}

function shouldRedactKey(key: string): boolean {
  if (SECRET_KEY_PATTERN.test(key)) return true
  if (URL_KEY_PATTERN.test(key)) return true
  return PAYLOAD_KEY_PATTERN.test(key)
}

function sanitizeArray(value: readonly unknown[], seen: WeakSet<object>): unknown {
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  const sanitized = value.slice(0, MAX_ARRAY_ITEMS).map((nested) => sanitizeValue(nested, seen))
  seen.delete(value)
  return sanitized
}

function sanitizeRecord(value: Record<string, unknown>, seen: WeakSet<object>): unknown {
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  const sanitized = Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_OBJECT_ENTRIES)
      .map(([key, nested]) => [key, shouldRedactKey(key) ? '[redacted]' : sanitizeValue(nested, seen)]),
  )
  seen.delete(value)
  return sanitized
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return sanitizeArray(value, seen)
  if (!isPlainRecord(value)) return `[${typeof value}]`
  return sanitizeRecord(value, seen)
}

function sanitizeRootValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet())
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatValue(value: unknown, settings: AiOutputSettings): string {
  return stableStringify(settings.detailLevel === 'raw' ? value : sanitizeRootValue(value))
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return stableStringify(error)
}

function formatErrorValue(error: unknown, settings: AiOutputSettings): string {
  if (settings.detailLevel === 'raw') return stableStringify(formatError(error))
  if (error instanceof Error || typeof error === 'string') return stableStringify('[redacted]')
  return formatValue(error, settings)
}

function formatCodeBlock(value: unknown, settings: AiOutputSettings): string {
  const formatted = formatValue(value, settings)
  return '```json\n' + formatted + '\n```'
}

function formatToolFinishedMessage(event: ToolFinishedEvent, settings: AiOutputSettings, locale: Locale): string {
  const status = event.success ? t('progress.statusSuccess', locale) : t('progress.statusFailed', locale)
  const duration =
    event.durationMs === undefined ? '' : t('progress.durationSuffix', locale, { durationMs: event.durationMs })
  const head = t('progress.toolFinished', locale, { toolName: event.toolName, status }) + duration
  const lines = [head, '']
  lines.push(t('progress.inputLabel', locale), formatCodeBlock(event.input, settings))
  if (event.output !== undefined) {
    lines.push('', t('progress.outputLabel', locale), formatCodeBlock(event.output, settings))
  }
  if (event.error !== undefined) {
    lines.push('', t('progress.errorLabel', locale), '```json\n' + formatErrorValue(event.error, settings) + '\n```')
  }
  return lines.join('\n')
}

function formatToolStartedMessage(event: ToolStartedEvent, settings: AiOutputSettings, locale: Locale): string {
  const lines = [t('progress.toolStarted', locale, { toolName: event.toolName }), '']
  lines.push(t('progress.inputLabel', locale), formatCodeBlock(event.input, settings))
  return lines.join('\n')
}

function formatReasoningMessage(text: string, settings: AiOutputSettings, locale: Locale): string {
  const content =
    settings.detailLevel === 'raw' ? text.trim() : t('progress.reasoningHidden', locale, { count: text.trim().length })
  return t('progress.reasoningTitle', locale) + '\n\n```json\n' + JSON.stringify(content) + '\n```'
}

export function createAiProgressReporter(
  reply: ReplyFn,
  settings: AiOutputSettings,
  locale: Locale = 'en',
): AiProgressReporter {
  const pendingToolStarts = new Map<string, ToolStartedEvent>()
  const toolMessages: string[] = []
  const reasoningMessages: string[] = []

  return {
    toolStarted: (event) => {
      if (settings.toolVisibility !== 'on') return
      pendingToolStarts.set(event.toolCallId, event)
    },
    toolFinished: (event) => {
      if (settings.toolVisibility !== 'on') return
      pendingToolStarts.delete(event.toolCallId)
      toolMessages.push(formatToolFinishedMessage(event, settings, locale))
    },
    reasoning: (...args) => {
      const [text, raw] = args
      if (settings.reasoningVisibility !== 'on') return
      if (settings.detailLevel === 'raw' && raw !== undefined) {
        reasoningMessages.push(t('progress.reasoningTitle', locale) + '\n\n' + formatCodeBlock(raw, settings))
        return
      }
      if (text === undefined || text.trim() === '') return
      reasoningMessages.push(formatReasoningMessage(text, settings, locale))
    },
    flush: async () => {
      const startedMessages = Array.from(pendingToolStarts.values()).map((event) =>
        formatToolStartedMessage(event, settings, locale),
      )
      const allMessages = [...startedMessages, ...toolMessages, ...reasoningMessages]
      if (allMessages.length === 0) return
      await allMessages.reduce((chain, message) => chain.then(() => reply.formatted(message)), Promise.resolve())
      pendingToolStarts.clear()
      toolMessages.length = 0
      reasoningMessages.length = 0
    },
  }
}
