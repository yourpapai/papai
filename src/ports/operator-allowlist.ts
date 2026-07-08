// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Who may use operator-gated tools: everyone (`'members'`) or an explicit allowlist of chat user ids. */
export type WhoMayUse = 'members' | string[]

/** Resolves the who-may-use allowlist for a given platform instance. */
export type OperatorAllowlistResolver = (platformInstanceId: string) => WhoMayUse

/**
 * Lets core resolve the operator allowlist without importing the feature that owns the policy.
 * A trusted module registers the resolver at load; the orchestrator consults `resolve()`.
 * Default (no resolver registered) is `'members'` — everyone allowed — matching the historical
 * default when no guardrail policy is configured.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard test scans `src/ports/**`
 * for feature/provider names. Do not reference concrete module or feature names here.
 */
export interface OperatorAllowlistPort {
  register(resolver: OperatorAllowlistResolver): void
  resolve(platformInstanceId: string): WhoMayUse
}

/** Create an isolated port (used by tests and, as a singleton, by the runtime). */
export function createOperatorAllowlistPort(): OperatorAllowlistPort {
  let resolver: OperatorAllowlistResolver = () => 'members'
  return {
    register: (r) => {
      resolver = r
    },
    resolve: (platformInstanceId) => resolver(platformInstanceId),
  }
}

/** Process-wide singleton: a trusted module registers into it at load, the orchestrator reads it. */
export const operatorAllowlistPort: OperatorAllowlistPort = createOperatorAllowlistPort()
