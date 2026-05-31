// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SettingsPrincipal } from '../../settings/principal.js'
import {
  authenticateSettingsRequest,
  verifyCsrf,
  type AuthenticatedSettingsRequest,
} from '../../settings/request-auth.js'
import { requireScope, type ScopeResult } from '../../settings/scope-guard.js'

export const settingsJson = (status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })

export type AuthOutcome =
  | { readonly ok: true; readonly authed: AuthenticatedSettingsRequest }
  | { readonly ok: false; readonly response: Response }

export function authenticate(req: Request, nowMs: number = Date.now()): AuthOutcome {
  const authed = authenticateSettingsRequest(req, nowMs)
  if (authed === null) return { ok: false, response: settingsJson(401, { error: 'unauthenticated' }) }
  return { ok: true, authed }
}

/** Returns a 403 Response when the CSRF header is missing/invalid, otherwise null. */
export function requireCsrf(req: Request, authed: AuthenticatedSettingsRequest): Response | null {
  if (!verifyCsrf(req, authed.session)) return settingsJson(403, { error: 'invalid csrf token' })
  return null
}

export type ParsedBody =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response }

export async function parseJsonBody(req: Request): Promise<ParsedBody> {
  try {
    return { ok: true, value: await req.json() }
  } catch {
    return { ok: false, response: settingsJson(400, { error: 'invalid JSON body' }) }
  }
}

export type ContextScope = { readonly contextId: string; readonly kind: 'personal' | 'group' }
export type ScopeOutcome =
  | { readonly ok: true; readonly scope: ContextScope }
  | { readonly ok: false; readonly response: Response }

/**
 * Resolve a client-supplied raw contextId into a validated, canonical contextId.
 * Omitted or personal-matching ids resolve to the personal scope; everything else
 * is treated as a managed-group target. Always use `scope.contextId` for storage
 * access — never the raw client value.
 */
export function resolveContextScope(
  principal: SettingsPrincipal,
  action: 'read' | 'write',
  rawContextId: string | undefined,
): ScopeOutcome {
  const isPersonal = rawContextId === undefined || rawContextId === principal.personalConfigContextId
  const result: ScopeResult = isPersonal
    ? requireScope(principal, { action, target: { kind: 'personal' } })
    : requireScope(principal, { action, target: { kind: 'group', contextId: rawContextId } })
  if (!result.ok) return { ok: false, response: settingsJson(403, { error: 'forbidden' }) }
  return { ok: true, scope: { contextId: result.contextId, kind: isPersonal ? 'personal' : 'group' } }
}
