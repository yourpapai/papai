// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  assertLinuxStorySandboxBackend,
  buildStorySandboxCommand,
  isLinuxStorySandboxRequired,
  resolveLinuxStorySandboxUser,
  selectStorySandboxBackend,
  type StorySandboxProcessRunner,
  type StorySandboxRequest,
} from '../../scripts/story/sandbox.js'
import { classifyStorySandboxDockerMode } from '../../scripts/story/test-story-sandbox.js'

const roots: string[] = []

function fixture(): Readonly<{
  request: StorySandboxRequest
  dependencyCacheRoot: string
  liveRoot: string
  outsideRoot: string
}> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-sandbox-'))
  roots.push(root)
  const appRoot = path.join(root, 'session', 'app')
  const dependencyCacheRoot = path.join(root, 'dependency-cache', 'node_modules')
  const dependencyMountpoint = path.join(appRoot, 'node_modules')
  const tempRoot = path.join(root, 'session', 'tmp')
  const reportsRoot = path.join(root, 'session', 'reports')
  const outsideRoot = path.join(root, 'session', 'outside')
  const liveRoot = path.join(root, 'candidate-worktree')
  for (const directory of [
    appRoot,
    dependencyCacheRoot,
    dependencyMountpoint,
    tempRoot,
    reportsRoot,
    outsideRoot,
    liveRoot,
  ]) {
    mkdirSync(directory, { recursive: true })
  }
  writeFileSync(path.join(appRoot, 'source.txt'), 'captured source')
  writeFileSync(path.join(appRoot, 'package.json'), '{"name":"sandbox-fixture"}')
  writeFileSync(path.join(dependencyCacheRoot, 'dependency.txt'), 'captured dependency')
  const packageRoot = path.join(dependencyCacheRoot, '@fixture', 'dependency')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"@fixture/dependency","exports":"./index.ts"}')
  writeFileSync(path.join(packageRoot, 'index.ts'), "export const capturedDependency = 'captured dependency module'\n")
  writeFileSync(path.join(reportsRoot, 'junit.xml'), '')
  writeFileSync(path.join(outsideRoot, 'outside-module.ts'), 'export const outside = true')
  writeFileSync(path.join(liveRoot, 'live.txt'), 'candidate worktree')
  return {
    request: {
      platform: 'darwin',
      appRoot: realpathSync(appRoot),
      dependencyRoot: realpathSync(dependencyCacheRoot),
      tempRoot: realpathSync(tempRoot),
      reportPaths: [realpathSync(path.join(reportsRoot, 'junit.xml'))],
      bunExecutable: realpathSync(process.execPath),
      command: [realpathSync(process.execPath), 'test'],
    },
    dependencyCacheRoot: realpathSync(dependencyCacheRoot),
    liveRoot,
    outsideRoot,
  }
}

function outputText(output: ReadableStream<Uint8Array> | number | undefined): Promise<string> {
  return output instanceof ReadableStream ? new Response(output).text() : Promise.resolve('')
}

function writeProbe(request: StorySandboxRequest, name: string, source: string): string {
  const target = path.join(request.appRoot, `${name}.test.ts`)
  writeFileSync(target, source)
  return target
}

