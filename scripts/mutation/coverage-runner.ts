// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Runnability/preset lane for a test file, derived from bunfig.toml `[test] pathIgnorePatterns`
 * and the package.json lane scripts. `client` tests (tests/client/**) are excluded from default
 * discovery and only run with the `test:client` preset; `external` tests (tests/e2e/** needs
 * Docker, tests/stories/** needs the sandboxed story runner) cannot be spawned per-file at all.
 */
export type TestLane = 'server' | 'client' | 'external'

export const classifyTestLane = (testFile: string): TestLane => {
  const normalized = testFile.replace(/\\/gu, '/')
  const under = (prefix: string): boolean => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`)
  if (under('tests/e2e/') || under('tests/stories/')) return 'external'
  if (under('tests/client/')) return 'client'
  return 'server'
}

/**
 * bun argv for one coverage run. The client lane mirrors package.json `test:client`: without
 * `--path-ignore-patterns ''` bun's scanner drops tests/client/** from discovery and fails with
 * "filters did not match any test files" even when the file exists.
 */
export const buildCoverageArgs = (testFile: string): readonly string[] =>
  classifyTestLane(testFile) === 'client'
    ? [
        '--conditions=browser',
        'test',
        '--preload',
        './tests/client-setup.ts',
        '--path-ignore-patterns',
        '',
        testFile,
        '--coverage',
        '--coverage-reporter=lcov',
      ]
    : ['test', testFile, '--coverage', '--coverage-reporter=lcov']

export interface SpawnCoverageOptions {
  readonly coverageDir: string
  readonly lcovName: string
  readonly timeoutMs: number
}

export type SpawnAndParse = (
  testFile: string,
  projectRoot: string,
  opts: SpawnCoverageOptions,
) => Map<string, number> | null

/**
 * Spawn one per-lane `bun test --coverage` and parse the resulting lcov. Returns null on any
 * failure (spawn error, non-runnable external lane, missing/unparseable lcov) so the caller can
 * distinguish failure from legitimately-empty coverage and keep failures out of the cache.
 */
export const spawnAndParseLcov = (
  testFile: string,
  projectRoot: string,
  opts: SpawnCoverageOptions,
): Map<string, number> | null => {
  if (classifyTestLane(testFile) === 'external') {
    console.error(`coverage-map: skipping ${testFile}: external lane (e2e/stories) cannot be spawned per-file`)
    return null
  }
  try {
    execFileSync('bun', [...buildCoverageArgs(testFile)], {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: opts.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`coverage-map: bun coverage failed for ${testFile}: ${message}`)
    return null
  }
  const lcovPath = path.join(projectRoot, opts.coverageDir, opts.lcovName)
  if (!fs.existsSync(lcovPath)) {
    console.error(`coverage-map: lcov missing at ${lcovPath} for ${testFile}`)
    return null
  }
  try {
    return parseLcovAll(lcovPath, projectRoot)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`coverage-map: lcov parse failed for ${lcovPath}: ${message}`)
    return null
  }
}

/** Parse lcov into project-relative `sourceFile -> lines-hit` (keys match requested sourceFiles). */
const parseLcovAll = (lcovPath: string, projectRoot: string): Map<string, number> => {
  const content = fs.readFileSync(lcovPath, 'utf8')
  const out = new Map<string, number>()
  for (const section of content.split('end_of_record')) {
    const sfMatch = section.match(/^SF:(.+)$/mu)
    const lhMatch = section.match(/^LH:(\d+)$/mu)
    if (sfMatch === null || lhMatch === null) continue
    const sfPath = sfMatch[1]
    const lhText = lhMatch[1]
    if (sfPath === undefined || lhText === undefined) continue
    const abs = path.resolve(projectRoot, sfPath.trim())
    const linesHit = Number.parseInt(lhText, 10)
    if (Number.isFinite(linesHit)) out.set(path.relative(projectRoot, abs), linesHit)
  }
  return out
}
