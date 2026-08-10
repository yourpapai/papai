// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ExecGitFn } from './config.js'
import type { SddEvent } from './events.js'

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

export async function buildReport(input: ReportInput): Promise<string> {
  const events = input.readEvents()
  const facts = factsFrom(events)
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
    `### Commits on ${input.branch}`,
    ...commits,
    '',
    `run: ${input.runId}`,
  )
  if (input.pr) lines.push('', 'Archive: post-merge follow-up on master (human-triggered).')
  return lines.join('\n')
}
