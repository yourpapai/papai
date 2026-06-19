// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseScopedContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { getToolPrefs, hasStoredToolPrefs, setToolPrefs, type ToolPrefs } from './tool-preferences.js'

const log = logger.child({ scope: 'tools:admin-defaults' })

/** Reserved sentinel prefix for the per-instance admin default tool_prefs context. */
const ADMIN_TOOL_DEFAULTS_PREFIX = '__admin_tool_defaults__:'

export function adminToolDefaultsContextId(platformInstanceId: string): string {
  return `${ADMIN_TOOL_DEFAULTS_PREFIX}${platformInstanceId}`
}

function isAdminToolDefaultsContextId(contextId: string): boolean {
  return contextId.startsWith(ADMIN_TOOL_DEFAULTS_PREFIX)
}

function prefsAreEmpty(prefs: ToolPrefs): boolean {
  return (
    Object.keys(prefs.riskDefaults ?? {}).length === 0 &&
    Object.keys(prefs.domainDefaults).length === 0 &&
    Object.keys(prefs.toolOverrides).length === 0
  )
}

/** The configured admin default for an instance, or null when unset / empty (allow-all). */
export function getAdminToolDefaults(platformInstanceId: string): ToolPrefs | null {
  const prefs = getToolPrefs(adminToolDefaultsContextId(platformInstanceId))
  return prefsAreEmpty(prefs) ? null : prefs
}

/**
 * Seed a context's tool_prefs from its instance admin default the first time the context
 * is built with no stored prefs. Idempotent (guarded by row presence); never seeds the
 * sentinel context, a non-scoped context, or when no admin default exists.
 */
export function maybeSeedAdminToolDefaults(prefsContextId: string): void {
  if (isAdminToolDefaultsContextId(prefsContextId)) return
  if (hasStoredToolPrefs(prefsContextId)) return
  const parsed = parseScopedContextId(prefsContextId)
  if (parsed === null) return
  const adminDefault = getAdminToolDefaults(parsed.platformInstanceId)
  if (adminDefault === null) return
  setToolPrefs(prefsContextId, adminDefault)
  log.info({ contextId: prefsContextId, platformInstanceId: parsed.platformInstanceId }, 'Seeded admin tool defaults')
}
