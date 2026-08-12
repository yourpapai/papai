// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { prepareResumeInput } from '../../sdd-runner/src/extend-round.js'

describe('prepareResumeInput module surface', () => {
  it('reads a converged review result and gathers assumptions from sidecars', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
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
