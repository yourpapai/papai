// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  clearResponseError,
  readFailedDigest,
  writeResponseError,
  writeSteerResponseError,
} from '../../../afk-runner/src/work/response-error.js'

function makeRunDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'afk-response-error-'))
}

describe('response-error artifacts', () => {
  it('the file-path artifact carries the digest a resumed waiter seeds its guard from', () => {
    const runDir = makeRunDir()
    writeResponseError(runDir, 3, 'unknown assumption A9', 'a'.repeat(64))
    const errorMd = fs.readFileSync(path.join(runDir, 'gate-3.response-error.md'), 'utf8')
    expect(errorMd).toContain('the gate is NOT settled')
    expect(errorMd).not.toContain('(steer)')
    expect(readFailedDigest(runDir, 3)).toBe('a'.repeat(64))
  })

  it('the steer artifact is (steer)-marked and parse-inert: no directive line it carries can settle anything', () => {
    const runDir = makeRunDir()
    const directive = 'veto F99=drop the rollback promise'
    writeSteerResponseError(runDir, 1, `steer "${directive}" rejected: unknown finding F99`, 'b'.repeat(64))
    const errorMd = fs.readFileSync(path.join(runDir, 'gate-1.response-error.md'), 'utf8')
    expect(errorMd).toContain('(steer)')
    expect(errorMd).toContain(directive)
    expect(errorMd.split('\n').some((line) => /^veto\b/u.test(line.trim()))).toBe(false)
    expect(readFailedDigest(runDir, 1)).toBe('b'.repeat(64))
  })

  it('clearResponseError removes the artifact regardless of its producer', () => {
    const runDir = makeRunDir()
    writeSteerResponseError(runDir, 2, 'steer rejected', 'c'.repeat(64))
    clearResponseError(runDir, 2)
    expect(fs.existsSync(path.join(runDir, 'gate-2.response-error.md'))).toBe(false)
    expect(readFailedDigest(runDir, 2)).toBeNull()
  })
})
