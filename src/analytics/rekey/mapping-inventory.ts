// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsBackfillEventMap,
  analyticsCollectionEligibility,
  analyticsDeletionRequests,
  analyticsEligibilityGrants,
  analyticsEvents,
  analyticsGoalAttempts,
  analyticsPreferences,
  analyticsSessions,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import { REKEY_MAPPING_DOMAINS } from '../governance/generation-store.js'
import { buildMappingForKey, insertMappingPairIn } from './mapping-store.js'
import type { MappingStoreDeps } from './mapping-store.js'
import type { RekeyTx } from './run-store.js'

const log = logger.child({ scope: 'analytics:rekey:mapping-inventory' })

type Db = ReturnType<typeof defaultGetDrizzleDb>

export const EVENT_COLUMN_DOMAINS = [
  ['actorKey', 'actor:v1'],
  ['contextKey', 'context:v1'],
  ['threadKey', 'thread:v1'],
  ['conversationKey', 'conversation:v1'],
  ['turnKey', 'turn:v1'],
  ['sessionKey', 'session:v1'],
  ['taskInstanceKey', 'task-instance:v1'],
  ['platformInstanceKey', 'platform-instance:v1'],
  ['deploymentKey', 'deployment:v1'],
] as const

export const PROPS_KEY_DOMAINS = [
  ['attempt_key', 'llm-attempt:v1'],
  ['model_key', 'model:v1'],
  ['tool_key', 'tool:v1'],
  ['coding_project_key', 'coding-project:v1'],
  ['coding_session_key', 'coding-session:v1'],
] as const

const addTo = (inventory: Map<string, Set<string>>, domain: string, value: string | null | undefined): void => {
  if (value === null || value === undefined || value.length === 0) return
  const bucket = inventory.get(domain) ?? new Set<string>()
  bucket.add(value)
  inventory.set(domain, bucket)
}

const collectEventInventory = (
  db: Db | RekeyTx,
  sourceGeneration: string,
  inventory: Map<string, Set<string>>,
): void => {
  const rows = db.select().from(analyticsEvents).where(eq(analyticsEvents.storageGeneration, sourceGeneration)).all()
  for (const row of rows) {
    for (const [column, domain] of EVENT_COLUMN_DOMAINS) addTo(inventory, domain, row[column])
    const props: unknown = JSON.parse(row.propsJson)
    if (typeof props !== 'object' || props === null) continue
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(props))
    for (const [propKey, domain] of PROPS_KEY_DOMAINS) {
      const value = record[propKey]
      if (typeof value === 'string') addTo(inventory, domain, value)
    }
  }
}

/** Enumerates every retained old key per domain from the source generation. */
export const collectDomainInventory = (
  db: Db | RekeyTx,
  sourceGeneration: string,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const inventory = new Map<string, Set<string>>()
  collectEventInventory(db, sourceGeneration, inventory)
  for (const row of db
    .select()
    .from(analyticsSessions)
    .where(eq(analyticsSessions.storageGeneration, sourceGeneration))
    .all()) {
    addTo(inventory, 'session:v1', row.sessionKey)
    addTo(inventory, 'actor:v1', row.actorKey)
    addTo(inventory, 'conversation:v1', row.conversationKey)
  }
  for (const row of db
    .select()
    .from(analyticsGoalAttempts)
    .where(eq(analyticsGoalAttempts.storageGeneration, sourceGeneration))
    .all()) {
    addTo(inventory, 'materialization:v1', row.attemptKey)
  }
  for (const row of db.select().from(analyticsPreferences).all())
    addTo(inventory, 'governance-actor:v1', row.governanceActorKey)
  for (const row of db.select().from(analyticsDeletionRequests).all()) {
    addTo(inventory, 'governance-actor:v1', row.governanceActorKey)
  }
  for (const row of db.select().from(analyticsCollectionEligibility).all()) {
    addTo(inventory, 'collection-eligibility:v1', row.refKey)
  }
  for (const row of db.select().from(analyticsEligibilityGrants).all())
    addTo(inventory, 'delivery-grant:v1', row.grantKey)
  return inventory
}

export type InstallDomainMappingsInput = Readonly<{
  runId: string
  sourceGeneration: string
  domains: readonly string[]
  toKey: Buffer
  toVersion: string
  encryptionKey: Buffer
  nowMs: number
}>

/** Builds the complete one-to-one old→new map for the given domains inside the caller's transaction. */
export const installDomainMappingsIn = (
  tx: RekeyTx,
  input: InstallDomainMappingsInput,
): Readonly<{ installed: number }> => {
  for (const domain of input.domains) {
    if (!(REKEY_MAPPING_DOMAINS as readonly string[]).includes(domain)) {
      throw new Error('unknown rekey mapping domain')
    }
  }
  const inventory = collectDomainInventory(tx, input.sourceGeneration)
  let installed = 0
  for (const domain of input.domains) {
    const oldKeys = [...(inventory.get(domain) ?? new Set<string>())].sort()
    for (const oldKey of oldKeys) {
      const newKey = buildMappingForKey({ domain, oldKey, toKey: input.toKey, toVersion: input.toVersion })
      const result = insertMappingPairIn(tx, {
        runId: input.runId,
        domain,
        oldKey,
        newKey,
        encryptionKey: input.encryptionKey,
      })
      if (result === 'inserted') installed += 1
    }
  }
  log.info({ installed, domains: input.domains.length }, 'rekey domain mappings installed')
  return { installed }
}

/** Builds the complete one-to-one old→new map for the given domains in one transaction. */
export const installDomainMappings = (
  input: InstallDomainMappingsInput,
  deps: MappingStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): Readonly<{ installed: number }> => deps.getDrizzleDb().transaction((tx) => installDomainMappingsIn(tx, input))

/** Backfill-map rows keyed by physical event id, used by the copy subphase. */
export const listBackfillMapRows = (db: Db | RekeyTx): readonly (typeof analyticsBackfillEventMap.$inferSelect)[] =>
  db.select().from(analyticsBackfillEventMap).all()
