// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  applySteerAtBoundary,
  consumeResumeSession,
  sessionForLabel,
  type ResumedSpawn,
} from '../../sdd-runner/src/review-boundary.js'
import type { SteerDirective } from '../../sdd-runner/src/steer.js'

const tmpDirs: string[] = []

function makeRunDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-reviewboundary-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

interface SteerDepsFixture {
  readonly runDir: string
  readonly warnings: string[]
  readonly directives: SteerDirective[]
  readonly onWarning: (line: string) => void
  readonly onDirectives: (directives: readonly SteerDirective[]) => void
  readonly readRoundCap: () => number
}

function makeSteerDeps(runDir: string, roundCap: number): SteerDepsFixture {
  const warnings: string[] = []
  const directives: SteerDirective[] = []
  return {
    runDir,
    warnings,
    directives,
    onWarning: (line: string): void => {
      warnings.push(line)
    },
    onDirectives: (list: readonly SteerDirective[]): void => {
      directives.push(...list)
    },
    readRoundCap: (): number => roundCap,
  }
}

describe('applySteerAtBoundary', () => {
  test('without a steering seam returns the entry cap untouched', () => {
    expect(applySteerAtBoundary({ steer: undefined }, 7)).toBe(7)
  })

  test('with no queued steer file re-reads the round cap instead of the entry cap', () => {
    const deps = makeSteerDeps(makeRunDir(), 12)
    expect(applySteerAtBoundary({ steer: deps }, 7)).toBe(12)
    expect(deps.warnings).toEqual([])
    expect(deps.directives).toEqual([])
  })

  test('consumes the steer file: forwards warnings and directives, persists the staged set, and re-reads the cap', () => {
    const runDir = makeRunDir()
    fs.writeFileSync(path.join(runDir, 'steer.md'), 'extend\nnonsense line\n')
    const deps = makeSteerDeps(runDir, 9)

    expect(applySteerAtBoundary({ steer: deps }, 7)).toBe(9)
    expect(deps.directives).toEqual([{ kind: 'extend' }])
    expect(deps.warnings).toEqual(['unknown directive: nonsense line'])
    expect(fs.existsSync(path.join(runDir, 'steer.md'))).toBe(false)
    expect(fs.existsSync(path.join(runDir, 'steer.staged.json'))).toBe(true)
  })

  test('valid directives without an onDirectives callback are not fatal', () => {
    const runDir = makeRunDir()
    fs.writeFileSync(path.join(runDir, 'steer.md'), 'abort\n')

    expect(
      applySteerAtBoundary(
        {
          steer: {
            runDir,
            onWarning: () => undefined,
            readRoundCap: () => 3,
          },
        },
        1,
      ),
    ).toBe(3)
  })
})

describe('consumeResumeSession', () => {
  const session: ResumedSpawn = { label: 'alpha', opencodeSessionId: 'ses-1', round: 2 }

  test('no recorded session stays undefined', () => {
    expect(consumeResumeSession(undefined, 2)).toBeUndefined()
  })

  test('a resume from an earlier round runs fresh by design', () => {
    expect(consumeResumeSession(session, 3)).toBeUndefined()
  })

  test('a resume recorded in the current round is returned', () => {
    expect(consumeResumeSession(session, 2)).toBe(session)
  })
})

describe('sessionForLabel', () => {
  const session: ResumedSpawn = { label: 'alpha-r2', opencodeSessionId: 'ses-1', round: 2 }

  test('no consumed session yields no session id', () => {
    expect(sessionForLabel(undefined, 'alpha', 2)).toBeUndefined()
  })

  test('a label from another round does not match', () => {
    expect(sessionForLabel(session, 'alpha', 3)).toBeUndefined()
  })

  test('the round-matched label yields its opencode session id', () => {
    expect(sessionForLabel(session, 'alpha', 2)).toBe('ses-1')
  })
})
