// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { eq, ne } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsDeletionRequests, analyticsDeletionTargetBundles } from '../../db/schema.js'
import type { AnalyticsDeletionRequestRow } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'analytics:governance:deletion-target-store' })

export type DeletionTargetStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

/**
 * The sealed set of pseudonymous targets for one deletion request. Contains
 * only derived key material (never native identity) so deletion can resume
 * after a restart without re-deriving from the authenticated identity.
 */
export type DeletionTargetSet = Readonly<{
  analyticsActorKeys: readonly string[]
  governanceActorKeys: readonly string[]
  collectionRefKeys: readonly string[]
  grantKeys: readonly string[]
}>

export const createDeletionRequestIn = (
  tx: Tx,
  input: Readonly<{
    requestId: string
    governanceActorKey: string
    keyVersion: string
    policyVersion: number
    nowMs: number
  }>,
): void => {
  tx.insert(analyticsDeletionRequests)
    .values({
      requestId: input.requestId,
      governanceActorKey: input.governanceActorKey,
      keyVersion: input.keyVersion,
      state: 'requested',
      policyVersion: input.policyVersion,
      requestedAtMs: input.nowMs,
    })
    .onConflictDoNothing()
    .run()
}

export const getDeletionRequest = (
  requestId: string,
  deps: DeletionTargetStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): AnalyticsDeletionRequestRow | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsDeletionRequests)
    .where(eq(analyticsDeletionRequests.requestId, requestId))
    .get()
  return row ?? null
}

export const listUnresolvedDeletionRequests = (
  deps: DeletionTargetStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): readonly AnalyticsDeletionRequestRow[] =>
  deps
    .getDrizzleDb()
    .select()
    .from(analyticsDeletionRequests)
    .where(ne(analyticsDeletionRequests.state, 'completed'))
    .all()

export const markDeletionRequestStateIn = (
  tx: Tx,
  input: Readonly<{ requestId: string; state: string; nowMs: number }>,
): void => {
  tx.update(analyticsDeletionRequests)
    .set({
      state: input.state,
      completedAtMs: input.state === 'completed' ? input.nowMs : null,
    })
    .where(eq(analyticsDeletionRequests.requestId, input.requestId))
    .run()
}

const encryptionKeyFor = (key: Buffer): Buffer => createHash('sha256').update('deletion-target:v1').update(key).digest()

const seal = (plaintext: string, key: Buffer): string => {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKeyFor(key), nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', nonce.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

const open = (ciphertext: string, key: Buffer): string => {
  const parts = ciphertext.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('deletion target bundle has an unknown format')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKeyFor(key), Buffer.from(parts[1] ?? '', 'base64url'), {
    authTagLength: 16,
  })
  decipher.setAuthTag(Buffer.from(parts[2] ?? '', 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(parts[3] ?? '', 'base64url')), decipher.final()]).toString('utf8')
}

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const parseTargets = (plaintext: string): DeletionTargetSet => {
  const parsed: unknown = JSON.parse(plaintext)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('deletion target bundle is malformed')
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
  const { analyticsActorKeys, governanceActorKeys, collectionRefKeys, grantKeys } = record
  if (
    !isStringArray(analyticsActorKeys) ||
    !isStringArray(governanceActorKeys) ||
    !isStringArray(collectionRefKeys) ||
    !isStringArray(grantKeys)
  ) {
    throw new Error('deletion target bundle is malformed')
  }
  return { analyticsActorKeys, governanceActorKeys, collectionRefKeys, grantKeys }
}

export const sealDeletionTargetsIn = (
  tx: Tx,
  input: Readonly<{ requestId: string; targets: DeletionTargetSet; encryptionKey: Buffer; nowMs: number }>,
): string => {
  const plaintext = JSON.stringify(input.targets)
  const targetHash = createHash('sha256').update(plaintext).digest('hex')
  tx.insert(analyticsDeletionTargetBundles)
    .values({
      requestId: input.requestId,
      targetCiphertext: seal(plaintext, input.encryptionKey),
      targetHash,
      createdAt: input.nowMs,
    })
    .onConflictDoNothing()
    .run()
  log.info('deletion target bundle sealed')
  return targetHash
}

/**
 * Opens a sealed bundle with every retained key version (active first), so a
 * deletion requested before a governance rekey can still resume while the old
 * key remains in the keyring. Fails closed when no retained key authenticates.
 */
export const openDeletionTargets = (
  input: Readonly<{ requestId: string; encryptionKeys: readonly Buffer[] }>,
  deps: DeletionTargetStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): DeletionTargetSet | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsDeletionTargetBundles)
    .where(eq(analyticsDeletionTargetBundles.requestId, input.requestId))
    .get()
  if (row === undefined || row.destroyedAt !== null || row.targetCiphertext.length === 0) return null
  let lastError: unknown = new Error('no retained governance key to open the deletion target bundle')
  for (const encryptionKey of input.encryptionKeys) {
    let plaintext: string
    try {
      plaintext = open(row.targetCiphertext, encryptionKey)
    } catch (error) {
      lastError = error
      continue
    }
    return parseTargets(plaintext)
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export const destroyDeletionTargetCiphertextIn = (
  tx: Tx,
  input: Readonly<{ requestId: string; nowMs: number }>,
): void => {
  tx.update(analyticsDeletionTargetBundles)
    .set({ targetCiphertext: '', destroyedAt: input.nowMs })
    .where(eq(analyticsDeletionTargetBundles.requestId, input.requestId))
    .run()
  log.info('deletion target ciphertext destroyed')
}
