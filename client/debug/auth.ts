// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { readBody } from '../shared/fetcher-helpers.js'

const WhoamiSchema = z.object({ adminUserId: z.string() })

export type AuthState = { authenticated: true; adminUserId: string } | { authenticated: false }

export const ensureAuthenticated = async (): Promise<AuthState> => {
  const res = await fetch('/auth/whoami', { credentials: 'include' })
  if (res.status !== 200) return { authenticated: false }
  const body = await readBody(res)
  const parsed = WhoamiSchema.safeParse(body)
  if (!parsed.success) return { authenticated: false }
  return { authenticated: true, adminUserId: parsed.data.adminUserId }
}

export const logout = async (): Promise<void> => {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.reload()
}
