// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { validateStoredProps } from './fixture-validation.js'
import {
  ACTIVATION_QUERY,
  ENVELOPE_VIOLATIONS_QUERY,
  GUEST_VIOLATIONS_QUERY,
  IDENTITY_VIOLATIONS_QUERY,
  RETENTION_QUERY,
  TTFT_VIOLATIONS_QUERY,
} from './self-check-queries.js'
import type { ExpectedSummary } from './self-check.js'

interface CountRow {
  readonly total: number
  readonly unique_count: number
}

interface ScalarRow {
  readonly value: number
}

interface StringRow {
  readonly value: string
}

interface ActivationRow {
  readonly step: string
  readonly actors: number
}

interface RetentionRow {
  readonly d1: number
  readonly d7: number
  readonly d30: number
}

interface StoredEventRow {
  readonly event_id: string
  readonly event_name: string
  readonly props_json: string
}

interface MetadataRow {
  readonly key: string
  readonly value: string
}

const sameValues = (actual: readonly string[], expected: readonly string[]): boolean =>
  JSON.stringify(actual) === JSON.stringify(expected)

const enumValues = (database: Database, column: string): readonly string[] =>
  database
    .query<StringRow, []>(`SELECT DISTINCT ${column} AS value FROM analytics_events ORDER BY value`)
    .all()
    .map(({ value }) => value)

function storedContentViolations(database: Database): readonly string[] {
  return database
    .query<StoredEventRow, []>('SELECT event_id, event_name, props_json FROM analytics_events ORDER BY event_id')
    .all()
    .flatMap((row) => {
      try {
        const parsed: unknown = JSON.parse(row.props_json)
        return validateStoredProps(row.event_name, parsed).map((violation) => `${row.event_id}: ${violation}`)
      } catch {
        return [`${row.event_id}: props_json is not valid JSON`]
      }
    })
}

function databaseCountFailures(database: Database, expected: ExpectedSummary): readonly string[] {
  const counts = database
    .query<CountRow, []>('SELECT COUNT(*) AS total, COUNT(DISTINCT event_id) AS unique_count FROM analytics_events')
    .get()
  const actorCount = database
    .query<ScalarRow, []>('SELECT COUNT(DISTINCT actor_key) AS value FROM analytics_events')
    .get()
  const dayCount = database
    .query<ScalarRow, []>(
      "SELECT COUNT(DISTINCT date(occurred_at_ms / 1000, 'unixepoch')) AS value FROM analytics_events",
    )
    .get()
  return [
    ...(counts === null || counts.total === 0 ? ['analytics_events must contain rows'] : []),
    ...(counts !== null && counts.total !== counts.unique_count
      ? [`event_id uniqueness failed: ${counts.total} rows versus ${counts.unique_count} ids`]
      : []),
    ...(actorCount?.value === expected.actor_count ? [] : ['actor count mismatch']),
    ...(dayCount?.value === expected.day_count ? [] : ['active UTC date count mismatch']),
  ]
}

function enumCoverageFailures(database: Database, expected: ExpectedSummary): readonly string[] {
  const dimensions = [
    ['platform', expected.platforms],
    ['context_type', expected.context_types],
    ['actor_role', expected.actor_roles],
    ['task_provider', expected.task_providers],
    ['invocation_mode', expected.invocation_modes],
  ] as const
  return dimensions.flatMap(([column, expectedValues]) =>
    sameValues(enumValues(database, column), expectedValues) ? [] : [`${column} enum coverage mismatch`],
  )
}

function activationRetentionFailures(database: Database, expected: ExpectedSummary): readonly string[] {
  const activation = Object.fromEntries(
    database
      .query<ActivationRow, []>(ACTIVATION_QUERY)
      .all()
      .map(({ step, actors }) => [step, actors] as const),
  )
  const retention = database.query<RetentionRow, []>(RETENTION_QUERY).get()
  const retentionMatches =
    retention?.d1 === expected.retention_actor_counts.d1 &&
    retention.d7 === expected.retention_actor_counts.d7 &&
    retention.d30 === expected.retention_actor_counts.d30
  return [
    ...Object.entries(expected.activation_actor_counts)
      .filter(([step, expectedCount]) => activation[step] !== expectedCount)
      .map(
        ([step, expectedCount]) =>
          `${step} actor count mismatch: expected ${expectedCount}, received ${activation[step] ?? 0}`,
      ),
    ...(retentionMatches ? [] : ['D1/D7/D30 retention counts mismatch']),
  ]
}

function sourceEvidenceFailures(database: Database, expected: ExpectedSummary): readonly string[] {
  const ratio = database
    .query<ScalarRow, []>(`
      WITH source_order AS (
        SELECT occurred_at_ms, LAG(occurred_at_ms) OVER (ORDER BY rowid) AS previous_occurred_at
        FROM analytics_events
      )
      SELECT CAST(SUM(previous_occurred_at > occurred_at_ms) AS REAL) / COUNT(*) AS value
      FROM source_order
    `)
    .get()
  const metadata = Object.fromEntries(
    database
      .query<MetadataRow, []>('SELECT key, value FROM fixture_metadata')
      .all()
      .map(({ key, value }) => [key, value] as const),
  )
  const attempts = Number(metadata['duplicate_attempts'])
  const ignored = Number(metadata['duplicate_rows_ignored'])
  const ratioValid =
    ratio !== null &&
    ratio.value >= expected.out_of_order_ratio.minimum &&
    ratio.value <= expected.out_of_order_ratio.maximum
  const duplicatesValid = Number.isFinite(attempts) && attempts > 0 && attempts === ignored
  return [
    ...(ratioValid ? [] : [`out-of-order ratio is outside the expected range: ${ratio?.value ?? 'null'}`]),
    ...(metadata['seed'] === expected.seed ? [] : ['fixture seed metadata mismatch']),
    ...(duplicatesValid ? [] : ['duplicate insertion was not fully ignored by the event_id primary key']),
  ]
}

function contractFailures(database: Database): readonly string[] {
  const checks = [
    ['canonical envelope', database.query<ScalarRow, []>(ENVELOPE_VIOLATIONS_QUERY).get()?.value],
    ['guest aggregate continuity', database.query<ScalarRow, []>(GUEST_VIOLATIONS_QUERY).get()?.value],
    ['pseudonymous identity column', database.query<ScalarRow, []>(IDENTITY_VIOLATIONS_QUERY).get()?.value],
    ['TTFT source contract', database.query<ScalarRow, []>(TTFT_VIOLATIONS_QUERY).get()?.value],
  ] as const
  return checks.flatMap(([name, value]) => (value === 0 ? [] : [`${name} violations: ${value ?? 'null'}`]))
}

export function runEvidenceChecks(database: Database, expected: ExpectedSummary): readonly string[] {
  return [
    ...databaseCountFailures(database, expected),
    ...enumCoverageFailures(database, expected),
    ...activationRetentionFailures(database, expected),
    ...sourceEvidenceFailures(database, expected),
    ...contractFailures(database),
    ...storedContentViolations(database),
  ]
}
