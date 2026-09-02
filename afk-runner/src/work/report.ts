// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type { ExecGitFn } from '../config.js'
import { discoverBranch } from '../config.js'
import type { RunnerConfig } from '../config.js'
import type { SddEvent } from '../events.js'
import { readEvents } from '../events.js'
import { loadRunState } from '../run-state.js'

export interface ChangeDirSummary {
  readonly tasksDone: number
  readonly tasksTotal: number
  readonly artifacts: readonly string[]
}

export interface ReportInput {
  readonly readEvents: () => readonly SddEvent[]
  readonly readChangeDir: () => Promise<ChangeDirSummary>
  readonly execGit: ExecGitFn
  readonly runId: string
  readonly changeName: string
  readonly branch: string
  readonly pr: boolean
}

interface PipelineFacts {
  readonly depth: { profile: string; rationale: string } | null
  readonly rounds: number
  readonly lastVerdict: string | null
  readonly gateVersions: number
  readonly ranSkeptic: boolean
}

function factsFrom(events: readonly SddEvent[]): PipelineFacts {
  let depth: { profile: string; rationale: string } | null = null
  let rounds = 0
  let lastVerdict: string | null = null
  let gateVersions = 0
  let ranSkeptic = false
  for (const event of events) {
    if (event.type === 'depth') depth = { profile: event.profile, rationale: event.rationale }
    else if (event.type === 'round_open') rounds = Math.max(rounds, event.round)
    else if (event.type === 'convergence') lastVerdict = event.verdict
    else if (event.type === 'gate' && event.action === 'presented') gateVersions += 1
    else if (event.type === 'spawned' && event.role === 'skeptic') ranSkeptic = true
  }
  return { depth, rounds, lastVerdict, gateVersions, ranSkeptic }
}

function lensLine(facts: PipelineFacts): string {
  return ranSkepticLine(facts.ranSkeptic, facts.depth?.profile)
}

function ranSkepticLine(ran: boolean, profile: string | undefined): string {
  if (ran) return 'skeptic lens: run'
  return `skeptic lens: not run${profile === undefined ? '' : ` — ${profile} profile`}`
}

function verdictWord(verdict: string | null, rounds: number): string {
  if (verdict === 'converged') return `converged in ${rounds} round${rounds === 1 ? '' : 's'}`
  if (rounds === 0) return 'review not reached'
  return `open after ${rounds} round${rounds === 1 ? '' : 's'}`
}

async function commitsLine(input: ReportInput): Promise<string[]> {
  const { stdout } = await input.execGit(input.branch, ['log', '--pretty=format:%h %s'])
  return stdout.split('\n').filter((line) => line.trim().length > 0)
}

interface GainsFacts {
  readonly avoidedByRule: ReadonlyMap<string, number>
  readonly acceptItemsByRule: ReadonlyMap<string, number>
  readonly humanGates: number
  readonly medianDwellMs: number | null
}

/** Fixed conservative constant when no human-gate dwell history exists (D9). */
const DEFAULT_DWELL_MINUTES = 5

/**
 * Wall-time saved estimate: N × median human-gate dwell, where dwell is the
 * `gate presented` → `gate answered` timestamp distance of human-settled
 * gates. One helper owns the formula so it can be corrected in one place.
 */
function estimateSavedMs(gains: GainsFacts): number {
  const totalAvoided = [...gains.avoidedByRule.values()].reduce((acc, n) => acc + n, 0)
  if (totalAvoided === 0) return 0
  const dwell = gains.medianDwellMs ?? DEFAULT_DWELL_MINUTES * 60_000
  return totalAvoided * dwell
}

/**
 * Human-gate dwell distances (U9 cross-run accounting seam): each gate's
 * `presented` → `answered` timestamp distance, excluding auto-decided gates
 * and unanswered presentations — the exact list `collectGains` medians over.
 */
export function gateDwellsMs(events: readonly SddEvent[]): number[] {
  const answeredAt = new Map<number, string>()
  for (const event of events) {
    if (event.type === 'gate' && event.action === 'answered') answeredAt.set(event.version, event.ts)
  }
  const presentedHuman = new Map<number, string>()
  for (const event of events) {
    if (event.type === 'gate' && event.action === 'presented') presentedHuman.set(event.version, event.ts)
  }
  const autoDecidedVersions = new Set<number>()
  for (const event of events) {
    if (event.type !== 'auto_decision') continue
    if (event.decision === 'approve' || event.decision === 'extend') {
      if (answeredAt.has(event.gateVersion)) autoDecidedVersions.add(event.gateVersion)
    }
  }
  const dwellsMs: number[] = []
  for (const [version, presentedTs] of presentedHuman) {
    const answeredTs = answeredAt.get(version)
    if (answeredTs === undefined) continue
    if (autoDecidedVersions.has(version)) continue
    dwellsMs.push(Math.max(0, new Date(answeredTs).getTime() - new Date(presentedTs).getTime()))
  }
  return dwellsMs
}

