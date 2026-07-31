// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { getDrizzleDb } from '../../db/drizzle.js'
import { logger } from '../../logger.js'
import { CURATED_TABLES_PSEUDONYMOUS, PROP_EXTRACTIONS } from './snapshot-schema.js'

const log = logger.child({ scope: 'analytics:jobs:snapshot-scan' })

type SourceDb = ReturnType<typeof getDrizzleDb>

export class SnapshotCanaryError extends Error {
  constructor(detail: string) {
    super(`snapshot output failed the canary scan: ${detail}`)
    this.name = 'SnapshotCanaryError'
  }
}

const MIN_CANARY_LENGTH = 8

/**
 * Raw byte strings that must never appear in a publish file: canonical props,
 * preference/grant keys, delivery secrets, usage rows, conversation content,
 * memory, system config, and settings auth rows. Short values are skipped to
 * avoid false-positive substring matches.
 */
const CANARY_QUERIES: readonly string[] = [
  `SELECT props_json AS canary FROM analytics_events`,
  `SELECT governance_actor_key AS canary FROM analytics_preferences`,
  `SELECT grant_key AS canary FROM analytics_eligibility_grants`,
  `SELECT ref_key AS canary FROM analytics_collection_eligibility`,
  `SELECT endpoint_ciphertext AS canary FROM analytics_sinks`,
  `SELECT secret_ciphertext AS canary FROM analytics_sinks`,
  `SELECT chat_user_id AS canary FROM llm_usage_events`,
  `SELECT response_id AS canary FROM llm_usage_events`,
  `SELECT messages AS canary FROM conversation_history`,
  `SELECT summary AS canary FROM memory_summary`,
  `SELECT value AS canary FROM system_config`,
  `SELECT code_hash AS canary FROM settings_auth_codes`,
  `SELECT session_id_hash AS canary FROM settings_sessions`,
]

const ALLOWLISTED_PROP_KEYS: ReadonlySet<string> = new Set(PROP_EXTRACTIONS.map((entry) => entry.propKey))

/**
 * Only non-allowlisted prop values are canaries: allowlisted keys are the
 * typed curation boundary and legitimately appear in the output; everything
 * else (free text, payloads, native IDs) must never survive.
 */
const collectPropValues = (value: unknown, into: Set<string>, topLevel: boolean): void => {
  if (typeof value === 'string') {
    if (value.length >= MIN_CANARY_LENGTH) into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPropValues(entry, into, false)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (topLevel && ALLOWLISTED_PROP_KEYS.has(key)) continue
      collectPropValues(entry, into, false)
    }
  }
}

const collectPropsCanaries = (source: SourceDb, into: Set<string>): void => {
  const rows = source.$client.query<{ props_json: string }, []>(`SELECT props_json FROM analytics_events`).all()
  for (const row of rows) {
    if (row.props_json.length >= MIN_CANARY_LENGTH) into.add(row.props_json)
    try {
      collectPropValues(JSON.parse(row.props_json), into, true)
    } catch {
      log.warn('unparseable canonical props skipped during canary collection')
    }
  }
}

export const collectSnapshotCanaries = (source: SourceDb): readonly string[] => {
  const canaries = new Set<string>()
  for (const query of CANARY_QUERIES) {
    const rows = source.$client.query<{ canary: string | null }, []>(query).all()
    for (const row of rows) {
      if (typeof row.canary === 'string' && row.canary.length >= MIN_CANARY_LENGTH) canaries.add(row.canary)
    }
  }
  collectPropsCanaries(source, canaries)
  return [...canaries].sort()
}

const scanBytes = (label: string, bytes: Uint8Array, canaries: readonly string[]): number => {
  let violations = 0
  const buffer = Buffer.from(bytes)
  for (const canary of canaries) {
    if (buffer.includes(canary, 0, 'utf8')) {
      violations += 1
      log.warn({ label }, 'snapshot canary matched output bytes')
    }
  }
  return violations
}

export type SnapshotScanResult = Readonly<{
  violations: number
  canariesChecked: number
}>

const ALLOWED_TABLES: ReadonlySet<string> = new Set(CURATED_TABLES_PSEUDONYMOUS)

/**
 * Scans the complete output: schema (allowlisted tables only, no canary in
 * any DDL), the full serialized bytes, and the freelist (must be empty after
 * VACUUM so no dropped pages survive). Throws on the first class of violation.
 */
export const scanSnapshotOutput = (publishDb: Database, canaries: readonly string[]): SnapshotScanResult => {
  const tables = publishDb
    .query<{ name: string; sql: string }, []>(`SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL`)
    .all()
  for (const table of tables) {
    if (table.name.startsWith('sqlite_')) continue
    if (!ALLOWED_TABLES.has(table.name)) {
      throw new SnapshotCanaryError('schema contains a non-allowlisted table')
    }
    if (scanBytes('schema', new TextEncoder().encode(table.sql), canaries) > 0) {
      throw new SnapshotCanaryError('schema bytes contain a canary')
    }
  }
  const freelist = publishDb.query<{ freelist_count: number }, []>(`PRAGMA freelist_count`).get()
  if ((freelist?.freelist_count ?? 0) > 0) {
    throw new SnapshotCanaryError('freelist pages survive in the publish file')
  }
  const image = publishDb.serialize()
  const violations = scanBytes('file', image, canaries)
  if (violations > 0) {
    throw new SnapshotCanaryError(`${violations} canary match(es) in the publish file bytes`)
  }
  log.info({ canariesChecked: canaries.length }, 'snapshot canary scan passed')
  return { violations: 0, canariesChecked: canaries.length }
}
