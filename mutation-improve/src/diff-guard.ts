// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const ALLOWED_PREFIXES = ['tests/', 'docs/superpowers/']

export type ExecGitFn = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

export function classifyDiff(paths: readonly string[]): { allowed: string[]; violations: string[] } {
  const allowed: string[] = []
  const violations: string[] = []
  for (const p of paths) {
    if (ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix))) allowed.push(p)
    else violations.push(p)
  }
  return { allowed, violations }
}

export async function runDiffGuard(
  execGit: ExecGitFn,
  cwd: string,
): Promise<{ ok: true } | { ok: false; violations: string[] }> {
  const { stdout } = await execGit(cwd, ['diff', '--name-only', 'HEAD'])
  const paths = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const { violations } = classifyDiff(paths)
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
