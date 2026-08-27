// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { clearStagedSteer, pendingSteerOverride } from '../../../afk-runner/src/work/steer.js'

describe('pendingSteerOverride', () => {
  it('returns true when steer.md carries an abort', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-steer2-'))
    fs.writeFileSync(path.join(dir, 'steer.md'), 'abort\n')
    expect(pendingSteerOverride(dir)).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns false with no steering present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-steer2-'))
    expect(pendingSteerOverride(dir)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('staged veto orphaning (9.4)', () => {
  it('clearing the staged set after a gate settles drops orphaned vetoes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-steer3-'))
    fs.writeFileSync(
      path.join(dir, 'steer.staged.json'),
      JSON.stringify({ directives: [{ kind: 'veto', id: 'A1', redirect: 'other' }] }),
    )
    clearStagedSteer(dir)
    expect(fs.existsSync(path.join(dir, 'steer.staged.json'))).toBe(true)
    expect(pendingSteerOverride(dir)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
