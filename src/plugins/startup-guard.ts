// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StartupGuardInput = Readonly<{
  directoryMissing: boolean
  debugServerEnabled: boolean
}>

export type StartupGuardDecision = Readonly<
  { action: 'ok' } | { action: 'warn'; reason: string } | { action: 'exit'; reason: string }
>

export function evaluateStartupGuard(input: StartupGuardInput): StartupGuardDecision {
  if (!input.directoryMissing) return { action: 'ok' }
  if (input.debugServerEnabled) {
    return {
      action: 'exit',
      reason:
        'Plugins directory is missing but DEBUG_SERVER=true. The settings web UI cannot dispatch task-provider provisioning without it. Rebuild the Docker image with `COPY plugins ./plugins` or mount the plugins tree into the container.',
    }
  }
  return {
    action: 'warn',
    reason:
      'Plugins directory is missing. The bot will start in degraded mode; task-provider plugins (Kaneo, YouTrack) are unavailable.',
  }
}
