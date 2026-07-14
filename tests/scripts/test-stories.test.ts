// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, spyOn, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { acquireStoryDependencySnapshot } from '../../scripts/story-dependency-snapshot.js'
import { buildCandidateStoryManifest, type StoryManifest, writeStoryManifest } from '../../scripts/story-manifest.js'
import { resolveReporterOutfiles } from '../../scripts/story-runner-arguments.js'
import type { StoryRunnerSession } from '../../scripts/story-runner-session.js'
import type { StorySandboxRequest } from '../../scripts/story-sandbox.js'
import { parseStoryRunnerArguments, runStoryTests, STORY_SEED } from '../../scripts/test-stories.js'

const manifest = (treeHash: string): StoryManifest => ({
  version: 4,
  commit: '1234567',
  bunVersion: '1.0.0',
  seed: STORY_SEED,
  treeHash,
  files: [],
  runtimeInputs: { treeHash: '0'.repeat(64), directories: [], files: [] },
  scenarios: [],
})

function testSession(
  root: string,
  candidate: StoryManifest,
  options: Readonly<{
    appRoot?: string
    cleanup?: () => Promise<void>
    copyReports?: () => Promise<void>
    verifyIntegrity?: () => Promise<void>
  }> = {},
): StoryRunnerSession {
  const appRoot = options.appRoot ?? root
  const reportPath = path.join(root, 'reports', 'junit.xml')
  return {
    root,
    appRoot,
    tempRoot: path.join(root, 'tmp'),
    manifest: candidate,
    childReporterArguments: ['--reporter', 'junit', '--reporter-outfile', reportPath],
    childReportPaths: [reportPath],
    reportPaths: [reportPath],
    verifyIntegrity: options.verifyIntegrity ?? (() => Promise.resolve()),
    copyReports: options.copyReports ?? (() => Promise.resolve()),
    cleanup: options.cleanup ?? (() => Promise.resolve()),
  }
}

function sessionDependencies(session: StoryRunnerSession): Readonly<{
  createStoryRunnerSession: () => Promise<StoryRunnerSession>
  buildSandboxCommand: (request: StorySandboxRequest) => readonly string[]
  resolveSessionDependencyRoot: () => string
}> {
  return {
    createStoryRunnerSession: () => Promise.resolve(session),
    buildSandboxCommand: (request) => request.command,
    resolveSessionDependencyRoot: () => '/dependencies/node_modules',
  }
}

