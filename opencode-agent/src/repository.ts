// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ConfigError } from './config.js'

/**
 * GitHub's own rules for each half of `owner/repo`. Owners are alphanumeric with
 * interior hyphens and cap at 39 characters; repositories also allow `.` and `_`
 * and cap at 100.
 */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u

/** Names `REPO_PATTERN` admits but a path segment must never carry. */
const RESERVED_REPO_NAMES: ReadonlySet<string> = new Set(['.', '..'])

const isRepoName = (candidate: string): boolean => REPO_PATTERN.test(candidate) && !RESERVED_REPO_NAMES.has(candidate)

/**
 * Parses `GITHUB_REPOSITORY` (`owner/repo`).
 *
 * Both halves are matched against GitHub's naming rules rather than merely
 * counted. Counting separators is a proxy for "well-formed" and admits plenty
 * that is not: `acme / widgets`, a value with the trailing newline a shell
 * heredoc leaves behind, `acme/widgets?x=1`. Each of those parses, then surfaces
 * far away as an opaque 404 from the REST API in the middle of a run — the same
 * argument `OPENAI_MODEL` is required for.
 *
 * The raw value is quoted with `JSON.stringify` so invisible characters, which
 * are the likeliest cause, are visible in the error.
 */
export const parseRepository = (raw: string): { owner: string; repo: string } => {
  const [owner, repo, ...extra] = raw.split('/')

  if (
    owner === undefined ||
    repo === undefined ||
    extra.length > 0 ||
    !OWNER_PATTERN.test(owner) ||
    !isRepoName(repo)
  ) {
    throw new ConfigError(
      `GITHUB_REPOSITORY must be "owner/repo" using GitHub's naming rules, got ${JSON.stringify(raw)}`,
    )
  }

  return { owner, repo }
}
