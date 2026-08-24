// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ConfigError } from './config-values.js'
import type { Env } from './config-values.js'
import { optional, optionalOrNull } from './config-values.js'

/**
 * The backend-selection reads: `AGENT_BACKEND` and the claude route's
 * credential demands.
 *
 * Split from `config-values.ts` when the claude route's guards pushed that
 * file past `max-lines`, along the seam its own re-export blocks already drew
 * (`config-clock-values.ts`, `config-model-values.ts`): this file is about
 * *which backend a job runs on and what it must present to run*, while the
 * parent stays about how one scalar is read and refused. Re-exported from
 * there, so callers keep naming one module — the same arrangement
 * `config-model-values.ts` has.
 */

/** The two model backends a job may run its model turns on. */
export type BackendSelection = 'opencode' | 'claude'

/**
 * `AGENT_BACKEND`, the one job-wide backend selector.
 *
 * An enum rather than a free string: the whole route forks on this value, and
 * a typo falling back to the default would silently spend the wrong account
 * instead of failing the job. Unset and empty both keep `opencode`, because the
 * workflow's job-level `env:` line forwards an unset repository variable as the
 * empty string — which the parent's `optional` convention reads as absence.
 */
export const backendSelection = (env: Env, key: string): BackendSelection => {
  const value = optional(env, key, 'opencode')
  if (value === 'opencode' || value === 'claude') return value
  throw new ConfigError(`${key} must be "opencode" or "claude", got ${JSON.stringify(value)}`)
}

/** The claude route's chosen Anthropic credential, as config carries it. */
export interface ClaudeCredential {
  /** The variable the value arrived under — the only name ever logged. */
  readonly name: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'
  readonly value: string
}

/** The failure code of the credential-exclusivity guard (design D5). */
export const CLAUDE_CREDENTIALS_CODE = 'CLAUDE_CREDENTIALS'

/** The failure code of the claude route's gateway-credential refusal (design D4). */
export const LLM_CREDENTIALS_CODE = 'LLM_CREDENTIALS'

/**
 * Reads exactly one Anthropic credential on the claude route, or fails loudly.
 *
 * Both set fails because the API key silently wins and switches billing to
 * per-token Console charges; neither set fails because no credential remains.
 * Fired in `loadConfig` ahead of the logger, the scrub, every GitHub call and
 * every spawn — before any model spend by construction — and never on the
 * `opencode` route. Names variables, never values.
 */
export const claudeCredential = (env: Env): ClaudeCredential => {
  const apiKey = optionalOrNull(env, 'ANTHROPIC_API_KEY')
  const oauth = optionalOrNull(env, 'CLAUDE_CODE_OAUTH_TOKEN')

  if (apiKey !== null && oauth !== null) {
    throw new ConfigError(
      'Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set. Exactly one may be: when both are present the ' +
        'API key silently wins and switches billing to per-token Console charges. Unset one and re-run.',
      CLAUDE_CREDENTIALS_CODE,
    )
  }
  if (apiKey !== null) return { name: 'ANTHROPIC_API_KEY', value: apiKey }
  if (oauth !== null) return { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: oauth }

  throw new ConfigError(
    'AGENT_BACKEND=claude needs exactly one Anthropic credential — ANTHROPIC_API_KEY (the documented default, ' +
      'per-token Console billing) or CLAUDE_CODE_OAUTH_TOKEN (a Pro/Max/Team/Enterprise subscription) — and neither ' +
      'is set. No model turn can run.',
    CLAUDE_CREDENTIALS_CODE,
  )
}

/**
 * Refuses a gateway credential on the claude route (design D4).
 *
 * `contain()` starts no provider proxy there, so the only thing a gateway key
 * could still feed is the review runner's `opencode run` children — whose own
 * children the model controls, the exact exposure `provider-proxy.ts` exists
 * to prevent. Unset it or stay on the opencode route; `LLM_BASE_URL` and the
 * model knobs are optional-empty and harmless.
 */
export const refuseGatewayKeyOnClaude = (env: Env): void => {
  if (optionalOrNull(env, 'LLM_API_KEY') !== null) {
    throw new ConfigError(
      'LLM_API_KEY is set on the claude route (AGENT_BACKEND=claude). The gateway credential is refused here, not ' +
        'merely unused: with no provider proxy in front of the review loop’s `opencode run` children, a present key ' +
        'would reach a subprocess whose children the model controls. Unset it, or set AGENT_BACKEND=opencode.',
      LLM_CREDENTIALS_CODE,
    )
  }
}
