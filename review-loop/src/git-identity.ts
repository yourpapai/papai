// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Who the loop's own commits are made by.
 *
 * A laptop needs none of this: `git commit` reads `user.name` out of the
 * developer's `~/.gitconfig` and the loop inherits whoever they are. A hosted
 * runner has no such file, and what that costs is not a cosmetic byline — it is
 * the fix. `git commit` refuses outright with *Author identity unknown*, the
 * throw escapes `ensureFixerChangesCommitted`, and the issue is recorded as
 * `needs_human` with a page of git's advice pasted into the reasoning. Run
 * 31803380299 lost an accepted `high`-severity fix exactly that way.
 *
 * The identity is applied as environment rather than as `-c user.name=` on each
 * call, because the commits are not all made in one place. The loop commits a
 * fixer's changes, rebases a worker branch onto the primary, and merges it back
 * — a rebase writes committer lines too, and the fixer agent is itself a
 * subprocess free to run `git commit` of its own. Environment reaches every one
 * of them, including children this module has never heard of; a flag on one call
 * site reaches one call site.
 */

export interface CommitAuthor {
  name: string
  email: string
}

/** The four variables git reads for the two identities on every commit it writes. */
export const identityEnv = (author: CommitAuthor): Record<string, string> => ({
  GIT_AUTHOR_NAME: author.name,
  GIT_AUTHOR_EMAIL: author.email,
  GIT_COMMITTER_NAME: author.name,
  GIT_COMMITTER_EMAIL: author.email,
})

/**
 * Puts the configured identity into `env`, and answers whether there was one.
 *
 * Called once, at the top of a run, against `process.env` — so every git child
 * spawned afterwards inherits it. An identity already in the environment is
 * **overridden**: the config is the caller's explicit statement of who this run
 * commits as, and a value inherited from whatever launched it is a guess.
 *
 * With no identity configured nothing is touched at all, which is what keeps a
 * developer's own `user.name` in charge of a run on their machine.
 */
export const applyCommitIdentity = (
  author: CommitAuthor | undefined,
  env: Record<string, string | undefined>,
): boolean => {
  if (author === undefined) return false

  for (const [key, value] of Object.entries(identityEnv(author))) env[key] = value
  return true
}
