// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

interface ActivationModelRow {
  readonly reached_first_dm: number
  readonly reached_config_link: number
  readonly reached_settings_opened: number
  readonly reached_task_assignment: number
  readonly reached_first_mutating_success: number
}

interface RetentionEngagementModelRow {
  readonly row_kind: 'engagement' | 'retention'
  readonly d1_retained_actors: number | null
  readonly d7_retained_actors: number | null
  readonly d30_retained_actors: number | null
}

interface IntentFeatureModelRow {
  readonly usage_kind: 'intent' | 'tool' | 'feature'
  readonly usage_name: string
  readonly outcome: string
}

interface ReliabilityModelRow {
  readonly row_kind: 'metric' | 'friction_signature'
  readonly metric_family: 'error' | 'friction' | 'performance'
  readonly metric_name: string
  readonly metric_provider: string | null
  readonly metric_value: number
  readonly metric_date: string
  readonly platform: string
  readonly context_type: string
  readonly task_provider: string
  readonly app_version: string
  readonly numerator: number
  readonly denominator: number
  readonly friction_r: number | null
  readonly friction_c: number | null
  readonly friction_p: number | null
  readonly friction_s: number | null
  readonly friction_l: number | null
  readonly friction_d: number | null
  readonly friction_f: number | null
  readonly friction_signature_count: number | null
  readonly friction_signature_100: number | null
  readonly rephrase_opportunities: number | null
  readonly clarification_opportunities: number | null
  readonly permission_opportunities: number | null
  readonly stop_opportunities: number | null
  readonly long_turn_opportunities: number | null
  readonly disclosure_opportunities: number | null
  readonly failure_chain_opportunities: number | null
}

interface RetentionTotals {
  readonly d1: number
  readonly d7: number
  readonly d30: number
}

const SQL_DIRECTORY = path.resolve(import.meta.dir, '../metabase/sql')
const GENERATOR_PATH = path.join(import.meta.dir, 'generate-fixture.ts')

async function loadSql(filename: string): Promise<string> {
  const file = Bun.file(path.join(SQL_DIRECTORY, filename))
  const exists = await file.exists()
  expect(exists, `Missing SQL model: ${filename}`).toBe(true)
  return exists ? file.text() : ''
}

