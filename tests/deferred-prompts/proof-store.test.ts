// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  appendProofJsonLine,
  appendProofRecord,
  defaultProofStorePath,
  loadProofRecords,
  type ProofCheckRecord,
  type ProofStoreDeps,
} from '../../src/deferred-prompts/proof-store.js'
import { createTrackedLoggerMock, mockLogger } from '../utils/test-helpers.js'

const CLOCK_BASE_MS = 1_700_000_000_000
const PROOF_STORE_CAP = 50
const FILE_NAME = 'proof-checks.jsonl'

const setDbPathEnv = (value: string | undefined): void => {
  if (value === undefined) delete process.env['DB_PATH']
  else process.env['DB_PATH'] = value
}

type ProofStoreModule = typeof import('../../src/deferred-prompts/proof-store.js')

const importFreshProofStore = (): Promise<ProofStoreModule> =>
  import(`../../src/deferred-prompts/proof-store.js?test=${crypto.randomUUID()}`)

describe('proof store', () => {
  let dir: string
  let path: string
  let ticks: number

  const fakeNow = (): Date => {
    ticks += 1
    return new Date(CLOCK_BASE_MS + ticks * 1_000)
  }

  const deps = (): ProofStoreDeps => ({ path, now: fakeNow })

  const makeRecord = (index: number, overrides: Partial<ProofCheckRecord> = {}): ProofCheckRecord => ({
    run_id: `run-${String(index).padStart(2, '0')}`,
    check: 'bug4_create_response_mode',
    variant: 'default',
    started_at: new Date(CLOCK_BASE_MS + index * 1_000).toISOString(),
    finished_at: new Date(CLOCK_BASE_MS + index * 1_000 + 500).toISOString(),
    verdict: 'pass',
    observations: [`observation ${index}`],
    ...overrides,
  })

  beforeEach(() => {
    mockLogger()
    ticks = 0
    dir = mkdtempSync(join(tmpdir(), 'papai-proof-store-'))
    path = join(dir, FILE_NAME)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('load returns an empty array and creates no file before the first append', async () => {
    const records = await loadProofRecords(deps())

    expect(records).toEqual([])
    expect(existsSync(path)).toBe(false)
  })

  test('round-trips records with the exact pinned shape', async () => {
    const withVariant = makeRecord(1)
    const bare: ProofCheckRecord = {
      run_id: 'run-02',
      check: 'bug1_delivery_matches_execution',
      started_at: new Date(CLOCK_BASE_MS + 2_000).toISOString(),
      finished_at: new Date(CLOCK_BASE_MS + 2_500).toISOString(),
      verdict: 'inconclusive',
      observations: [],
    }

    await appendProofRecord(withVariant, deps())
    await appendProofRecord(bare, deps())

    expect(await loadProofRecords(deps())).toEqual([withVariant, bare])
  })

  test('round-trips every verdict value in append order', async () => {
    const verdicts = ['pass', 'fail', 'inconclusive', 'pending'] as const

    for (const [index, verdict] of verdicts.entries()) {
      await appendProofRecord(makeRecord(index + 1, { verdict }), deps())
    }

    const records = await loadProofRecords(deps())
    expect(records.map((record) => record.verdict)).toEqual([...verdicts])
  })

  test('caps the file to the last 50 records, dropping the oldest atomically', async () => {
    for (let index = 1; index <= PROOF_STORE_CAP + 5; index++) {
      await appendProofRecord(makeRecord(index), deps())
    }

    const records = await loadProofRecords(deps())

    expect(records).toHaveLength(PROOF_STORE_CAP)
    expect(records[0]!.run_id).toBe('run-06')
    expect(records[records.length - 1]!.run_id).toBe('run-55')

    expect(readdirSync(dir)).toEqual([FILE_NAME])

    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(PROOF_STORE_CAP)
    for (const line of lines) {
      const parsed: unknown = JSON.parse(line)
      expect(parsed).not.toBeUndefined()
    }
  })

  test('caps run records, not raw lines, so interleaved delivery lines keep full run retention', async () => {
    const appendDelivery = async (index: number): Promise<void> => {
      await appendProofJsonLine(
        {
          runId: `run-${String(index).padStart(2, '0')}`,
          responseText: 'delivered',
          delivered: true,
          at: new Date(CLOCK_BASE_MS + index * 1_000).toISOString(),
        },
        deps(),
      )
    }

    for (let index = 1; index <= PROOF_STORE_CAP; index++) {
      await appendDelivery(index)
      await appendProofRecord(makeRecord(index), deps())
    }

    expect(await loadProofRecords(deps())).toHaveLength(PROOF_STORE_CAP)
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2 * PROOF_STORE_CAP)

    for (let index = PROOF_STORE_CAP + 1; index <= PROOF_STORE_CAP + 5; index++) {
      await appendDelivery(index)
      await appendProofRecord(makeRecord(index), deps())
    }

    const records = await loadProofRecords(deps())

    expect(records).toHaveLength(PROOF_STORE_CAP)
    expect(records[0]!.run_id).toBe('run-06')
    expect(records[records.length - 1]!.run_id).toBe('run-55')
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2 * PROOF_STORE_CAP - 1)
  })

  test('consults the injected clock while appending past the cap', async () => {
    let calls = 0
    const now = (): Date => {
      calls += 1
      return new Date(CLOCK_BASE_MS + calls * 1_000)
    }

    for (let index = 1; index <= PROOF_STORE_CAP + 1; index++) {
      await appendProofRecord(makeRecord(index), { path, now })
    }

    expect(calls).toBeGreaterThan(0)
  })

  test('keeps the file intact and capped under concurrent appends', async () => {
    await Promise.all(
      Array.from({ length: PROOF_STORE_CAP + 5 }, (_, index) => appendProofRecord(makeRecord(index + 1), deps())),
    )

    const records = await loadProofRecords(deps())

    expect(records).toHaveLength(PROOF_STORE_CAP)
    const ids = records.map((record) => record.run_id)
    for (const dropped of ['run-01', 'run-02', 'run-03', 'run-04', 'run-05']) {
      expect(ids).not.toContain(dropped)
    }
    for (const record of records) {
      expect(record.run_id).toMatch(/^run-\d{2}$/u)
      expect(typeof record.started_at).toBe('string')
      expect(typeof record.finished_at).toBe('string')
      expect(['pass', 'fail', 'inconclusive', 'pending']).toContain(record.verdict)
      expect(Array.isArray(record.observations)).toBe(true)
    }
    expect(readdirSync(dir)).toEqual([FILE_NAME])
  })

  test('appends raw JSON lines verbatim for non-run records and keeps the file capped', async () => {
    const line = {
      runId: 'run-raw-1',
      responseText: 'echo',
      delivered: true,
      at: new Date(CLOCK_BASE_MS).toISOString(),
    }

    await appendProofJsonLine(line, deps())

    const raw = readFileSync(path, 'utf8').trim()
    expect(JSON.parse(raw)).toEqual(line)
    expect(await loadProofRecords(deps())).toEqual([])
  })

  test('skips delivery records silently while still warning on genuinely invalid lines', async () => {
    const tracked = createTrackedLoggerMock()
    void mock.module('../../src/logger.js', () => ({ getLogLevel: tracked.getLogLevel, logger: tracked.logger }))
    const check = makeRecord(1)
    const delivery = {
      runId: 'run-9',
      responseText: 'delivered text',
      delivered: true,
      at: new Date(CLOCK_BASE_MS).toISOString(),
    }
    await appendProofJsonLine(delivery, deps())
    await appendProofRecord(check, deps())
    await appendProofJsonLine({ broken: true }, deps())

    // proof-store.ts binds `log` at module load; import a fresh instance that
    // resolves the tracked logger mock (mirrors alerts-logging.test.ts).
    const fresh = await importFreshProofStore()

    expect(await fresh.loadProofRecords(deps())).toEqual([check])
    expect(tracked.getCallsByLevel('warn').map((call) => call.args[1])).toEqual([
      'Skipping invalid line in proof store',
    ])
  })

  test('derives the default path next to DB_PATH', () => {
    const dbPath = join(dir, 'nested', 'papai.db')
    const original = process.env['DB_PATH']
    setDbPathEnv(dbPath)
    try {
      expect(defaultProofStorePath()).toBe(join(dirname(dbPath), FILE_NAME))
    } finally {
      setDbPathEnv(original)
    }
  })

  test('falls back to the papai.db directory when DB_PATH is unset', () => {
    const original = process.env['DB_PATH']
    setDbPathEnv(undefined)
    try {
      expect(defaultProofStorePath()).toBe(FILE_NAME)
    } finally {
      setDbPathEnv(original)
    }
  })
})
