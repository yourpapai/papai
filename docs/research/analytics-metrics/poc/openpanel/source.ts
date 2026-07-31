// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import path from 'node:path'

import { mapCanonicalRow, type CanonicalEventRow, type MappedCanonicalEvent } from './mapping.js'

export interface CanonicalFixtureSource {
  readonly events: readonly MappedCanonicalEvent[]
  readonly sourceEventCount: number
  readonly profileEventCount: number
  readonly anonymousEventCount: number
  readonly fixtureSha256: string
}

export type SourceReadResult =
  | Readonly<{ ok: true; value: CanonicalFixtureSource }>
  | Readonly<{
      code: 'PATH_MUST_BE_ABSOLUTE' | 'SOURCE_MAPPING_FAILED' | 'SOURCE_READ_FAILED'
      ok: false
      violationCount?: number
    }>

interface CountRow {
  readonly count: number
}

const SELECT_EVENTS_SQL = `
  SELECT
    event_id, schema_name, schema_version, event_version, occurred_at_ms, ingested_at_ms,
    event_name, event_source, attribution_quality, app_version, deployment_key, key_version,
    platform, platform_instance_key, actor_key, context_key, thread_key, task_instance_key,
    context_type, actor_role, task_provider, invocation_mode, turn_key, session_key,
    governance_purpose, collection_tier, policy_version, eligibility, privacy_max_class,
    expires_at_ms, props_json
  FROM analytics_events
  ORDER BY occurred_at_ms, event_id
`

async function sha256File(databasePath: string): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(databasePath).arrayBuffer())
  return createHash('sha256').update(bytes).digest('hex')
}

function mapRows(
  rows: readonly CanonicalEventRow[],
): Readonly<{ events: readonly MappedCanonicalEvent[]; violationCount: number }> {
  const results = rows.map(mapCanonicalRow)
  return {
    events: results.flatMap((result) => (result.ok ? [result.value] : [])),
    violationCount: results.reduce((count, result) => count + (result.ok ? 0 : result.violations.length), 0),
  }
}

function readRows(databasePath: string): Readonly<{
  rows: readonly CanonicalEventRow[]
  sourceEventCount: number
}> {
  using database = new Database(databasePath, { readonly: true, strict: true })
  const rows = database.query<CanonicalEventRow, []>(SELECT_EVENTS_SQL).all()
  const sourceEventCount =
    database.query<CountRow, []>('SELECT COUNT(*) AS count FROM analytics_events').get()?.count ?? -1
  return { rows, sourceEventCount }
}

export async function readCanonicalFixture(databasePath: string): Promise<SourceReadResult> {
  if (!path.isAbsolute(databasePath)) return { code: 'PATH_MUST_BE_ABSOLUTE', ok: false }
  try {
    const { rows, sourceEventCount } = readRows(databasePath)
    const mapped = mapRows(rows)
    if (mapped.violationCount > 0 || mapped.events.length !== sourceEventCount) {
      return { code: 'SOURCE_MAPPING_FAILED', ok: false, violationCount: mapped.violationCount }
    }
    const profileEventCount = mapped.events.filter((event) => Object.hasOwn(event.request.payload, 'profileId')).length
    return {
      ok: true,
      value: {
        anonymousEventCount: mapped.events.length - profileEventCount,
        events: mapped.events,
        fixtureSha256: await sha256File(databasePath),
        profileEventCount,
        sourceEventCount,
      },
    }
  } catch {
    return { code: 'SOURCE_READ_FAILED', ok: false }
  }
}