function collectGains(events: readonly SddEvent[]): GainsFacts {
  const answeredVersions = new Set<number>()
  for (const event of events) {
    if (event.type === 'gate' && event.action === 'answered') answeredVersions.add(event.version)
  }
  const avoidedByRule = new Map<string, number>()
  const acceptItemsByRule = new Map<string, number>()
  for (const event of events) {
    if (event.type !== 'auto_decision') continue
    if (event.decision === 'approve' || event.decision === 'extend') {
      if (answeredVersions.has(event.gateVersion)) {
        avoidedByRule.set(event.rule, (avoidedByRule.get(event.rule) ?? 0) + 1)
      }
    }
    if (event.decision === 'accept-items') {
      acceptItemsByRule.set(event.rule, (acceptItemsByRule.get(event.rule) ?? 0) + 1)
    }
  }
  const humanDwellsMs = gateDwellsMs(events)
  humanDwellsMs.sort((a, b) => a - b)
  const mid = Math.floor(humanDwellsMs.length / 2)
  const medianDwellMs: number | null =
    humanDwellsMs.length === 0
      ? null
      : humanDwellsMs.length % 2 === 1
        ? (humanDwellsMs[mid] ?? 0)
        : Math.round(((humanDwellsMs[mid - 1] ?? 0) + (humanDwellsMs[mid] ?? 0)) / 2)
  return { avoidedByRule, acceptItemsByRule, humanGates: humanDwellsMs.length, medianDwellMs }
}

function gainsLines(gains: GainsFacts): string[] {
  const totalAvoided = [...gains.avoidedByRule.values()].reduce((acc, n) => acc + n, 0)
  const perRule = [...gains.avoidedByRule.entries()].map(([rule, n]) => `${rule} × ${n}`)
  const savedMin = Math.round(estimateSavedMs(gains) / 60_000)
  const lines = [
    '### Gains',
    `interventions avoided: ${totalAvoided} · human gates: ${gains.humanGates} · ~wall-time saved: ${savedMin}m`,
  ]
  if (perRule.length > 0) lines.push(`per rule: ${perRule.join(', ')}`)
  for (const [rule, n] of gains.acceptItemsByRule) {
    lines.push(`${rule} items auto-accepted: ${n}`)
  }
  return lines
}

export async function buildReport(input: ReportInput): Promise<string> {
  const events = input.readEvents()
  const facts = factsFrom(events)
  const gains = collectGains(events)
  const change = await input.readChangeDir()
  const commits = await commitsLine(input)
  const lines: string[] = []
  if (input.pr) lines.push('## Summary', '', `Change \`${input.changeName}\` — see below for the scrutiny envelope.`)
  lines.push(
    '',
    `### Depth`,
    facts.depth === null ? 'not classified' : `${facts.depth.profile} — ${facts.depth.rationale}`,
    '',
    `### Review`,
    verdictWord(facts.lastVerdict, facts.rounds),
    `gate versions presented: ${facts.gateVersions}`,
    lensLine(facts),
    '',
    `### Tasks`,
    `${change.tasksDone}/${change.tasksTotal} tasks complete`,
    '',
    ...(gains.avoidedByRule.size > 0 || gains.acceptItemsByRule.size > 0 ? [...gainsLines(gains), ''] : []),
    `### Commits on ${input.branch}`,
    ...commits,
    '',
    `run: ${input.runId}`,
    `transcripts: runs/${input.runId}/transcripts/`,
    `sessions: runs/${input.runId}/sessions.jsonl`,
  )
  if (input.pr) lines.push('', 'Archive: post-merge follow-up on master (human-triggered).')
  return lines.join('\n')
}

export async function readChangeSummary(repoRoot: string, changeName: string): Promise<ChangeDirSummary> {
  const changeDir = path.join(repoRoot, 'openspec', 'changes', changeName)
  let tasksDone = 0
  let tasksTotal = 0
  try {
    const tasksMd = await readFile(path.join(changeDir, 'tasks.md'), 'utf8')
    for (const line of tasksMd.split('\n')) {
      const checked = /^\s*- \[x\]/iu.test(line)
      const unchecked = /^\s*- \[ \]/iu.test(line)
      if (checked || unchecked) {
        tasksTotal += 1
        if (checked) tasksDone += 1
      }
    }
  } catch {
    // no tasks.md yet
  }
  const artifacts = await listArtifacts(changeDir)
  return { tasksDone, tasksTotal, artifacts }
}

async function listArtifacts(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const perEntry = await Promise.all(
    entries.map((entry): Promise<string[]> => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return listArtifacts(full)
      return Promise.resolve(entry.name.endsWith('.md') ? [entry.name] : [])
    }),
  )
  return perEntry.flat().sort()
}

/**
 * The passive report entry (C5 D8): builds the summary purely from the event
 * log, the change directory, and git — printing it never writes run state.
 */
export async function buildRunReport(
  deps: { readonly config: RunnerConfig; readonly execGit: ExecGitFn },
  runId: string,
  pr: boolean,
): Promise<string> {
  const state = await loadRunState(deps.config.workDir, runId)
  const branch = await discoverBranch(deps.execGit, deps.config.repoRoot)
  return buildReport({
    readEvents: () => readEvents(path.join(deps.config.workDir, 'runs', runId, 'events.ndjson')),
    readChangeDir: () => readChangeSummary(deps.config.repoRoot, state.changeName),
    execGit: deps.execGit,
    runId,
    changeName: state.changeName,
    branch,
    pr,
  })
}
