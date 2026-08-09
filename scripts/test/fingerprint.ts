// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

/**
 * Glob patterns whose files decide whether a recorded test run still describes
 * the working tree. Deliberately source-only: generated bundles and report
 * artifacts must not make a run look stale.
 */
export const FINGERPRINT_ROOTS: readonly string[] = [
  'src/**/*.ts',
  'client/**/*.{ts,svelte}',
  'plugins/**/*.ts',
  'tests/**/*.ts',
  'scripts/**/*.ts',
]

/**
 * Standalone files outside the globbed roots that still invalidate a run:
 * the test-runner config and the dependency manifests.
 */
export const FINGERPRINT_FILES: readonly string[] = ['bunfig.toml', 'package.json', 'bun.lock']

export interface FingerprintDeps {
  /** Yields repo-relative paths matching a glob pattern. */
  scan: (pattern: string) => Iterable<string>
  /** Stats a repo-relative path; `null` when it does not exist or is unreadable. */
  stat: (relPath: string) => { size: number; mtimeMs: number } | null
}

/**
 * Hashes size+mtime over the source roots into a 16-hex-char digest.
 *
 * Entries are sorted before hashing so the digest does not depend on directory
 * iteration order, and a path whose `stat` returns `null` (deleted between the
 * scan and the stat) is skipped rather than throwing — a fingerprint is a
 * staleness hint, never a gate.
 */
export function computeFingerprint(deps: FingerprintDeps): string {
  const paths = new Set<string>()
  for (const pattern of FINGERPRINT_ROOTS) {
    for (const relPath of deps.scan(pattern)) paths.add(relPath)
  }
  for (const relPath of FINGERPRINT_FILES) paths.add(relPath)

  const entries: string[] = []
  for (const relPath of paths) {
    const stat = deps.stat(relPath)
    if (stat === null) continue
    entries.push(`${relPath}\0${String(stat.size)}\0${String(stat.mtimeMs)}\n`)
  }
  entries.sort()

  const hasher = new Bun.CryptoHasher('sha256')
  for (const entry of entries) hasher.update(entry)
  return hasher.digest('hex').slice(0, 16)
}

/** Real filesystem deps rooted at `cwd`. The only place this module touches IO. */
export function defaultFingerprintDeps(cwd: string): FingerprintDeps {
  return {
    scan: (pattern: string): Iterable<string> =>
      new Bun.Glob(pattern).scanSync({ cwd, onlyFiles: true, followSymlinks: false }),
    stat: (relPath: string): { size: number; mtimeMs: number } | null => {
      try {
        const stat = fs.statSync(path.resolve(cwd, relPath))
        return { size: stat.size, mtimeMs: stat.mtimeMs }
      } catch {
        return null
      }
    },
  }
}
