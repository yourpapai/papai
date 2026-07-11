// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// TeamCity build/VCS/step/parameter configs routinely embed secrets as
// `{ name, value }` properties (e.g. `{ name: 'env.DEPLOY_TOKEN', value: 'abc' }`).
// This plugin performs no AI-based redaction, so this sanitizer is the ONLY
// protection against leaking those secrets to the coding agent. It must run
// over every config payload returned by the TeamCity MCP tools before the
// response reaches the model.
const SECRET_PROP = /password|token|secret|key|credential/iu

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizeTeamCityConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeTeamCityConfig(item))
  if (!isRecord(value)) return value

  const name = value['name']
  const isSecret = typeof name === 'string' && SECRET_PROP.test(name)

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    const redactable = v !== undefined && v !== null && v !== false && v !== '' && v !== 0
    if (isSecret && key === 'value' && redactable) {
      out[key] = '[REDACTED]'
    } else {
      out[key] = sanitizeTeamCityConfig(v)
    }
  }
  return out
}
