// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { ResultSchema } from '../../mutation-improve/src/result-schema.js'
import { SelectionSchema } from '../../mutation-improve/src/selection-schema.js'
import { agentWritePath, runAgent } from '../../review-loop/src/agent-runner.js'
import { createShellExec, runBuildCheck } from '../../review-loop/src/build-checker.js'
import { LiveRenderer } from '../../review-loop/src/live-renderer.js'
import { realSpawn } from '../../review-loop/src/spawn.js'
import {
  createWorktree,
  detectGitRoot,
  execGit,
  mergeWorktree,
  removeWorktree,
  resetWorktree,
} from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers'

afterEach(cleanupTempDirs)

describe('contracts', () => {
  test('SelectionSchema accepts a well-formed selection and rejects missing runnerUps', () => {
    const valid = {
      file: 'src/live-status/tool-status-labels.ts',
      beforeScore: 0.46,
      rationale: 'Pure, dependency-free, user-facing.',
      runnerUps: [{ file: 'src/tools/tool-metadata.ts', score: 0.29, why: 'declarative table' }],
    }
    expect(() => SelectionSchema.parse(valid)).not.toThrow()
    expect(() => SelectionSchema.parse({ ...valid, runnerUps: undefined })).toThrow()
  })

  test('SelectionSchema rejects beforeScore out of [0,1]', () => {
    const base = {
      file: 'a.ts',
      beforeScore: 0.5,
      rationale: 'x',
      runnerUps: [],
    }
    expect(() => SelectionSchema.parse({ ...base, beforeScore: 1.2 })).toThrow()
  })

  test('ResultSchema accepts empty residuals and defaults notes to empty string', () => {
    const parsed = ResultSchema.parse({
      specPath: 'docs/superpowers/specs/x-design.md',
      planPath: 'docs/superpowers/plans/x.md',
      testPaths: ['tests/live-status/x.test.ts'],
      residuals: [],
    })
    expect(parsed.notes).toBe('')
  })

  test('ResultSchema requires at least one testPath', () => {
    const base = {
      specPath: 'd.md',
      planPath: 'p.md',
      testPaths: [],
      residuals: [],
    }
    expect(() => ResultSchema.parse(base)).toThrow()
    expect(() => ResultSchema.parse({ ...base, testPaths: ['tests/x.test.ts'] })).not.toThrow()
  })

  test('ResultSchema residual entries carry the Stryker mutant ids they cover', () => {
    const parsed = ResultSchema.parse({
      specPath: 'd.md',
      planPath: 'p.md',
      testPaths: ['tests/x.test.ts'],
      residuals: [{ loc: 'src/x.ts:24', why: 'equivalent guard', mutantIds: ['2', '3', '4'] }],
    })
    expect(parsed.residuals[0]?.mutantIds).toEqual(['2', '3', '4'])
  })

  // Old agent outputs (and resumed runs) predate mutantIds; they must still
  // parse — the capped gate treats a missing list as "covers nothing", which
  // fails closed to the pre-change behaviour (iteration fails the score gate).
  test('ResultSchema defaults residual mutantIds to empty when omitted', () => {
    const parsed = ResultSchema.parse({
      specPath: 'd.md',
      planPath: 'p.md',
      testPaths: ['tests/x.test.ts'],
      residuals: [{ loc: 'src/x.ts:24', why: 'equivalent guard' }],
    })
    expect(parsed.residuals[0]?.mutantIds).toEqual([])
  })

  test('ResultSchema rejects non-string residual mutantIds', () => {
    const base = {
      specPath: 'd.md',
      planPath: 'p.md',
      testPaths: ['tests/x.test.ts'],
      residuals: [{ loc: 'src/x.ts:24', why: 'equivalent guard', mutantIds: [2, 3] }],
    }
    expect(() => ResultSchema.parse(base)).toThrow()
  })
})

describe('review-loop surface contract', () => {
  test('Tier A — LiveRenderer.log writes the message through to the stream', () => {
    const written: string[] = []
    const sink = {
      write: (chunk: string): boolean => {
        written.push(chunk)
        return true
      },
    }
    new LiveRenderer(sink).log('hello')
    expect(written.join('')).toBe('hello\n')
  })

  test('Tier A — createShellExec + runBuildCheck map exit 0 → passed and non-zero → failed', async () => {
    const dir = makeTempDir('contract-build-')
    const passed = await runBuildCheck({ exec: createShellExec(dir, 'true') })
    expect(passed.passed).toBe(true)
    const failed = await runBuildCheck({ exec: createShellExec(dir, 'false') })
    expect(failed.passed).toBe(false)
  })

  test('Tier B — consumed concrete symbols are exported and callable', () => {
    // Inventory of the review-loop surface mutation-improve consumes today.
    // Behavioral authority for the git/opencode-requiring functions lives in
    // tests/review-loop/**; this asserts presence + callability so removal or
    // export-shape drift fails loudly in mutation-improve's own gate.
    expect(typeof runAgent).toBe('function')
    expect(typeof agentWritePath).toBe('function')
    expect(typeof realSpawn).toBe('function')
    expect(typeof createWorktree).toBe('function')
    expect(typeof execGit).toBe('function')
    expect(typeof mergeWorktree).toBe('function')
    expect(typeof removeWorktree).toBe('function')
    expect(typeof resetWorktree).toBe('function')
    expect(typeof detectGitRoot).toBe('function')
  })
})
