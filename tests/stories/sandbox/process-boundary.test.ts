// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { spawnStorySandboxedChild, type SpawnedStoryChild } from '../../../scripts/story/child.js'
import type { StoryManifest } from '../../../scripts/story/manifest.js'
import { assertLinuxStorySandboxBackend, buildStorySandboxCommand } from '../../../scripts/story/sandbox.js'
import type { StoryRunnerSession } from '../../../scripts/story/session.js'
import { classifyStorySandboxDockerMode } from '../../../scripts/story/test-story-sandbox.js'

const operations = [
  'file-import',
  'bun-stat',
  'bun-glob',
  'network',
  'stream-race',
  'cp-dereference',
  'write',
  'dependency-mount-write',
] as const
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

const dockerMode = classifyStorySandboxDockerMode(process.env, assertLinuxStorySandboxBackend)
const dockerTest = test.skipIf(dockerMode === 'unavailable')

function renderFixture(outsideRoot: string, directNetworkUrl: string, sandboxNetworkUrl: string): string {
  return [
    "import { test, expect } from 'bun:test'",
    "import { createReadStream } from 'node:fs'",
    "import { cp, readFile, rm, symlink, writeFile } from 'node:fs/promises'",
    `const outside = ${JSON.stringify(outsideRoot)}`,
    `const directNetworkUrl = ${JSON.stringify(directNetworkUrl)}`,
    `const sandboxNetworkUrl = ${JSON.stringify(sandboxNetworkUrl)}`,
    "const temporary = process.env['TMPDIR']",
    "const executionRoot = process.env['PAPAI_STORY_EXECUTION_ROOT']",
    "if (temporary === undefined || executionRoot === undefined) throw new Error('missing process-boundary fixture environment')",
    "const networkUrl = executionRoot === '/session/app' ? sandboxNetworkUrl : directNetworkUrl",
    'function readStream(target: string): Promise<string> {',
    '  return new Promise((resolve, reject) => {',
    '    const chunks: Buffer[] = []',
    '    const stream = createReadStream(target)',
    "    stream.on('data', (chunk: Buffer) => chunks.push(chunk))",
    "    stream.once('error', reject)",
    "    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))",
    '  })',
    '}',
    "test('file-import', async () => {",
    '  const module = await import(`file://${outside}/external-module.ts`)',
    "  expect(module.outside).toBe('host-sentinel')",
    '})',
    "test('bun-stat', async () => {",
    '  expect((await Bun.file(`${outside}/external.txt`).stat()).size).toBeGreaterThan(0)',
    '})',
    "test('bun-glob', async () => {",
    '  const paths: string[] = []',
    "  for await (const pathname of new Bun.Glob('*').scan({ cwd: outside })) paths.push(pathname)",
    "  expect(paths).toContain('external.txt')",
    '})',
    "test('network', async () => {",
    "  expect(await fetch(networkUrl).then((response) => response.text())).toBe('parent-network-sentinel')",
    '})',
    "test('stream-race', async () => {",
    '  const victim = `${temporary}/stream-race.txt`',
    "  await Bun.write(victim, 'safe')",
    '  await rm(victim)',
    '  await symlink(`${outside}/external.txt`, victim)',
    "  expect(await readStream(victim)).toBe('host-sentinel')",
    '})',
    "test('cp-dereference', async () => {",
    '  const source = `${temporary}/copy-link`',
    '  const destination = `${temporary}/copy-result.txt`',
    '  await symlink(`${outside}/external.txt`, source)',
    '  await cp(source, destination, { dereference: true })',
    "  expect(await readFile(destination, 'utf8')).toBe('host-sentinel')",
    '})',
    "test('write', async () => {",
    '  const target = `${executionRoot}/blocked.txt`',
    "  await writeFile(target, 'written outside declared outputs')",
    "  expect(await readFile(target, 'utf8')).toBe('written outside declared outputs')",
    '})',
    "test('dependency-mount-write', async () => {",
    "  await writeFile(`${executionRoot}/node_modules/blocked.txt`, 'written into the dependency mount')",
    '})',
  ].join('\n')
}

