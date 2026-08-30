// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findingsGapTextsFor, readConcernSidecar } from '../../sdd-runner/src/gate-sidecars.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gs-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeRound3Sidecars(dir: string): string {
  const sidecarDir = path.join(dir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.writeFileSync(
    path.join(sidecarDir, 'findings-3.json'),
    JSON.stringify({
      findings: [
        {
          id: 'F2',
          class: 'MATERIAL',
          gap: 'the proposal never names the scope id for the migrated table',
          question: 'q',
          code_evidence_attempted: 'e',
        },
      ],
    }),
  )
  fs.writeFileSync(
    path.join(sidecarDir, 'findings-skeptic-3.json'),
    JSON.stringify({
      findings: [
        {
          id: 'S1',
          class: 'NITPICK',
          gap: 'short',
          question: 'q',
          code_evidence_attempted: 'e',
        },
      ],
    }),
  )
  return sidecarDir
}

describe('findingsGapTextsFor (loop-memory D7)', () => {
  it('joins finding ids to gap text from both lenses round sidecars', async () => {
    const sidecarDir = writeRound3Sidecars(makeDir())
    const gaps = await findingsGapTextsFor(sidecarDir, 3)
    expect(gaps.get('F2')).toBe('the proposal never names the scope id for the migrated table')
    expect(gaps.get('S1')).toBe('short')
  })

  it('truncates long gaps to an excerpt so gate rows stay one line', async () => {
    const dir = makeDir()
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, 'findings-3.json'),
      JSON.stringify({
        findings: [
          {
            id: 'F2',
            class: 'MATERIAL',
            gap: 'x'.repeat(400),
            question: 'q',
            code_evidence_attempted: 'e',
          },
        ],
      }),
    )
    const gaps = await findingsGapTextsFor(sidecarDir, 3)
    expect(gaps.get('F2')?.length).toBeLessThanOrEqual(99)
    expect(gaps.get('F2')).toContain('…')
  })

  it('returns an empty map when the sidecars are missing or invalid', async () => {
    const gaps = await findingsGapTextsFor(path.join(makeDir(), 'sidecars'), 3)
    expect(gaps.size).toBe(0)
  })
})

describe('readConcernSidecar (loop-memory D5)', () => {
  it('reads concern records written at round close', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, 'concerns.json'),
      `${JSON.stringify([
        {
          fingerprint: 'names scope id',
          firstRound: 1,
          lastRound: 3,
          entries: [{ round: 1, id: 'F2', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }],
        },
      ])}\n`,
    )
    const records = await readConcernSidecar(sidecarDir)
    expect(records).toHaveLength(1)
    expect(records[0]?.fingerprint).toBe('names scope id')
  })

  it('missing or corrupt sidecar reads as empty', async () => {
    expect(await readConcernSidecar(path.join(makeDir(), 'sidecars'))).toHaveLength(0)
    const sidecarDir = path.join(makeDir(), 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(path.join(sidecarDir, 'concerns.json'), 'not json')
    expect(await readConcernSidecar(sidecarDir)).toHaveLength(0)
  })
})
