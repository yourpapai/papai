// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { Finding, Resolution } from './agent-layer.js'
import { FindingsSidecarSchema, ResolutionsSidecarSchema } from './agent-layer.js'
import type { SddEvent } from './events.js'
import { SddEventSchema } from './events.js'
import { PersistedRunStateSchema } from './run-state.js'
import type { PersistedRunState } from './run-state.js'

/**
 * Read-only analysis IO seams (D2): the fs type exposes only read functions —
 * the no-write contract is the seam's shape, not discipline — and the git
 * wrapper admits only `log`/`ls-tree`. Tests pin both; nothing here writes,
 * renames, or deletes in any run dir, workdir, or the repository.
 */

export interface AnalyzeFs {
  readFile(filePath: string): Promise<string>
  readdir(dirPath: string): Promise<string[]>
  stat(targetPath: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>
}

export function nodeAnalyzeFs(): AnalyzeFs {
  return {
    readFile: (filePath) => readFile(filePath, 'utf8'),
    readdir: (dirPath) => readdir(dirPath),
    stat: (targetPath) => stat(targetPath),
  }
}

export type AnalyzeGit = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

const READABLE_GIT_SUBCOMMANDS = new Set(['log', 'ls-tree'])

export function readOnlyGit(exec: AnalyzeGit): AnalyzeGit {
  return (cwd, args) => {
    const subcommand = args[0] ?? ''
    if (!READABLE_GIT_SUBCOMMANDS.has(subcommand)) {
      return Promise.reject(
        new Error(`read-only git seam rejected '${subcommand === '' ? '<none>' : subcommand}' (allowed: log, ls-tree)`),
      )
    }
    return exec(cwd, args)
  }
}

export interface RoundSidecar<T> {
  readonly round: number
  readonly items: readonly T[]
}

export interface GateFileRecord {
  readonly version: number
  readonly md: string
}

export interface RunBundle {
  readonly workDir: string
  readonly runId: string
  readonly runDir: string
  readonly state: PersistedRunState | null
  readonly stateBak: boolean
  readonly events: readonly SddEvent[]
  readonly droppedEventLines: number
  readonly findings: readonly RoundSidecar<Finding>[]
  readonly skepticFindings: readonly RoundSidecar<Finding>[]
  readonly resolutions: readonly RoundSidecar<Resolution>[]
  readonly gateFiles: readonly GateFileRecord[]
  readonly sidecarFailures: number
}

export function analyzeRunDir(workDir: string, runId: string): string {
  return path.join(workDir, 'runs', runId)
}

/** Run ids under one workdir; an unreadable runs/ dir is no runs, never a failure. */
export async function discoverRunIds(fs: AnalyzeFs, workDir: string): Promise<readonly string[]> {
  const entries = await fs.readdir(path.join(workDir, 'runs')).catch(() => [] as string[])
  return [...entries].sort()
}

export async function loadCorpus(fs: AnalyzeFs, workdirs: readonly string[]): Promise<readonly RunBundle[]> {
  const perWorkDir = await Promise.all(
    workdirs.map(async (workDir): Promise<readonly RunBundle[]> => {
      const runIds = await discoverRunIds(fs, workDir)
      return Promise.all(runIds.map((runId) => loadRunBundle(fs, workDir, runId)))
    }),
  )
  return perWorkDir.flat()
}

/**
 * Load one run dir degraded-gracefully: every artifact (memo, sidecars, gate
 * files) that is missing or unreadable loads as absent and the metrics that
 * need it report `unknown`; unparsable event lines are dropped and counted,
 * never fatal (pre-change vocabularies parse to reduced coverage).
 */
export async function loadRunBundle(fs: AnalyzeFs, workDir: string, runId: string): Promise<RunBundle> {
  const runDir = analyzeRunDir(workDir, runId)
  const rawEvents = await readEventsTolerant(fs, path.join(runDir, 'events.ndjson'))
  const sidecars = await readSidecars(fs, runDir)
  const gateFiles = await readGateFiles(fs, runDir)
  return {
    workDir,
    runId,
    runDir,
    state: await readState(fs, runDir),
    stateBak: await pathExists(fs, path.join(runDir, 'state.json.bak')),
    events: rawEvents.events,
    droppedEventLines: rawEvents.dropped,
    findings: sidecars.findings,
    skepticFindings: sidecars.skepticFindings,
    resolutions: sidecars.resolutions,
    sidecarFailures: sidecars.failures,
    gateFiles: gateFiles,
  }
}

async function readState(fs: AnalyzeFs, runDir: string): Promise<PersistedRunState | null> {
  const raw = await fs.readFile(path.join(runDir, 'state.json')).catch(() => null)
  if (raw === null) return null
  const parsed = PersistedRunStateSchema.safeParse(safeJson(raw))
  return parsed.success ? parsed.data : null
}

interface TolerantEvents {
  readonly events: readonly SddEvent[]
  readonly dropped: number
}

async function readEventsTolerant(fs: AnalyzeFs, logPath: string): Promise<TolerantEvents> {
  const raw = await fs.readFile(logPath).catch(() => '')
  const events: SddEvent[] = []
  let dropped = 0
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    const parsed = SddEventSchema.safeParse(safeJson(line))
    if (parsed.success) events.push(parsed.data)
    else dropped += 1
  }
  return { events, dropped }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const FINDINGS_RE = /^findings-(\d+)\.json$/u
const SKEPTIC_FINDINGS_RE = /^findings-skeptic-(\d+)\.json$/u
const RESOLUTIONS_RE = /^resolutions-(\d+)\.json$/u
const GATE_FILE_RE = /^gate-(\d+)\.md$/u

interface SidecarLoad {
  readonly findings: readonly RoundSidecar<Finding>[]
  readonly skepticFindings: readonly RoundSidecar<Finding>[]
  readonly resolutions: readonly RoundSidecar<Resolution>[]
  readonly failures: number
}

async function readSidecars(fs: AnalyzeFs, runDir: string): Promise<SidecarLoad> {
  const sidecarsDir = path.join(runDir, 'sidecars')
  const entries = await fs.readdir(sidecarsDir).catch(() => [] as string[])
  const contents = await Promise.all(
    [...entries].sort().map(async (name): Promise<{ readonly name: string; readonly raw: string | null }> => ({
      name,
      raw: await fs.readFile(path.join(sidecarsDir, name)).catch(() => null),
    })),
  )
  const findings: RoundSidecar<Finding>[] = []
  const skepticFindings: RoundSidecar<Finding>[] = []
  const resolutions: RoundSidecar<Resolution>[] = []
  let failures = 0
  for (const { name, raw } of contents) {
    if (raw === null) continue
    const json = safeJson(raw)
    const findingsMatch = FINDINGS_RE.exec(name)
    if (findingsMatch !== null) {
      const parsed = FindingsSidecarSchema.safeParse(json)
      if (parsed.success) findings.push({ round: Number(findingsMatch[1]), items: parsed.data.findings })
      else failures += 1
      continue
    }
    const skepticMatch = SKEPTIC_FINDINGS_RE.exec(name)
    if (skepticMatch !== null) {
      const parsed = FindingsSidecarSchema.safeParse(json)
      if (parsed.success) skepticFindings.push({ round: Number(skepticMatch[1]), items: parsed.data.findings })
      else failures += 1
      continue
    }
    const resolutionsMatch = RESOLUTIONS_RE.exec(name)
    if (resolutionsMatch !== null) {
      const parsed = ResolutionsSidecarSchema.safeParse(json)
      if (parsed.success) resolutions.push({ round: Number(resolutionsMatch[1]), items: parsed.data.resolutions })
      else failures += 1
    }
  }
  return { findings, skepticFindings, resolutions, failures }
}

async function readGateFiles(fs: AnalyzeFs, runDir: string): Promise<readonly GateFileRecord[]> {
  const entries = await fs.readdir(runDir).catch(() => [] as string[])
  const gateNames = [...entries].sort().filter((name) => GATE_FILE_RE.test(name))
  const contents = await Promise.all(
    gateNames.map(async (name): Promise<{ readonly name: string; readonly md: string | null }> => ({
      name,
      md: await fs.readFile(path.join(runDir, name)).catch(() => null),
    })),
  )
  const gateFiles: GateFileRecord[] = []
  for (const { name, md } of contents) {
    if (md === null) continue
    const gateMatch = GATE_FILE_RE.exec(name)
    if (gateMatch !== null) gateFiles.push({ version: Number(gateMatch[1]), md })
  }
  return gateFiles
}

function pathExists(fs: AnalyzeFs, targetPath: string): Promise<boolean> {
  return fs
    .stat(targetPath)
    .then(() => true)
    .catch(() => false)
}

export interface ChangeFolderSummary {
  readonly changeDir: string
  readonly exists: boolean
  readonly tasksDone: number
  readonly tasksTotal: number
}

export function changeDirOf(repoRoot: string, changeName: string): string {
  return path.join(repoRoot, 'openspec', 'changes', changeName)
}

/**
 * Change-folder resolution: locate `openspec/changes/<name>` and count its
 * tasks.md checkboxes. A missing folder reports `exists: false` with zero
 * tasks rather than failing — the ground-truth join needs the absence, not an
 * error.
 */
export async function readChangeFolder(
  fs: AnalyzeFs,
  repoRoot: string,
  changeName: string,
): Promise<ChangeFolderSummary> {
  const changeDir = changeDirOf(repoRoot, changeName)
  const tasksMd = await fs.readFile(path.join(changeDir, 'tasks.md')).catch(() => null)
  if (tasksMd === null) {
    return { changeDir, exists: await pathExists(fs, changeDir), tasksDone: 0, tasksTotal: 0 }
  }
  let tasksDone = 0
  let tasksTotal = 0
  for (const line of tasksMd.split('\n')) {
    const checked = /^\s*- \[x\]/iu.test(line)
    const unchecked = /^\s*- \[ \]/iu.test(line)
    if (checked || unchecked) {
      tasksTotal += 1
      if (checked) tasksDone += 1
    }
  }
  return { changeDir, exists: true, tasksDone, tasksTotal }
}
