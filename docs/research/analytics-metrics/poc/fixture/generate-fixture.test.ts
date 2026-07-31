// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  ACTIVATION_COUNTS_SQL,
  CANONICAL_CONTRACT_SQL,
  EXPECTED_EVENT_COLUMNS,
  GUEST_AGGREGATE_SQL,
  LEGACY_EVENT_COUNT_SQL,
  ORDERING_RATIO_SQL,
  REPLACE_MESSAGE_PROPS_SQL,
  RETENTION_COUNTS_SQL,
  TTFT_CONTRACT_SQL,
} from './fixture-test-queries.js'

interface SchemaColumn {
  readonly name: string
}

interface CountRow {
  readonly count: number
}

interface EnumRow {
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

interface OrderingRow {
  readonly ratio: number
}

interface MetadataRow {
  readonly key: string
  readonly value: string
}

interface EventIdRow {
  readonly event_id: string
}

interface GuestAggregateRow {
  readonly total: number
  readonly aggregate_only: number
}

interface ContractViolationRow {
  readonly violations: number
}

interface ChildResult {
  readonly exitCode: number
  readonly stderr: string
}

type EnumColumn = 'actor_role' | 'context_type' | 'invocation_mode' | 'platform' | 'task_provider'

async function runGenerator(outputPath: string): Promise<ChildResult> {
  const child = Bun.spawn(
    [process.execPath, path.join(import.meta.dir, 'generate-fixture.ts'), '--output', outputPath],
    { cwd: import.meta.dir, stderr: 'pipe', stdout: 'pipe' },
  )
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  return { exitCode, stderr }
}

async function runSelfCheck(databasePath: string): Promise<ChildResult> {
  const child = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dir, 'self-check.ts'),
      '--database',
      databasePath,
      '--expected',
      path.join(import.meta.dir, 'expected-summary.json'),
    ],
    { cwd: import.meta.dir, stderr: 'pipe', stdout: 'pipe' },
  )
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  return { exitCode, stderr }
}

