// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AvailableContext, BootstrapData } from './fetcher-schemas.js'
import { exchangeCode, fetchBootstrap, onUnauthorized, setCsrfToken } from './fetchers.js'

type Status = 'loading' | 'ready' | 'unauthenticated'

export const settingsSession = $state({
  status: 'loading' as Status,
  display: '',
  isBotAdmin: false,
  isSuperAdmin: false,
  contexts: [] as AvailableContext[],
  activeContextId: '',
})

function applyBootstrap(data: BootstrapData): void {
  setCsrfToken(data.csrfToken)
  settingsSession.display = data.display
  settingsSession.isBotAdmin = data.principal.isBotAdmin
  settingsSession.isSuperAdmin = data.principal.isSuperAdmin
  settingsSession.contexts = [...data.contexts]
  const stillValid = data.contexts.some((c) => c.contextId === settingsSession.activeContextId)
  settingsSession.activeContextId = stillValid ? settingsSession.activeContextId : (data.contexts[0]?.contextId ?? '')
  settingsSession.status = 'ready'
}

export function setActiveContext(contextId: string): void {
  if (settingsSession.contexts.some((c) => c.contextId === contextId)) {
    settingsSession.activeContextId = contextId
  }
}

export function activeContext(): AvailableContext | undefined {
  return settingsSession.contexts.find((c) => c.contextId === settingsSession.activeContextId)
}

export async function bootstrapSession(code: string | null): Promise<void> {
  try {
    const data = code !== null && code.length > 0 ? await exchangeCode(code) : await fetchBootstrap()
    applyBootstrap(data)
  } catch {
    settingsSession.status = 'unauthenticated'
  }
}

let registered = false
export function registerExpiryHandler(): void {
  if (registered) return
  registered = true
  onUnauthorized(() => {
    settingsSession.status = 'unauthenticated'
  })
}
