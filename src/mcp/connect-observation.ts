// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import type { StatusClass } from '../analytics/controlled-types.js'
import { getFeatureObserver } from '../analytics/feature-observer.js'
import type { McpAvailabilityOrigin, McpAvailabilityOutcome } from '../analytics/feature-observer.js'
import { classifyProviderError, type ProviderRequestObservation } from '../analytics/provider-observer.js'
import type { ProviderRequestScope } from '../analytics/provider-request-scope.js'
import type { McpEndpointConfig, McpPluginConfig } from './types.js'

export type ConnectObservationTarget = Readonly<{
  availabilityOrigin: McpAvailabilityOrigin
  serverRawId: string
}>

/**
 * Maps a connect failure onto the bounded availability outcome enum; never
 * carries messages or URLs. `policy_blocked` is catalog-reserved but has no
 * producer today: the pool connects directly (no connect-time host policy),
 * and the user-endpoint HTTPS rule is a config-schema parse gate, not a
 * connect-time block.
 */
const availabilityOutcomeOf = (statusClass: StatusClass): McpAvailabilityOutcome => {
  if (statusClass === 'timeout') return 'timeout'
  if (statusClass === 'auth') return 'auth_failed'
  return 'connection_failed'
}

/** Emits the controlled connect observation + availability fact; never throws. */
export const observeMcpConnect = (
  scope: ProviderRequestScope,
  clock: Readonly<{ elapsedMs: () => number }>,
  target: ConnectObservationTarget,
  caught: unknown,
): void => {
  if (scope.kind !== 'actor') return
  const classification =
    caught === null ? { statusClass: '2xx' as const, retryable: null } : classifyProviderError(caught)
  const observation: ProviderRequestObservation = {
    provider: 'mcp',
    operation: 'connect',
    durationMs: clock.elapsedMs(),
    outcome: caught === null ? 'success' : 'failure',
    statusClass: classification.statusClass,
    retryable: classification.retryable,
  }
  try {
    scope.observeProviderRequest(scope.requestContext, observation)
  } catch {
    // Observation must never change connection behavior.
  }
  const observer = getFeatureObserver()
  if (observer === null) return
  try {
    observer.mcpAvailability(scope.requestContext, {
      origin: target.availabilityOrigin,
      serverRawId: target.serverRawId,
      outcome: caught === null ? 'available' : availabilityOutcomeOf(classification.statusClass),
    })
  } catch {
    // Observation must never change connection behavior.
  }
}

function computeHash(parts: Record<string, unknown>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${JSON.stringify(parts[k])}`)
    .join('&')
  return createHash('sha256').update(sorted).digest('hex')
}

export function endpointHash(endpoint: McpEndpointConfig): string {
  return computeHash({
    transport: 'streamable-http',
    url: endpoint.url,
    headers: endpoint.headers ?? {},
  })
}

export function pluginHash(pluginId: string, mcp: McpPluginConfig): string {
  return computeHash({
    transport: mcp.transport,
    url: mcp.url ?? '',
    headers: mcp.headers ?? {},
    command: mcp.command ?? '',
    args: mcp.args ?? [],
    pluginId,
  })
}
