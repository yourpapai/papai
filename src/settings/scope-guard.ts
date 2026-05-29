// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { SettingsPrincipal } from './principal.js'

/** Sentinel config context for system/admin-tier actions. */
export const ADMIN_SYSTEM_CONTEXT_ID = '__system__'

export type ScopeTarget =
  | { readonly kind: 'personal' }
  | { readonly kind: 'group'; readonly contextId: string }
  | { readonly kind: 'admin'; readonly requireSuperAdmin?: boolean }

export type ScopeRequest = {
  readonly action: 'read' | 'write'
  readonly target: ScopeTarget
}

export type ScopeResult =
  | { readonly ok: true; readonly contextId: string }
  | { readonly ok: false; readonly status: 403 }

const DENY: ScopeResult = { ok: false, status: 403 }

/**
 * Resolve and authorize the concrete config context a handler may act on.
 * Returns the validated contextId, or a 403 result. Handlers must use the
 * returned contextId, never a client-supplied one.
 */
export function requireScope(principal: SettingsPrincipal, request: ScopeRequest): ScopeResult {
  const { target } = request

  if (target.kind === 'personal') {
    if (!principal.authorized) return DENY
    return { ok: true, contextId: principal.personalConfigContextId }
  }

  if (target.kind === 'group') {
    const manageable = principal.manageableGroups.some((g) => g.contextId === target.contextId)
    if (manageable || principal.isBotAdmin) {
      return { ok: true, contextId: getConfigContextIdFromStorageContextId(target.contextId) }
    }
    return DENY
  }

  // admin tier
  if (!principal.isBotAdmin) return DENY
  if (target.requireSuperAdmin === true && !principal.isSuperAdmin) return DENY
  return { ok: true, contextId: ADMIN_SYSTEM_CONTEXT_ID }
}
