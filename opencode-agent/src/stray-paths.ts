// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Files a *process* left behind, which are never the work a step was asked for.
 *
 * `git add --all` stages whatever the model happened to leave in the tree, and a
 * phase that verifies its work by running something — a server, a probe, a
 * fixture — leaves the runtime's own bookkeeping beside it. Issue #239 delivered
 * a pull request whose entire diff was `serve3.pid`, one line, the process id of
 * the third `opencode serve` an experiment had started: the turn that was going
 * to write the actual document died before it wrote it, and the only dirty path
 * left in the tree was the pid file.
 *
 * That is worse than committing nothing, and not because of the file. The phase
 * asks exactly one question about an implementation that produced no work —
 * `noChangesError` fires when a walk committed **nothing at all** — and a single
 * stray artefact answers it in the affirmative. So a run with no deliverable
 * reported a delivery, opened a pull request, and closed the loop on the issue.
 * Dropping these at staging is what puts that question back in reach.
 *
 * Deliberately a *different* list from `protected-paths.ts`, which is about what
 * a remote will refuse to accept. This is about what a commit is *for*: nothing
 * here would be rejected by anything, it simply is not work. Keeping them apart
 * means neither list can grow the other's justification — "the remote refuses
 * it" and "it is not a deliverable" answer different questions, and a guardrail
 * that conflates them is one nobody can reason about when it fires.
 *
 * The list is short on purpose and should stay short. A suffix here is a claim
 * that **no repository this pipeline works on** would ever version such a file,
 * which is a strong claim and is only true of a runtime's own scratch. Anything
 * a project might legitimately track — a log fixture, a recorded socket
 * transcript — belongs in that project's `.gitignore`, where a maintainer can
 * see it and override it, and not in a guardrail they cannot.
 */

/**
 * Suffixes of files that are a running process's bookkeeping.
 *
 * `.pid` and `.sock` are what a daemon writes to say where it is; both are
 * meaningless the moment the process that wrote them exits, which on an Actions
 * runner is before anybody could read them. `nohup.out` is matched whole rather
 * than by suffix — it is a fixed name, and `.out` is a build artefact extension
 * far too broad to claim.
 */
export const STRAY_SUFFIXES: readonly string[] = ['.pid', '.sock']

/** Basenames that are a stray whatever directory they were dropped in. */
export const STRAY_NAMES: readonly string[] = ['nohup.out']

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Whether one staged path is a process artefact rather than work. */
export const isStrayPath = (path: string): boolean => {
  const name = basename(path)
  // A dotfile named exactly `.pid` is a file called `.pid`, not a pid file with
  // an empty name — and it is the kind of thing a project might well track.
  if (STRAY_NAMES.includes(name)) return true
  return STRAY_SUFFIXES.some((suffix) => name.length > suffix.length && name.endsWith(suffix))
}

/**
 * The strays among a staged set, in the order they were staged.
 *
 * Takes plain strings for the reason `protectedAmong` does: the diff guard judges
 * what a change set *contains* and these two say what may not be in one at all,
 * and a shared type would be the first step towards a shared verdict.
 */
export const strayAmong = (paths: readonly string[]): string[] => paths.filter(isStrayPath)

/** What the log is told when a staged change set carried some. */
export const strayPathsNotice = (dropped: readonly string[]): string =>
  `Dropped ${dropped.length} file(s) a running process left behind: ${dropped.join(', ')}. ` +
  'These are not the work a step was asked for, and committing one is how a run with no deliverable ' +
  'passes for a run with a small one. Everything else is kept.'
