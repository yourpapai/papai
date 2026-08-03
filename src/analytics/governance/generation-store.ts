// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsActiveGeneration, analyticsRekeyMappings, analyticsRekeyRuns } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:governance:generation-store' })

export const SUBJECT_RIGHTS_LOOKUP_HORIZON_DAYS = 90
export const V1_MAX_EVENT_RETENTION_DAYS = 90
const DAY_MS = 86_400_000

export const REKEY_MAPPING_DOMAINS = [
  'event-source-ref:v1',
  'deployment:v1',
  'platform-instance:v1',
  'actor:v1',
  'context:v1',
  'conversation:v1',
  'thread:v1',
  'turn:v1',
  'llm-attempt:v1',
  'task-instance:v1',
  'model:v1',
  'tool:v1',
  'coding-project:v1',
  'coding-session:v1',
  'session:v1',
  'materialization:v1',
  'governance-actor:v1',
  'collection-eligibility:v1',
  'delivery-grant:v1',
] as const

export type RekeyMappingDomain = (typeof REKEY_MAPPING_DOMAINS)[number]

export type GenerationStoreDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
}>

export type ActiveGeneration = Readonly<{
  generation: string
  updatedAtMs: number
}>

const DEFAULT_DEPS: GenerationStoreDeps = { getDrizzleDb: defaultGetDrizzleDb }

let advisoryCache: ActiveGeneration | null = null

export const resolveActive = (deps: GenerationStoreDeps = DEFAULT_DEPS): ActiveGeneration => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsActiveGeneration)
    .where(eq(analyticsActiveGeneration.singletonId, 1))
    .get()
  if (row === undefined) throw new Error('analytics_active_generation singleton row is missing')
  if (advisoryCache !== null && advisoryCache.updatedAtMs === row.updatedAtMs) return advisoryCache
  const resolved: ActiveGeneration = {
    generation: row.activeGeneration,
    updatedAtMs: row.updatedAtMs,
  }
  advisoryCache = resolved
  return resolved
}

export const setActiveGeneration = (
  input: Readonly<{ generation: string; nowMs: number }>,
  deps: GenerationStoreDeps = DEFAULT_DEPS,
): void => {
  deps
    .getDrizzleDb()
    .update(analyticsActiveGeneration)
    .set({ activeGeneration: input.generation, updatedAtMs: input.nowMs })
    .where(eq(analyticsActiveGeneration.singletonId, 1))
    .run()
  advisoryCache = null
  log.info('active analytics generation updated')
}

export const planRekeyRun = (
  input: Readonly<{
    runId: string
    sourceGeneration: string
    targetGeneration: string
    fromVersions: readonly string[]
    toVersions: readonly string[]
    sourceHighWater: string
    planHash: string
    nowMs: number
  }>,
  deps: GenerationStoreDeps = DEFAULT_DEPS,
): void => {
  if (input.sourceGeneration === input.targetGeneration) {
    throw new Error('rekey run requires distinct source and target generations')
  }
  deps
    .getDrizzleDb()
    .insert(analyticsRekeyRuns)
    .values({
      runId: input.runId,
      sourceGeneration: input.sourceGeneration,
      targetGeneration: input.targetGeneration,
      fromVersions: JSON.stringify(input.fromVersions),
      toVersions: JSON.stringify(input.toVersions),
      sourceHighWater: input.sourceHighWater,
      phase: 'plan',
      subphase: null,
      planHash: input.planHash,
      status: 'planned',
      createdAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .run()
  log.info({ phase: 'plan' }, 'rekey run planned')
}

export const insertRekeyMapping = (
  input: Readonly<{
    runId: string
    domain: string
    oldKeyHash: string
    mappingCiphertext: string
    mappingHash: string
    nowMs: number
  }>,
  deps: GenerationStoreDeps = DEFAULT_DEPS,
): void => {
  if (!(REKEY_MAPPING_DOMAINS as readonly string[]).includes(input.domain)) {
    throw new Error('unknown rekey mapping domain')
  }
  deps
    .getDrizzleDb()
    .insert(analyticsRekeyMappings)
    .values({
      runId: input.runId,
      domain: input.domain,
      oldKeyHash: input.oldKeyHash,
      mappingCiphertext: input.mappingCiphertext,
      mappingHash: input.mappingHash,
      state: 'mapped',
    })
    .run()
}

export const computeRetireNotBeforeMs = (input: {
  swapCompletedAtMs: number
  retainedEventHorizonDays: number
}): number => {
  if (
    !Number.isInteger(input.retainedEventHorizonDays) ||
    input.retainedEventHorizonDays < 1 ||
    input.retainedEventHorizonDays > V1_MAX_EVENT_RETENTION_DAYS
  ) {
    throw new Error(`retained event horizon must be between 1 and ${V1_MAX_EVENT_RETENTION_DAYS} days`)
  }
  const horizonDays = Math.max(input.retainedEventHorizonDays, SUBJECT_RIGHTS_LOOKUP_HORIZON_DAYS)
  return input.swapCompletedAtMs + horizonDays * DAY_MS
}

export const completeRekeySwap = (
  input: Readonly<{
    runId: string
    retainedEventHorizonDays: number
    nowMs: number
  }>,
  deps: GenerationStoreDeps = DEFAULT_DEPS,
): Readonly<{ swapCompletedAtMs: number; retireNotBeforeMs: number }> => {
  const db = deps.getDrizzleDb()
  const retireNotBeforeMs = computeRetireNotBeforeMs({
    swapCompletedAtMs: input.nowMs,
    retainedEventHorizonDays: input.retainedEventHorizonDays,
  })
  db.transaction((tx) => {
    const run = tx.select().from(analyticsRekeyRuns).where(eq(analyticsRekeyRuns.runId, input.runId)).get()
    if (run === undefined) throw new Error('rekey run not found')
    if (run.status === 'completed' || run.status === 'aborted') throw new Error('rekey run is already terminal')
    tx.update(analyticsRekeyRuns)
      .set({
        status: 'completed',
        phase: 'swap',
        subphase: 'swap.active_generation',
        swapCompletedAtMs: input.nowMs,
        retireNotBeforeMs,
        updatedAt: input.nowMs,
      })
      .where(eq(analyticsRekeyRuns.runId, input.runId))
      .run()
    tx.update(analyticsActiveGeneration)
      .set({ activeGeneration: run.targetGeneration, updatedAtMs: input.nowMs })
      .where(eq(analyticsActiveGeneration.singletonId, 1))
      .run()
  })
  advisoryCache = null
  log.info({ phase: 'swap' }, 'rekey swap completed')
  return { swapCompletedAtMs: input.nowMs, retireNotBeforeMs }
}
