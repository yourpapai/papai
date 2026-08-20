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
  const unacceptable = neverCommittable(files, diff, secrets)
  if (unacceptable !== null) return { ok: false, reason: unacceptable }

  const oversized = overSize(files, limits)
  return oversized === null ? { ok: true } : { ok: false, reason: oversized }
}

/**
 * The two refusals that are about **what** a change set contains, and that no
 * deadline makes acceptable.
 *
 * A credential is in git history whether or not the file carrying it is later
 * deleted, and a binary is a blob no line count can size — so both stay absolute
 * on every path, including the salvage. Split out from the size caps for exactly
 * that reason: {@link inspectSalvage} keeps these and relaxes those, and a shared
 * predicate is what stops the two lists drifting into a salvage that quietly
 * permits one of these.
 *
 * Checked before the caps, so a leak is never masked by a size complaint.
 */
const neverCommittable = (files: readonly StagedFile[], diff: string, secrets: readonly string[]): string | null => {
  const leaked = secrets.filter((secret) => secret.length > 0 && diff.includes(secret))
  // Never name the value, only the fact.
  if (leaked.length > 0) return `the staged changes contain ${leaked.length} of this pipeline's own credentials`

  const { binaries } = measure(files)
  if (binaries.length > 0) return `binary files cannot be size-checked and are not committed: ${list(binaries)}`

  return null
}

/** The two ceilings that exist to refuse a runaway `git add --all`. */
const overSize = (files: readonly StagedFile[], limits: DiffLimits): string | null => {
  const { files: count, lines } = measure(files)
  if (count > limits.maxFiles)
    return `${count} files changed, over the limit of ${limits.maxFiles}: ${list(paths(files))}`
  if (lines > limits.maxLines) return `${lines} lines changed, over the limit of ${limits.maxLines}`

  return null
}

/**
 * The same judgement for a tree a wall-clock stop is trying to keep, where the
 * caps **report** instead of refusing.
 *
 * The caps exist to turn down a runaway `git add --all` — a staged `node_modules`,
 * a downloaded fixture, a build directory. On a partial tree they can also refuse
 * for a reason that has nothing to do with a runaway, and discarding a real
 * 3,000-line increment because the cap says 2,000 recreates the exact loss the
 * salvage exists to prevent. So the figure rides out on {@link StagedTotals} and
 * the notice says it was over the ceiling, which is the honest version of both.
 *
 * A deliberate widening of what a commit may look like, and therefore scoped to
 * this one path and no other: `inspectStaged` is unchanged, and the secret and
 * binary refusals are shared rather than re-stated so the widening cannot spread
 * to them by omission.
 */
export type SalvageVerdict = { ok: true; overCap: string | null } | { ok: false; reason: string }

export const inspectSalvage = (
  files: readonly StagedFile[],
  diff: string,
  limits: DiffLimits,
  secrets: readonly string[],
): SalvageVerdict => {
  const unacceptable = neverCommittable(files, diff, secrets)
  if (unacceptable !== null) return { ok: false, reason: unacceptable }

  return { ok: true, overCap: overSize(files, limits) }
}

const paths = (files: readonly StagedFile[]): string[] => files.map((file) => file.path)

/**
 * Design D8 — which staged paths fall **outside** the change folder a turn was
 * granted write access to.
 *
 * Planner/spec turns are scoped to `openspec/changes/<change-name>/`: the
 * confined commit path refuses anything this returns, the same shape
 * sdd-runner's guard takes. A path is under the prefix only when the prefix
 * ends on a segment boundary, so a sibling change (`add-x` vs `add-xtras`) is
 * correctly outside. The prefix is normalised with a trailing slash so callers
 * may spell it either way.
 */
export const outsidePrefix = (staged: readonly string[], prefix: string): string[] => {
  const root = prefix.endsWith('/') ? prefix : `${prefix}/`
  return staged.filter((path) => !path.startsWith(root))
}
