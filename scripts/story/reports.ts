// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { constants, type Dirent, type Stats } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'

export const STORY_REPORT_DIRECTORY = 'reports/stories'
export const STORY_MANIFEST_REPORT_PATH = `${STORY_REPORT_DIRECTORY}/manifest.json`
export const STORY_JUNIT_REPORT_PATH = `${STORY_REPORT_DIRECTORY}/junit.xml`

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export async function removeStoryReport(reportPath: string): Promise<void> {
  try {
    await rm(reportPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to remove story report ${reportPath}: ${message}`, { cause: error })
  }
}

export type SessionFileHandle = Readonly<{
  close(): Promise<void>
  readFile(): Promise<Uint8Array>
  stat(): Promise<Stats>
  writeFile(data: Uint8Array): Promise<void>
}>

export type SessionFileSystem = Readonly<{
  chmod(target: string, mode: number): Promise<void>
  lstat(target: string): Promise<Stats>
  mkdir(target: string, options: Readonly<{ recursive: true; mode: number }>): Promise<string | undefined>
  mkdtemp(prefix: string): Promise<string>
  open(target: string, flags: number, mode?: number): Promise<SessionFileHandle>
  readlink(target: string): Promise<string>
  readdir(target: string, options: Readonly<{ withFileTypes: true }>): Promise<readonly Dirent[]>
  realpath(target: string): Promise<string>
  rm(target: string, options: Readonly<{ recursive: true; force: true }>): Promise<void>
  symlink(target: string, link: string, type?: 'dir' | 'file' | 'junction'): Promise<void>
}>

export type ReportMapping = Readonly<{ livePath: string; sessionPath: string }>

function isReportPath(value: string): boolean {
  return /^reports\/stories\/[^/\\]+\.xml$/u.test(value)
}

export function reporterMappings(
  reporterArguments: readonly string[],
  liveRoot: string,
  sessionRoot: string,
): Readonly<{ argumentsForChild: readonly string[]; reports: readonly ReportMapping[] }> {
  const argumentsForChild: string[] = []
  const reports: ReportMapping[] = []
  const names = new Set<string>()
  for (let index = 0; index < reporterArguments.length; index += 1) {
    const argument = reporterArguments[index]
    if (argument === undefined) continue
    if (argument === '--reporter-outfile') {
      const value = reporterArguments[index + 1]
      if (value === undefined) throw new Error('--reporter-outfile requires a value')
      argumentsForChild.push(argument, mapReport(value, liveRoot, sessionRoot, reports, names).sessionPath)
      index += 1
      continue
    }
    if (argument.startsWith('--reporter-outfile=')) {
      const value = argument.slice('--reporter-outfile='.length)
      const mapped = mapReport(value, liveRoot, sessionRoot, reports, names)
      argumentsForChild.push(`--reporter-outfile=${mapped.sessionPath}`)
      continue
    }
    argumentsForChild.push(argument)
  }
  return { argumentsForChild, reports }
}

function mapReport(
  value: string,
  liveRoot: string,
  sessionRoot: string,
  reports: ReportMapping[],
  names: Set<string>,
): ReportMapping {
  if (!isReportPath(value)) throw new Error('Story reporter outfile must be reports/stories/<name>.xml')
  const name = path.posix.basename(value)
  if (names.has(name)) throw new Error(`Duplicate story reporter outfile: ${value}`)
  names.add(name)
  const report = {
    livePath: path.join(liveRoot, 'reports', 'stories', name),
    sessionPath: path.join(sessionRoot, 'reports', name),
  }
  reports.push(report)
  return report
}

export async function createReportFiles(reports: readonly ReportMapping[], fs: SessionFileSystem): Promise<void> {
  const results = await Promise.allSettled(
    reports.map(async (report): Promise<void> => {
      const handle = await fs.open(report.sessionPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      await handle.close()
    }),
  )
  const failures = results.flatMap((result): readonly unknown[] =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )
  if (failures.length > 0) {
    const messages = failures.map((failure) => (failure instanceof Error ? failure.message : String(failure)))
    throw new AggregateError(failures, `Story report precreation failed: ${messages.join('; ')}`)
  }
}

async function assertRegularFile(target: string, fs: SessionFileSystem): Promise<void> {
  const entry = await fs.lstat(target)
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Story report is not a regular file: ${target}`)
}

export function verifyReportFiles(reports: readonly ReportMapping[], fs: SessionFileSystem): Promise<void> {
  return Promise.all(reports.map((report) => assertRegularFile(report.sessionPath, fs))).then(() => undefined)
}

async function assertSafeDestination(liveRoot: string, destination: string, fs: SessionFileSystem): Promise<void> {
  const relative = path.relative(liveRoot, destination)
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Story report destination escapes the live root: ${destination}`)
  }
  const ancestors = [liveRoot]
  let current = liveRoot
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment)
    ancestors.push(current)
  }
  const entries = await Promise.all(ancestors.map((ancestor) => fs.lstat(ancestor).catch(() => undefined)))
  if (entries.some((entry) => entry !== undefined && entry.isSymbolicLink())) {
    throw new Error(`Story report destination traverses a symbolic link: ${destination}`)
  }
  const destinationEntry = await fs.lstat(destination).catch(() => undefined)
  if (destinationEntry !== undefined && destinationEntry.isSymbolicLink()) {
    throw new Error(`Story report destination is a symbolic link: ${destination}`)
  }
}

async function copyReport(source: string, destination: string, liveRoot: string, fs: SessionFileSystem): Promise<void> {
  await assertRegularFile(source, fs)
  await assertSafeDestination(liveRoot, destination, fs)
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await assertSafeDestination(liveRoot, destination, fs)
  const input = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const output = await fs.open(
      destination,
      constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await assertOpenedDestination(output, destination, liveRoot, fs)
      await output.writeFile(await input.readFile())
    } finally {
      await output.close()
    }
  } finally {
    await input.close()
  }
}

async function assertOpenedDestination(
  handle: SessionFileHandle,
  destination: string,
  liveRoot: string,
  fs: SessionFileSystem,
): Promise<void> {
  await assertSafeDestination(liveRoot, destination, fs)
  const resolved = await fs.realpath(destination)
  const resolvedLiveRoot = await fs.realpath(liveRoot)
  await assertSafeDestination(resolvedLiveRoot, resolved, fs)
  const entry = await fs.lstat(resolved)
  const opened = await handle.stat()
  if (!entry.isFile() || entry.isSymbolicLink() || entry.dev !== opened.dev || entry.ino !== opened.ino) {
    throw new Error(`Story report destination changed while opening: ${destination}`)
  }
  await assertSafeDestination(liveRoot, destination, fs)
}

export async function copyReports(
  reports: readonly ReportMapping[],
  liveRoot: string,
  fs: SessionFileSystem,
): Promise<void> {
  const results = await Promise.allSettled(
    reports.map((report) => copyReport(report.sessionPath, report.livePath, liveRoot, fs)),
  )
  const failures = results.flatMap((result): readonly unknown[] =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )
  if (failures.length > 0) {
    const messages = failures.map((failure) => (failure instanceof Error ? failure.message : String(failure)))
    throw new AggregateError(failures, `Story report copy failed: ${messages.join('; ')}`)
  }
}
