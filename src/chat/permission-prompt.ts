// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'

import { logger } from '../logger.js'
import type { ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:permission-prompt' })

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function flattenArguments(obj: Record<string, unknown>, prefix = '', depth = 0): [string, unknown][] {
  const result: [string, unknown][] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value) && depth < 3) {
      result.push(...flattenArguments(value, fullKey, depth + 1))
    } else if (isPlainObject(value)) {
      result.push([fullKey, '[Object]'])
    } else {
      result.push([fullKey, value])
    }
  }
  return result
}

function formatArray(arr: unknown[]): string {
  return arr.map((item) => String(item)).join(', ')
}

function isSensitiveFieldName(name: string): boolean {
  return /api[_-]?key|token|password|secret|credential/iu.test(name)
}

function maskValue(value: string): string {
  if (value.length <= 7) return '***'
  return value.slice(0, 3) + '...' + value.slice(-3)
}

function maskSensitive(value: string): string {
  if (/^(sk-|token-|password-|secret-|key-)/iu.test(value)) {
    return value.slice(0, 4) + '...' + value.slice(-3)
  }
  return value
}

function formatValue(value: unknown, fieldName?: string): string {
  if (value === null || value === undefined) return '(empty)'
  if (Array.isArray(value)) return formatArray(value)
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'function') return '[Function]'
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'bigint') return applyMasking(value.toString(), fieldName)
  if (typeof value === 'boolean') return applyMasking(value ? 'true' : 'false', fieldName)
  if (typeof value === 'number') return applyMasking(value.toString(), fieldName)
  if (typeof value === 'string') return applyMasking(value, fieldName)
  return '(unknown)'
}

function applyMasking(str: string, fieldName?: string): string {
  return fieldName !== undefined && isSensitiveFieldName(fieldName) ? maskValue(str) : maskSensitive(str)
}

export function formatArguments(args: Record<string, unknown>): string {
  const entries = flattenArguments(args)
  if (entries.length === 0) return ''

  const lines = entries.map(([key, value]) => {
    const formatted = formatValue(value, key)
    return `${key}: ${formatted}`
  })

  return lines.join('\n')
}

export type PermissionDecision = 'allow' | 'deny'

interface PendingRequest {
  contextId: string
  toolName: string
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRequest>()

function generateRequestId(): string {
  return randomBytes(6).toString('base64url')
}

// CommonMark inline-disruptive punctuation. Backslash-escaping these neutralizes
// LLM-supplied reasons that attempt (accidentally or adversarially) to inject
// bold, italics, code spans, or links into the permission prompt.
const MARKDOWN_ESCAPE_PATTERN = /[\\`*_~[\]()]/gu

function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_ESCAPE_PATTERN, (ch) => `\\${ch}`)
}

export function formatPrompt(toolName: string, reason: string, args: Record<string, unknown>): string {
  const argsSection = formatArguments(args)
  const parts = [`🔐 Run \`${toolName}\`?`]

  if (argsSection) {
    parts.push('')
    parts.push('**Arguments:**')
    parts.push(argsSection)
  }

  parts.push('')
  parts.push(escapeMarkdown(reason))

  return parts.join('\n')
}

export function formatPermissionDecisionText(sourceMessageText: string, decision: PermissionDecision): string {
  const label = decision === 'allow' ? 'Allowed.' : 'Denied.'
  return `${sourceMessageText.trimEnd()}\n\n${label}`
}

export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string; args: Record<string, unknown> },
): Promise<PermissionDecision> {
  const id = generateRequestId()
  const body = formatPrompt(req.toolName, req.reason, req.args)
  await reply.buttons(body, {
    buttons: [
      { text: '✅ Allow', callbackData: `perm:a:${id}`, style: 'primary' },
      { text: '🚫 Deny', callbackData: `perm:d:${id}`, style: 'secondary' },
    ],
  })
  return new Promise<PermissionDecision>((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id)
      if (entry === undefined) return
      pending.delete(id)
      log.warn({ contextId, toolName: req.toolName, id }, 'Permission prompt timed out; denying')
      entry.resolve('deny')
    }, PERMISSION_TIMEOUT_MS)
    pending.set(id, { contextId, toolName: req.toolName, resolve, timer })
  })
}

export function resolvePermissionRequest(id: string, decision: PermissionDecision): boolean {
  const entry = pending.get(id)
  if (entry === undefined) return false
  pending.delete(id)
  clearTimeout(entry.timer)
  entry.resolve(decision)
  return true
}

export function peekPermissionRequest(id: string): { contextId: string; toolName: string } | null {
  const entry = pending.get(id)
  if (entry === undefined) return null
  return { contextId: entry.contextId, toolName: entry.toolName }
}

export function resetPermissionPromptForTesting(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer)
  pending.clear()
}
