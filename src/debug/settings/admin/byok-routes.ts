// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listByokAdminSummaries } from '../../../byok-llm/store.js'
import { authenticate, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

export function handleAdminByokRoutes(req: Request, _url: URL): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return Promise.resolve(guard)
    return Promise.resolve(settingsJson(200, { contexts: listByokAdminSummaries() }))
  }

  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
