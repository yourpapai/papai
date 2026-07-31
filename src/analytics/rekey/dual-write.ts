// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { analyticsEvents, analyticsEventCollectionRefs } from '../../db/schema.js'
import type { AnalyticsEventRow, AnalyticsRekeyRunRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { parseAnalyticsKeyring, parseGovernanceKeyring } from '../identity/keyring.js'
import { deriveRekeyedPseudonym } from '../identity/pseudonym.js'
import { physicalEventIdFor } from '../storage/event-store.js'
import { EVENT_COLUMN_DOMAINS, PROPS_KEY_DOMAINS } from './mapping-inventory.js'
import { insertMappingPairIn } from './mapping-store.js'
import type { RekeyTx } from './run-store.js'

const log = logger.child({ scope: 'analytics:rekey:dual-write' })

export type RekeyKeyMaterial = Readonly<{
  toVersion: string
  toKey: Buffer
  encryptionKey: Buffer
}>

/** Full material for copy/verify: analytics + governance target keys and the retained sealing keys. */
export type RekeyFullKeyMaterial = Readonly<{
  toVersion: string
  analyticsToKey: Buffer
  governanceToKey: Buffer
  encryptionKey: Buffer
  encryptionKeys: readonly Buffer[]
}>

export type RekeyKeyMaterialProvider = (toVersions: readonly string[]) => RekeyKeyMaterial | null

/** Production provider: target analytics key + governance sealing key from env keyrings. */
export const defaultRekeyKeyMaterial: RekeyKeyMaterialProvider = (toVersions) => {
  const toVersion = toVersions[0]
  if (toVersion === undefined) return null
  const analytics = parseAnalyticsKeyring()
  const governance = parseGovernanceKeyring()
  if (analytics.kind !== 'available' || governance.kind !== 'available') return null
  const toKey = analytics.keys.get(toVersion)
  if (toKey === undefined) return null
  return { toVersion, toKey, encryptionKey: governance.activeKey }
}

const remapValue = (domain: string, value: string | null, material: RekeyKeyMaterial): string | null => {
  if (value === null) return null
  return deriveRekeyedPseudonym({
    key: material.toKey,
    keyVersion: material.toVersion,
    domain,
    sourcePseudonym: value,
  })
}

export const remapPropsJson = (propsJson: string, material: RekeyKeyMaterial): string => {
  const parsed: unknown = JSON.parse(propsJson)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return propsJson
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
  for (const [propKey, domain] of PROPS_KEY_DOMAINS) {
    const value = record[propKey]
    if (typeof value === 'string') {
      record[propKey] = deriveRekeyedPseudonym({
        key: material.toKey,
        keyVersion: material.toVersion,
        domain,
        sourcePseudonym: value,
      })
    }
  }
  return JSON.stringify(record)
}

const domainForColumn = (column: string): string => {
  const entry = EVENT_COLUMN_DOMAINS.find(([name]) => name === column)
  if (entry === undefined) throw new Error(`no rekey domain registered for event column ${column}`)
  return entry[1]
}

/** Remaps every keyed column of a canonical parent row into the target generation. */
export const remapEventRowForTarget = (
  row: AnalyticsEventRow,
  material: RekeyKeyMaterial,
): typeof analyticsEvents.$inferInsert => {
  const remap = (column: string, value: string | null): string | null =>
    remapValue(domainForColumn(column), value, material)
  return {
    ...row,
    eventId: physicalEventIdFor({
      storageGeneration: row.storageGeneration,
      sourceKind: row.sourceKind,
      sourceRefKey: row.sourceRefKey,
      eventName: row.eventName,
    }),
    keyVersion: material.toVersion,
    deploymentKey: remap('deploymentKey', row.deploymentKey) ?? row.deploymentKey,
    platformInstanceKey: remap('platformInstanceKey', row.platformInstanceKey) ?? row.platformInstanceKey,
    actorKey: remap('actorKey', row.actorKey),
    contextKey: remap('contextKey', row.contextKey),
    threadKey: remap('threadKey', row.threadKey),
    conversationKey: remap('conversationKey', row.conversationKey),
    taskInstanceKey: remap('taskInstanceKey', row.taskInstanceKey),
    turnKey: remap('turnKey', row.turnKey),
    sessionKey: remap('sessionKey', row.sessionKey),
    propsJson: remapPropsJson(row.propsJson, material),
  }
}

export const shadowEventIdFor = (
  row: Readonly<{ sourceKind: string; sourceRefKey: string; eventName: string }>,
  targetGeneration: string,
): string =>
  physicalEventIdFor({
    storageGeneration: targetGeneration,
    sourceKind: row.sourceKind,
    sourceRefKey: row.sourceRefKey,
    eventName: row.eventName,
  })

/**
 * The only dual-write parent seam: inside the caller's fenced transaction,
 * creates exactly one target-shadow physical parent for one already-inserted
 * active parent, associates it with the inherited exact collection ref, and
 * persists only the distinct physical IDs in the encrypted run mapping.
 */
export const insertShadowParentIn = (
  tx: RekeyTx,
  input: Readonly<{
    activeRow: AnalyticsEventRow
    collectionRef: Readonly<{ refKey: string; keyVersion: string; generation: number }> | null
    run: AnalyticsRekeyRunRow
    material: RekeyKeyMaterial
  }>,
): Readonly<{ status: 'created' | 'already_present'; shadowEventId: string }> => {
  const shadowEventId = shadowEventIdFor(input.activeRow, input.run.targetGeneration)
  insertMappingPairIn(tx, {
    runId: input.run.runId,
    domain: 'event-source-ref:v1',
    oldKey: input.activeRow.eventId,
    newKey: shadowEventId,
    encryptionKey: input.material.encryptionKey,
  })
  const existing = tx
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.eventId, shadowEventId))
    .get()
  if (existing !== undefined) return { status: 'already_present', shadowEventId }
  const shadowRow = remapEventRowForTarget(
    { ...input.activeRow, storageGeneration: input.run.targetGeneration },
    input.material,
  )
  tx.insert(analyticsEvents)
    .values({ ...shadowRow, eventId: shadowEventId })
    .run()
  if (input.collectionRef !== null) {
    tx.insert(analyticsEventCollectionRefs)
      .values({
        eventId: shadowEventId,
        refKey: input.collectionRef.refKey,
        keyVersion: input.collectionRef.keyVersion,
        generation: input.collectionRef.generation,
        createdAt: input.activeRow.ingestedAtMs,
      })
      .run()
  }
  log.debug('target-shadow parent created beside the active parent')
  return { status: 'created', shadowEventId }
}

export const loadEventRowIn = (tx: RekeyTx, eventId: string): AnalyticsEventRow | null => {
  const row = tx.select().from(analyticsEvents).where(eq(analyticsEvents.eventId, eventId)).get()
  return row ?? null
}
