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
  isLinuxStorySandboxRequired,
  resolveLinuxStorySandboxUser,
  type StorySandboxProcessRunner,
} from '../../scripts/story-sandbox-linux.js'
import { buildStorySandboxCommand, type StorySandboxRequest } from '../../scripts/story-sandbox.js'
import { classifyStorySandboxDockerMode } from '../../scripts/test-story-sandbox.js'

const roots: string[] = []

function fixture(): Readonly<{ request: StorySandboxRequest; liveRoot: string; outsideRoot: string }> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-sandbox-'))
  roots.push(root)
  const appRoot = path.join(root, 'session', 'app')
  const dependencyRoot = path.join(root, 'dependency-cache', 'node_modules')
  const tempRoot = path.join(root, 'session', 'tmp')
  const reportsRoot = path.join(root, 'session', 'reports')
  const outsideRoot = path.join(root, 'session', 'outside')
  const liveRoot = path.join(root, 'candidate-worktree')
  for (const directory of [appRoot, dependencyRoot, tempRoot, reportsRoot, outsideRoot, liveRoot]) {
    mkdirSync(directory, { recursive: true })
  }
  symlinkSync(realpathSync(dependencyRoot), path.join(root, 'session', 'node_modules'), 'dir')
  writeFileSync(path.join(appRoot, 'source.txt'), 'captured source')
  writeFileSync(path.join(appRoot, 'package.json'), '{"name":"sandbox-fixture"}')
  writeFileSync(path.join(dependencyRoot, 'dependency.txt'), 'captured dependency')
  writeFileSync(path.join(reportsRoot, 'junit.xml'), '')
  writeFileSync(path.join(outsideRoot, 'outside-module.ts'), 'export const outside = true')
  writeFileSync(path.join(liveRoot, 'live.txt'), 'candidate worktree')
  return {
    request: {
      platform: 'darwin',
      appRoot: realpathSync(appRoot),
      dependencyRoot: realpathSync(dependencyRoot),
      tempRoot: realpathSync(tempRoot),
      reportPaths: [realpathSync(path.join(reportsRoot, 'junit.xml'))],
      bunExecutable: realpathSync(process.execPath),
      command: [realpathSync(process.execPath), 'test'],
    },
    liveRoot,
    outsideRoot,
  }
}

