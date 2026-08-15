// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface DiffStats {
  added: number
  removed: number
}

export type ExecGitFn = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

export function parseNumstat(output: string): DiffStats {
  let added = 0
  let removed = 0
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const [a, r] = line.split('\t')
    const addN = Number(a)
    const remN = Number(r)
    if (Number.isFinite(addN)) added += addN
    if (Number.isFinite(remN)) removed += remN
  }
  return { added, removed }
}

/**
 * The same numstat `parseNumstat` reads, kept as a separate export rather than
 * a widened return: `mutation-improve` imports `parseNumstat`/`measureDiffSince`
 * and its `reportMergeDiff` swallows failures, so a changed shape there would
 * degrade silently instead of failing.
 *
 * Rename rows arrive as `src/{old.ts => new.ts}` or `old.ts => new.ts`; both
 * resolve to the destination, which is the file that exists afterwards.
 */
export function parseNumstatPaths(output: string): string[] {
  const paths: string[] = []
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const raw = line.split('\t')[2]
    if (raw === undefined || raw === '') continue
    const braced = raw.replace(/\{[^{}]*? => ([^{}]*?)\}/gu, '$1')
    const arrow = braced.split(' => ')
    paths.push((arrow[arrow.length - 1] ?? braced).trim())
  }
  return paths
}

/**
 * Whether a fix left a check behind, judged by the repository's own definition
 * of a test file rather than one private to the loop — `.hooks/tdd`'s pattern,
 * which is what actually gates implementation code here. A drift between the
 * two is pinned by a test.
 */
const TEST_PATH_PATTERN = /\.(?:test|spec)\.(?:ts|js|tsx|jsx)$/u

export function touchedTestPath(paths: readonly string[]): boolean {
  return paths.some((p) => TEST_PATH_PATTERN.test(p))
}

export async function headSha(execGit: ExecGitFn, cwd: string): Promise<string> {
  const { stdout } = await execGit(cwd, ['rev-parse', 'HEAD'])
  return stdout.trim()
}

export async function measureDiffPathsSince(execGit: ExecGitFn, cwd: string, beforeSha: string): Promise<string[]> {
  const { stdout } = await execGit(cwd, ['diff', '--numstat', `${beforeSha}..HEAD`])
  return parseNumstatPaths(stdout)
}

export async function measureDiffSince(execGit: ExecGitFn, cwd: string, beforeSha: string): Promise<DiffStats> {
  const { stdout } = await execGit(cwd, ['diff', '--numstat', `${beforeSha}..HEAD`])
  return parseNumstat(stdout)
}
