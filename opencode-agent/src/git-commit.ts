// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { inspectSalvage, inspectStaged, measure, parseNumstat } from './diff-guard.js'
import type { StagedTotals } from './diff-guard.js'
import { diffGuardError } from './errors.js'
import type { GitOptions } from './git.js'
import type { CommandResult } from './shell.js'

/**
 * Staging a change set, judging it, and committing it — the two ways this
 * pipeline makes a commit.
 *
 * Split from `git.ts` when the salvage commit pushed that file past `max-lines`,
 * along a seam it already had: everything left there is about *addressing* a
 * repository — which branch, which remote, which credential, what the default
 * branch is — while this is about what a commit is allowed to contain. The two
 * change for different reasons, and the second is the one the diff guard, the
 * secrets list and the repository's own hooks all bear on.
 *
 * Both commits below run the guard. What differs is what the guard's verdict is
 * allowed to do, and that difference is deliberately visible in the return types
 * rather than hidden behind a flag.
 */

/**
 * What a salvage commit did, as three outcomes rather than a value and a throw.
 *
 * `clean` is not an error and must not be turned into one: a turn stopped before it
 * wrote anything is a legitimate thing to have happened, and the stop still parks
 * and still hands over. `refused` is the hard guard tripping, where the branch must
 * be left exactly as it was found. `committed` carries the count — including when
 * `overCap` says the count was over a ceiling this path only reports.
 */
export type Salvage =
  | { kind: 'clean' }
  | { kind: 'refused'; reason: string }
  | { kind: 'committed'; totals: StagedTotals; overCap: string | null }

/** One `git …` invocation that throws on a non-zero exit. */
export type GitFn = (...argv: readonly string[]) => Promise<CommandResult>

/**
 * Checks what `git add --all` actually staged, unstages it if the answer is
 * unacceptable, and reports the size of what it let through.
 *
 * Measured after staging rather than before: `--numstat` on the index lists
 * every file individually, including the untracked ones that
 * `status --porcelain` collapses into a single directory entry — which is
 * precisely how a whole `node_modules` reads as one line.
 *
 * The totals come from a second `measure` over the same array `inspectStaged`
 * judged, rather than from widening `DiffVerdict` to carry them: `measure` is a
 * fold over an array already in hand, so the two calls cannot disagree, and a
 * verdict that answered "yes, and here are the numbers" would make every caller
 * that only wants the yes narrow past them.
 */
const guardStaged = async (gitOrThrow: GitFn, options: GitOptions): Promise<StagedTotals> => {
  const staged = parseNumstat((await gitOrThrow('diff', '--cached', '--numstat')).stdout)
  const diff = (await gitOrThrow('diff', '--cached')).stdout

  const verdict = inspectStaged(staged, diff, options.limits, options.secrets)
  if (!verdict.ok) {
    // Leave the tree as it was found. A retry lands on a fresh runner in the
    // normal case, but a half-staged index is a poor thing to hand anyone.
    await gitOrThrow('reset')
    throw diffGuardError(verdict.reason)
  }

  const { files, lines } = measure(staged)
  return { files, lines }
}

/** The commit itself, identity stamped, with whatever extra flags the path needs. */
const commit = (gitOrThrow: GitFn, options: GitOptions, message: string, extra: readonly string[]): Promise<unknown> =>
  gitOrThrow(
    '-c',
    `user.name=${options.authorName}`,
    '-c',
    `user.email=${options.authorEmail}`,
    'commit',
    ...extra,
    '-m',
    message,
  )

export const commitAll = async (
  gitOrThrow: GitFn,
  options: GitOptions,
  message: string,
): Promise<StagedTotals | null> => {
  const status = await gitOrThrow('status', '--porcelain')
  if (status.stdout.trim().length === 0) return null

  await gitOrThrow('add', '--all')
  const totals = await guardStaged(gitOrThrow, options)
  await commit(gitOrThrow, options, message, [])
  return totals
}

/**
 * Commits whatever a stopped turn left behind, bypassing the repository's hooks.
 *
 * `--no-verify` is not an optimisation and not a preference — without it this
 * operation cannot work at all. `package.json`'s `prepare` copies
 * `scripts/pre-commit.sh` into `.git/hooks/pre-commit` on any install where `.git`
 * exists, the Actions runner included, and that hook runs `scripts/check.sh
 * --staged`: lint, typecheck, format:check and the licence-header scan over the
 * staged files. A tree with an unused import, an unformatted file or a half-typed
 * expression in it — exactly what being interrupted mid-edit produces — therefore
 * cannot be committed at all: `git commit` exits non-zero, the plain path throws
 * `GitError`, and the salvage loses everything it exists to keep. Verified by
 * staging a file with an unterminated expression and running the installed hook,
 * which failed all four checks.
 *
 * The guard still runs, and the split is {@link inspectSalvage}'s: a credential or
 * a binary refuses and pushes nothing, while the size caps only report.
 */
export const salvageAll = async (gitOrThrow: GitFn, options: GitOptions, message: string): Promise<Salvage> => {
  const status = await gitOrThrow('status', '--porcelain')
  if (status.stdout.trim().length === 0) return { kind: 'clean' }

  await gitOrThrow('add', '--all')
  const staged = parseNumstat((await gitOrThrow('diff', '--cached', '--numstat')).stdout)
  const verdict = inspectSalvage(staged, (await gitOrThrow('diff', '--cached')).stdout, options.limits, options.secrets)
  if (!verdict.ok) {
    // Leave the tree as it was found, for the reason `guardStaged` does.
    await gitOrThrow('reset')
    return { kind: 'refused', reason: verdict.reason }
  }

  await commit(gitOrThrow, options, message, ['--no-verify'])
  const { files, lines } = measure(staged)
  return { kind: 'committed', totals: { files, lines }, overCap: verdict.overCap }
}
