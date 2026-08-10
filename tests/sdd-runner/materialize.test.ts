// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createMaterializer, materializeAssumptions, materializeReview } from '../../sdd-runner/src/materialize.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-mat-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeJson(dir: string, name: string, data: unknown): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data))
}

const FINDINGS_R1 = {
  findings: [
    {
      id: 'F1',
      class: 'BLOCKER',
      gap: 'no rollback path',
      question: 'how do we roll back?',
      code_evidence_attempted: 'read design.md',
    },
  ],
}
const RESOLUTIONS_R1 = {
  resolutions: [
    { id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'answered verbatim in design D2' },
  ],
  assumptions: [
    {
      id: 'A1',
      text: 'guests stay read-only',
      basis: 'convention',
      confidence: 'medium',
      blast_radius: 'group replies',
      status: 'open',
    },
  ],
}

describe('materializeReview', () => {
  it('writes review.md with a GENERATED header and one section per round including the verdict', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('GENERATED')
    expect(md).toContain('### Round 1')
    expect(md).toContain('no rollback path')
    expect(md).toContain('NITPICK')
    expect(md).toContain('1 dismissed')
  })

  it('regenerates wholesale: a second call replaces, never merges', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    await materializeReview(changeDir, sidecarDir, 1)
    const first = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    writeJson(sidecarDir, 'findings-1.json', { findings: [] })
    writeJson(sidecarDir, 'resolutions-1.json', { resolutions: [], assumptions: [] })
    await materializeReview(changeDir, sidecarDir, 1)
    const second = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(second).not.toContain('no rollback path')
    expect(second.length).toBeLessThan(first.length)
  })
})

describe('materializeAssumptions', () => {
  it('aggregates assumptions across rounds blast-ranked with a GENERATED header', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'resolutions-1.json', {
      resolutions: [],
      assumptions: [
        {
          id: 'A1',
          text: 'small assumption',
          basis: 'default',
          confidence: 'low',
          blast_radius: 'one reply',
          status: 'open',
        },
      ],
    })
    writeJson(sidecarDir, 'resolutions-2.json', {
      resolutions: [],
      assumptions: [
        {
          id: 'A2',
          text: 'big assumption',
          basis: 'default',
          confidence: 'high',
          blast_radius: 'whole bot',
          status: 'open',
        },
      ],
    })
    await materializeAssumptions(changeDir, sidecarDir, 2)
    const md = fs.readFileSync(path.join(changeDir, 'assumptions.md'), 'utf8')
    expect(md).toContain('GENERATED')
    expect(md).toContain('A1')
    expect(md).toContain('A2')
    expect(md.indexOf('whole bot')).toBeLessThan(md.indexOf('one reply'))
  })
})

describe('createMaterializer', () => {
  it('returns a function that materializes review.md and assumptions.md through the given round', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    const materialize = createMaterializer(sidecarDir, changeDir)
    await materialize(1)
    expect(fs.existsSync(path.join(changeDir, 'review.md'))).toBe(true)
    expect(fs.existsSync(path.join(changeDir, 'assumptions.md'))).toBe(true)
  })
})
