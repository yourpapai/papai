// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// NOTE: this validator only inspects the instance-scoped baseUrl. It is reached both
// from task-instance config validation and from resolver-time
// validateEffectiveTaskProviderConfigResult (which passes the merged config including
// the context-scoped token). The token is intentionally ignored here; token validation
// happens during /setup.
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
