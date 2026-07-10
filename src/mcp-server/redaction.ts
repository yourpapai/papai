// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { McpRedactionConfig } from '../coding-credentials/mcp-redaction.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'mcp-server:redaction' })

export const BLOCK_PREFIX = '[RESULT BLOCKED BY VALIDATION'
const DEFAULT_LABEL = 'REDACTED'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_SIZE = 25_000
export const MAX_REDACTION_INPUT_CHARS = 100_000

export interface Finding {
  value: string
  label: string
}

export type HttpFetch = (url: string, init: RequestInit | undefined) => Promise<Response>

// Shared default redaction prompt for all redacting plugins (Plan 1). Per-plugin override is a follow-up.
export const DEFAULT_REDACTION_PROMPT = [
  'You detect sensitive data in JSON tool responses bound for an external AI coding agent.',
  'Return ONLY a JSON array of objects: [{"string":"exact substring from input","redacted":"CATEGORY"}].',
  'Do not rewrite the input. Do not add markdown or prose around the JSON. If nothing sensitive, return [].',
  'Find and mask: personal data (full names, usernames, emails, phones, IPs, addresses, passport/INN/SNILS),',
  'real external user/session/device ids, request/response bodies containing PII or customer data, and secrets',
  '(tokens, passwords, API keys, authorization headers, cookies, JWTs, private keys, connection strings).',
  'Do NOT mask: class/function/file names, stacktrace paths, package names, release versions, commit ids,',
  'project slugs, environment names, HTTP status codes, browser/OS names, timestamps.',
  'Allowed category labels: NAME, EMAIL, PHONE, IP, ADDRESS, USER_ID, SESSION, SECRET, CUSTOMER_DATA, REQUEST_DATA, REDACTED.',
].join('\n')

export function isBlockedResult(text: string): boolean {
  return text.startsWith(BLOCK_PREFIX)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asUnknownArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? (value as unknown[]) : undefined
}

function normalizeLabel(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_LABEL
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
  return cleaned.length > 0 ? cleaned : DEFAULT_LABEL
}

export function parseFindings(raw: string): Finding[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('internal model did not return a JSON array')
  }
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('internal model findings is not an array')
  const findings: Finding[] = []
  for (const item of parsed) {
    if (typeof item === 'string') {
      if (item.length >= 2) findings.push({ value: item, label: DEFAULT_LABEL })
      continue
    }
    if (isRecord(item)) {
      const value = item['string']
      if (typeof value === 'string' && value.length >= 2) {
        findings.push({ value, label: normalizeLabel(item['redacted']) })
      }
    }
  }
  return findings
}

export function applyRedactions(text: string, findings: Finding[]): string {
  let out = text
  for (const finding of [...findings].sort((a, b) => b.value.length - a.value.length)) {
    out = out.split(finding.value).join(`[${finding.label}]`)
  }
  return out
}

async function callInternalModel(
  systemPrompt: string,
  userContent: string,
  config: McpRedactionConfig,
  httpFetch: HttpFetch,
  parentSignal: AbortSignal | undefined,
): Promise<string> {
  const endpoint = `${config.model_url.replace(/\/+$/u, '')}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, config.timeout_ms ?? DEFAULT_TIMEOUT_MS)
  const onParentAbort = (): void => {
    controller.abort()
  }
  if (parentSignal?.aborted === true) controller.abort()
  parentSignal?.addEventListener('abort', onParentAbort)
  try {
    const res = await httpFetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model_name,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`internal model HTTP ${res.status}: ${body.slice(0, 300)}`)
    }
    const data: unknown = await res.json()
    const choices = asUnknownArray(isRecord(data) ? data['choices'] : undefined)
    const firstChoice = choices?.[0]
    const message = isRecord(firstChoice) ? firstChoice['message'] : undefined
    const content = isRecord(message) ? message['content'] : undefined
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('internal model returned empty content')
    }
    return content
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}

export async function redactText(
  text: string,
  systemPrompt: string,
  config: McpRedactionConfig,
  httpFetch: HttpFetch,
  parentSignal: AbortSignal | undefined,
): Promise<string> {
  if (text.length > MAX_REDACTION_INPUT_CHARS) {
    log.warn({ length: text.length }, 'redaction input exceeds cap; blocking (fail-closed)')
    return `${BLOCK_PREFIX}: response too large to redact safely (${text.length} chars)]`
  }
  try {
    const raw = await callInternalModel(systemPrompt, text, config, httpFetch, parentSignal)
    return applyRedactions(text, parseFindings(raw))
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn({ reason }, 'redaction failed; blocking result (fail-closed)')
    return `${BLOCK_PREFIX}: ${reason}]`
  }
}

export function sizeGuard(text: string, maxSize: number = DEFAULT_MAX_SIZE): string {
  if (text.length <= maxSize) return text
  return `${text.slice(0, maxSize)}\n\n[output truncated at ${maxSize} chars of ${text.length}]`
}
