// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { and, eq, ne } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsRekeyMappings } from '../../db/schema.js'
import type { AnalyticsRekeyMappingRow } from '../../db/schema.js'
import { REKEY_MAPPING_DOMAINS } from '../governance/generation-store.js'
import type { RekeyMappingDomain } from '../governance/generation-store.js'
import { deriveRekeyedPseudonym } from '../identity/pseudonym.js'
import type { RekeyTx } from './run-store.js'

export const REKEY_MAPPING_CRYPTO_DOMAIN = 'rekey-mapping:v1'

export type MappingStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

export const oldKeyHashFor = (domain: string, oldKey: string): string =>
  createHash('sha256').update(`${domain}|${oldKey}`).digest('hex')

const newKeyHashFor = (domain: string, newKey: string): string =>
  createHash('sha256').update(`${domain}|${newKey}`).digest('hex')

const encryptionKeyFor = (key: Buffer): Buffer =>
  createHash('sha256').update(REKEY_MAPPING_CRYPTO_DOMAIN).update(key).digest()

const seal = (plaintext: string, key: Buffer): string => {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKeyFor(key), nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', nonce.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

const open = (ciphertext: string, key: Buffer): string => {
  const parts = ciphertext.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('rekey mapping has an unknown format')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKeyFor(key), Buffer.from(parts[1] ?? '', 'base64url'), {
    authTagLength: 16,
  })
  decipher.setAuthTag(Buffer.from(parts[2] ?? '', 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(parts[3] ?? '', 'base64url')), decipher.final()]).toString('utf8')
}

export type RekeyMappingPair = Readonly<{
  domain: string
  oldKey: string
  newKey: string
}>

const parsePair = (plaintext: string): RekeyMappingPair => {
  const parsed: unknown = JSON.parse(plaintext)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('rekey mapping is malformed')
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(parsed))
  const { domain, oldKey, newKey } = record
  if (typeof domain !== 'string' || typeof oldKey !== 'string' || typeof newKey !== 'string') {
    throw new Error('rekey mapping is malformed')
  }
  return { domain, oldKey, newKey }
}

export const buildMappingForKey = (
  input: Readonly<{ domain: string; oldKey: string; toKey: Buffer; toVersion: string }>,
): string =>
  deriveRekeyedPseudonym({
    key: input.toKey,
    keyVersion: input.toVersion,
    domain: input.domain,
    sourcePseudonym: input.oldKey,
  })

/**
 * Inserts one encrypted old→new mapping. Idempotent for an identical retry;
 * rejects any collision where two distinct old keys map to one new key.
 */
export const insertMappingPairIn = (
  tx: RekeyTx,
  input: Readonly<{
    runId: string
    domain: string
    oldKey: string
    newKey: string
    encryptionKey: Buffer
  }>,
): 'inserted' | 'already_present' => {
  if (!(REKEY_MAPPING_DOMAINS as readonly string[]).includes(input.domain)) {
    throw new Error('unknown rekey mapping domain')
  }
  const oldKeyHash = oldKeyHashFor(input.domain, input.oldKey)
  const newKeyHash = newKeyHashFor(input.domain, input.newKey)
  const existing = tx
    .select()
    .from(analyticsRekeyMappings)
    .where(and(eq(analyticsRekeyMappings.runId, input.runId), eq(analyticsRekeyMappings.domain, input.domain)))
    .all()
  const sameOld = existing.find((row) => row.oldKeyHash === oldKeyHash)
  if (sameOld !== undefined) {
    if (sameOld.mappingHash !== newKeyHash) {
      throw new Error(`rekey mapping conflict: old key already mapped in domain ${input.domain}`)
    }
    return 'already_present'
  }
  const sameNew = existing.find((row) => row.mappingHash === newKeyHash)
  if (sameNew !== undefined) {
    throw new Error(`rekey mapping collision: two old keys share a new key in domain ${input.domain}`)
  }
  const plaintext = JSON.stringify({ domain: input.domain, oldKey: input.oldKey, newKey: input.newKey })
  tx.insert(analyticsRekeyMappings)
    .values({
      runId: input.runId,
      domain: input.domain,
      oldKeyHash,
      mappingCiphertext: seal(plaintext, input.encryptionKey),
      mappingHash: newKeyHash,
      state: 'mapped',
    })
    .run()
  return 'inserted'
}

/** Verifier-only single-key open; throws when the key does not authenticate. */
export const openMappingForVerify = (ciphertext: string, key: Buffer): RekeyMappingPair =>
  parsePair(open(ciphertext, key))

const openPair = (row: AnalyticsRekeyMappingRow, encryptionKeys: readonly Buffer[]): RekeyMappingPair => {
  let lastError: unknown = new Error('no retained key to open the rekey mapping')
  for (const encryptionKey of encryptionKeys) {
    try {
      return parsePair(open(row.mappingCiphertext, encryptionKey))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** Verifier-only: decrypts retained run mappings with the retained key set. */
export const listMappingPairs = (
  input: Readonly<{ runId: string; encryptionKeys: readonly Buffer[] }>,
  deps: MappingStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): readonly RekeyMappingPair[] =>
  deps
    .getDrizzleDb()
    .select()
    .from(analyticsRekeyMappings)
    .where(and(eq(analyticsRekeyMappings.runId, input.runId), ne(analyticsRekeyMappings.state, 'destroyed')))
    .all()
    .map((row) => openPair(row, input.encryptionKeys))

/**
 * Subject-rights translation: expands derived keys forward through every
 * retained (non-destroyed) encrypted mapping, across runs and chained
 * generations, so denial/export/deletion search sees rekeyed rows. Mappings
 * that no retained key can open are skipped — their generations are gone by
 * the retirement contract.
 */
export const expandKeysThroughMappings = (
  keysByDomain: Readonly<Record<string, readonly string[]>>,
  encryptionKeys: readonly Buffer[],
  deps: MappingStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): ReadonlyMap<string, readonly string[]> => {
  const rows = deps
    .getDrizzleDb()
    .select()
    .from(analyticsRekeyMappings)
    .where(ne(analyticsRekeyMappings.state, 'destroyed'))
    .all()
  const adjacency = new Map<string, Map<string, string>>()
  for (const row of rows) {
    let pair: RekeyMappingPair
    try {
      pair = openPair(row, encryptionKeys)
    } catch {
      continue
    }
    const domainMap = adjacency.get(pair.domain) ?? new Map<string, string>()
    domainMap.set(pair.oldKey, pair.newKey)
    adjacency.set(pair.domain, domainMap)
  }
  const expanded = new Map<string, readonly string[]>()
  for (const [domain, keys] of Object.entries(keysByDomain)) {
    const domainMap = adjacency.get(domain)
    const seen = new Set<string>(keys)
    if (domainMap !== undefined) {
      const queue = [...keys]
      while (queue.length > 0) {
        const current = queue.pop()
        if (current === undefined) break
        const next = domainMap.get(current)
        if (next !== undefined && !seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    expanded.set(domain, [...seen])
  }
  return expanded
}

export type { RekeyMappingDomain }
