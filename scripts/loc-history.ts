#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

/**
 * Project growth report: runs `tokei -C` over src/, plugins/ and client/ for
 * every commit reachable from master inside a temporary git worktree, then
 * writes an interactive HTML chart plus the raw data points under reports/.
 *
 * Usage:
 *   bun scripts/loc-history.ts [options]
 *
 * Options:
 *   --base=<refs>    comma-separated refs to walk (default: master); use e.g.
 *                    --base=v6.8.0,master to stitch the pre-reseed history
 *                    (rooted at the original "Initial commit") with master
 *   --out=<file>     HTML output (default: reports/loc-history.html)
 *   --json=<file>    raw data dump (default: reports/loc-history.json)
 *   --since=<date>   only commits after this date
 *   --sample=<n>     plot n evenly spaced commits instead of all
 *   --max=<n>        only the first n commits (oldest first)
 *   --resume         reuse the <json>.partial.jsonl checkpoint after an aborted run
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { renderHtml } from './loc-history/chart-html.js'
import { collectPoints, loadPartial, partialPath, selectCommits } from './loc-history/collect.js'
import type { Commit, Point } from './loc-history/collect.js'

interface Options {
  base: string
  out: string
  jsonOut: string
  since?: string
  sample?: number
  max?: number
  resume: boolean
}

const SEP = '\u001f'
const MAX_BUFFER = 128 * 1024 * 1024

function sh(cmd: string, args: string[], cwd?: string): string {
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER })
  if (res.status !== 0) {
    const reason = res.stderr.trim() || String(res.error)
    throw new Error(`\`${cmd} ${args.join(' ')}\` failed: ${reason}`)
  }
  return res.stdout
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { base: 'master', out: 'reports/loc-history.html', jsonOut: '', resume: false }
  for (const arg of argv) {
    const match = /^--([a-z]+)(?:=(.*))?$/u.exec(arg)
    if (match === null) throw new Error(`unexpected argument: ${arg}`)
    const key = match[1]
    if (key === undefined || key === '') throw new Error(`unexpected argument: ${arg}`)
    const value = match[2] ?? ''
    switch (key) {
      case 'base':
        opts.base = value
        break
      case 'out':
        opts.out = value
        break
      case 'json':
        opts.jsonOut = value
        break
      case 'since':
        opts.since = value
        break
      case 'sample':
        opts.sample = Number(value)
        break
      case 'max':
        opts.max = Number(value)
        break
      case 'resume':
        opts.resume = true
        break
      default:
        throw new Error(`unknown option: ${arg}`)
    }
  }
  if (opts.jsonOut === '') opts.jsonOut = opts.out.replace(/\.html$/u, '.json')
  return opts
}

function listCommits(base: string, since?: string): Commit[] {
  const format = `%H${SEP}%T${SEP}%at${SEP}%s`
  const refs = base
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
  const args = ['log', '--reverse', '--date-order', `--format=${format}`, ...refs]
  if (since !== undefined && since !== '') args.push(`--since=${since}`)
  return sh('git', args)
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, tree, date, subject] = line.split(SEP)
      return { sha: sha ?? '', tree: tree ?? '', date: Number(date), subject: subject ?? '' }
    })
}

function writeOutputs(points: Point[], opts: Options, allCount: number, tokeiVersion: string): void {
  mkdirSync(join(opts.out, '..'), { recursive: true })
  writeFileSync(opts.jsonOut, `${JSON.stringify(points, null, 2)}\n`)
  writeFileSync(
    opts.out,
    renderHtml(points, {
      repo: basename(process.cwd()),
      base: opts.base,
      plotted: String(points.length),
      totalCommits: String(allCount),
      tokeiVersion: tokeiVersion ?? 'unknown',
      generatedAt: new Date().toISOString(),
    }),
  )
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const tokeiVersion = sh('tokei', ['--version']).trim().split(' ')[1] ?? 'unknown'
  const allCommits = listCommits(opts.base, opts.since)
  if (allCommits.length === 0) throw new Error(`no commits found for ref: ${opts.base}`)
  const commits = selectCommits(allCommits, opts.max, opts.sample)
  if (commits.length === 0) throw new Error('commit list is empty')
  const first = commits[0]
  if (first === undefined) throw new Error('commit list is empty')
  const startedAt = Date.now()
  const checkpoint = partialPath(opts.jsonOut)
  const resumed = opts.resume ? loadPartial(checkpoint) : []
  const done = new Set(resumed.map((p) => p.sha))
  if (resumed.length > 0) console.log(`resuming: ${resumed.length} commits already measured`)
  const tmpDir = mkdtempSync(join(tmpdir(), 'papai-loc-history-'))
  const wtPath = join(tmpDir, 'wt')
  sh('git', ['worktree', 'add', '--detach', wtPath, first.sha])
  let points: Point[] = []
  try {
    points = collectPoints(commits, wtPath, checkpoint, done)
  } finally {
    process.stdout.write('\n')
    try {
      sh('git', ['worktree', 'remove', '--force', wtPath])
    } catch (error: unknown) {
      console.error(`warn: failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`)
    }
    rmSync(tmpDir, { recursive: true, force: true })
  }
  writeOutputs([...resumed, ...points], opts, allCommits.length, tokeiVersion)
  rmSync(checkpoint, { force: true })
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`done in ${seconds}s — chart: ${opts.out}, data: ${opts.jsonOut}`)
}

try {
  main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
