// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsEpochSourceCounters } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { EpochStoreDeps } from './epoch-store.js'

const log = logger.child({ scope: 'analytics:storage:epoch-source-counters' })

const VALID_DISPOSITIONS = new Set([
  'opportunity',
  'canonical',
  'normalization_reject',
  'governance_ineligible',
  'aggregate_only',
  'controlled_overflow',
])

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

/**
 * Aggregate-lane increments have no per-fact canonical event, so the live sink
 * records them per contribution unit under this fixed family (the same
 * convention as the controlled-overflow binding) to keep the reconciliation
 * equation's opportunity/terminal and aggregate/contribution terms balanced.
 */
const AGGREGATE_LANE_SOURCE_FAMILY = 'chat'

export type EpochSourceCounterInput = Readonly<{
  epochId: string
  utcDay: string
  sourceFamily: string
  disposition: string
  value?: number
}>

/** In-transaction variant for writers that must keep the counter in the same commit as their own rows. */
const incrementEpochSourceCounterIn = (tx: Tx, input: EpochSourceCounterInput): void => {
  if (!VALID_DISPOSITIONS.has(input.disposition)) {
    throw new Error(`Invalid disposition: ${input.disposition}`)
  }
  const value = input.value ?? 1
  tx.insert(analyticsEpochSourceCounters)
    .values({
      epochId: input.epochId,
      utcDay: input.utcDay,
      sourceFamily: input.sourceFamily,
      disposition: input.disposition,
      value,
    })
    .onConflictDoUpdate({
      target: [
        analyticsEpochSourceCounters.epochId,
        analyticsEpochSourceCounters.utcDay,
        analyticsEpochSourceCounters.sourceFamily,
        analyticsEpochSourceCounters.disposition,
      ],
      set: { value: sql`${analyticsEpochSourceCounters.value} + ${value}` },
    })
    .run()
}

export const incrementEpochSourceCounter = (
  input: EpochSourceCounterInput,
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): void => {
  const db = deps.getDrizzleDb()
  db.transaction((tx) => {
    incrementEpochSourceCounterIn(tx, input)
  })
  log.debug({ ...input, value: input.value ?? 1 }, 'epoch source counter incremented')
}

/**
 * Live aggregate writes have no canonical insert to carry their opportunity and
 * terminal dispositions, so each contribution unit bumps both counters together:
 * the opportunity/terminal groups stay balanced per (day, family) and the
 * aggregate_only total tracks the epoch's contribution increments exactly.
 */
export const recordLiveAggregateDisposition = (
  tx: Tx,
  input: Readonly<{ epochId: string; utcDay: string; value: number }>,
): void => {
  const base = { epochId: input.epochId, utcDay: input.utcDay, sourceFamily: AGGREGATE_LANE_SOURCE_FAMILY }
  incrementEpochSourceCounterIn(tx, { ...base, disposition: 'opportunity', value: input.value })
  incrementEpochSourceCounterIn(tx, { ...base, disposition: 'aggregate_only', value: input.value })
}

/**
 * Production binding for the runtime observer's controlled-overflow hook: a
 * queue-full drop increments the exact `controlled_overflow` source counter
 * on the open process epoch (durable), in addition to the process-global
 * health signal.
 */
export const createControlledOverflowBinding = (
  input: { epochId: string },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): ((utcDay: string) => void) => {
  return (utcDay) => {
    incrementEpochSourceCounter(
      { epochId: input.epochId, utcDay, sourceFamily: 'chat', disposition: 'controlled_overflow' },
      deps,
    )
  }
}

export type EpochSourceCounterSummary = Readonly<{
  utcDay: string
  sourceFamily: string
  disposition: string
  value: number
}>

export const listEpochSourceCounters = (
  input: { epochId: string },
  deps: EpochStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): readonly EpochSourceCounterSummary[] =>
  deps
    .getDrizzleDb()
    .select()
    .from(analyticsEpochSourceCounters)
    .where(eq(analyticsEpochSourceCounters.epochId, input.epochId))
    .all()
    .map((row) => ({
      utcDay: row.utcDay,
      sourceFamily: row.sourceFamily,
      disposition: row.disposition,
      value: row.value,
    }))
