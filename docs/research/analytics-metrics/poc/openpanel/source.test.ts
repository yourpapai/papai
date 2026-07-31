// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { readCanonicalFixture, type SourceReadResult } from './source.js'

const GENERATOR_PATH = path.resolve(import.meta.dir, '../fixture/generate-fixture.ts')

function requireSource(result: SourceReadResult): Extract<SourceReadResult, { ok: true }>['value'] {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.code)
  return result.value
}

test('strictly maps every row from the deterministic canonical fixture', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'papai-openpanel-source-'))
  const databasePath = path.join(directory, 'analytics.sqlite')
  try {
    const child = Bun.spawn([process.execPath, GENERATOR_PATH, '--output', databasePath], {
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(exitCode, stderr).toBe(0)

    const source = requireSource(await readCanonicalFixture(databasePath))

    expect(source.sourceEventCount).toBe(17_183)
    expect(source.events).toHaveLength(17_183)
    expect(source.profileEventCount).toBe(16_981)
    expect(source.anonymousEventCount).toBe(202)
    expect(source.fixtureSha256).toMatch(/^[0-9a-f]{64}$/u)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