async function withFixture<Value>(run: (database: Database) => Value | Promise<Value>): Promise<Value> {
  const directory = await mkdtemp(path.join(tmpdir(), 'papai-analytics-model-test-'))
  const databasePath = path.join(directory, 'analytics.sqlite')
  try {
    const child = Bun.spawn([process.execPath, GENERATOR_PATH, '--output', databasePath], {
      cwd: import.meta.dir,
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(exitCode, stderr).toBe(0)
    using database = new Database(databasePath, { strict: true })
    return await run(database)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

const retainedActorCount = (value: number | null): number => value ?? 0

function sumRetentionRows(rows: readonly RetentionEngagementModelRow[]): RetentionTotals {
  return rows.reduce(
    (result, row) => ({
      d1: result.d1 + retainedActorCount(row.d1_retained_actors),
      d7: result.d7 + retainedActorCount(row.d7_retained_actors),
      d30: result.d30 + retainedActorCount(row.d30_retained_actors),
    }),
    { d1: 0, d7: 0, d30: 0 },
  )
}

function frictionBits(row: ReliabilityModelRow): readonly (number | null)[] {
  return [
    row.friction_r,
    row.friction_c,
    row.friction_p,
    row.friction_s,
    row.friction_l,
    row.friction_d,
    row.friction_f,
  ]
}

function frictionOpportunities(row: ReliabilityModelRow): readonly (number | null)[] {
  return [
    row.rephrase_opportunities,
    row.clarification_opportunities,
    row.permission_opportunities,
    row.stop_opportunities,
    row.long_turn_opportunities,
    row.disclosure_opportunities,
    row.failure_chain_opportunities,
  ]
}

function isValidFrictionSignature(row: ReliabilityModelRow): boolean {
  const bits = frictionBits(row)
  const count = bits.reduce<number>((sum, bit) => sum + retainedActorCount(bit), 0)
  return (
    bits.every((bit) => bit === 0 || bit === 1) &&
    row.friction_signature_count === count &&
    row.friction_signature_100 === Math.round((100 * count) / 7) &&
    frictionOpportunities(row).every((opportunity) => opportunity !== null && opportunity >= 0)
  )
}

const successTotal = (rows: readonly ActivationModelRow[]): number =>
  rows.reduce((total, row) => total + row.reached_first_mutating_success, 0)

function providerMetricGrainIsUnique(rows: readonly ReliabilityModelRow[]): boolean {
  const providerRows = rows.filter(({ metric_name }) => metric_name.startsWith('provider_request_completed:'))
  const keys = providerRows.map(
    (row) =>
      `${row.metric_date}:${row.platform}:${row.context_type}:${row.task_provider}:${row.app_version}:${row.metric_name}:${row.metric_provider ?? 'none'}`,
  )
  return new Set(keys).size === keys.length
}

test('activation model preserves ordered funnel drop-offs', async () => {
  const sql = await loadSql('01-activation.sql')
  const result = await withFixture((database) => {
    const rows = database.query<ActivationModelRow, []>(sql).all()
    database.run(`
      UPDATE analytics_events
      SET task_instance_key = 'syn_00000000000000000000000000000000'
      WHERE event_name = 'tool_completed'
        AND json_extract(props_json, '$.domain') = 'task'
        AND json_extract(props_json, '$.risk') IN ('write', 'destructive')
        AND json_extract(props_json, '$.execution_outcome') = 'semantic_success'
    `)
    const mismatchedRows = database.query<ActivationModelRow, []>(sql).all()
    return { rows, mismatchedRows }
  })

  const totals = result.rows.reduce(
    (totalsSoFar, row) => ({
      firstDm: totalsSoFar.firstDm + row.reached_first_dm,
      config: totalsSoFar.config + row.reached_config_link,
      settings: totalsSoFar.settings + row.reached_settings_opened,
      assignment: totalsSoFar.assignment + row.reached_task_assignment,
      success: totalsSoFar.success + row.reached_first_mutating_success,
    }),
    { firstDm: 0, config: 0, settings: 0, assignment: 0, success: 0 },
  )
  expect(result.rows).toHaveLength(200)
  expect(totals).toEqual({ firstDm: 200, config: 180, settings: 160, assignment: 140, success: 120 })
  expect(successTotal(result.mismatchedRows)).toBe(0)
})

test('retention and engagement model reproduces the D1, D7, and D30 cohorts', async () => {
  const sql = await loadSql('02-retention-engagement.sql')
  const rows = await withFixture((database) => database.query<RetentionEngagementModelRow, []>(sql).all())
  const retentionRows = rows.filter(({ row_kind }) => row_kind === 'retention')
  const sums = sumRetentionRows(retentionRows)

  expect(rows.some(({ row_kind }) => row_kind === 'engagement')).toBe(true)
  expect(sums).toEqual({ d1: 90, d7: 60, d30: 30 })
})

test('intent and feature model exposes terminal outcomes and adoption dimensions', async () => {
  const sql = await loadSql('03-intents-features.sql')
  const rows = await withFixture((database) => database.query<IntentFeatureModelRow, []>(sql).all())
  const usageKinds = [...new Set(rows.map(({ usage_kind }) => usage_kind))].toSorted()
  const outcomes = new Set(rows.map(({ outcome }) => outcome))
  const usageNames = new Set(rows.map(({ usage_name }) => usage_name))

  expect(usageKinds).toEqual(['feature', 'intent', 'tool'])
  expect(outcomes.has('immediate_success')).toBe(true)
  expect(outcomes.has('recovered_same_turn')).toBe(true)
  expect(outcomes.has('abandoned_after_failure')).toBe(true)
  expect(usageNames.has('task.create')).toBe(true)
  expect(usageNames.has('no_action')).toBe(true)
  expect(usageNames.has('unknown')).toBe(true)
  expect(usageNames.has('multi_goal')).toBe(true)
  expect(usageNames.has('recurring')).toBe(true)
  expect(usageNames.has('coding')).toBe(true)
  expect(sql).toContain('intent_classified')
  expect(sql).toContain('tool_completed')
  expect(sql).toContain('feature_used')
  expect(sql).not.toContain('intent_detected')
})

test('reliability model includes error taxonomy, friction, and latency percentiles', async () => {
  const sql = await loadSql('04-reliability-friction-performance.sql')
  const rows = await withFixture((database) => database.query<ReliabilityModelRow, []>(sql).all())
  const families = [...new Set(rows.map(({ metric_family }) => metric_family))].toSorted()
  const metricNames = new Set(rows.map(({ metric_name }) => metric_name))
  const signatures = rows.filter(({ row_kind }) => row_kind === 'friction_signature')

  expect(families).toEqual(['error', 'friction', 'performance'])
  expect(metricNames.has('provider_request_completed:provider_5xx')).toBe(true)
  expect(metricNames.has('friction_signature_v1')).toBe(true)
  expect(metricNames.has('turn_duration_ms_p50')).toBe(true)
  expect(metricNames.has('turn_duration_ms_p75')).toBe(true)
  expect(metricNames.has('turn_duration_ms_p90')).toBe(true)
  expect(metricNames.has('turn_duration_ms_p95')).toBe(true)
  expect(metricNames.has('turn_duration_ms_p99')).toBe(true)
  expect(metricNames.has('time_to_first_token_ms_p50')).toBe(true)
  expect(signatures.length).toBeGreaterThan(0)
  expect(signatures.every(isValidFrictionSignature)).toBe(true)
  expect(providerMetricGrainIsUnique(rows)).toBe(true)
  expect(sql.toLowerCase()).not.toContain('weighted')
  expect(rows.every(({ metric_value }) => Number.isFinite(metric_value))).toBe(true)
})
