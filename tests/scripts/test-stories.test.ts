// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildCandidateStoryManifest, type StoryManifest, writeStoryManifest } from '../../scripts/story-manifest.js'
import { parseStoryRunnerArguments, runStoryTests, STORY_SEED } from '../../scripts/test-stories.js'

const manifest = (treeHash: string): StoryManifest => ({
  version: 1,
  commit: '1234567',
  bunVersion: '1.0.0',
  seed: STORY_SEED,
  treeHash,
  files: [],
  scenarios: [],
})

function runGit(root: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function createFailingReportRemover(attempted: string[]): (reportPath: string) => Promise<void> {
  return (reportPath): Promise<void> => {
    attempted.push(path.basename(reportPath))
    if (reportPath.endsWith('manifest.json')) throw new Error('locked manifest')
    return rm(reportPath, { force: true })
  }
}

function createAlwaysFailingReportRemover(attempted: string[]): (reportPath: string) => Promise<void> {
  return (reportPath): Promise<void> => {
    attempted.push(path.basename(reportPath))
    throw new Error(`locked ${path.basename(reportPath)}`)
  }
}

describe('story runner reports and compatibility', () => {
  test('consumes compatibility options and forwards a stable default seed and JUnit reporter', () => {
    expect(parseStoryRunnerArguments(['--compat', '--baseline-ref', 'abc1234'])).toEqual({
      baselineRef: 'abc1234',
      compat: true,
      contracts: false,
      fixture: undefined,
      manifestOnly: false,
      forwarded: [
        '--seed',
        String(STORY_SEED),
        '--reporter',
        'junit',
        '--reporter-outfile',
        'reports/stories/junit.xml',
      ],
      seed: STORY_SEED,
    })
  })

  test('does not add JUnit when the caller explicitly selects a reporter', () => {
    const parsed = parseStoryRunnerArguments(['--seed=7', '--reporter', 'dots'])

    expect(parsed.seed).toBe(7)
    expect(parsed.forwarded).toEqual(['--seed=7', '--reporter', 'dots'])
  })

  test('an explicit baseline ref implies compatibility without a separate flag', () => {
    const parsed = parseStoryRunnerArguments(['--baseline-ref=abc1234'])

    expect(parsed.compat).toBe(true)
    expect(parsed.baselineRef).toBe('abc1234')
  })

  test('manifest-only consumes the option and does not configure JUnit', () => {
    expect(parseStoryRunnerArguments(['--manifest-only'])).toEqual({
      baselineRef: undefined,
      compat: false,
      contracts: false,
      fixture: undefined,
      forwarded: ['--seed', String(STORY_SEED)],
      manifestOnly: true,
      seed: STORY_SEED,
    })
  })

  test('contract mode is consumed and does not leak into Bun arguments', () => {
    const parsed = parseStoryRunnerArguments(['--contracts'])

    expect(parsed.contracts).toBe(true)
    expect(parsed.forwarded).not.toContain('--contracts')
  })

  test.each([
    '--seed=',
    '--rerun-each=',
    '--test-name-pattern=',
    '--reporter=',
    '--reporter-outfile=',
    '--coverage-reporter=',
    '--baseline-ref=',
    '--fixture=',
  ])('rejects an empty equals value for %s', (argument) => {
    expect(() => parseStoryRunnerArguments([argument])).toThrow('requires a non-empty value')
  })

  test.each(['--seed=-1', '--seed=1.5', '--seed=1e2', '--seed=Infinity', '--seed=4294967296'])(
    'rejects invalid Bun seed %s',
    (argument) => {
      expect(() => parseStoryRunnerArguments([argument])).toThrow('--seed requires an integer between 0 and 4294967295')
    },
  )

  test.each(['--rerun-each=0', '--rerun-each=-1', '--rerun-each=1.5', '--rerun-each=1e2', '--rerun-each=Infinity'])(
    'rejects invalid rerun count %s',
    (argument) => {
      expect(() => parseStoryRunnerArguments([argument])).toThrow(
        '--rerun-each requires an integer between 1 and 4294967295',
      )
    },
  )

  test('accepts the maximum Bun rerun count', () => {
    expect(parseStoryRunnerArguments(['--rerun-each=4294967295']).forwarded).toContain('--rerun-each=4294967295')
  })

  test('rejects a rerun count above the Bun integer range', () => {
    expect(() => parseStoryRunnerArguments(['--rerun-each=4294967296'])).toThrow(
      '--rerun-each requires an integer between 1 and 4294967295',
    )
  })

  test('refuses compatibility without an explicit CLI or BASE_REF ref before spawning', async () => {
    let spawnCount = 0

    const exitCode = await runStoryTests(['--compat'], {
      cwd: '/repo',
      env: {},
      spawn: () => {
        spawnCount += 1
        throw new Error('must not spawn')
      },
      buildCandidateManifest: () => Promise.resolve(manifest('a'.repeat(64))),
      buildBaselineManifest: () => Promise.resolve(manifest('a'.repeat(64))),
      writeManifest: () => Promise.resolve(),
      removeReport: () => Promise.resolve(),
      discoverStories: () => Promise.resolve(['./tests/stories/a.story.test.ts']),
      discoverContracts: () => Promise.resolve(['./tests/stories/harness/a.test.ts']),
    })

    expect(exitCode).toBe(2)
    expect(spawnCount).toBe(0)
  })

  test('compares manifests and stops before child spawn on mismatch', async () => {
    let spawnCount = 0

    const exitCode = await runStoryTests(['--baseline-ref=base123'], {
      cwd: '/repo',
      env: {},
      spawn: () => {
        spawnCount += 1
        throw new Error('must not spawn')
      },
      buildCandidateManifest: () => Promise.resolve(manifest('a'.repeat(64))),
      buildBaselineManifest: () => Promise.resolve(manifest('b'.repeat(64))),
      writeManifest: () => Promise.resolve(),
      removeReport: () => Promise.resolve(),
      discoverStories: () => Promise.resolve(['./tests/stories/a.story.test.ts']),
      discoverContracts: () => Promise.resolve(['./tests/stories/harness/a.test.ts']),
    })

    expect(exitCode).toBe(2)
    expect(spawnCount).toBe(0)
  })

  test('ignores BASE_REF outside explicit compatibility mode and writes before spawning', async () => {
    const actions: string[] = []
    let baselineBuilds = 0

    const exitCode = await runStoryTests([], {
      cwd: '/repo',
      env: { BASE_REF: 'must-not-activate-compat' },
      spawn: () => {
        actions.push('spawn')
        return { exited: Promise.resolve(0), kill: (): void => undefined }
      },
      buildCandidateManifest: () => {
        actions.push('candidate')
        return Promise.resolve(manifest('a'.repeat(64)))
      },
      buildBaselineManifest: () => {
        baselineBuilds += 1
        return Promise.resolve(manifest('a'.repeat(64)))
      },
      writeManifest: () => {
        actions.push('write')
        return Promise.resolve()
      },
      removeReport: () => Promise.resolve(),
      discoverStories: () => Promise.resolve(['./tests/stories/a.story.test.ts']),
      discoverContracts: () => Promise.resolve(['./tests/stories/harness/a.test.ts']),
    })

    expect(exitCode).toBe(0)
    expect(baselineBuilds).toBe(0)
    expect(actions).toEqual(['candidate', 'write', 'spawn'])
  })

  test('manifest-only compares BASE_REF in explicit compat mode, removes stale JUnit, and never spawns', async () => {
    const actions: string[] = []

    const exitCode = await runStoryTests(['--compat', '--manifest-only'], {
      cwd: '/repo',
      env: { BASE_REF: 'base123' },
      spawn: () => {
        actions.push('spawn')
        throw new Error('must not spawn')
      },
      buildCandidateManifest: () => {
        actions.push('candidate')
        return Promise.resolve(manifest('a'.repeat(64)))
      },
      buildBaselineManifest: () => {
        actions.push('baseline')
        return Promise.resolve(manifest('a'.repeat(64)))
      },
      writeManifest: () => {
        actions.push('write')
        return Promise.resolve()
      },
      removeReport: (reportPath) => {
        actions.push(`remove-${path.basename(reportPath, '.json').replace('.xml', '')}`)
        return Promise.resolve()
      },
      discoverStories: () => {
        actions.push('discover')
        return Promise.resolve(['./tests/stories/a.story.test.ts'])
      },
      discoverContracts: () => Promise.resolve(['./tests/stories/harness/a.test.ts']),
    })

    expect(exitCode).toBe(0)
    expect(actions).toEqual(['remove-manifest', 'remove-junit', 'candidate', 'write', 'baseline'])
  })

  test('a real invalid baseline ref fails in manifest-only mode without producing JUnit', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-runner-ref-'))
    try {
      mkdirSync(path.join(root, 'tests/stories'), { recursive: true })
      mkdirSync(path.join(root, 'scripts'), { recursive: true })
      writeFileSync(path.join(root, 'tests/stories/example.story.test.ts'), `scenario('example', async () => {})\n`)
      runGit(root, 'init', '-q')
      runGit(root, 'config', 'user.email', 'stories@example.invalid')
      runGit(root, 'config', 'user.name', 'Story Tests')
      runGit(root, 'config', 'commit.gpgsign', 'false')
      runGit(root, 'add', '--', 'tests/stories')
      runGit(root, 'commit', '-qm', 'candidate')
      const runner = path.resolve(import.meta.dir, '../../scripts/test-stories.ts')
      const child = Bun.spawn(['bun', runner, '--manifest-only', '--baseline-ref=missing-ref'], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

      expect(exitCode).not.toBe(0)
      expect(stderr).toContain('Cannot resolve baseline ref "missing-ref"')
      expect(existsSync(path.join(root, 'reports/stories/junit.xml'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('story report lifecycle', () => {
  type TestRunnerDependencies = NonNullable<Parameters<typeof runStoryTests>[1]>

  function reportFixture(): Readonly<{ root: string; manifestPath: string; junitPath: string; customPath: string }> {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-reports-'))
    const reports = path.join(root, 'reports/stories')
    mkdirSync(reports, { recursive: true })
    const manifestPath = path.join(reports, 'manifest.json')
    const junitPath = path.join(reports, 'junit.xml')
    const customPath = path.join(reports, 'custom.xml')
    writeFileSync(manifestPath, 'stale manifest')
    writeFileSync(junitPath, 'stale junit')
    writeFileSync(customPath, 'caller-owned')
    return { root, manifestPath, junitPath, customPath }
  }

  function dependencies(root: string, overrides: Partial<TestRunnerDependencies> = {}): TestRunnerDependencies {
    return {
      cwd: root,
      env: {},
      spawn: () => ({ exited: Promise.resolve(0), kill: (): void => undefined }),
      buildCandidateManifest: () => Promise.resolve(manifest('a'.repeat(64))),
      buildBaselineManifest: () => Promise.resolve(manifest('a'.repeat(64))),
      writeManifest: writeStoryManifest,
      removeReport: (reportPath) => rm(reportPath, { force: true }),
      discoverStories: () => Promise.resolve(['./tests/stories/a.story.test.ts']),
      discoverContracts: () => Promise.resolve(['./tests/stories/harness/a.test.ts']),
      ...overrides,
    }
  }

  test('invalid arguments remove both stale standard reports but preserve custom output', async () => {
    const fixture = reportFixture()
    try {
      const exitCode = await runStoryTests(['--seed='], dependencies(fixture.root))

      expect(exitCode).toBe(2)
      expect(existsSync(fixture.manifestPath)).toBe(false)
      expect(existsSync(fixture.junitPath)).toBe(false)
      expect(readFileSync(fixture.customPath, 'utf8')).toBe('caller-owned')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('out-of-range rerun count clears stale reports and stops before build or spawn', async () => {
    const fixture = reportFixture()
    let builds = 0
    let spawns = 0
    try {
      const exitCode = await runStoryTests(
        ['--rerun-each=4294967296'],
        dependencies(fixture.root, {
          buildCandidateManifest: () => {
            builds += 1
            return Promise.resolve(manifest('a'.repeat(64)))
          },
          spawn: () => {
            spawns += 1
            return { exited: Promise.resolve(0), kill: (): void => undefined }
          },
        }),
      )

      expect(exitCode).toBe(2)
      expect(builds).toBe(0)
      expect(spawns).toBe(0)
      expect(existsSync(fixture.manifestPath)).toBe(false)
      expect(existsSync(fixture.junitPath)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('candidate manifest build failure leaves both standard reports absent', async () => {
    const fixture = reportFixture()
    const external = mkdtempSync(path.join(os.tmpdir(), 'papai-story-root-link-'))
    try {
      mkdirSync(path.join(fixture.root, 'tests'), { recursive: true })
      symlinkSync(external, path.join(fixture.root, 'tests/stories'))
      const exitCode = await runStoryTests(
        ['--manifest-only'],
        dependencies(fixture.root, { buildCandidateManifest: buildCandidateStoryManifest }),
      )

      expect(exitCode).toBe(2)
      expect(existsSync(fixture.manifestPath)).toBe(false)
      expect(existsSync(fixture.junitPath)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
      rmSync(external, { recursive: true, force: true })
    }
  })

  test('compatibility mismatch leaves the current candidate manifest and no JUnit', async () => {
    const fixture = reportFixture()
    try {
      const exitCode = await runStoryTests(
        ['--baseline-ref=base'],
        dependencies(fixture.root, {
          buildBaselineManifest: () => Promise.resolve(manifest('b'.repeat(64))),
        }),
      )

      expect(exitCode).toBe(2)
      expect(JSON.parse(readFileSync(fixture.manifestPath, 'utf8'))).toEqual(manifest('a'.repeat(64)))
      expect(existsSync(fixture.junitPath)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('empty discovery leaves the current candidate manifest and no JUnit', async () => {
    const fixture = reportFixture()
    try {
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, { discoverStories: () => Promise.resolve([]) }),
      )

      expect(exitCode).toBe(2)
      expect(existsSync(fixture.manifestPath)).toBe(true)
      expect(existsSync(fixture.junitPath)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('spawn failure leaves the current candidate manifest and no JUnit', async () => {
    const fixture = reportFixture()
    try {
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, {
          spawn: () => {
            throw new Error('spawn failed')
          },
        }),
      )

      expect(exitCode).toBe(2)
      expect(existsSync(fixture.manifestPath)).toBe(true)
      expect(existsSync(fixture.junitPath)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('successful child run leaves current manifest and JUnit reports', async () => {
    const fixture = reportFixture()
    try {
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, {
          spawn: () => {
            writeFileSync(fixture.junitPath, 'current junit')
            return { exited: Promise.resolve(0), kill: (): void => undefined }
          },
        }),
      )

      expect(exitCode).toBe(0)
      expect(JSON.parse(readFileSync(fixture.manifestPath, 'utf8'))).toEqual(manifest('a'.repeat(64)))
      expect(readFileSync(fixture.junitPath, 'utf8')).toBe('current junit')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('failed child run leaves current manifest and failure JUnit reports', async () => {
    const fixture = reportFixture()
    try {
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, {
          spawn: () => {
            writeFileSync(fixture.junitPath, 'current failure junit')
            return { exited: Promise.resolve(1), kill: (): void => undefined }
          },
        }),
      )

      expect(exitCode).toBe(1)
      expect(existsSync(fixture.manifestPath)).toBe(true)
      expect(readFileSync(fixture.junitPath, 'utf8')).toBe('current failure junit')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('contract mode discovers harness tests and omits the scenario preload', async () => {
    const fixture = reportFixture()
    let command: readonly string[] = []
    try {
      const exitCode = await runStoryTests(
        ['--contracts', '--reporter=dots'],
        dependencies(fixture.root, {
          discoverStories: () => Promise.reject(new Error('story discovery must not run')),
          discoverContracts: () => Promise.resolve(['tests/stories/harness/world.test.ts']),
          spawn: (spawnCommand) => {
            command = spawnCommand
            return { exited: Promise.resolve(0), kill: (): void => undefined }
          },
        }),
      )

      expect(exitCode).toBe(0)
      expect(command).toContain('tests/stories/harness/world.test.ts')
      expect(command).not.toContain('./tests/stories/preload.ts')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('attempts both standard report removals when one cleanup throws synchronously', async () => {
    const fixture = reportFixture()
    const attempted: string[] = []
    let builds = 0
    let spawns = 0
    const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, {
          removeReport: createFailingReportRemover(attempted),
          buildCandidateManifest: () => {
            builds += 1
            return Promise.resolve(manifest('a'.repeat(64)))
          },
          spawn: () => {
            spawns += 1
            return { exited: Promise.resolve(0), kill: (): void => undefined }
          },
        }),
      )

      expect(exitCode).toBe(2)
      expect(attempted).toEqual(['manifest.json', 'junit.xml'])
      expect(builds).toBe(0)
      expect(spawns).toBe(0)
      expect(existsSync(fixture.junitPath)).toBe(false)
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('reports/stories/manifest.json')
    } finally {
      errorSpy.mockRestore()
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('names both standard paths and stops when both cleanup attempts fail', async () => {
    const fixture = reportFixture()
    const attempted: string[] = []
    let builds = 0
    const errorSpy = spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, {
          removeReport: createAlwaysFailingReportRemover(attempted),
          buildCandidateManifest: () => {
            builds += 1
            return Promise.resolve(manifest('a'.repeat(64)))
          },
        }),
      )

      expect(exitCode).toBe(2)
      expect(attempted).toEqual(['manifest.json', 'junit.xml'])
      expect(builds).toBe(0)
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('reports/stories/manifest.json')
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain('reports/stories/junit.xml')
    } finally {
      errorSpy.mockRestore()
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})
