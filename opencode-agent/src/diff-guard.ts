// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * What a staged change set is allowed to look like.
 *
 * `git add --all` stages everything untracked and not gitignored, which is
 * whatever the model happened to leave behind: a `.env` written while debugging,
 * a downloaded fixture, a `node_modules` the repo never ignored. All three land
 * in a public pull request, and the credential among them lands in git history,
 * where deleting the file does not remove it.
 */
export interface DiffLimits {
  maxFiles: number
  maxLines: number
}

export interface StagedFile {
  path: string
  /** `null` for a binary file, which `--numstat` reports as `-`. */
  lines: number | null
}

export type DiffVerdict = { ok: true } | { ok: false; reason: string }

/**
 * Parses `git diff --cached --numstat`.
 *
 * A rename is reported as `a\td\told => new` (or with a `{x => y}` brace form
 * inside a shared prefix). Only the trailing path is kept: the guard cares which
 * files a commit would carry, and after a rename that is the destination.
 */
export const parseNumstat = (stdout: string): StagedFile[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [added, deleted, ...rest] = line.split('\t')
      const path = rest.join('\t')
      if (added === undefined || deleted === undefined || path.length === 0) return []
      return [{ path: renameTarget(path), lines: countOf(added, deleted) }]
    })

const countOf = (added: string, deleted: string): number | null => {
  // `-` on both sides is git's marker for a binary file: real content, no
  // measurable lines. Counting it as zero would let an arbitrarily large blob
  // through a line cap, so it is reported as unmeasurable instead.
  if (added === '-' || deleted === '-') return null
  const total = Number.parseInt(added, 10) + Number.parseInt(deleted, 10)
  return Number.isSafeInteger(total) ? total : null
}

const BRACE_RENAME = /\{.*? => (?<target>.*?)\}/u

const renameTarget = (path: string): string => {
  const braced = BRACE_RENAME.exec(path)
  if (braced?.groups?.['target'] !== undefined) {
    return path.replace(BRACE_RENAME, braced.groups['target']).replaceAll('//', '/')
  }
  const arrow = path.indexOf(' => ')
  return arrow === -1 ? path : path.slice(arrow + 4)
}

/**
 * The size of a commit, as the guard measured the index that became it.
 *
 * Named and exported because it outlives the guard: `commitAll` hands it back,
 * the implementation phase records `lines` in the state block, and the delivery
 * comment sizes its `/review` recommendation against it. `binaries` is
 * deliberately not part of it — a commit that gets past {@link inspectStaged}
 * has none, so the list is a working detail of judging a change set rather than
 * a fact about one that was made.
 */
export interface StagedTotals {
  files: number
  lines: number
}

/** The number of files a commit would carry, and the lines it would change. */
export const measure = (files: readonly StagedFile[]): StagedTotals & { binaries: string[] } => ({
  files: files.length,
  lines: files.reduce((total, file) => total + (file.lines ?? 0), 0),
  binaries: files.filter((file) => file.lines === null).map((file) => file.path),
})

const list = (paths: readonly string[], limit = 10): string =>
  paths.length <= limit ? paths.join(', ') : `${paths.slice(0, limit).join(', ')} … and ${paths.length - limit} more`

/**
 * Judges a staged change set.
 *
 * The secret check is by **value**, not by filename. A deny-list of names
 * (`.env`, `*.pem`) only catches the files someone thought of; the thing that
 * must not be committed is the credential, whatever the file is called — and
 * this pipeline knows exactly which values those are.
 */
export const inspectStaged = (
  files: readonly StagedFile[],
  diff: string,
  limits: DiffLimits,
  secrets: readonly string[],
): DiffVerdict => {
  const leaked = secrets.filter((secret) => secret.length > 0 && diff.includes(secret))
  if (leaked.length > 0) {
    // Never name the value, only the fact.
    return { ok: false, reason: `the staged changes contain ${leaked.length} of this pipeline's own credentials` }
  }

  const { files: count, lines, binaries } = measure(files)
  if (count > limits.maxFiles) {
    return { ok: false, reason: `${count} files changed, over the limit of ${limits.maxFiles}: ${list(paths(files))}` }
  }
  if (lines > limits.maxLines) {
    return { ok: false, reason: `${lines} lines changed, over the limit of ${limits.maxLines}` }
  }
  if (binaries.length > 0) {
    return { ok: false, reason: `binary files cannot be size-checked and are not committed: ${list(binaries)}` }
  }

  return { ok: true }
}

const paths = (files: readonly StagedFile[]): string[] => files.map((file) => file.path)
