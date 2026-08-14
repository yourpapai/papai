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
import { strayAmong, strayPathsNotice } from './stray-paths.js'

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

/**
 * What an ordinary commit did, as three outcomes rather than a value and a null.
 *
 * The same argument {@link Salvage} makes, one function over. `StagedTotals |
 * null` gave a caller one bit and made `null` mean two opposite things: a turn
 * that wrote nothing, and a turn whose every written file the remote will not
 * take. Run 31779566286 is what the second costs when it is spelled as the
 * first — a correct CI diagnosis, written to `.github/workflows/`, dropped at
 * staging and reported as "nothing changed", twice, until `ciAttempts` ran out.
 *
 * `dropped` rides on **`committed`** as well, and that is the member most worth
 * having it on: a partial drop pushes real work, so every other signal the run
 * emits reads as success while part of the change is silently absent.
 *
 * `blocked` is not a failure. Nothing threw, the tree is exactly as
 * `stageAllowed` left it, and the remedy — apply it by hand, or grant the
 * permission — belongs to a maintainer rather than to a retry.
 */
export type CommitOutcome =
  | { kind: 'clean' }
  | { kind: 'blocked'; dropped: string[] }
  | { kind: 'committed'; totals: StagedTotals; dropped: string[] }

/**
 * The totals a caller wanting only the size needs, `null` when nothing was
 * committed. Keeps `changedLines`' one accumulation site from having to narrow
 * the union itself, without giving anyone back the ambiguity it replaced.
 */
export const committedTotals = (outcome: CommitOutcome): StagedTotals | null =>
  outcome.kind === 'committed' ? outcome.totals : null

/** Whatever a commit left undeliverable, on any of the three outcomes. */
export const droppedBy = (outcome: CommitOutcome): readonly string[] =>
  outcome.kind === 'clean' ? [] : outcome.dropped

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
 * Stages everything, then takes back out what does not belong in a commit.
 *
 * Two lists, and they answer different questions. `protected-paths.ts` is what a
 * push cannot **carry**: GitHub has already announced it will refuse a push that
 * touches `.github/workflows/` from a token without the `workflows` permission,
 * and a push is atomic, so a commit built around one such file cannot be
 * delivered at all. `stray-paths.ts` is what a commit is not **for**: a pid file
 * or a socket a probe left behind would push perfectly well, and is still not
 * the work a step was asked for. They are kept apart because a guardrail that
 * conflates "the remote refuses it" with "it is not a deliverable" is one nobody
 * can reason about when it fires.
 *
 * Both commit paths go through this, and the reason it is here rather than in
 * `diff-guard.ts` is what it does with the answer. The guard *judges* a change
 * set and refusing is a real outcome for it; this is not a judgement at all.
 * Refusing here would lose the same work the remote would have lost. Dropping
 * the file keeps the rest, which is the only outcome with anything in it.
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

/** One reason a set of staged paths is coming back out, with that set. */
interface Refusal {
  paths: string[]
  notice: string
}

/**
 * What may not be committed, grouped by why — each group in staged order.
 *
 * Grouped rather than merged into one list because the two notices say different
 * things and a maintainer reading the log has to know which fired: one says
 * "apply this by hand or grant the permission", the other says "this was never
 * work". A path that somehow matched both is reported once, under the reason
 * that would have stopped the push, since that is the one with a remedy.
 */
const refusals = (paths: readonly string[]): Refusal[] => {
  const cannotPush = protectedAmong(paths)
  const notWork = strayAmong(paths).filter((path) => !cannotPush.includes(path))

  return [
    ...(cannotPush.length === 0 ? [] : [{ paths: cannotPush, notice: protectedPathsNotice(cannotPush) }]),
    ...(notWork.length === 0 ? [] : [{ paths: notWork, notice: strayPathsNotice(notWork) }]),
  ]
}

const stageAllowed = async (gitOrThrow: GitFn, options: GitOptions): Promise<Staged> => {
  await gitOrThrow('add', '--all')

  const staged = parseNumstat((await gitOrThrow('diff', '--cached', '--numstat')).stdout)
  const refused = refusals(staged.map((file) => file.path))
  const blocked = refused.flatMap((refusal) => refusal.paths)
  if (blocked.length === 0) return { staged, dropped: [] }

  // `ls-tree` lists only the paths that exist in HEAD and says nothing about
  // the rest, so it partitions tracked from new without a second failing call.
  const tracked = stdoutLines((await gitOrThrow('ls-tree', '--name-only', 'HEAD', '--', ...blocked)).stdout)
  const added = blocked.filter((path) => !tracked.includes(path))

  await gitOrThrow('reset', '--', ...blocked)
  if (tracked.length > 0) await gitOrThrow('checkout', 'HEAD', '--', ...tracked)
  if (added.length > 0) await gitOrThrow('clean', '--force', '--', ...added)

  refused.forEach((refusal) => {
    options.log.warn({ dropped: refusal.paths }, refusal.notice)
  })
  return { staged: staged.filter((file) => !blocked.includes(file.path)), dropped: blocked }
}

export const stdoutLines = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

/** The commit itself, identity stamped, with whatever extra flags the path needs. */
export const commit = (
  gitOrThrow: GitFn,
  options: GitOptions,
  message: string,
  extra: readonly string[],
): Promise<unknown> =>
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

export const commitAll = async (gitOrThrow: GitFn, options: GitOptions, message: string): Promise<CommitOutcome> => {
  const status = await gitOrThrow('status', '--porcelain')
  if (status.stdout.trim().length === 0) return { kind: 'clean' }

  const { staged, dropped } = await stageAllowed(gitOrThrow, options)
  // Only when the drop is what emptied it: a `status`-dirty tree that stages no
  // measurable change is an existing shape, and it still commits as it did.
  if (staged.length === 0 && dropped.length > 0) return { kind: 'blocked', dropped }

  const totals = await guardStaged(gitOrThrow, options, staged)
  await commit(gitOrThrow, options, message, [])
  return { kind: 'committed', totals, dropped }
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
