// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../../src/db/schema.js'
import { createMigratedDbFile, restoreDrizzle, setTestDrizzleDb } from '../utils/test-helpers.js'
import { seedShadowFunnelFixture } from './shadow-funnel-fixture.js'

describe('memory:shadow-funnel CLI dry-run', () => {
  let dir: string
  let dbPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shadow-funnel-cli-'))
    dbPath = join(dir, 'funnel.db')
    await createMigratedDbFile(dbPath)

    // Point the singleton at the on-disk file so the real writer seeds it, then close and
    // release it -- the spawned CLI opens the same path itself.
    const sqlite = new Database(dbPath)
    sqlite.run('PRAGMA foreign_keys=ON')
    setTestDrizzleDb(drizzle(sqlite, { schema }))
    seedShadowFunnelFixture()
    sqlite.close()
    restoreDrizzle()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function runFunnel(args: readonly string[] = []): Promise<string> {
    const proc = Bun.spawn(['bun', 'run', 'scripts/memory-shadow-funnel.ts', ...args], {
      env: { ...process.env, DB_PATH: dbPath },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) throw new Error(`funnel script exited ${exitCode}: ${stderr}`)
    return stdout
  }

  test('prints one block per reader model, ascending, with no pooled figures', async () => {
    const out = await runFunnel()

    expect(out.match(/reader_model_id: /gu)).toHaveLength(3)
    expect(out.indexOf('model-a')).toBeLessThan(out.indexOf('model-b'))
    expect(out.indexOf('model-b')).toBeLessThan(out.indexOf('model-c'))

    // A pooled distinct-scope count would be 107 (model-c shares model-a's scopes) and a
    // pooled turn count would be 238. Neither may ever appear.
    expect(out).not.toContain('107')
    expect(out).not.toContain('238')
    expect(out.toLowerCase()).not.toContain('all models')
    expect(out.toLowerCase()).not.toContain('total')
  })

  test('reports model-a exactly: preconditions met on M, short on N, below-5% rate', async () => {
    const out = await runFunnel()

    expect(out).toContain('reader_model_id: model-a')
    expect(out).toContain('  memory-bearing turns:      110 (below the pre-registered N = 1000)')
    expect(out).toContain('  shadow_hit turns (rank>=1): 44')
    expect(out).toContain('  under-trigger turns:       4')
    expect(out).toContain('  under-trigger rate:        3.64%')
    expect(out).toContain('  overlap-when-pulled turns: 30')
    expect(out).toContain('  over-pull turns:           10')
    // 55, not 60: the 5 zero-active-record scopes must not inflate M.
    expect(out).toContain('  distinct scopes (M):       55 (meets the pre-registered M >= 50)')
  })

  test('reports model-b exactly: preconditions met on M, rate at/above 5%', async () => {
    const out = await runFunnel()

    expect(out).toContain('reader_model_id: model-b')
    expect(out).toContain('  memory-bearing turns:      104 (below the pre-registered N = 1000)')
    expect(out).toContain('  shadow_hit turns (rank>=1): 38')
    expect(out).toContain('  under-trigger turns:       13')
    expect(out).toContain('  under-trigger rate:        12.50%')
    expect(out).toContain('  overlap-when-pulled turns: 20')
    expect(out).toContain('  over-pull turns:           5')
    expect(out).toContain('  distinct scopes (M):       52 (meets the pre-registered M >= 50)')
  })

  test('reports model-c exactly: M short, so its high rate is not yet trustworthy', async () => {
    const out = await runFunnel()

    expect(out).toContain('reader_model_id: model-c')
    expect(out).toContain('  memory-bearing turns:      24 (below the pre-registered N = 1000)')
    expect(out).toContain('  shadow_hit turns (rank>=1): 12')
    expect(out).toContain('  under-trigger turns:       6')
    expect(out).toContain('  under-trigger rate:        25.00%')
    expect(out).toContain('  overlap-when-pulled turns: 4')
    expect(out).toContain('  over-pull turns:           2')
    expect(out).toContain('  distinct scopes (M):       12 (below the pre-registered M >= 50)')
  })

  test('leaves the under-trigger rate unmarked -- the 5% branch is the operator call', async () => {
    const out = await runFunnel()

    expect(out).not.toContain('5%)')
    expect(out).not.toMatch(/under-trigger rate:.*pre-registered/u)
  })

  test('prints the three gate footnotes verbatim', async () => {
    const out = await runFunnel()

    expect(out).toContain(
      'Note: shadow_hit is a rank cutoff (top-k position within the shadow cascade), not a relevance-score' +
        ' threshold -- see the doc comment on ShadowRecallHit.score in src/long-term-memory/shadow-recall.ts.',
    )
    expect(out).toContain(
      'Note: over-pull turns (shadow_pull_overlap = 0) is NOT a pre-registered or spec-numeric threshold',
    )
    expect(out).toContain(
      'Note: distinct scopes (M) IS part of the frozen go/no-go gate -- the gate requires N = 1000 sampled',
    )
  })

  test('--reader-model-id narrows to a single block', async () => {
    const out = await runFunnel(['--reader-model-id', 'model-b'])

    expect(out.match(/reader_model_id: /gu)).toHaveLength(1)
    expect(out).toContain('reader_model_id: model-b')
    expect(out).not.toContain('model-a')
    expect(out).not.toContain('model-c')
  })
})
