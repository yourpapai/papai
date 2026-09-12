// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// NOTE: this validator inspects only the instance-scoped repo and baseUrl. It is
// reached both from task-instance config validation and from resolver-time
// validateEffectiveTaskProviderConfigResult (which passes the merged config
// including the context-scoped token). The token is intentionally ignored here;
// token handling happens during /setup. An absent/empty baseUrl is valid — the
// default https://api.github.com is applied at request time.
export function validateConfig(config: Record<string, string>): Promise<{ ok: true } | { ok: false; reason: string }> {
  const repo = config['repo'] ?? ''
  if (repo.trim().length === 0) return Promise.resolve({ ok: false, reason: 'repo is required' })
  if (!/^[^\s/]+\/[^\s/]+$/u.test(repo)) {
    return Promise.resolve({ ok: false, reason: 'repo must be in owner/repo form' })
  }

  const baseUrl = config['baseUrl']?.trim() ?? ''
  if (baseUrl.length > 0) {
    let parsed: URL
    try {
      parsed = new URL(baseUrl)
    } catch {
      return Promise.resolve({ ok: false, reason: 'baseUrl must be a valid URL' })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return Promise.resolve({ ok: false, reason: 'baseUrl must use http or https' })
    }
  }

  return Promise.resolve({ ok: true })
}
