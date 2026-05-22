// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { readBody } from '../shared/fetcher-helpers.js'

export type StatsWindow = '24h' | '7d' | '30d' | 'all'

const GlobalStatsSchema = z.object({
  subjects: z.number().optional(),
  llmCalls: z.number().optional(),
  toolCalls: z.number().optional(),
  tokens: z.number().optional(),
  growthLast30d: z.array(z.object({ ts: z.number(), count: z.number() })).optional(),
  surfaceMix: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
})

export type GlobalStats = z.infer<typeof GlobalStatsSchema>

export const adminGlobals = $state({
  window: '30d' as StatsWindow,
  loading: false,
  data: null as GlobalStats | null,
  fetchedAt: null as number | null,
})

export async function refreshGlobals(): Promise<void> {
  adminGlobals.loading = true
  try {
    const res = await fetch(`/stats/global?window=${encodeURIComponent(adminGlobals.window)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return
    const body = await readBody(res)
    const parsed = GlobalStatsSchema.safeParse(body)
    if (!parsed.success) return
    adminGlobals.data = parsed.data
    adminGlobals.fetchedAt = Date.now()
  } finally {
    adminGlobals.loading = false
  }
}
