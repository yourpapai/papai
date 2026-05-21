// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { GlobalStats, StatsWindow } from '../../../src/stats/types.js'
import { readBody, requireOk } from '../../shared/fetcher-helpers.js'

const PercentilesSchema = z.object({
  count: z.number(),
  min: z.number(),
  p50: z.number(),
  p90: z.number(),
  p99: z.number(),
  max: z.number(),
  mean: z.number(),
})

const StatsWindowSchema = z.enum(['1d', '7d', '30d', 'all'])

const GlobalStatsSchema = z.object({
  generatedAt: z.number(),
  window: StatsWindowSchema,
  subjects: z.object({
    dmTotal: z.number(),
    groupTotal: z.number(),
    growthLast30d: z.array(z.object({ date: z.string(), dmAdded: z.number(), groupAdded: z.number() })),
  }),
  active: z.object({ activeIn1d: z.number(), activeIn7d: z.number(), activeIn30d: z.number() }),
  distributions: z.object({
    memosPerSubject: PercentilesSchema,
    recurringTasksPerSubject: PercentilesSchema,
    messageMetadataPerSubject: PercentilesSchema,
    attachmentBytesPerSubject: PercentilesSchema,
  }),
  storage: z.object({ sqliteBytes: z.number(), s3AttachmentBytes: z.number() }),
  identityMix: z.object({ byProvider: z.record(z.string(), z.number()), kaneoWorkspaces: z.number() }),
  surfaceMix: z.object({
    subjectsWithRecurring: z.number(),
    subjectsWithDeferred: z.number(),
    subjectsWithMemos: z.number(),
    subjectsWithInstructions: z.number(),
  }),
  webFetches: z.object({
    topHosts: z.array(z.object({ hostHash: z.string(), count: z.number() })),
  }),
  toolMix: z.object({
    topTools: z.array(z.object({ toolName: z.string(), count: z.number(), successRate: z.number() })),
    errorTypeCounts: z.record(z.string(), z.number()),
  }),
})

export const fetchStatsGlobal = async (window: StatsWindow | undefined): Promise<GlobalStats> => {
  const path = window === undefined ? '/stats/global' : `/stats/global?window=${encodeURIComponent(window)}`
  const res = await fetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return GlobalStatsSchema.parse(body) as GlobalStats
}
