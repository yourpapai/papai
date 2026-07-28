// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { getDrizzleDb } from '../db/drizzle.js'
import { FIXED_HISTOGRAM_BUCKETS_MS } from './aggregate-contract.js'
import type { ContributorTracker } from './aggregate-contributors.js'
import { contributorBasisForMetric, histogramBucketIndex } from './aggregate.js'
import { insertEligibleCanonicalEvent } from './governance/collection-serialization.js'
import type { QueuedAggregateIncrement, RuntimeSinks } from './runtime.js'
import { incrementCounter, mergeHistogram } from './storage/aggregate-store.js'

export type ProductionSinkDeps = Readonly<{
  epochId: string
  tracker: ContributorTracker
  getDrizzleDb: typeof getDrizzleDb
}>

const aggregateCellKeyOf = (item: QueuedAggregateIncrement): string =>
  `${item.utcDay}|${JSON.stringify(item.dimensions)}|${item.increment.metric}`

const recordContributor = (
  tracker: ContributorTracker,
  item: QueuedAggregateIncrement,
  cellKey: string,
): number | null => {
  if (item.contributorKey === null) return null
  tracker.record(item.utcDay, cellKey, item.contributorKey)
  return tracker.count(item.utcDay, cellKey)
}

const writeAggregateItem = (item: QueuedAggregateIncrement, deps: ProductionSinkDeps): void => {
  const cellKey = aggregateCellKeyOf(item)
  const quality = {
    disclosureScope: 'local_only',
    contributorBasis: contributorBasisForMetric(item.increment.metric),
    contributorCount: recordContributor(deps.tracker, item, cellKey),
  }
  const base = {
    utcDay: item.utcDay,
    definitionVersion: 1,
    platform: item.dimensions.platform,
    contextType: item.dimensions.context_type,
    actorRole: item.dimensions.actor_role,
    taskProvider: item.dimensions.task_provider,
    appVersion: item.dimensions.app_version,
    aggregateCellKey: cellKey,
    epochId: deps.epochId,
  }
  const storeDeps = { getDrizzleDb: deps.getDrizzleDb }
  if (item.increment.kind === 'counter') {
    incrementCounter(
      {
        ...base,
        metric: item.increment.metric,
        delta: item.increment.delta,
        ...quality,
      },
      storeDeps,
    )
    return
  }
  const counts = FIXED_HISTOGRAM_BUCKETS_MS.map(() => 0)
  const bucketIndex = histogramBucketIndex(item.increment.valueMs)
  counts[bucketIndex] = 1
  mergeHistogram(
    {
      ...base,
      metric: item.increment.metric,
      fixedBuckets: FIXED_HISTOGRAM_BUCKETS_MS,
      counts,
      sum: item.increment.valueMs,
      sampleCount: 1,
      ...quality,
    },
    storeDeps,
  )
}

export const createProductionSinks = (deps: ProductionSinkDeps): RuntimeSinks => ({
  writeEvents: (items): void => {
    items.forEach((item) => {
      insertEligibleCanonicalEvent(
        {
          event: item.event,
          processEpochId: deps.epochId,
          collectionRef: item.collectionRef,
        },
        { getDrizzleDb: deps.getDrizzleDb },
      )
    })
  },
  writeAggregates: (items): void => {
    items.forEach((item) => {
      writeAggregateItem(item, deps)
    })
  },
})
