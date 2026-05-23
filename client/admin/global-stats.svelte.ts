// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { readBody } from '../shared/fetcher-helpers.js'

export type StatsWindow = '1d' | '7d' | '30d' | 'all'

const SubjectGrowthPointSchema = z.object({
  date: z.string(),
  dmAdded: z.number(),
  groupAdded: z.number(),
})

const GlobalStatsSchema = z.object({
  generatedAt: z.number().optional(),
  window: z.string().optional(),
  subjects: z
    .object({
      dmTotal: z.number(),
      groupTotal: z.number(),
      growthLast30d: z.array(SubjectGrowthPointSchema),
    })
    .optional(),
  active: z
    .object({
      activeIn1d: z.number(),
      activeIn7d: z.number(),
      activeIn30d: z.number(),
    })
    .optional(),
  storage: z
    .object({
      sqliteBytes: z.number(),
      s3AttachmentBytes: z.number(),
    })
    .optional(),
  surfaceMix: z
    .object({
      subjectsWithRecurring: z.number(),
      subjectsWithDeferred: z.number(),
      subjectsWithMemos: z.number(),
      subjectsWithInstructions: z.number(),
    })
    .optional(),
  toolMix: z
    .object({
      topTools: z.array(
        z.object({
          toolName: z.string(),
          count: z.number(),
          successRate: z.number(),
        }),
      ),
      errorTypeCounts: z.record(z.string(), z.number()),
    })
    .optional(),
  llmUsage: z
    .object({
      totalCalls: z.number(),
      mainCalls: z.number(),
      smallCalls: z.number(),
      embeddingCalls: z.number(),
      inputTokensTotal: z.number(),
      outputTokensTotal: z.number(),
    })
    .optional(),
})

export type GlobalStats = z.infer<typeof GlobalStatsSchema>
export type SubjectGrowthPoint = z.infer<typeof SubjectGrowthPointSchema>

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