function runGit(root: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function makeRemovable(root: string): void {
  if (!lstatSync(root).isDirectory()) return
  for (const entry of readdirSync(root)) makeRemovable(path.join(root, entry))
  chmodSync(root, 0o700)
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
  test('runs through a verified sandbox session and copies reports only after post-exit integrity', async () => {
    const actions: string[] = []
    const candidate = {
      ...manifest('a'.repeat(64)),
      files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
    }
    const session = {
      root: '/session',
      appRoot: '/session/app',
      tempRoot: '/session/tmp',
      manifest: candidate,
      childReporterArguments: ['--reporter', 'junit', '--reporter-outfile', '/session/reports/junit.xml'],
      childReportPaths: ['/session/reports/junit.xml'],
      reportPaths: ['/session/reports/junit.xml'],
      verifyIntegrity: mock(() => {
        actions.push('verify')
        return Promise.resolve()
      }),
      copyReports: mock(() => {
        actions.push('copy')
        return Promise.resolve()
      }),
      cleanup: mock(() => {
        actions.push('cleanup')
        return Promise.resolve()
      }),
    } as StoryRunnerSession
    const dependencies = {
      cwd: '/repo',
      env: { HOME: '/must-not-leak' },
      spawn: mock((command: readonly string[], options: Parameters<typeof Bun.spawn>[1]) => {
        actions.push('spawn')
        expect(command).toEqual(['sandbox-exec', '-p', 'profile', '/bun', 'test'])
        expect(options?.cwd).toBe(session.appRoot)
        expect(options?.env?.['TMPDIR']).toBe(session.tempRoot)
        expect(options?.env?.['PAPAI_STORY_EXECUTION_ROOT']).toBe(session.appRoot)
        expect(options?.env?.['HOME']).toBeUndefined()
        return { exited: Promise.resolve(0), kill: (): void => undefined }
      }),
      buildCandidateManifest: () => Promise.resolve(candidate),
      buildBaselineManifest: () => Promise.resolve(candidate),
      writeManifest: () => Promise.resolve(),
      removeReport: () => Promise.resolve(),
      discoverStories: () => Promise.reject(new Error('live story discovery must not run')),
      discoverContracts: () => Promise.reject(new Error('live contract discovery must not run')),
      createStoryRunnerSession: (options) => {
        actions.push('session')
        expect(options.sandboxBackend).toBe('darwin-sandbox-exec')
        return Promise.resolve(session)
      },
      buildSandboxCommand: mock((request: StorySandboxRequest) => {
        actions.push('sandbox')
        expect(request).toMatchObject({
          platform: 'darwin',
          appRoot: session.appRoot,
          dependencyRoot: '/dependencies/node_modules',
          tempRoot: session.tempRoot,
          reportPaths: session.childReportPaths,
          bunExecutable: '/bun',
        })
        return ['sandbox-exec', '-p', 'profile', '/bun', 'test']
      }),
      platform: 'darwin' as NodeJS.Platform,
      bunExecutable: '/bun',
      resolveSessionDependencyRoot: () => '/dependencies/node_modules',
    } as Parameters<typeof runStoryTests>[1]

    await expect(runStoryTests([], dependencies)).resolves.toBe(0)

    expect(actions).toEqual(['session', 'verify', 'sandbox', 'spawn', 'verify', 'copy', 'cleanup'])
  })

  test('fails before spawning when no sandbox backend supports the platform', async () => {
    let spawned = false
    const candidate = {
      ...manifest('a'.repeat(64)),
      files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
    }
    const exitCode = await runStoryTests([], {
      cwd: '/repo',
      env: {},
      spawn: () => {
        spawned = true
        return { exited: Promise.resolve(0), kill: (): void => undefined }
      },
      createStoryRunnerSession: () => Promise.resolve(testSession('/session', candidate)),
      resolveSessionDependencyRoot: () => '/dependencies/node_modules',
      buildCandidateManifest: () => Promise.resolve(candidate),
      buildBaselineManifest: () => Promise.resolve(candidate),
      writeManifest: () => Promise.resolve(),
      removeReport: () => Promise.resolve(),
      discoverStories: () => Promise.resolve(['tests/stories/a.story.test.ts']),
      discoverContracts: () => Promise.resolve([]),
      platform: 'freebsd' as NodeJS.Platform,
    } as Parameters<typeof runStoryTests>[1])

    expect(exitCode).toBe(2)
    expect(spawned).toBe(false)
  })

  test.each([
    ['Docker availability', new Error('Story sandbox Docker availability check failed')],
    ['pinned Bun version', new Error('Story sandbox Docker image must run Bun 1.3.13')],
  ])('rejects a Linux %s failure before session creation or spawn', async (_failure, failure) => {
    const actions: string[] = []
    const candidate = {
      ...manifest('a'.repeat(64)),
      files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
    }
    const exitCode = await runStoryTests([], {
      cwd: '/repo',
      env: {},
      spawn: () => {
        actions.push('spawn')
        return { exited: Promise.resolve(0), kill: (): void => undefined }
      },
      createStoryRunnerSession: () => {
        actions.push('session')
        return Promise.resolve(testSession('/session', candidate))
      },
      assertLinuxSandboxBackend: () => {
        actions.push('preflight')
        throw failure
      },
      buildCandidateManifest: () => Promise.resolve(candidate),
      buildBaselineManifest: () => Promise.resolve(candidate),
      writeManifest: () => Promise.resolve(),
      removeReport: () => Promise.resolve(),
      discoverStories: () => Promise.resolve([]),
      discoverContracts: () => Promise.resolve([]),
      platform: 'linux' as NodeJS.Platform,
    } as Parameters<typeof runStoryTests>[1])

    expect(exitCode).toBe(2)
    expect(actions).toEqual(['preflight'])
  })

  test.each([
    ['mutation', (liveStory: string): void => writeFileSync(liveStory, 'mutated story')],
    ['symlink', (liveStory: string, external: string): void => symlinkSync(external, liveStory)],
  ] as const)(
    'executes captured story bytes when the live file is replaced by %s after manifest capture',
    async (_replacement, replace) => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-snapshot-race-'))
      const snapshotRoot = mkdtempSync(path.join(root, '.story-inputs-'))
      const storyPath = 'tests/stories/example.story.test.ts'
      const liveStory = path.join(root, storyPath)
      const snapshotStory = path.join(snapshotRoot, storyPath)
      const external = path.join(root, 'external.story.test.ts')
      mkdirSync(path.dirname(liveStory), { recursive: true })
      mkdirSync(path.dirname(snapshotStory), { recursive: true })
      writeFileSync(liveStory, 'captured story')
      writeFileSync(snapshotStory, 'captured story')
      writeFileSync(external, 'symlink replacement')
      let spawnedStory = ''
      try {
        const candidate = { ...manifest('a'.repeat(64)), files: [{ path: storyPath, sha256: 'b'.repeat(64) }] }
        const session = testSession(snapshotRoot, candidate, {
          cleanup: () => rm(snapshotRoot, { recursive: true, force: true }),
        })
        const exitCode = await runStoryTests([], {
          cwd: root,
          env: {},
          spawn: (command) => {
            const commandStory = command.at(-1)
            expect(commandStory).toBeDefined()
            spawnedStory = path.resolve(root, String(commandStory))
            expect(readFileSync(spawnedStory, 'utf8')).toBe('captured story')
            return { exited: Promise.resolve(0), kill: (): void => undefined }
          },
          buildCandidateManifest: () => Promise.resolve(candidate),
          ...sessionDependencies(session),
          buildBaselineManifest: () => Promise.resolve(candidate),
          writeManifest: () => {
            rmSync(liveStory)
            replace(liveStory, external)
            return Promise.resolve()
          },
          removeReport: () => Promise.resolve(),
          discoverStories: () => Promise.reject(new Error('live discovery must not run')),
          discoverContracts: () => Promise.reject(new Error('live discovery must not run')),
        })

        expect(exitCode).toBe(0)
        expect(spawnedStory).toBe(snapshotStory)
        expect(existsSync(snapshotRoot)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )

  test('runs the child from the snapshot with captured relative inputs and live report output', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-snapshot-cwd-'))
    const snapshotRoot = path.join(root, '.story-snapshot')
    const storyPath = 'tests/stories/example.story.test.ts'
    const runtimeInputPath = 'runtime/input.txt'
    const reportPath = path.join(root, 'reports/stories/junit.xml')
    const candidate = { ...manifest('a'.repeat(64)), files: [{ path: storyPath, sha256: 'b'.repeat(64) }] }
    try {
      for (const directory of ['tests/stories', 'runtime', 'reports/stories']) {
        mkdirSync(path.join(root, directory), { recursive: true })
        mkdirSync(path.join(snapshotRoot, directory), { recursive: true })
      }
      writeFileSync(path.join(root, runtimeInputPath), 'live runtime input')
      writeFileSync(path.join(snapshotRoot, runtimeInputPath), 'captured runtime input')
      writeFileSync(path.join(snapshotRoot, storyPath), 'captured story')
      writeFileSync(path.join(snapshotRoot, 'tests/setup.ts'), '')
      writeFileSync(path.join(snapshotRoot, 'tests/mock-reset.ts'), '')
      writeFileSync(path.join(snapshotRoot, 'tests/stories/preload.ts'), '')
      const session = testSession(snapshotRoot, candidate, {
        cleanup: () => rm(snapshotRoot, { recursive: true, force: true }),
        copyReports: () => {
          writeFileSync(reportPath, readFileSync(path.join(snapshotRoot, 'reports/junit.xml')))
          return Promise.resolve()
        },
      })

      const exitCode = await runStoryTests([], {
        cwd: root,
        env: {},
        spawn: (command, options) => {
          expect(options).toBeDefined()
          const childOptions = options!
          expect(childOptions.cwd).toBe(snapshotRoot)
          expect(childOptions.env?.['PAPAI_STORY_EXECUTION_ROOT']).toBe(snapshotRoot)
          expect(readFileSync(path.join(String(childOptions.cwd), runtimeInputPath), 'utf8')).toBe(
            'captured runtime input',
          )

          const setupPreload = path.join(snapshotRoot, 'tests/setup.ts')
          const mockResetPreload = path.join(snapshotRoot, 'tests/mock-reset.ts')
          const storyPreload = path.join(snapshotRoot, 'tests/stories/preload.ts')
          const storyFile = path.join(snapshotRoot, storyPath)
          const storyFileIndex = command.indexOf(storyFile)
          const setupPreloadIndex = command.indexOf(setupPreload)
          const mockResetPreloadIndex = command.indexOf(mockResetPreload)
          const storyPreloadIndex = command.indexOf(storyPreload)
          expect(setupPreloadIndex).toBeGreaterThanOrEqual(0)
          expect(mockResetPreloadIndex).toBeGreaterThanOrEqual(0)
          expect(storyPreloadIndex).toBeGreaterThanOrEqual(0)
          expect(setupPreloadIndex).toBeLessThan(storyFileIndex)
          expect(mockResetPreloadIndex).toBeLessThan(storyFileIndex)
          expect(storyPreloadIndex).toBeLessThan(storyFileIndex)

          const reportArgument = command.indexOf('--reporter-outfile')
          expect(command[reportArgument + 1]).toBe(path.join(snapshotRoot, 'reports/junit.xml'))
          writeFileSync(path.join(snapshotRoot, 'reports/junit.xml'), 'current junit')
          return { exited: Promise.resolve(0), kill: (): void => undefined }
        },
        buildCandidateManifest: () => Promise.resolve(candidate),
        ...sessionDependencies(session),
        buildBaselineManifest: () => Promise.resolve(candidate),
        writeManifest: (_manifest, outputPath) => {
          writeFileSync(outputPath, 'current manifest')
          writeFileSync(path.join(root, runtimeInputPath), 'mutated live runtime input')
          return Promise.resolve()
        },
        removeReport: () => Promise.resolve(),
        discoverStories: () => Promise.reject(new Error('live discovery must not run')),
        discoverContracts: () => Promise.reject(new Error('live discovery must not run')),
      })

      expect(exitCode).toBe(0)
      expect(readFileSync(reportPath, 'utf8')).toBe('current junit')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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

  test('cleans the snapshot and never spawns when terminated during compatibility', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-pre-spawn-signal-'))
    const snapshotRoot = path.join(root, '.snapshot')
    mkdirSync(snapshotRoot)
    let spawns = 0
    const safetyHandler = (): void => undefined
    process.once('SIGTERM', safetyHandler)
    try {
      const candidate = manifest('a'.repeat(64))
      const session = testSession(snapshotRoot, candidate, {
        cleanup: () => rm(snapshotRoot, { recursive: true, force: true }),
      })
      const exitCode = await runStoryTests([], {
        cwd: root,
        env: {},
        spawn: () => {
          spawns += 1
          return { exited: Promise.resolve(0), kill: (): void => undefined }
        },
        ...sessionDependencies(session),
        buildCandidateManifest: () => Promise.resolve(candidate),
        buildBaselineManifest: () => Promise.resolve(candidate),
        writeManifest: () => {
          process.emit('SIGTERM')
          return Promise.resolve()
        },
        removeReport: () => Promise.resolve(),
        discoverStories: () => Promise.resolve(['tests/stories/a.story.test.ts']),
        discoverContracts: () => Promise.resolve([]),
      })

      expect(exitCode).toBe(143)
      expect(spawns).toBe(0)
      expect(existsSync(snapshotRoot)).toBe(false)
    } finally {
      process.off('SIGTERM', safetyHandler)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('does not add JUnit when the caller explicitly selects a reporter', () => {
    const parsed = parseStoryRunnerArguments(['--seed=7', '--reporter', 'dots'])

    expect(parsed.seed).toBe(7)
    expect(parsed.forwarded).toEqual(['--seed=7', '--reporter', 'dots'])
  })

  test.each([
    ['split', ['--reporter-outfile', '../../outside.xml']],
    ['equals', ['--reporter-outfile=/tmp/outside.xml']],
  ])('rejects a %s reporter outfile outside the live report directory', (_form, argv) => {
    const parsed = parseStoryRunnerArguments(argv)

    expect(() => resolveReporterOutfiles(parsed.forwarded, '/repo')).toThrow(
      'Story reporter outfile must stay within /repo/reports/stories',
    )
  })

  test.each([
    ['split', ['--reporter-outfile', 'reports/stories/custom.xml']],
    ['equals', ['--reporter-outfile=./reports/stories/custom.xml']],
  ])('resolves a %s canonical reporter outfile within the live report directory', (_form, argv) => {
    const parsed = parseStoryRunnerArguments(argv)

    expect(resolveReporterOutfiles(parsed.forwarded, '/repo').join(' ')).toContain('/repo/reports/stories/custom.xml')
  })

  test('rejects a bare reporter outfile instead of resolving it outside the live report directory', () => {
    const parsed = parseStoryRunnerArguments(['--reporter-outfile', 'custom.xml'])

    expect(() => resolveReporterOutfiles(parsed.forwarded, '/repo')).toThrow(
      'Story reporter outfile must stay within /repo/reports/stories',
    )
  })

  test('rejects a reporter outfile through an existing report-directory symlink', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-reporter-link-'))
    const outside = mkdtempSync(path.join(os.tmpdir(), 'papai-story-reporter-outside-'))
    try {
      mkdirSync(path.join(root, 'reports/stories'), { recursive: true })
      symlinkSync(outside, path.join(root, 'reports/stories/external'))
      const parsed = parseStoryRunnerArguments(['--reporter-outfile', 'reports/stories/external/custom.xml'])

      expect(() => resolveReporterOutfiles(parsed.forwarded, root)).toThrow(
        'Story reporter outfile must not traverse symbolic links',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('rejects a reporter outfile through an existing reports ancestor symlink', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-reporter-root-link-'))
    const outside = mkdtempSync(path.join(os.tmpdir(), 'papai-story-reporter-root-outside-'))
    try {
      mkdirSync(path.join(outside, 'stories'), { recursive: true })
      symlinkSync(outside, path.join(root, 'reports'))
      const parsed = parseStoryRunnerArguments(['--reporter-outfile', 'reports/stories/custom.xml'])

      expect(() => resolveReporterOutfiles(parsed.forwarded, root)).toThrow(
        'Story reporter outfile must not traverse symbolic links',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
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
    const candidate = manifest('a'.repeat(64))
    const session = testSession('/session', {
      ...candidate,
      files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
    })

    const exitCode = await runStoryTests([], {
      cwd: '/repo',
      env: { BASE_REF: 'must-not-activate-compat' },
      spawn: () => {
        actions.push('spawn')
        return { exited: Promise.resolve(0), kill: (): void => undefined }
      },
      ...sessionDependencies(session),
      buildCandidateManifest: () => {
        actions.push('candidate')
        return Promise.resolve(candidate)
      },
      buildBaselineManifest: () => {
        baselineBuilds += 1
        return Promise.resolve(candidate)
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
    expect(actions).toEqual(['write', 'spawn'])
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
      mkdirSync(path.join(root, 'tests/utils'), { recursive: true })
      mkdirSync(path.join(root, 'scripts'), { recursive: true })
      mkdirSync(path.join(root, 'src'), { recursive: true })
      mkdirSync(path.join(root, 'plugins'), { recursive: true })
      writeFileSync(path.join(root, 'bunfig.toml'), '[test]')
      writeFileSync(path.join(root, 'tests/stories/example.story.test.ts'), `scenario('example', async () => {})\n`)
      writeFileSync(path.join(root, 'tests/setup.ts'), '')
      writeFileSync(path.join(root, 'tests/mock-reset.ts'), '')
      writeFileSync(path.join(root, 'tests/utils/test-helpers.ts'), '')
      writeFileSync(path.join(root, 'tests/utils/logger-mock.ts'), '')
      writeFileSync(path.join(root, 'src/runtime.ts'), '')
      const packageName = `story-runner-ref-${path.basename(root)}`
      const dependencyCacheRoot = path.join(root, '.dependency-cache')
      writeFileSync(path.join(root, 'package.json'), `{"name":"${packageName}"}\n`)
      writeFileSync(path.join(root, 'bun.lock'), 'fixture lock\n')
      await acquireStoryDependencySnapshot(
        {
          projectRoot: root,
          cacheRoot: dependencyCacheRoot,
          bunVersion: Bun.version,
        },
        {
          install: (options): Promise<void> => {
            mkdirSync(path.join(options.cwd, 'node_modules'), { recursive: true })
            return Promise.resolve()
          },
        },
      )
      runGit(root, 'init', '-q')
      runGit(root, 'config', 'user.email', 'stories@example.invalid')
      runGit(root, 'config', 'user.name', 'Story Tests')
      runGit(root, 'config', 'commit.gpgsign', 'false')
      runGit(root, 'add', '--', 'tests/stories')
      runGit(root, 'commit', '-qm', 'candidate')
      const runner = path.resolve(import.meta.dir, '../../scripts/test-stories.ts')
      const child = Bun.spawn(['bun', runner, '--manifest-only', '--baseline-ref=missing-ref'], {
        cwd: root,
        env: { ...process.env, PAPAI_STORY_DEPENDENCY_CACHE_ROOT: dependencyCacheRoot },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

      expect(exitCode).not.toBe(0)
      expect(stderr).toContain('Cannot resolve baseline ref "missing-ref"')
      expect(existsSync(path.join(root, 'reports/stories/junit.xml'))).toBe(false)
    } finally {
      makeRemovable(root)
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
    const candidate = manifest('a'.repeat(64))
    const sessionManifest = {
      ...candidate,
      files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
    }
    return {
      cwd: root,
      env: {},
      spawn: () => ({ exited: Promise.resolve(0), kill: (): void => undefined }),
      buildCandidateManifest: () => Promise.resolve(candidate),
      buildBaselineManifest: () => Promise.resolve(candidate),
      writeManifest: writeStoryManifest,
      removeReport: (reportPath) => rm(reportPath, { force: true }),
      discoverStories: () => Promise.resolve(['./tests/stories/a.story.test.ts']),
      discoverContracts: () => Promise.resolve(['./tests/stories/harness/a.test.ts']),
      ...sessionDependencies(testSession(root, sessionManifest)),
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
          ...sessionDependencies(testSession(fixture.root, manifest('a'.repeat(64)))),
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

  test('an empty frozen session leaves the current candidate manifest and no JUnit', async () => {
    const fixture = reportFixture()
    try {
      const candidate = manifest('a'.repeat(64))
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, {
          ...sessionDependencies(testSession(fixture.root, candidate)),
          buildCandidateManifest: () => Promise.resolve(candidate),
        }),
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
    const snapshotRoot = path.join(fixture.root, '.story-snapshot')
    mkdirSync(path.join(snapshotRoot, 'tests/stories'), { recursive: true })
    const candidate = {
      ...manifest('a'.repeat(64)),
      files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
    }
    try {
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, {
          ...sessionDependencies(
            testSession(snapshotRoot, candidate, { cleanup: () => rm(snapshotRoot, { recursive: true, force: true }) }),
          ),
          spawn: () => {
            throw new Error('spawn failed')
          },
        }),
      )

      expect(exitCode).toBe(2)
      expect(existsSync(fixture.manifestPath)).toBe(true)
      expect(existsSync(fixture.junitPath)).toBe(false)
      expect(existsSync(snapshotRoot)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test('forwards termination and removes the captured snapshot after child exit', async () => {
    const fixture = reportFixture()
    const snapshotRoot = path.join(fixture.root, '.story-snapshot')
    mkdirSync(path.join(snapshotRoot, 'tests/stories'), { recursive: true })
    const candidate = {
      ...manifest('a'.repeat(64)),
      files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
    }
    let resolveExit: ((code: number) => void) | undefined
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    let resolveSpawned: (() => void) | undefined
    const spawned = new Promise<void>((resolve) => {
      resolveSpawned = resolve
    })
    let forwardedSignal: NodeJS.Signals | undefined
    try {
      const run = runStoryTests(
        [],
        dependencies(fixture.root, {
          ...sessionDependencies(
            testSession(snapshotRoot, candidate, { cleanup: () => rm(snapshotRoot, { recursive: true, force: true }) }),
          ),
          spawn: () => {
            resolveSpawned?.()
            return {
              exited,
              kill: (signal): void => {
                forwardedSignal = signal
                resolveExit?.(0)
              },
            }
          },
        }),
      )
      await spawned
      process.emit('SIGTERM')

      expect(await run).toBe(143)
      expect(forwardedSignal).toBe('SIGTERM')
      expect(existsSync(snapshotRoot)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  test.each([
    ['mutation', (storyPath: string): void => writeFileSync(storyPath, 'tampered')],
    ['symlink', (storyPath: string, target: string): void => symlinkSync(target, storyPath)],
  ] as const)('rejects child-time snapshot %s and still removes the snapshot', async (_replacement, replace) => {
    const fixture = reportFixture()
    const snapshotRoot = path.join(fixture.root, '.story-snapshot')
    const storyPath = path.join(snapshotRoot, 'tests/stories/a.story.test.ts')
    mkdirSync(path.dirname(storyPath), { recursive: true })
    writeFileSync(storyPath, 'captured')
    const candidate = {
      ...manifest('a'.repeat(64)),
      files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
    }
    const verifyIntegrity = mock((): Promise<void> => Promise.resolve())
    verifyIntegrity.mockResolvedValueOnce(undefined)
    verifyIntegrity.mockRejectedValueOnce(new Error('Snapshot integrity check failed'))
    try {
      const exitCode = await runStoryTests(
        [],
        dependencies(fixture.root, {
          ...sessionDependencies(
            testSession(snapshotRoot, candidate, {
              verifyIntegrity,
              cleanup: () => rm(snapshotRoot, { recursive: true, force: true }),
            }),
          ),
          spawn: () => ({
            exited: Promise.resolve().then(() => {
              rmSync(storyPath)
              replace(storyPath, fixture.manifestPath)
              return 0
            }),
            kill: (): void => undefined,
          }),
        }),
      )

      expect(exitCode).toBe(2)
      expect(existsSync(snapshotRoot)).toBe(false)
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
      expect(JSON.parse(readFileSync(fixture.manifestPath, 'utf8'))).toEqual({
        ...manifest('a'.repeat(64)),
        files: [{ path: 'tests/stories/a.story.test.ts', sha256: 'b'.repeat(64) }],
      })
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
    const snapshotRoot = path.join(fixture.root, '.story-snapshot')
    mkdirSync(snapshotRoot)
    const candidate = {
      ...manifest('a'.repeat(64)),
      files: [{ path: 'tests/stories/harness/world.test.ts', sha256: 'b'.repeat(64) }],
    }
    let command: readonly string[] = []
    try {
      const exitCode = await runStoryTests(
        ['--contracts', '--reporter=dots'],
        dependencies(fixture.root, {
          ...sessionDependencies(
            testSession(snapshotRoot, candidate, { cleanup: () => rm(snapshotRoot, { recursive: true, force: true }) }),
          ),
          discoverStories: () => Promise.reject(new Error('story discovery must not run')),
          discoverContracts: () => Promise.reject(new Error('live contract discovery must not run')),
          spawn: (spawnCommand) => {
            command = spawnCommand
            return { exited: Promise.resolve(0), kill: (): void => undefined }
          },
        }),
      )

      expect(exitCode).toBe(0)
      expect(command).toContain(path.join(snapshotRoot, 'tests/stories/harness/world.test.ts'))
      expect(command).not.toContain('./tests/stories/preload.ts')
      expect(command).toContain(path.join(snapshotRoot, 'tests/setup.ts'))
      expect(command).toContain(path.join(snapshotRoot, 'tests/mock-reset.ts'))
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
