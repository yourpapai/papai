// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { buildBaselineFromPerFile, loadBaseline, seedMerge, writeBaseline } from './baseline.js'
import type { BaselineMap, PerFileScore } from './baseline.js'

/**
 * File name of the per-run scores snapshot written next to the paired Stryker
 * reports by the master seed run and consumed by {@link seedFromScores} when
 * the CI commit step must re-seed on top of a master that moved while mutation
 * testing was running.
 */
export const SCORES_FILE = 'scores.json'

const BASELINE_FILE = 'scripts/mutation/baseline.json'

type SeedFromCliArgs =
  | { readonly kind: 'ok'; readonly scoresPath: string; readonly freshBase: string | undefined }
  | { readonly kind: 'usageError'; readonly reason: string }

export interface SeedFromDeps {
  readonly runGit: (args: readonly string[]) => string
  readonly log: (message: string) => void
}

export interface SeedFromInput {
  readonly baselinePath: string
  readonly scoresPath: string
  readonly freshBase: string | undefined
  readonly deps: SeedFromDeps | undefined
}

type BunLike = {
  readonly argv: readonly string[]
  readonly main: string
}

const defaultDeps: SeedFromDeps = {
  runGit: (args) =>
    execFileSync('git', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  log: (message) => {
    console.log(message)
  },
}

export const parseSeedFromCliArgs = (argv: readonly string[]): SeedFromCliArgs => {
  const knownFlags = ['--scores=', '--fresh-base=']
  const unknownArg = argv.find((arg) => arg.startsWith('-') && !knownFlags.some((flag) => arg.startsWith(flag)))
  if (unknownArg !== undefined) return { kind: 'usageError', reason: `unknown argument ${unknownArg}` }
  const positionalArg = argv.find((arg) => !knownFlags.some((flag) => arg.startsWith(flag)))
  if (positionalArg !== undefined) {
    return { kind: 'usageError', reason: `unexpected positional argument ${positionalArg}` }
  }

  const scoresArgs = argv.filter((arg) => arg.startsWith('--scores='))
  if (scoresArgs.length > 1) return { kind: 'usageError', reason: 'scores must be provided at most once' }
  const freshBaseArgs = argv.filter((arg) => arg.startsWith('--fresh-base='))
  if (freshBaseArgs.length > 1) return { kind: 'usageError', reason: 'fresh-base must be provided at most once' }

  const scoresArg = scoresArgs[0]
  if (scoresArg === undefined) return { kind: 'usageError', reason: 'missing required argument --scores=PATH' }
  const scoresPath = scoresArg.slice('--scores='.length)
  if (scoresPath === '') return { kind: 'usageError', reason: 'scores must not be empty' }

  const freshBaseArg = freshBaseArgs[0]
  const freshBase = freshBaseArg === undefined ? undefined : freshBaseArg.slice('--fresh-base='.length)
  if (freshBase === '') return { kind: 'usageError', reason: 'fresh-base must not be empty' }

  return { kind: 'ok', scoresPath, freshBase }
}

/** Persist a run's per-file scores so a later re-seed can apply them without re-running Stryker. */
export const writeScoresFile = (scoresPath: string, perFile: readonly PerFileScore[]): void => {
  fs.mkdirSync(path.dirname(scoresPath), { recursive: true })
  writeBaseline(scoresPath, buildBaselineFromPerFile(perFile))
}

const loadScores = (scoresPath: string): BaselineMap => {
  const scores = loadBaseline(scoresPath)
  if (scores === null) {
    throw new Error(`Scores file ${scoresPath} does not exist; run the mutation seed step first`)
  }
  return scores
}

const excludeChangedSince = (scores: BaselineMap, freshBase: string, deps: SeedFromDeps): BaselineMap => {
  const output = deps.runGit(['diff', '--name-only', freshBase, 'HEAD'])
  const changed = new Set(
    output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  )
  const out: BaselineMap = {}
  const excluded: string[] = []
  for (const [sourceFile, score] of Object.entries(scores)) {
    if (changed.has(sourceFile)) excluded.push(sourceFile)
    else out[sourceFile] = score
  }
  if (excluded.length > 0) {
    deps.log(`Excluding stale scores for files changed since ${freshBase}: ${excluded.join(', ')}`)
  }
  return out
}

/**
 * Merge a persisted scores snapshot into the baseline via seedMerge (per-key
 * max, existing keys preserved). Because the merge is associative and
 * idempotent, callers can reset to a fresh master tip and re-apply the same
 * scores until the push succeeds without losing entries from concurrent seeds.
 * `freshBase` drops scores for files that changed on master since the run's
 * original checkout, so a score is never recorded for content master no longer
 * has. Returns the merged entry count.
 */
export const seedFromScores = (input: SeedFromInput): number => {
  const deps = input.deps ?? defaultDeps
  const scores = loadScores(input.scoresPath)
  const filtered = input.freshBase === undefined ? scores : excludeChangedSince(scores, input.freshBase, deps)
  const existing = loadBaseline(input.baselinePath) ?? {}
  const merged = seedMerge(existing, filtered)
  writeBaseline(input.baselinePath, merged)
  return Object.keys(merged).length
}

const main = (bun: BunLike): number => {
  const parsed = parseSeedFromCliArgs(bun.argv.slice(2))
  if (parsed.kind === 'usageError') {
    console.error(parsed.reason)
    console.error('Usage: bun scripts/mutation/seed-from.ts --scores=PATH [--fresh-base=SHA]')
    return 2
  }

  const projectRoot = process.cwd()
  const count = seedFromScores({
    baselinePath: path.join(projectRoot, BASELINE_FILE),
    scoresPath: path.resolve(projectRoot, parsed.scoresPath),
    freshBase: parsed.freshBase,
    deps: undefined,
  })
  console.log(`Seeded baseline from ${parsed.scoresPath} (${count} files)`)
  return 0
}

const maybeBun = (globalThis as typeof globalThis & { readonly Bun: BunLike | undefined }).Bun
if (maybeBun !== undefined && import.meta.path === maybeBun.main) {
  process.exit(main(maybeBun))
}

/**
 * Seed the baseline from a changed-files run, PRESERVING existing entries for
 * files that were not re-measured (unlike a full-run ratchet). Used by the
 * master seed command (`--update-baseline`): measures only changed files but
 * must not erase the rest of the baseline. Returns the resulting entry count.
 */
export const seedBaseline = (baselinePath: string, perFile: readonly PerFileScore[]): number => {
  const existing = loadBaseline(baselinePath) ?? {}
  const latest = buildBaselineFromPerFile(perFile)
  const merged = seedMerge(existing, latest)
  writeBaseline(baselinePath, merged)
  return Object.keys(merged).length
}

/**
 * Master seed flow: ratchet the baseline from the run's per-file scores and
 * persist those scores next to the paired reports. The CI commit step replays
 * the scores file onto a fresh master tip whenever the initial push races a
 * concurrent master update, so the Stryker run never has to be repeated.
 * Always writes the scores file even when `perFile` is empty (a seed run that
 * measured no targets), so the re-seed step always has an artifact to read.
 * Returns the seeded baseline entry count.
 */
export const runUpdateBaseline = (input: {
  readonly baselinePath: string
  readonly reportDir: string
  readonly perFile: readonly PerFileScore[]
}): number => {
  const count = seedBaseline(input.baselinePath, input.perFile)
  writeScoresFile(path.join(input.reportDir, SCORES_FILE), input.perFile)
  return count
}
