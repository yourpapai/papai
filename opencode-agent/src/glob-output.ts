// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

/**
 * Where a **glob** artifact's files go — the one loose end in design D3's
 * "TypeScript owns the paths, the model owns the content" split.
 *
 * Every artifact of the `spec-driven` schema resolves to a file the drafter can
 * write, except one: `specs`, whose `resolvedOutputPath` is
 * `<changeDir>/specs/**\/*.md` — a **pattern**, because a change carries one
 * delta spec per capability and only the proposal knows how many that is. The
 * drafter wrote it verbatim and run 31664928683 died on
 * `ENOENT ... /specs/**\/*.md` at PLANNING, after paying for the model turn that
 * composed the content.
 *
 * So the path becomes something the drafter asks for and this module judges. The
 * judging is deliberately not a glob matcher: what protects the tree is
 * **containment** — the file must land under the directory the pattern collects
 * from — plus the extension the pattern admits, and a hand-rolled `**` matcher
 * would add a reimplementation of picomatch without adding a single refusal.
 * Every rejection is a sentence rather than a throw, because the drafter already
 * has a retry that re-asks with a complaint attached (the one `openspec validate
 * --strict` uses), and a bad path is exactly the kind of mistake a second ask
 * fixes.
 */

/** The characters that make a path segment a pattern rather than a name. */
const MAGIC = /[*?[\]]/u

/** Whether an artifact's resolved output path names a pattern, not a file. */
export const isGlobOutputPath = (pattern: string): boolean => MAGIC.test(pattern)

/**
 * The deepest directory the pattern is anchored to — everything up to the first
 * segment carrying a glob character (`<changeDir>/specs` for the `specs`
 * artifact). This is the boundary a drafted file may not escape.
 */
export const globStaticRoot = (pattern: string): string => {
  const segments = pattern.split('/')
  const magic = segments.findIndex((segment) => MAGIC.test(segment))
  return (magic === -1 ? segments.slice(0, -1) : segments.slice(0, magic)).join('/')
}

/**
 * What the drafter's paths are relative to.
 *
 * The change folder when the driver reported one, because that is how the
 * artifact instruction itself spells the path the model is being asked for
 * (`specs/<capability-path>/spec.md`) — an answer relative to anything else
 * would be the model reading two different rules. When `changeDir` is absent the
 * base is derived, and the pattern the drafter is shown is computed from
 * whichever base was chosen, so the fallback is the same contract re-anchored
 * rather than a second one.
 */
export const globOutputBase = (pattern: string, changeDir: string | undefined): string =>
  changeDir ?? path.dirname(globStaticRoot(pattern))

export type GlobOutputResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string }

/**
 * The literal tail of the pattern's last segment — `.md` for `*.md`, and empty
 * for a bare `*`, which admits anything.
 */
const literalSuffix = (pattern: string): string => {
  const last = pattern.split('/').at(-1) ?? ''
  return last.replace(/^.*[*?[\]]/u, '')
}

/**
 * Turns one drafter-chosen relative path into an absolute one, or says why it
 * cannot be used. The reason is written to be read by the model on the retry.
 */
export const resolveGlobOutput = (pattern: string, base: string, relative: string): GlobOutputResolution => {
  const candidate = relative.trim()
  if (candidate.length === 0) return { ok: false, reason: 'the file path is empty' }
  if (path.isAbsolute(candidate)) {
    return { ok: false, reason: `"${candidate}" is absolute; give a path relative to ${base}` }
  }

  const root = globStaticRoot(pattern)
  const resolved = path.resolve(base, candidate)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return { ok: false, reason: `"${candidate}" resolves outside ${root}, which is where ${pattern} collects files` }
  }

  const suffix = literalSuffix(pattern)
  if (suffix.length > 0 && !resolved.endsWith(suffix)) {
    return { ok: false, reason: `"${candidate}" does not end in "${suffix}", which ${pattern} requires` }
  }
  return { ok: true, path: resolved }
}
