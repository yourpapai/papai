// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { StoryManifest } from '../../../scripts/story-manifest.js'
import { spawnStorySandboxedChild, type SpawnedStoryChild } from '../../../scripts/story-runner-child.js'
import type { StoryRunnerSession } from '../../../scripts/story-runner-session.js'
import { assertLinuxStorySandboxBackend } from '../../../scripts/story-sandbox-linux.js'

const fixtureSource = path.resolve('tests/stories/harness/process-boundary.fixture.ts')
const operations = ['file-import', 'bun-stat', 'bun-glob', 'network', 'stream-race', 'cp-dereference', 'write'] as const
const roots: string[] = []
const emptyHash = '0'.repeat(64)
const fixtureManifest: StoryManifest = {
  version: 4,
  commit: '0000000',
  bunVersion: Bun.version,
  seed: 41021,
  treeHash: emptyHash,
  files: [],
  runtimeInputs: { treeHash: emptyHash, directories: [], files: [] },
  scenarios: [],
}

type Operation = (typeof operations)[number]

type SandboxedChild = SpawnedStoryChild &
  Readonly<{ stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array> }>

function dockerAvailable(): boolean {
  try {
    assertLinuxStorySandboxBackend()
    return true
  } catch {
    return false
  }
}

const dockerTest = test.skipIf(!dockerAvailable())

function createSession(): Readonly<{ session: StoryRunnerSession; fixture: string; appRoot: string }> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-process-boundary-'))
  roots.push(root)
  const appRoot = path.join(root, 'app')
  const tempRoot = path.join(root, 'tmp')
  const reportsRoot = path.join(root, 'reports')
  const outsideRoot = path.join(root, 'outside')
  const dependencyRoot = realpathSync(path.resolve('node_modules'))
  const fixture = path.join(appRoot, 'tests/stories/harness/process-boundary.fixture.ts')
  const report = path.join(reportsRoot, 'junit.xml')
  mkdirSync(path.dirname(fixture), { recursive: true })
  mkdirSync(path.join(appRoot, 'scripts'), { recursive: true })
  mkdirSync(tempRoot, { recursive: true, mode: 0o700 })
  mkdirSync(reportsRoot, { recursive: true, mode: 0o700 })
  mkdirSync(outsideRoot, { recursive: true, mode: 0o700 })
  writeFileSync(path.join(outsideRoot, 'external.txt'), 'outside sandbox session')
  writeFileSync(path.join(outsideRoot, 'external-module.ts'), 'export const outside = true')
  writeFileSync(path.join(appRoot, 'scripts/snapshot-bunfig.toml'), '[test]\ntimeout = 15000\n')
  writeFileSync(path.join(appRoot, 'tests/setup.ts'), '')
  writeFileSync(path.join(appRoot, 'tests/mock-reset.ts'), '')
  writeFileSync(fixture, readFileSync(fixtureSource))
  writeFileSync(report, '')
  symlinkSync(dependencyRoot, path.join(root, 'node_modules'), 'dir')
  const canonicalAppRoot = realpathSync(appRoot)
  return {
    fixture: path.join(canonicalAppRoot, 'tests/stories/harness/process-boundary.fixture.ts'),
    appRoot: canonicalAppRoot,
    session: {
      root,
      appRoot: canonicalAppRoot,
      tempRoot: realpathSync(tempRoot),
      manifest: fixtureManifest,
      childReporterArguments: [],
      childReportPaths: [realpathSync(report)],
      reportPaths: [realpathSync(report)],
      verifyIntegrity: () => Promise.resolve(),
      copyReports: () => Promise.resolve(),
      cleanup: () => Promise.resolve(),
    },
  }
}

function spawnFixture(operation: Operation, session: StoryRunnerSession, fixture: string): SandboxedChild {
  let child: SandboxedChild | undefined
  const spawned = spawnStorySandboxedChild(
    {
      forwarded: ['--test-name-pattern', `^${operation}$`],
      compat: false,
      contracts: true,
      manifestOnly: false,
      seed: 41021,
    },
    {
      env: process.env,
      platform: 'linux',
      spawn: (command, options) => {
        const process = Bun.spawn([...command], { ...options, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
        if (!(process.stdout instanceof ReadableStream) || !(process.stderr instanceof ReadableStream)) {
          throw new Error('Story sandbox child must expose captured output streams')
        }
        const captured: SandboxedChild = {
          exited: process.exited,
          kill: (signal) => process.kill(signal),
          stdout: process.stdout,
          stderr: process.stderr,
        }
        child = captured
        return captured
      },
    },
    [fixture],
    session,
  )
  if (child === undefined || spawned !== child) throw new Error('Story runner did not spawn a sandboxed child')
  return child
}

function output(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text()
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('story process sandbox boundary', () => {
  for (const operation of operations) {
    dockerTest(`rejects ${operation} through the real story child launcher`, async () => {
      const { session, fixture, appRoot } = createSession()
      const child = spawnFixture(operation, session, fixture)
      const [exitCode, stderr, stdout] = await Promise.all([child.exited, output(child.stderr), output(child.stdout)])

      expect(exitCode, `${stdout}\n${stderr}`).not.toBe(0)
      expect(`${stdout}\n${stderr}`).toMatch(
        /sandbox|permission denied|operation not permitted|erofs|enoent|network|fetch|not found/iu,
      )
      expect(`${stdout}\n${stderr}`).not.toContain('UNSAFE:')
      expect(existsSync(path.join(appRoot, 'blocked.txt'))).toBe(false)
    })
  }
})
