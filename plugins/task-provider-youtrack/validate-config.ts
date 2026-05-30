// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// NOTE: validates instance-scoped config only (baseUrl). The context-scoped token
// is not available at instance-config validation time; token validation happens during /setup.
export function validateConfig(config: Record<string, string>): Promise<{ ok: true } | { ok: false; reason: string }> {
  const baseUrl = config['baseUrl']?.trim() ?? ''
  if (baseUrl.length === 0) return Promise.resolve({ ok: false, reason: 'baseUrl is required' })
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return Promise.resolve({ ok: false, reason: 'baseUrl must be a valid URL' })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Promise.resolve({ ok: false, reason: 'baseUrl must use http or https' })
  }
  return Promise.resolve({ ok: true })
}