function spawnSandboxed(request: StorySandboxRequest, file: string): ReturnType<typeof Bun.spawn> {
  const relativeFile = `./${path.relative(request.appRoot, file)}`
  const command = [...buildStorySandboxCommand(request), relativeFile]
  return Bun.spawn(command, {
    cwd: request.appRoot,
    env: { ...process.env, TMPDIR: request.tempRoot },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

function outputText(output: ReadableStream<Uint8Array> | number | undefined): Promise<string> {
  return output instanceof ReadableStream ? new Response(output).text() : Promise.resolve('')
}

function isNestedSandboxIncompatibility(output: string): boolean {
  return output.includes('sandbox-exec: sandbox_apply: Operation not permitted')
}

function assertSandboxDenied(exitCode: number, output: string): void {
  if (isNestedSandboxIncompatibility(output)) throw new Error('sandbox child could not start')
  if (exitCode === 0) throw new Error('sandbox child unexpectedly succeeded')
  if (!/operation not permitted|permission denied|connectionrefused|cannot find module/iu.test(output)) {
    throw new Error(`sandbox child failed without an access denial: ${output}`)
  }
}

function sandboxExecutionUnavailable(): boolean {
  const child = Bun.spawnSync(['sandbox-exec', '-p', '(version 1) (allow default)', '/usr/bin/true'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = `${child.stdout.toString()}\n${child.stderr.toString()}`
  if (child.exitCode === 0) return false
  if (isNestedSandboxIncompatibility(output)) return true
  throw new Error(`sandbox-exec preflight failed: ${output}`)
}

const executableSandboxUnavailable = sandboxExecutionUnavailable()
const executableSandboxTest = test.skipIf(executableSandboxUnavailable)

async function expectSandboxDenied(child: ReturnType<typeof Bun.spawn>): Promise<void> {
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    outputText(child.stderr),
    outputText(child.stdout),
  ])
  assertSandboxDenied(exitCode, `${stdout}\n${stderr}`)
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

describe('Darwin story sandbox', () => {
  test('does not treat a sandbox-exec setup failure as a denied child operation', () => {
    expect(() => assertSandboxDenied(71, 'sandbox-exec: sandbox_apply: Operation not permitted')).toThrow(
      'could not start',
    )
  })

  test('builds a deny-default command from canonical declared paths', () => {
    const { request, liveRoot } = fixture()

    const command = buildStorySandboxCommand(request)
    const profile = String(command[2])

    expect(command[0]).toBe('sandbox-exec')
    expect(command[1]).toBe('-p')
    expect(typeof command[2]).toBe('string')
    expect([...command.slice(3)]).toEqual([...request.command])
    expect(profile).toContain('(version 1)')
    expect(profile).toContain('(deny default)')
    expect(profile).toContain('(deny network*)')
    expect(profile).toContain('(allow process-exec*)')
    expect(profile).not.toContain('(allow process*)')
    expect(profile).toContain(`(subpath "${realpathSync(request.appRoot)}")`)
    expect(profile).toContain(`(subpath "${realpathSync(request.dependencyRoot)}")`)
    expect(profile).toContain(`(subpath "${realpathSync(request.tempRoot)}")`)
    expect(profile).toContain(`(literal "${realpathSync(request.reportPaths[0]!)}")`)
    expect(profile).toContain('(subpath "/System")')
    expect(profile).toContain('(subpath "/usr/lib")')
    expect(profile).toContain('(subpath "/private/var/db/timezone")')
    expect(profile).toContain(`(subpath "${path.dirname(process.execPath)}")`)
    expect(profile).not.toContain(liveRoot)
    expect(profile).not.toContain(`(subpath "${os.homedir()}")`)
  })

  test('rejects paths and commands outside the declared sandbox contract', () => {
    const { request } = fixture()

    expect(() => buildStorySandboxCommand({ ...request, appRoot: 'relative' })).toThrow('absolute')
    expect(() => buildStorySandboxCommand({ ...request, appRoot: `${request.appRoot}/../app` })).toThrow('canonical')
    expect(() => buildStorySandboxCommand({ ...request, command: ['bun', 'test'] })).toThrow('bun executable')
    expect(() => buildStorySandboxCommand({ ...request, reportPaths: [] })).toThrow('report')
  })

  test('rejects canonical outputs outside the app-owned session layout', () => {
    const { request, outsideRoot } = fixture()
    const outsideReport = path.join(outsideRoot, 'outside.xml')
    const nestedReport = path.join(path.dirname(request.reportPaths[0]!), 'nested', 'nested.xml')
    mkdirSync(path.dirname(nestedReport), { recursive: true })
    writeFileSync(outsideReport, '')
    writeFileSync(nestedReport, '')

    expect(() => buildStorySandboxCommand({ ...request, appRoot: path.dirname(request.appRoot) })).toThrow(
      'session app',
    )
    expect(() => buildStorySandboxCommand({ ...request, tempRoot: realpathSync(outsideRoot) })).toThrow('session tmp')
    expect(() => buildStorySandboxCommand({ ...request, reportPaths: [realpathSync(outsideReport)] })).toThrow(
      'session reports',
    )
    expect(() => buildStorySandboxCommand({ ...request, reportPaths: [realpathSync(nestedReport)] })).toThrow(
      'session reports',
    )
  })

  test('rejects a canonical dependency root that is not the session node_modules target', () => {
    const { request, liveRoot } = fixture()
    const liveNodeModules = path.join(liveRoot, 'node_modules')
    mkdirSync(liveNodeModules)

    expect(() => buildStorySandboxCommand({ ...request, dependencyRoot: realpathSync(liveNodeModules) })).toThrow(
      'session node_modules',
    )
  })

  executableSandboxTest('permits only declared source, dependency, temp, and report access', async () => {
    const { request } = fixture()
    const report = request.reportPaths[0]!
    const probe = writeProbe(
      request,
      'allowed',
      [
        "import { expect, test } from 'bun:test'",
        "import { writeFileSync } from 'node:fs'",
        "import path from 'node:path'",
        "test('reads declared inputs and writes declared outputs', async () => {",
        "  expect(await Bun.file('source.txt').text()).toBe('captured source')",
        "  expect(await Bun.file(path.resolve('../node_modules/dependency.txt')).text()).toBe('captured dependency')",
        `  writeFileSync(${JSON.stringify(path.join(request.tempRoot, 'allowed.txt'))}, 'temporary')`,
        `  writeFileSync(${JSON.stringify(report)}, '<testsuite/>')`,
        '})',
      ].join('\n'),
    )

    const child = spawnSandboxed(request, probe)
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      outputText(child.stderr),
      outputText(child.stdout),
    ])
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0)
    expect(existsSync(path.join(request.tempRoot, 'allowed.txt'))).toBe(true)
    expect(existsSync(report)).toBe(true)
  })

  executableSandboxTest('denies native file import outside the app root', async () => {
    const { request, outsideRoot } = fixture()
    const outsideModule = path.join(realpathSync(outsideRoot), 'outside-module.ts')
    const probe = writeProbe(request, 'external-import', `await import(${JSON.stringify(`file://${outsideModule}`)})`)

    expect(existsSync(outsideModule)).toBe(true)
    await expectSandboxDenied(spawnSandboxed(request, probe))
  })

  executableSandboxTest('denies Bun native reads outside declared inputs', async () => {
    const { request } = fixture()
    const probe = writeProbe(request, 'native-read', "await Bun.file('/etc/hosts').text()")

    await expectSandboxDenied(spawnSandboxed(request, probe))
  })

  executableSandboxTest('denies network requests', async () => {
    const { request } = fixture()
    let requests = 0
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        requests += 1
        return new Response('parent listener')
      },
    })
    const probe = writeProbe(request, 'network', `await fetch(${JSON.stringify(server.url.href)})`)

    try {
      await expectSandboxDenied(spawnSandboxed(request, probe))
      expect(requests).toBe(0)
    } finally {
      await server.stop(true)
    }
  })

  executableSandboxTest('denies writes outside the session temporary root and exact report', async () => {
    const { request, outsideRoot } = fixture()
    const probe = writeProbe(
      request,
      'outside-write',
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(path.join(realpathSync(outsideRoot), 'escape.txt'))}, 'escape')`,
    )

    await expectSandboxDenied(spawnSandboxed(request, probe))
  })
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
    const { request, liveRoot } = fixture()

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
    expect(command).toContain(`type=bind,src=${request.dependencyRoot},dst=/session/node_modules,readonly`)
    expect(command).toContain(`type=bind,src=${request.tempRoot},dst=/session/tmp`)
    expect(command).toContain(`type=bind,src=${request.reportPaths[0]},dst=/session/reports/junit.xml`)
    expect(command).toContain('TMPDIR=/session/tmp')
    expect(command).toContain('HOME=/nonexistent')
    expect(command).toContain('PAPAI_STORY_EXECUTION_ROOT=/session/app')
    expect(command).not.toContain('--volume')
    expect(command).not.toContain('-v')
    expect(command).not.toContain('--add-host')
    expect(command).not.toContain(liveRoot)
    expect(command).not.toContain(os.homedir())
    expect(command.some((argument) => argument.includes(os.tmpdir()))).toBe(true)
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
        "test('can use only declared Docker mounts', async () => {",
        "  expect(await Bun.file('/session/app/source.txt').text()).toBe('captured source')",
        "  expect(await Bun.file('/session/node_modules/dependency.txt').text()).toBe('captured dependency')",
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
