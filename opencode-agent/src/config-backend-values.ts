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
  /**
   * The variable the value arrived under — the only name ever logged. The
   * spelling is the profile selector (design D1 of the native-OAuth
   * change): the API key runs the bare profile, the OAuth token the native
   * one. The adapter derives the profile from this name; config itself
   * stays profile-blind.
   */
  readonly name: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'
  readonly value: string
}

/** The failure code of the credential guard (design D5). */
export const CLAUDE_CREDENTIALS_CODE = 'CLAUDE_CREDENTIALS'

/** The failure code of the claude route's gateway-credential refusal (design D4). */
export const LLM_CREDENTIALS_CODE = 'LLM_CREDENTIALS'

/**
 * Reads the claude route's one chosen credential, or fails loudly.
 *
 * The guard's shape is unchanged by the profile split: exactly one spelling
 * may be set — both set fails, neither set fails — and the one that is set
 * selects the invocation profile the adapter derives (design D1): the API
 * key means the bare profile, the OAuth token the native one. The single-
 * spelling messages name both meanings, so an operator reading a failure
 * sees the selection rule rather than a refused route. Fired in `loadConfig`
 * ahead of the logger, the scrub, every GitHub call and every spawn — before
 * any model spend by construction — and never on the `opencode` route. Names
 * variables, never values.
 */
export const claudeCredential = (env: Env): ClaudeCredential => {
  const apiKey = optionalOrNull(env, 'ANTHROPIC_API_KEY')
  const oauth = optionalOrNull(env, 'CLAUDE_CODE_OAUTH_TOKEN')

  if (oauth !== null && apiKey !== null) {
    throw new ConfigError(
      'Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set, and the spelling is the claude route’s profile ' +
        'selector: the API key selects the bare profile (--bare, per-token Console billing), the OAuth token the ' +
        'native profile (neutralized non-bare invocation, subscription billing). Exactly one may run — unset one and ' +
        're-run.',
      CLAUDE_CREDENTIALS_CODE,
    )
  }
  if (oauth !== null) return { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: oauth }
  if (apiKey !== null) return { name: 'ANTHROPIC_API_KEY', value: apiKey }

  throw new ConfigError(
    'AGENT_BACKEND=claude needs exactly one Anthropic credential, and the spelling selects the invocation profile: ' +
      'ANTHROPIC_API_KEY for the bare profile (--bare, per-token Console billing) or CLAUDE_CODE_OAUTH_TOKEN for ' +
      'the native profile (neutralized non-bare invocation, subscription billing). Neither is set, so no model turn ' +
      'can run.',
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
