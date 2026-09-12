// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProofCheckRecord } from '../../src/deferred-prompts/proof-store.js'
import { makeReadProofResultsTool } from '../../src/tools/proof-checks-read.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'

const recordFor = (runId: string, check: string): ProofCheckRecord => ({
  run_id: runId,
  check,
  started_at: '2026-08-31T00:00:00.000Z',
  finished_at: '2026-08-31T00:01:00.000Z',
  verdict: 'pass',
  observations: [],
})

const loadOnlyStore = (records: ProofCheckRecord[]): { load: () => Promise<ProofCheckRecord[]> } => ({
  load: (): Promise<ProofCheckRecord[]> => Promise.resolve(records),
})

const withDbPath = async (dbPath: string, run: () => Promise<void>): Promise<void> => {
  const previous = process.env['DB_PATH']
  process.env['DB_PATH'] = dbPath
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env['DB_PATH']
    else process.env['DB_PATH'] = previous
  }
}

describe('read_proof_results input schema', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('accepts empty, run_id, and positive limit inputs and rejects invalid ones', () => {
    const tool = makeReadProofResultsTool()

    expect(schemaValidates(tool, {})).toBe(true)
    expect(schemaValidates(tool, { run_id: 'run-1' })).toBe(true)
    expect(schemaValidates(tool, { limit: 5 })).toBe(true)
    expect(schemaValidates(tool, { run_id: 'run-1', limit: 5 })).toBe(true)
    expect(schemaValidates(tool, { limit: 0 })).toBe(false)
    expect(schemaValidates(tool, { limit: -1 })).toBe(false)
    expect(schemaValidates(tool, { run_id: 42 })).toBe(false)
  })
})

describe('read_proof_results execution', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('lists the most recent runs first with their verdicts', async () => {
    const tool = makeReadProofResultsTool(
      loadOnlyStore([
        recordFor('run-a', 'bug4_create_response_mode'),
        recordFor('run-b', 'bug2_context_time'),
        recordFor('run-c', 'bug3_fires_on_creation'),
      ]),
    )

    const result: unknown = await getToolExecutor(tool)({})

    expect(result).toEqual({
      runs: [
        recordFor('run-c', 'bug3_fires_on_creation'),
        recordFor('run-b', 'bug2_context_time'),
        recordFor('run-a', 'bug4_create_response_mode'),
      ],
    })
  })

  test('filters by run_id', async () => {
    const tool = makeReadProofResultsTool(
      loadOnlyStore([recordFor('run-a', 'bug4_create_response_mode'), recordFor('run-b', 'bug2_context_time')]),
    )

    const result: unknown = await getToolExecutor(tool)({ run_id: 'run-b' })

    expect(result).toEqual({ runs: [recordFor('run-b', 'bug2_context_time')] })
  })

  test('limit truncates the most-recent window', async () => {
    const tool = makeReadProofResultsTool(
      loadOnlyStore([
        recordFor('run-a', 'bug4_create_response_mode'),
        recordFor('run-b', 'bug2_context_time'),
        recordFor('run-c', 'bug3_fires_on_creation'),
      ]),
    )

    const result: unknown = await getToolExecutor(tool)({ limit: 2 })

    expect(result).toEqual({
      runs: [recordFor('run-c', 'bug3_fires_on_creation'), recordFor('run-b', 'bug2_context_time')],
    })
  })

  test('an unknown run_id filter yields an empty list without erroring', async () => {
    const tool = makeReadProofResultsTool(loadOnlyStore([recordFor('run-a', 'bug4_create_response_mode')]))

    const result: unknown = await getToolExecutor(tool)({ run_id: 'missing' })

    expect(result).toEqual({ runs: [] })
  })
})

describe('read_proof_results default store', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('the no-argument wiring reads the process proof store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proof-read-'))
    try {
      await withDbPath(join(dir, 'papai.db'), async () => {
        const lines = [recordFor('run-a', 'bug2_context_time'), recordFor('run-b', 'bug3_fires_on_creation')]
        writeFileSync(join(dir, 'proof-checks.jsonl'), `${lines.map((record) => JSON.stringify(record)).join('\n')}\n`)

        const result: unknown = await getToolExecutor(makeReadProofResultsTool())({})

        expect(result).toEqual({
          runs: [recordFor('run-b', 'bug3_fires_on_creation'), recordFor('run-a', 'bug2_context_time')],
        })
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
