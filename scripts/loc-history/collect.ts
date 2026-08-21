// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export interface Totals {
  code: number
  blanks: number
  comments: number
}

export interface Commit {
  sha: string
  tree: string
  date: number
  subject: string
}

export interface Point extends Totals {
  sha: string
  date: number
  subject: string
}

const MAX_BUFFER = 128 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTotals(value: unknown): value is Totals {
  if (!isRecord(value)) return false
  return (
    typeof value['code'] === 'number' && typeof value['blanks'] === 'number' && typeof value['comments'] === 'number'
  )
}

function parseTokeiJson(stdout: string): Totals | undefined {
  const parsed: unknown = JSON.parse(stdout)
  if (!isRecord(parsed)) return undefined
  const total: unknown = parsed['Total']
  if (!isTotals(total)) return undefined
  return { code: total.code, blanks: total.blanks, comments: total.comments }
}

function sh(cmd: string, args: string[], cwd?: string): string {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER })
  if (res.status !== 0) {
    const reason = res.stderr.trim() || String(res.error)
    throw new Error(`\`${cmd} ${args.join(' ')}\` failed: ${reason}`)
  }
  return res.stdout
}

export function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length === 0) return []
  if (count >= items.length || count <= 1) {
    if (count === 1) {
      const first = items[0]
      return first === undefined ? [] : [first]
    }
    return items
  }
  const picked: T[] = []
  let lastIndex = -1
  for (let i = 0; i < count; i++) {
    const index = Math.round((i * (items.length - 1)) / (count - 1))
    if (index !== lastIndex) {
      const value = items[index]
      if (value !== undefined) picked.push(value)
      lastIndex = index
    }
  }
  return picked
}

export function selectCommits(all: Commit[], max?: number, sample?: number): Commit[] {
  let commits = all
  if (max !== undefined) commits = commits.slice(0, max)
  if (sample !== undefined) commits = pickEvenly(commits, sample)
  return commits
}

export function measure(cwd: string, sha: string): Totals {
  const dirs = ['src', 'plugins', 'client'].filter((d) => existsSync(join(cwd, d)))
  if (dirs.length === 0) return { code: 0, blanks: 0, comments: 0 }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = spawnSync('tokei', ['-C', '-o', 'json', ...dirs], {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    })
    if (res.status === 0) {
      try {
        const totals = parseTokeiJson(res.stdout)
        if (totals !== undefined) return totals
      } catch (error) {
        console.error(
          `\nwarn: tokei emitted invalid JSON at ${sha.slice(0, 9)} (attempt ${attempt}): ` +
            `${error instanceof Error ? error.message : String(error)}; stdout ${res.stdout.length} bytes`,
        )
      }
    } else {
      console.error(
        `\nwarn: tokei exit ${res.status} at ${sha.slice(0, 9)} (attempt ${attempt}): ${res.stderr.trim().split('\n')[0]}`,
      )
    }
    if (attempt === 2) throw new Error(`tokei unusable at commit ${sha.slice(0, 9)}`)
  }
  return { code: 0, blanks: 0, comments: 0 }
}

export function partialPath(jsonOut: string): string {
  return `${jsonOut}.partial.jsonl`
}

function isPoint(value: unknown): value is Point {
  if (!isRecord(value)) return false
  const { code, blanks, comments, sha, date, subject } = value
  return (
    typeof code === 'number' &&
    typeof blanks === 'number' &&
    typeof comments === 'number' &&
    typeof sha === 'string' &&
    typeof date === 'number' &&
    typeof subject === 'string'
  )
}

export function loadPartial(path: string): Point[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line))
    .filter((parsed): parsed is Point => isPoint(parsed))
}

function checkout(wtPath: string, sha: string, isFirst: boolean): void {
  try {
    if (!isFirst) sh('git', ['-C', wtPath, 'checkout', '-q', '--detach', sha])
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`\nwarn: checkout ${sha.slice(0, 9)} failed (${reason.split('\n')[0]}); recreating worktree`)
    rmSync(wtPath, { recursive: true, force: true })
    sh('git', ['worktree', 'add', '--detach', wtPath, sha])
  }
}

export function collectPoints(commits: Commit[], wtPath: string, checkpoint: string, done: Set<string>): Point[] {
  const points: Point[] = []
  let lastTree = ''
  let lastTotals: Totals | undefined
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    if (commit === undefined) continue
    if (done.has(commit.sha)) continue
    let totals: Totals
    if (commit.tree === lastTree && lastTotals !== undefined) {
      totals = lastTotals
    } else {
      checkout(wtPath, commit.sha, points.length === 0 && done.size === 0)
      totals = measure(wtPath, commit.sha)
      lastTree = commit.tree
      lastTotals = totals
    }
    const point: Point = { ...totals, sha: commit.sha, date: commit.date, subject: commit.subject }
    points.push(point)
    appendFileSync(checkpoint, `${JSON.stringify(point)}\n`)
    const pct = Math.round(((i + 1) / commits.length) * 100)
    process.stdout.write(`\r${pct}% (${i + 1}/${commits.length}) ${commit.sha.slice(0, 7)} code=${totals.code}   `)
  }
  return points
}
