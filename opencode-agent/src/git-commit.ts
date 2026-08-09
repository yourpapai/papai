// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { inspectSalvage, inspectStaged, measure, parseNumstat } from './diff-guard.js'
import type { StagedFile, StagedTotals } from './diff-guard.js'
import { diffGuardError } from './errors.js'
import type { GitOptions } from './git.js'
import { protectedAmong, protectedPathsNotice } from './protected-paths.js'
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
const guardStaged = async (
  gitOrThrow: GitFn,
  options: GitOptions,
  staged: readonly StagedFile[],
): Promise<StagedTotals> => {
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

/**
 * Stages everything, then takes back out whatever a push cannot carry.
 *
 * Both commit paths go through this, and the reason it is here rather than in
 * `diff-guard.ts` is what it does with the answer. The guard *judges* a change
 * set and refusing is a real outcome for it; this is not a judgement at all —
 * GitHub has already announced it will refuse a push that touches
 * `.github/workflows/` from a token without the `workflows` permission, and a
 * push is atomic, so a commit built around one such file cannot be delivered at
 * all. Refusing here would lose the same work the remote would have lost.
 * Dropping the file keeps the rest, which is the only outcome with anything in
 * it.
 *
 * The working-tree copy is reverted, not merely unstaged, and that is the part
 * that makes the guardrail stable rather than a loop. An unstaged edit is still
 * an edit: the next step's `git add --all` re-stages it, this drops it again,
 * and a plan whose every remaining step is blocked would stage nothing but
 * blocked files and hand `git commit` an empty index to fail on. A file not in
 * `HEAD` is removed instead of restored, since there is no version to restore.
 *
 * Reported at `warn` and never silently: from every caller's side this is a
 * commit that simply did not contain those files, and a guardrail nobody sees
 * fire reads as a model that failed to make the edit.
 *
 * Returns what is left staged *and* what was taken out, derived from the set it
 * just read rather than by asking git a second time — the two cannot disagree.
 * Both halves are needed to tell the two empty indexes apart: a turn that wrote
 * nothing was already handled by the `status` probe, while a turn that wrote
 * *only* a protected file has to reach the callers' "nothing to commit" branch
 * rather than `git commit`'s hard failure on an empty index.
 */
interface Staged {
  staged: StagedFile[]
  dropped: string[]
}

const stageAllowed = async (gitOrThrow: GitFn, options: GitOptions): Promise<Staged> => {
  await gitOrThrow('add', '--all')

  const staged = parseNumstat((await gitOrThrow('diff', '--cached', '--numstat')).stdout)
  const blocked = protectedAmong(staged.map((file) => file.path))
  if (blocked.length === 0) return { staged, dropped: [] }

  // `ls-tree` lists only the paths that exist in HEAD and says nothing about
  // the rest, so it partitions tracked from new without a second failing call.
  const tracked = stdoutLines((await gitOrThrow('ls-tree', '--name-only', 'HEAD', '--', ...blocked)).stdout)
  const added = blocked.filter((path) => !tracked.includes(path))

  await gitOrThrow('reset', '--', ...blocked)
  if (tracked.length > 0) await gitOrThrow('checkout', 'HEAD', '--', ...tracked)
  if (added.length > 0) await gitOrThrow('clean', '--force', '--', ...added)

  options.log.warn({ dropped: blocked }, protectedPathsNotice(blocked))
  return { staged: staged.filter((file) => !blocked.includes(file.path)), dropped: blocked }
}

const stdoutLines = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

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

  const { staged, dropped } = await stageAllowed(gitOrThrow, options)
  // Only when the drop is what emptied it: a `status`-dirty tree that stages no
  // measurable change is an existing shape, and it still commits as it did.
  if (staged.length === 0 && dropped.length > 0) return null

  const totals = await guardStaged(gitOrThrow, options, staged)
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

  const { staged, dropped } = await stageAllowed(gitOrThrow, options)
  if (staged.length === 0 && dropped.length > 0) return { kind: 'clean' }

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
