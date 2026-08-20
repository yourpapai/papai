// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it, spyOn } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parseLcovTotals } from '../../scripts/coverage/ratchet-lib.js'
import { STORY_COVERAGE_FLOOR_PATH } from '../../scripts/coverage/story-coverage-gate.js'
import { gateStoryCoverage } from '../../scripts/story/coverage-gate.js'
import { STORY_COVERAGE_LCOV_PATH } from '../../scripts/story/reports.js'
import type { StoryRunnerSession } from '../../scripts/story/session.js'

function record(file: string, found: number, hit: number): string {
  return [`SF:${file}`, `FNF:${found}`, `FNH:${hit}`, `LF:${found}`, `LH:${hit}`, 'end_of_record'].join('\n')
}

// Two fully-covered records the child actually loaded; src/uncovered.ts is a
// real fixture file that never appears here, so scopeLcov must seed it.
const LCOV = [record('src/covered.ts', 4, 4), record('plugins/demo/index.ts', 4, 4), ''].join('\n')

async function fixtureRoot(floor: Readonly<{ lines: number; functions: number }>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'story-coverage-gate-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await mkdir(path.join(root, 'plugins', 'demo'), { recursive: true })
  await mkdir(path.join(root, 'reports', 'stories', 'coverage'), {
    recursive: true,
  })
  await mkdir(path.join(root, 'scripts', 'story'), { recursive: true })
  await writeFile(path.join(root, 'src', 'covered.ts'), 'export const covered = 1\n')
  await writeFile(path.join(root, 'src', 'uncovered.ts'), 'export const uncovered = 1\n')
  await writeFile(path.join(root, 'plugins', 'demo', 'index.ts'), 'export function run(): number {\n  return 1\n}\n')
  await writeFile(path.join(root, STORY_COVERAGE_LCOV_PATH), LCOV)
  await writeFile(path.join(root, STORY_COVERAGE_FLOOR_PATH), JSON.stringify(floor))
  return root
}

function fakeSession(copyCoverage: () => Promise<boolean>): StoryRunnerSession {
  return {
    root: '/unused',
    appRoot: '/unused',
    dependencyRoot: '/unused',
    tempRoot: '/unused',
    manifest: {
      version: 4,
      commit: '1234567',
      bunVersion: '1.0.0',
      seed: 1,
      treeHash: '0'.repeat(64),
      files: [],
      runtimeInputs: { treeHash: '0'.repeat(64), directories: [], files: [] },
      scenarios: [],
    },
    childReporterArguments: [],
    childReportPaths: [],
    reportPaths: [],
    verifyIntegrity: () => Promise.resolve(),
    copyReports: () => Promise.resolve(),
    copyCoverage,
    cleanup: () => Promise.resolve(),
  }
}

describe('gateStoryCoverage', () => {
  it('prints the coverage evaluation and the scope line with matching counts', async () => {
    const root = await fixtureRoot({ lines: 0.5, functions: 0.5 })
    try {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {})
      const exitCode = await gateStoryCoverage(
        { cwd: root },
        fakeSession(() => Promise.resolve(true)),
        0,
      )

      const output = logSpy.mock.calls.flat().join('\n')
      // scoped mean: covered.ts 1.0, plugins/demo/index.ts 1.0, uncovered.ts
      // seeded at 0 -> (1 + 1 + 0) / 3 = 66.67%.
      expect(output).toContain('T0 story coverage: lines 66.67%')
      expect(output).toContain('  scope: 2 measured, 1 unloaded seeded as 0%, 3 files')
      expect(exitCode).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('passes when the scoped figure clears the floor', async () => {
    const root = await fixtureRoot({ lines: 0.5, functions: 0.5 })
    try {
      spyOn(console, 'log').mockImplementation(() => {})
      const exitCode = await gateStoryCoverage(
        { cwd: root },
        fakeSession(() => Promise.resolve(true)),
        0,
      )

      expect(exitCode).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails when the scoped figure falls below the floor', async () => {
    const root = await fixtureRoot({ lines: 0.9, functions: 0.9 })
    try {
      spyOn(console, 'log').mockImplementation(() => {})
      const exitCode = await gateStoryCoverage(
        { cwd: root },
        fakeSession(() => Promise.resolve(true)),
        0,
      )

      expect(exitCode).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not override a nonzero child exit code even when coverage passes', async () => {
    const root = await fixtureRoot({ lines: 0.5, functions: 0.5 })
    try {
      spyOn(console, 'log').mockImplementation(() => {})
      const exitCode = await gateStoryCoverage(
        { cwd: root },
        fakeSession(() => Promise.resolve(true)),
        3,
      )

      expect(exitCode).toBe(3)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('short-circuits with the child exit code when no lcov was produced', async () => {
    const root = await fixtureRoot({ lines: 0.5, functions: 0.5 })
    try {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
      const exitCode = await gateStoryCoverage(
        { cwd: root },
        fakeSession(() => Promise.resolve(false)),
        0,
      )

      expect(exitCode).toBe(0)
      expect(warnSpy.mock.calls.flat().join('\n')).toContain('no lcov was produced')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('seeding drags the reported figure below what the same lcov reports unscoped', () => {
    // This is the property the whole scoping change exists to produce: an
    // unloaded-but-discovered source file must count against the mean, not
    // vanish from it. Prove it directly against the fixture's own lcov.
    const unscoped = parseLcovTotals(LCOV).lines.pct
    const scopedWithSeed = parseLcovTotals([LCOV.trimEnd(), record('src/uncovered.ts', 1, 0)].join('\n')).lines.pct

    expect(unscoped).toBe(1)
    expect(scopedWithSeed).toBeLessThan(unscoped)
    expect(scopedWithSeed).toBeCloseTo(2 / 3, 10)
  })
})