async function withTemporaryDirectory<Value>(run: (directory: string) => Value | Promise<Value>): Promise<Value> {
  const directory = await mkdtemp(path.join(tmpdir(), 'papai-analytics-fixture-test-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

async function createFixture(outputPath: string): Promise<void> {
  const result = await runGenerator(outputPath)
  expect(result.exitCode, result.stderr).toBe(0)
}

function withGeneratedFixture<Value>(run: (database: Database) => Value | Promise<Value>): Promise<Value> {
  return withTemporaryDirectory(async (directory) => {
    const outputPath = path.join(directory, 'analytics.sqlite')
    await createFixture(outputPath)
    using database = new Database(outputPath, { readonly: true, strict: true })
    return await run(database)
  })
}

function readEnumValues(database: Database, column: EnumColumn): readonly string[] {
  return database
    .query<EnumRow, []>(`SELECT DISTINCT ${column} AS value FROM analytics_events ORDER BY value`)
    .all()
    .map(({ value }) => value)
}

function assertCanonicalSchema(database: Database): void {
  const columns = database
    .query<SchemaColumn, []>("SELECT name FROM pragma_table_info('analytics_events') ORDER BY cid")
    .all()
    .map(({ name }) => name)
  expect(columns).toEqual([...EXPECTED_EVENT_COLUMNS])
}

function assertCanonicalDimensions(database: Database): void {
  const actorCount = database
    .query<CountRow, []>('SELECT COUNT(DISTINCT actor_key) AS count FROM analytics_events')
    .get()
  const activeDateCount = database
    .query<CountRow, []>(
      "SELECT COUNT(DISTINCT date(occurred_at_ms / 1000, 'unixepoch')) AS count FROM analytics_events",
    )
    .get()
  expect(actorCount?.count).toBe(200)
  expect(activeDateCount?.count).toBe(50)
  expect(readEnumValues(database, 'platform')).toEqual(['discord', 'kontur-talk', 'mattermost', 'telegram'])
  expect(readEnumValues(database, 'context_type')).toEqual(['dm', 'group', 'none'])
  expect(readEnumValues(database, 'task_provider')).toEqual(['kaneo', 'none', 'other', 'youtrack'])
  expect(readEnumValues(database, 'actor_role')).toEqual(['admin', 'guest', 'member', 'system'])
  expect(readEnumValues(database, 'invocation_mode')).toEqual([
    'command',
    'normal',
    'proactive',
    'scheduler',
    'settings',
  ])
}

function assertActivationCounts(database: Database): void {
  const activation = database.query<ActivationRow, []>(ACTIVATION_COUNTS_SQL).all()
  expect(Object.fromEntries(activation.map(({ step, actors }) => [step, actors]))).toEqual({
    first_dm: 200,
    config_link_issued: 180,
    settings_opened: 160,
    task_instance_assigned: 140,
    first_task_mutating_success: 120,
  })
}

function assertRetentionCounts(database: Database): void {
  const retention = database.query<RetentionRow, []>(RETENTION_COUNTS_SQL).get()
  expect(retention).toEqual({ d1: 90, d7: 60, d30: 30 })
}

function assertOrderingAndIdempotency(database: Database): void {
  const ordering = database.query<OrderingRow, []>(ORDERING_RATIO_SQL).get()
  expect(ordering?.ratio).toBeGreaterThanOrEqual(0.05)
  expect(ordering?.ratio).toBeLessThanOrEqual(0.1)
  const metadata = Object.fromEntries(
    database
      .query<MetadataRow, []>('SELECT key, value FROM fixture_metadata')
      .all()
      .map(({ key, value }) => [key, Number(value)] as const),
  )
  expect(metadata['duplicate_attempts']).toBeGreaterThan(0)
  expect(metadata['duplicate_attempts']).toBe(metadata['duplicate_rows_ignored'])
}

function assertGuestAggregation(database: Database): void {
  const guestAggregate = database.query<GuestAggregateRow, []>(GUEST_AGGREGATE_SQL).get()
  expect(guestAggregate).toEqual({ total: 200, aggregate_only: 200 })
}

function assertCanonicalContract(database: Database): void {
  const canonicalContract = database.query<ContractViolationRow, []>(CANONICAL_CONTRACT_SQL).get()
  const legacyEvents = database.query<CountRow, []>(LEGACY_EVENT_COUNT_SQL).get()
  const ttftContract = database.query<ContractViolationRow, []>(TTFT_CONTRACT_SQL).get()
  expect(canonicalContract?.violations).toBe(0)
  expect(legacyEvents?.count).toBe(0)
  expect(ttftContract?.violations).toBe(0)
}

function assertCanonicalCoverage(database: Database): void {
  assertCanonicalDimensions(database)
  assertActivationCounts(database)
  assertRetentionCounts(database)
  assertOrderingAndIdempotency(database)
  assertGuestAggregation(database)
  assertCanonicalContract(database)
}

function replaceMessageProps(databasePath: string, propsJson: string): void {
  using database = new Database(databasePath, { strict: true })
  using statement = database.query<never, Readonly<{ props_json: string }>>(REPLACE_MESSAGE_PROPS_SQL)
  statement.run({ props_json: propsJson })
}

function replaceActorKeyWithRawValue(databasePath: string): void {
  using database = new Database(databasePath, { strict: true })
  database.run(`
    UPDATE analytics_events
    SET actor_key = 'raw-user-123'
    WHERE event_id = (
      SELECT event_id FROM analytics_events WHERE actor_key IS NOT NULL LIMIT 1
    )
  `)
}

function readEventIds(database: Database): readonly string[] {
  return database
    .query<EventIdRow, []>('SELECT event_id FROM analytics_events ORDER BY event_id')
    .all()
    .map(({ event_id }) => event_id)
}

test('fixture generator creates the flattened canonical AnalyticsEventV1 table', async () => {
  await withGeneratedFixture(assertCanonicalSchema)
})

test('fixture generator covers canonical enums, funnel, retention, privacy, and source order', async () => {
  await withGeneratedFixture(assertCanonicalCoverage)
})

test('fixture self-check accepts generated rows and rejects forbidden keys and values', async () => {
  await withTemporaryDirectory(async (directory) => {
    const outputPath = path.join(directory, 'analytics.sqlite')
    await createFixture(outputPath)
    const validCheck = await runSelfCheck(outputPath)
    expect(validCheck.exitCode, validCheck.stderr).toBe(0)
    replaceMessageProps(outputPath, '{"message_text":"synthetic sentence"}')
    const invalidKeyCheck = await runSelfCheck(outputPath)
    expect(invalidKeyCheck.exitCode).toBe(1)
    expect(invalidKeyCheck.stderr).toContain('forbidden property key message_text')
    replaceMessageProps(outputPath, '{"input_count":"https://synthetic.invalid/path"}')
    const invalidValueCheck = await runSelfCheck(outputPath)
    expect(invalidValueCheck.exitCode).toBe(1)
    expect(invalidValueCheck.stderr).toContain('forbidden content-like value')
    replaceMessageProps(
      outputPath,
      '{"attachment_count":"0","command":"none","input_count":"1","is_command":false,"length_bucket":"33_128"}',
    )
    replaceActorKeyWithRawValue(outputPath)
    const invalidIdentityCheck = await runSelfCheck(outputPath)
    expect(invalidIdentityCheck.exitCode).toBe(1)
    expect(invalidIdentityCheck.stderr).toContain('pseudonymous identity column violations')
  })
})

test('repeated fixture generation produces the same complete event-id set', async () => {
  await withTemporaryDirectory(async (directory) => {
    const firstPath = path.join(directory, 'first.sqlite')
    const secondPath = path.join(directory, 'second.sqlite')
    await Promise.all([createFixture(firstPath), createFixture(secondPath)])
    using firstDatabase = new Database(firstPath, { readonly: true, strict: true })
    using secondDatabase = new Database(secondPath, { readonly: true, strict: true })
    const firstIds = readEventIds(firstDatabase)
    const secondIds = readEventIds(secondDatabase)
    expect(firstIds.length).toBeGreaterThan(4_000)
    expect(new Set(firstIds).size).toBe(firstIds.length)
    expect(firstIds).toEqual(secondIds)
  })
})
