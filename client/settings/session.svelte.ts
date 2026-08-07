// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { FetchError } from '../shared/fetcher-helpers.js'
import type { AvailableContext, BootstrapData } from './fetcher-schemas.js'
import { exchangeCode, fetchBootstrap, onUnauthorized, setCsrfToken } from './fetchers.js'

type Status = 'loading' | 'ready' | 'unauthenticated' | 'failed'

export const settingsSession = $state({
  status: 'loading' as Status,
  /** Non-empty only while status is 'failed': what stopped the bootstrap. */
  failureMessage: '',
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
  settingsSession.failureMessage = ''
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

/**
 * The code from the settings link, retained so retryBootstrap() can replay an
 * exchange whose transport failed — the server never consumed it, and index.ts
 * has already stripped it from the URL. Never logged.
 */
let lastCode: string | null = null

export async function bootstrapSession(code: string | null): Promise<void> {
  lastCode = code
  try {
    const data = code !== null && code.length > 0 ? await exchangeCode(code) : await fetchBootstrap()
    applyBootstrap(data)
  } catch (error) {
    // 401 is the server's only "this session cannot be recovered" answer: an invalid or
    // expired code, or a bootstrap with no cookie. Everything else -- 5xx, 429, a dropped
    // connection, a body that fails the schema -- is transient enough that a retry can win.
    if (error instanceof FetchError && error.status === 401) {
      settingsSession.failureMessage = ''
      settingsSession.status = 'unauthenticated'
      return
    }
    settingsSession.failureMessage = error instanceof Error ? error.message : String(error)
    settingsSession.status = 'failed'
  }
}

export async function retryBootstrap(): Promise<void> {
  settingsSession.status = 'loading'
  settingsSession.failureMessage = ''
  await bootstrapSession(lastCode)
}

let registered = false
export function registerExpiryHandler(): void {
  if (registered) return
  registered = true
  onUnauthorized(() => {
    settingsSession.failureMessage = ''
    settingsSession.status = 'unauthenticated'
  })
}
