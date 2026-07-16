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

// TeamCity's REST API wraps every collection in a single-child envelope
// (e.g. parameters -> { property: [...] }) and uses hyphenated keys. These
// tables drive flattenTeamCity: envelope key -> inner array key, and
// hyphenated key -> camelCase rename. Purely cosmetic; runs AFTER redaction.
const TC_ENVELOPES: Record<string, string> = {
  parameters: 'property',
  properties: 'property',
  projects: 'project',
  buildTypes: 'buildType',
  templates: 'buildType',
  steps: 'step',
  triggers: 'trigger',
  features: 'feature',
  'vcs-root-entries': 'vcs-root-entry',
  'artifact-dependencies': 'artifact-dependency',
  'snapshot-dependencies': 'snapshot-dependency',
}

const TC_RENAMES: Record<string, string> = {
  'vcs-root-entries': 'vcsRootEntries',
  'vcs-root': 'vcsRoot',
  'checkout-rules': 'checkoutRules',
  'artifact-dependencies': 'artifactDependencies',
  'snapshot-dependencies': 'snapshotDependencies',
  'source-buildType': 'sourceBuildType',
}

function unwrapTeamCityEnvelope(key: string, value: unknown): unknown {
  const inner = TC_ENVELOPES[key]
  if (inner === undefined || !isRecord(value)) return flattenTeamCity(value)
  const arr = value[inner]
  if (Array.isArray(arr)) return arr.map((item) => flattenTeamCity(item))
  // TeamCity normally wraps a single-child array; tolerate a lone object
  // (some legacy hyphenated collections) by wrapping it rather than silently
  // dropping the data. Any other (absent/scalar) inner shape is an empty set.
  if (isRecord(arr)) return [flattenTeamCity(arr)]
  return []
}

export function flattenTeamCity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => flattenTeamCity(item))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    const outKey = TC_RENAMES[key] ?? key
    out[outKey] = unwrapTeamCityEnvelope(key, v)
  }
  return out
}