function processRunner(
  ...results: readonly Readonly<{ exitCode: number; stdout?: string; stderr?: string }>[]
): StorySandboxProcessRunner {
  let index = 0
  return () => {
    const result = results[index]
    index += 1
    if (result === undefined) throw new Error('unexpected Docker command')
    return { exitCode: result.exitCode, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }
}

function skipOptionalLinuxDockerTest(environment: Readonly<Record<string, string | undefined>>): boolean {
  return !isLinuxStorySandboxRequired(environment) && environment['PAPAI_STORY_SANDBOX_DOCKER_MODE'] !== 'available'
}

const executableLinuxDockerTest = test.skipIf(skipOptionalLinuxDockerTest(process.env))

function spawnLinuxDockerSandboxed(request: StorySandboxRequest, file: string): ReturnType<typeof Bun.spawn> {
  const relativeFile = `./${path.relative(request.appRoot, file)}`
  return Bun.spawn([...buildStorySandboxCommand({ ...request, platform: 'linux' }), relativeFile], {
    cwd: request.appRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

function withoutDockerNetworkIsolation(command: readonly string[]): readonly string[] {
  const network = command.indexOf('--network')
  if (network === -1 || command[network + 1] !== 'none') throw new Error('Docker command has no network isolation flag')
  return [...command.slice(0, network), ...command.slice(network + 2)]
}

function withDockerHostGateway(command: readonly string[]): readonly string[] {
  const image = command.findIndex((argument) => argument.startsWith('docker.io/oven/bun:'))
  if (image === -1) throw new Error('Docker command has no story sandbox image')
  return [...command.slice(0, image), '--add-host', 'host.docker.internal:host-gateway', ...command.slice(image)]
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('story sandbox backend selection', () => {
  test.each(['darwin', 'linux'] as const)('selects the Docker backend on %s', (platform) => {
    expect(selectStorySandboxBackend(platform)).toBe('linux-docker')
  })

  test.each(['aix', 'freebsd', 'openbsd'] as const)('fails closed on unsupported %s', (platform) => {
    expect(() => selectStorySandboxBackend(platform)).toThrow('not implemented')
  })

  test('rejects win32 with an actionable unsupported-host error', () => {
    expect(() => selectStorySandboxBackend('win32')).toThrow(
      'Story sandbox is not supported on Windows: the linux-docker backend requires a POSIX host uid/gid. Run the story suite on Linux or macOS with Docker (see docs/architecture/commands.md).',
    )
  })

  test.each(['darwin', 'linux'] as const)(
    'builds a Docker command on %s with no native sandbox fallback',
    (platform) => {
      const { request } = fixture()

      const command = buildStorySandboxCommand({ ...request, platform })

      expect(command[0]).toBe('docker')
      expect(command[1]).toBe('run')
      expect(command).not.toContain('sandbox-exec')
    },
  )
})

describe('Linux story sandbox', () => {
  test('translates canonical session command paths to their declared container mounts', () => {
    const { request } = fixture()
    const report = request.reportPaths[0]!
    const command = buildStorySandboxCommand({
      ...request,
      platform: 'linux',
      command: [
        request.bunExecutable,
        'test',
        `--config=${path.join(request.appRoot, 'scripts/snapshot-bunfig.toml')}`,
        '--preload',
        path.join(request.appRoot, 'tests/setup.ts'),
        '--reporter-outfile',
        report,
        path.join(request.appRoot, 'tests/stories/example.story.test.ts'),
      ],
    })

    expect(command).toContain('--config=/session/app/scripts/snapshot-bunfig.toml')
    expect(command).toContain('/session/app/tests/setup.ts')
    expect(command).toContain('/session/reports/junit.xml')
    expect(command).toContain('/session/app/tests/stories/example.story.test.ts')
    expect(command).not.toContain(path.join(request.appRoot, 'tests/setup.ts'))
  })

  test('builds a pinned, capability-restricted Docker command with only declared mounts', () => {
    const { request, dependencyCacheRoot, liveRoot } = fixture()

    const command = buildStorySandboxCommand({ ...request, platform: 'linux' })

    for (const argument of [
      'docker',
      'run',
      '--rm',
      '--read-only',
      '--network',
      'none',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '128',
      '--ipc',
      'none',
      '--user',
      resolveLinuxStorySandboxUser(),
      'docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e',
      '--no-env-file',
      'test',
    ]) {
      expect(command).toContain(argument)
    }
    expect(command.filter((argument) => argument === '--mount')).toHaveLength(4)
    expect(command).toContain(`type=bind,src=${request.appRoot},dst=/session/app,readonly`)
    expect(command).toContain(`type=bind,src=${dependencyCacheRoot},dst=/session/app/node_modules,readonly`)
    expect(command).toContain(`type=bind,src=${request.tempRoot},dst=/session/tmp`)
    expect(command).toContain(`type=bind,src=${request.reportPaths[0]},dst=/session/reports/junit.xml`)
    expect(command).toContain('TMPDIR=/session/tmp')
    expect(command).toContain('HOME=/session/tmp')
    expect(command).not.toContain('HOME=/nonexistent')
    expect(command).toContain('PAPAI_STORY_EXECUTION_ROOT=/session/app')
    expect(command).not.toContain('--volume')
    expect(command).not.toContain('-v')
    expect(command).not.toContain('--add-host')
    expect(command).not.toContain(liveRoot)
    expect(command).not.toContain(os.homedir())
    expect(command.some((argument) => argument.includes(os.tmpdir()))).toBe(true)
  })

  test('rejects a dependency root that is unsafe for the app-local mount', () => {
    const { request } = fixture()
    const nested = path.join(request.appRoot, 'vendor', 'node_modules')
    mkdirSync(nested, { recursive: true })

    expect(() => buildStorySandboxCommand({ ...request, dependencyRoot: 'relative' })).toThrow('absolute')
    expect(() =>
      buildStorySandboxCommand({ ...request, dependencyRoot: `${request.dependencyRoot}/../node_modules` }),
    ).toThrow('canonical')
    expect(() => buildStorySandboxCommand({ ...request, dependencyRoot: realpathSync(nested) })).toThrow(
      'inside the app root',
    )
    expect(() =>
      buildStorySandboxCommand({ ...request, dependencyRoot: realpathSync(path.dirname(request.dependencyRoot)) }),
    ).toThrow('node_modules')
  })

  test('rejects a Linux command whose host Bun executable is not the declared command', () => {
    const { request } = fixture()

    expect(() => buildStorySandboxCommand({ ...request, platform: 'linux', command: ['bun', 'test'] })).toThrow(
      'bun executable',
    )
  })

  test('fails closed when Docker is unavailable or the image Bun version differs', () => {
    expect(() => assertLinuxStorySandboxBackend(processRunner({ exitCode: 1, stderr: 'daemon unavailable' }))).toThrow(
      'availability check',
    )
    expect(() =>
      assertLinuxStorySandboxBackend(processRunner({ exitCode: 0 }, { exitCode: 0, stdout: '1.3.12\n' })),
    ).toThrow('must run Bun 1.3.13')
  })

  test('requires Docker backend validation in CI or when explicitly requested', () => {
    expect(isLinuxStorySandboxRequired({})).toBe(false)
    expect(isLinuxStorySandboxRequired({ CI: 'true' })).toBe(true)
    expect(isLinuxStorySandboxRequired({ CI: '1' })).toBe(true)
    expect(isLinuxStorySandboxRequired({ PAPAI_REQUIRE_STORY_SANDBOX: '1' })).toBe(true)
  })

  test('classifies optional backend unavailability for explicit test registration skips', () => {
    expect(classifyStorySandboxDockerMode({}, () => undefined)).toBe('available')
    expect(
      classifyStorySandboxDockerMode({}, () => {
        throw new Error('daemon unavailable')
      }),
    ).toBe('unavailable')
    expect(() =>
      classifyStorySandboxDockerMode({ CI: 'true' }, () => {
        throw new Error('daemon unavailable')
      }),
    ).toThrow('daemon unavailable')
    expect(() =>
      classifyStorySandboxDockerMode({ PAPAI_REQUIRE_STORY_SANDBOX: '1' }, () => {
        throw new Error('daemon unavailable')
      }),
    ).toThrow('daemon unavailable')
    expect(skipOptionalLinuxDockerTest({})).toBe(true)
    expect(skipOptionalLinuxDockerTest({ PAPAI_STORY_SANDBOX_DOCKER_MODE: 'available' })).toBe(false)
    expect(skipOptionalLinuxDockerTest({ CI: 'true' })).toBe(false)
  })

  test('uses a validated host uid and gid for containers with dropped capabilities', () => {
    expect(resolveLinuxStorySandboxUser({ getuid: () => 501, getgid: () => 20 })).toBe('501:20')
    expect(() => resolveLinuxStorySandboxUser({ getuid: () => -1, getgid: () => 20 })).toThrow('uid')
    expect(() => resolveLinuxStorySandboxUser({ getuid: () => 501 })).toThrow('uid and gid')
  })

  executableLinuxDockerTest('enforces the Docker filesystem and network boundary for Bun-native probes', async () => {
    assertLinuxStorySandboxBackend()
    const { request, outsideRoot } = fixture()
    const report = request.reportPaths[0]!
    const outsideFile = path.join(realpathSync(outsideRoot), 'outside.txt')
    const containerOutsideFile = '/session/outside/outside.txt'
    const containerOutsideModule = '/session/outside/outside-module.ts'
    writeFileSync(outsideFile, 'outside')
    symlinkSync(outsideRoot, path.join(request.appRoot, 'escape'), 'dir')
    const server = Bun.serve({
      hostname: '0.0.0.0',
      port: 0,
      fetch: () => new Response('parent-network-sentinel'),
    })
    const probe = writeProbe(
      request,
      'linux-boundary',
      [
        "import { expect, test } from 'bun:test'",
        "import { writeFileSync } from 'node:fs'",
        "import path from 'node:path'",
        "import { capturedDependency } from '@fixture/dependency'",
        "test('can use only declared Docker mounts', async () => {",
        "  expect(await Bun.file('/session/app/source.txt').text()).toBe('captured source')",
        "  expect(await Bun.file('/session/app/node_modules/dependency.txt').text()).toBe('captured dependency')",
        "  expect(capturedDependency).toBe('captured dependency module')",
        `  await expect(import(${JSON.stringify(`file://${containerOutsideModule}`)})).rejects.toThrow()`,
        `  await expect(Bun.file(${JSON.stringify(containerOutsideFile)}).text()).rejects.toThrow()`,
        '  let outsideGlob: string[] = []',
        "  try { outsideGlob = [...new Bun.Glob('/session/outside/**/*').scanSync()] } catch (error) { expect(String(error)).toContain('ENOENT') }",
        "  expect(outsideGlob).not.toContain('/session/outside/outside.txt')",
        "  await expect(Bun.file('/session/app/escape/outside.txt').text()).rejects.toThrow()",
        "  expect(() => writeFileSync('/session/app/blocked.txt', 'blocked')).toThrow()",
        "  expect(() => writeFileSync('/dev/shm/escape', 'blocked')).toThrow()",
        `  await expect(fetch(${JSON.stringify(`http://host.docker.internal:${server.port}/`)}, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow()`,
        "  writeFileSync(path.join('/session/tmp', 'allowed.txt'), 'temporary')",
        "  writeFileSync('/session/reports/junit.xml', '<testsuite name=\"docker-boundary\"/>')",
        '})',
      ].join('\n'),
    )

    try {
      const child = spawnLinuxDockerSandboxed(request, probe)
      const [exitCode, stderr, stdout] = await Promise.all([
        child.exited,
        outputText(child.stderr),
        outputText(child.stdout),
      ])

      expect(exitCode, `${stdout}\n${stderr}`).toBe(0)
      expect(readFileSync(report, 'utf8')).toContain('docker-boundary')
      expect(readFileSync(path.join(request.tempRoot, 'allowed.txt'), 'utf8')).toBe('temporary')
      expect(existsSync(path.join(request.appRoot, 'blocked.txt'))).toBe(false)

      const control = writeProbe(
        request,
        'linux-network-control',
        [
          "import { expect, test } from 'bun:test'",
          "test('reaches the parent listener without Docker network isolation', async () => {",
          `  expect(await fetch(${JSON.stringify(`http://host.docker.internal:${server.port}/`)}).then((response) => response.text())).toBe('parent-network-sentinel')`,
          '})',
        ].join('\n'),
      )
      const relativeControl = `./${path.relative(request.appRoot, control)}`
      const controlChild = Bun.spawn(
        [
          ...withoutDockerNetworkIsolation(
            withDockerHostGateway(buildStorySandboxCommand({ ...request, platform: 'linux' })),
          ),
          relativeControl,
        ],
        { cwd: request.appRoot, stdout: 'pipe', stderr: 'pipe' },
      )
      const [controlExitCode, controlStderr, controlStdout] = await Promise.all([
        controlChild.exited,
        outputText(controlChild.stderr),
        outputText(controlChild.stdout),
      ])
      expect(controlExitCode, `${controlStdout}\n${controlStderr}`).toBe(0)
    } finally {
      await server.stop(true)
    }
  })
})