function createSession(
  directNetworkUrl: string,
  sandboxNetworkUrl: string,
): Readonly<{ session: StoryRunnerSession; fixture: string; appRoot: string }> {
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
  mkdirSync(path.join(appRoot, 'node_modules'), { recursive: true })
  mkdirSync(tempRoot, { recursive: true, mode: 0o700 })
  mkdirSync(reportsRoot, { recursive: true, mode: 0o700 })
  mkdirSync(outsideRoot, { recursive: true, mode: 0o700 })
  writeFileSync(path.join(outsideRoot, 'external.txt'), 'host-sentinel')
  writeFileSync(path.join(outsideRoot, 'external-module.ts'), "export const outside = 'host-sentinel'")
  writeFileSync(path.join(appRoot, 'scripts/snapshot-bunfig.toml'), '[test]\ntimeout = 15000\n')
  writeFileSync(path.join(appRoot, 'tests/setup.ts'), '')
  writeFileSync(path.join(appRoot, 'tests/mock-reset.ts'), '')
  writeFileSync(fixture, renderFixture(realpathSync(outsideRoot), directNetworkUrl, sandboxNetworkUrl))
  writeFileSync(report, '')
  const canonicalAppRoot = realpathSync(appRoot)
  return {
    fixture: path.join(canonicalAppRoot, 'tests/stories/harness/process-boundary.fixture.ts'),
    appRoot: canonicalAppRoot,
    session: {
      root,
      appRoot: canonicalAppRoot,
      dependencyRoot,
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

function addHostGateway(command: readonly string[]): readonly string[] {
  const image = command.findIndex((argument) => argument.startsWith('docker.io/oven/bun:'))
  if (image === -1) throw new Error('Story sandbox command has no Docker image')
  return [...command.slice(0, image), '--add-host', 'host.docker.internal:host-gateway', ...command.slice(image)]
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
      buildSandboxCommand: (request) => addHostGateway(buildStorySandboxCommand(request)),
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

function spawnDirectFixture(operation: Operation, fixture: string, session: StoryRunnerSession): SandboxedChild {
  const childProcess = Bun.spawn(
    [
      process.execPath,
      'test',
      '--no-env-file',
      '--path-ignore-patterns',
      '',
      '--test-name-pattern',
      `^${operation}$`,
      fixture,
    ],
    {
      cwd: session.appRoot,
      env: {
        ...process.env,
        PAPAI_STORY_EXECUTION_ROOT: session.appRoot,
        TMPDIR: session.tempRoot,
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  if (!(childProcess.stdout instanceof ReadableStream) || !(childProcess.stderr instanceof ReadableStream)) {
    throw new Error('Direct control child must expose captured output streams')
  }
  return {
    exited: childProcess.exited,
    kill: (signal) => childProcess.kill(signal),
    stdout: childProcess.stdout,
    stderr: childProcess.stderr,
  }
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
      const server = Bun.serve({
        hostname: '0.0.0.0',
        port: 0,
        fetch: () => new Response('parent-network-sentinel'),
      })
      try {
        const { session, fixture, appRoot } = createSession(
          `http://127.0.0.1:${server.port}/`,
          `http://host.docker.internal:${server.port}/`,
        )
        const direct = spawnDirectFixture(operation, fixture, session)
        const [directExitCode, directStderr, directStdout] = await Promise.all([
          direct.exited,
          output(direct.stderr),
          output(direct.stdout),
        ])
        expect(directExitCode, `${directStdout}\n${directStderr}`).toBe(0)
        rmSync(path.join(appRoot, 'blocked.txt'), { force: true })
        const child = spawnFixture(operation, session, fixture)
        const [exitCode, stderr, stdout] = await Promise.all([child.exited, output(child.stderr), output(child.stdout)])
        const sandboxOutput = `${stdout}\n${stderr}`

        expect(exitCode, sandboxOutput).not.toBe(0)
        expect(sandboxOutput).toContain(`(fail) ${operation}`)
        expect(sandboxOutput).not.toContain('missing process-boundary fixture environment')
        expect(existsSync(path.join(appRoot, 'blocked.txt'))).toBe(false)
      } finally {
        await server.stop(true)
      }
    })
  }
})
