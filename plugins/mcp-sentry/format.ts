// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const SECRET_KEY = /password|token|secret|apikey|api_key|credential|authorization|cookie|session/iu

function sanitizeKeyValue(key: string | undefined, value: unknown): unknown {
  if (key === undefined || key === 'key') return value
  if (!SECRET_KEY.test(key)) return value
  return value ? '[REDACTED]' : value
}

export function sanitizeObject(input: unknown, key?: string): unknown {
  const masked = sanitizeKeyValue(key, input)
  if (masked === '[REDACTED]') return masked
  if (Array.isArray(input)) return input.map((item) => sanitizeObject(item))
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input)) out[k] = sanitizeObject(v, k)
    return out
  }
  return input
}
