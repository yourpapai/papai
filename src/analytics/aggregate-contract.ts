// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { AggregateCounterV1Schema, AggregateHistogramV1Schema, VersionStringSchema } from './controlled-types.js'

const NonNegativeInt = z.number().int().nonnegative()
const NonNegativeIntNullable = NonNegativeInt.nullable()

export const FIXED_HISTOGRAM_BUCKETS_MS: readonly number[] = [
  0, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 300_000,
]

const AnalyticsAggregateMeasureSchema = z.union([
  z
    .object({
      kind: z.literal('counter'),
      metric: AggregateCounterV1Schema,
      value: NonNegativeInt,
    })
    .strict(),
  z
    .object({
      kind: z.literal('histogram'),
      metric: AggregateHistogramV1Schema,
      fixed_buckets: z.array(NonNegativeInt).length(FIXED_HISTOGRAM_BUCKETS_MS.length),
      counts: z.array(NonNegativeInt).length(FIXED_HISTOGRAM_BUCKETS_MS.length),
      sum: z.number().nonnegative(),
      sample_count: NonNegativeInt,
    })
    .strict(),
])

export const AnalyticsAggregateV1Schema = z
  .object({
    schema: z
      .object({
        name: z.literal('papai.analytics.aggregate'),
        version: z.literal(1),
      })
      .strict(),
    bucket: z
      .object({
        utc_day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/u, 'utc_day must be YYYY-MM-DD')
          .refine((value) => {
            const parsed = Date.parse(value)
            if (Number.isNaN(parsed)) return false
            return new Date(parsed).toISOString().slice(0, 10) === value
          }, 'utc_day must be a valid calendar day'),
        definition_version: z.literal(1),
        finalized: z.boolean(),
      })
      .strict(),
    dimensions: z
      .object({
        platform: z.enum(['telegram', 'mattermost', 'discord', 'kontur-talk', 'all']),
        context_type: z.enum(['dm', 'group', 'none', 'all']),
        actor_role: z.enum(['admin', 'member', 'guest', 'system', 'all']),
        task_provider: z.enum(['kaneo', 'youtrack', 'none', 'other', 'all']),
        app_version: z.union([VersionStringSchema, z.literal('all')]),
      })
      .strict(),
    measure: AnalyticsAggregateMeasureSchema,
    quality: z
      .object({
        source: z.literal('live'),
        partial_day: z.boolean(),
        restart_gap_detected: z.boolean(),
        reconciliation: z.enum(['complete_epoch', 'unreconciled_restart_gap']),
        late_event_count: NonNegativeInt,
      })
      .strict(),
    disclosure: z
      .object({
        scope: z.enum(['local_only', 'external_eligible', 'suppressed']),
        contributor_basis: z.enum(['not_required', 'eligible_actor', 'context']),
        contributor_count: NonNegativeIntNullable,
        threshold: NonNegativeIntNullable,
      })
      .strict(),
  })
  .strict()

export type AnalyticsAggregateV1 = z.infer<typeof AnalyticsAggregateV1Schema>
