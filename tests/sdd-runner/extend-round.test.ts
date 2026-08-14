// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { prepareResumeInput } from '../../sdd-runner/src/extend-round.js'

function makeSidecarDir(): { dir: string; sidecarDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-ext-'))
  const sidecarDir = path.join(dir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  return { dir, sidecarDir }
}

describe('prepareResumeInput module surface', () => {
  it('reads a converged review result and gathers assumptions from sidecars', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-ext-'))
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'fixed' }],
        assumptions: [
          { id: 'A1', text: 'ok', basis: 'default', confidence: 'medium', blast_radius: 'low', status: 'open' },
        ],
      }),
    )
    const result = await prepareResumeInput(sidecarDir, 2, 'final')
    expect(result.requiredAck).toBeUndefined()
    expect(result.assumptions.map((a) => a.id)).toContain('A1')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('prepareResumeInput gate-mode semantics', () => {
  it('treats an early gate as a cap-hit and demands the trajectory ack when no blockers are open', async () => {
    const { dir, sidecarDir } = makeSidecarDir()
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'cosmetic' }],
        assumptions: [],
      }),
    )
    const result = await prepareResumeInput(sidecarDir, 2, 'early')
    expect(result.reviewResult.outcome).toBe('cap-hit')
    expect(result.requiredAck).toBe('T1')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('waives the trajectory ack at an early gate while blockers are still open', async () => {
    const { dir, sidecarDir } = makeSidecarDir()
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'B1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }],
        assumptions: [],
      }),
    )
    const result = await prepareResumeInput(sidecarDir, 2, 'early')
    expect(result.reviewResult.outcome).toBe('cap-hit')
    expect(result.requiredAck).toBeUndefined()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('treats a final gate as converged and never demands the trajectory ack', async () => {
    const { dir, sidecarDir } = makeSidecarDir()
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-2.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }],
        assumptions: [],
      }),
    )
    const result = await prepareResumeInput(sidecarDir, 2, 'final')
    expect(result.reviewResult.outcome).toBe('converged')
    expect(result.requiredAck).toBeUndefined()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
