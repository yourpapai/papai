// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { requireScope } from '../../../settings/scope-guard.js'
import { settingsJson } from '../respond.js'

export function requireAdmin(authed: AuthenticatedSettingsRequest, action: 'read' | 'write'): Response | null {
  const result = requireScope(authed.principal, { action, target: { kind: 'admin' } })
  return result.ok ? null : settingsJson(403, { error: 'forbidden' })
}
