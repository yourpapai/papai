// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'

import type { StorySandboxRequest } from './story-sandbox.js'

export const STORY_SANDBOX_LINUX_IMAGE =
  'docker.io/oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e'

const REQUIRED_BUN_VERSION = '1.3.13'

export type StorySandboxProcessResult = Readonly<{
  exitCode: number
  stdout: string
  stderr: string
}>

export type StorySandboxProcessRunner = (command: readonly string[]) => StorySandboxProcessResult

export type StorySandboxUserIdentity = Readonly<{
  getgid?: () => number
  getuid?: () => number
}>

const MAXIMUM_LINUX_ID = 4_294_967_295

function linuxId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_LINUX_ID) {
    throw new Error(`Story sandbox ${label} must be a non-negative Linux identifier`)
  }
  return value
}

export function resolveLinuxStorySandboxUser(identity: StorySandboxUserIdentity = process): string {
  if (identity.getuid === undefined || identity.getgid === undefined) {
    throw new Error('Story sandbox Linux backend requires host uid and gid')
  }
  return `${linuxId(identity.getuid(), 'uid')}:${linuxId(identity.getgid(), 'gid')}`
}

export function isLinuxStorySandboxRequired(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const ci = environment['CI']
  return environment['PAPAI_REQUIRE_STORY_SANDBOX'] === '1' || (ci !== undefined && ci !== '' && ci !== 'false')
}

function canonicalDirectory(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(`Story sandbox ${label} must be absolute`)
  const resolved = realpathSync(value)
  if (resolved !== value) throw new Error(`Story sandbox ${label} must be canonical`)
  if (!lstatSync(resolved).isDirectory()) throw new Error(`Story sandbox ${label} must be a directory`)
  return resolved
}

function canonicalFile(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error(`Story sandbox ${label} must be absolute`)
  const resolved = realpathSync(value)
  if (resolved !== value) throw new Error(`Story sandbox ${label} must be canonical`)
  const stat = lstatSync(resolved)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Story sandbox ${label} must be a regular file`)
  return resolved
}

function sessionOutputs(appRoot: string, tempRoot: string, reportPaths: readonly string[]): readonly string[] {
  if (path.basename(appRoot) !== 'app') throw new Error('Story sandbox app root must be the session app directory')
  const sessionRoot = path.dirname(appRoot)
  if (tempRoot !== path.join(sessionRoot, 'tmp')) throw new Error('Story sandbox temporary root must be session tmp')
  const reportsRoot = path.join(sessionRoot, 'reports')
  const reports = reportPaths.map((report) => canonicalFile(report, 'report path'))
  if (reports.length === 0) throw new Error('Story sandbox requires at least one report path')
  if (new Set(reports).size !== reports.length) throw new Error('Story sandbox report paths must be unique')
  if (reports.some((report) => path.dirname(report) !== reportsRoot || path.extname(report) !== '.xml')) {
    throw new Error('Story sandbox report paths must be direct files in session reports')
  }
  return reports
}

function dockerMount(source: string, target: string, readOnly = false): readonly string[] {
  if (source.includes(',') || source.includes('\0'))
    throw new Error('Story sandbox mount path contains an unsafe Docker separator')
  return ['--mount', `type=bind,src=${source},dst=${target}${readOnly ? ',readonly' : ''}`]
}

function commandArguments(
  request: StorySandboxRequest,
  bunExecutable: string,
  appRoot: string,
  tempRoot: string,
  reports: readonly string[],
): readonly string[] {
  if (request.command[0] !== request.bunExecutable && request.command[0] !== bunExecutable) {
    throw new Error('Story sandbox command must begin with the declared bun executable')
  }
  if (request.command.length < 2 || request.command[1] !== 'test') {
    throw new Error('Story sandbox Linux command must invoke bun test')
  }
  return request.command.slice(1).map((argument) => translateLinuxCommandArgument(argument, appRoot, tempRoot, reports))
}

function translateLinuxCommandArgument(
  argument: string,
  appRoot: string,
  tempRoot: string,
  reports: readonly string[],
): string {
  for (const prefix of ['--config=', '--reporter-outfile=']) {
    if (argument.startsWith(prefix)) {
      return `${prefix}${translateLinuxSessionPath(argument.slice(prefix.length), appRoot, tempRoot, reports)}`
    }
  }
  if (!path.isAbsolute(argument)) return argument
  return translateLinuxSessionPath(argument, appRoot, tempRoot, reports)
}

function translateLinuxSessionPath(
  hostPath: string,
  appRoot: string,
  tempRoot: string,
  reports: readonly string[],
): string {
  const report = reports.find((value) => value === hostPath)
  if (report !== undefined) return `/session/reports/${path.basename(report)}`
  for (const [hostRoot, containerRoot] of [
    [appRoot, '/session/app'],
    [tempRoot, '/session/tmp'],
  ] as const) {
    const relative = path.relative(hostRoot, hostPath)
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      return relative === '' ? containerRoot : path.posix.join(containerRoot, ...relative.split(path.sep))
    }
  }
  throw new Error(`Story sandbox Linux command path is outside the declared session: ${hostPath}`)
}

export function buildLinuxStorySandboxCommand(request: StorySandboxRequest): readonly string[] {
  const appRoot = canonicalDirectory(request.appRoot, 'app root')
  const tempRoot = canonicalDirectory(request.tempRoot, 'temporary root')
  const reports = sessionOutputs(appRoot, tempRoot, request.reportPaths)
  const bunExecutable = canonicalFile(request.bunExecutable, 'bun executable')
  const argumentsForBun = commandArguments(request, bunExecutable, appRoot, tempRoot, reports)
  const reportMounts = reports.flatMap((report) => dockerMount(report, `/session/reports/${path.basename(report)}`))

  return [
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
    '--workdir',
    '/session/app',
    '--env',
    'TMPDIR=/session/tmp',
    '--env',
    'HOME=/nonexistent',
    '--env',
    'TZ=UTC',
    '--env',
    'PAPAI_STORY_RUNNER=1',
    '--env',
    'PAPAI_STORY_EXECUTION_ROOT=/session/app',
    ...dockerMount(appRoot, '/session/app', true),
    ...dockerMount(tempRoot, '/session/tmp'),
    ...reportMounts,
    STORY_SANDBOX_LINUX_IMAGE,
    '--no-env-file',
    ...argumentsForBun,
  ]
}

function defaultProcessRunner(command: readonly string[]): StorySandboxProcessResult {
  const child = Bun.spawnSync([...command], { stdout: 'pipe', stderr: 'pipe' })
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  }
}

function assertSuccessfulDockerCommand(result: StorySandboxProcessResult, purpose: string): void {
  if (result.exitCode === 0) return
  const detail = `${result.stdout}\n${result.stderr}`.trim()
  throw new Error(`Story sandbox Docker ${purpose} failed${detail === '' ? '' : `: ${detail}`}`)
}

export function assertLinuxStorySandboxBackend(run: StorySandboxProcessRunner = defaultProcessRunner): void {
  assertSuccessfulDockerCommand(run(['docker', 'version', '--format', '{{.Server.Version}}']), 'availability check')
  const version = run(['docker', 'run', '--rm', '--network', 'none', STORY_SANDBOX_LINUX_IMAGE, '--version'])
  assertSuccessfulDockerCommand(version, 'Bun version check')
  if (version.stdout.trim() !== REQUIRED_BUN_VERSION) {
    throw new Error(
      `Story sandbox Docker image must run Bun ${REQUIRED_BUN_VERSION}, received ${JSON.stringify(version.stdout.trim())}`,
    )
  }
}
