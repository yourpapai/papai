// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const ALLOWED_PREFIXES = ['tests/', 'openspec/changes/']

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

function unquote(p: string): string {
  return p.replace(/^"|"$/gu, '')
}

// Porcelain v1 rename/copy entries look like `R  orig -> new` (each side
// quoted independently when it contains special chars). Only R/C statuses use
// the arrow form, so the status check prevents mis-splitting a quoted path
// that merely contains ' -> '.
export function parsePorcelainPaths(line: string): string[] {
  const status = line.slice(0, 2)
  const body = line.slice(3).trim()
  if (!status.includes('R') && !status.includes('C')) return [unquote(body)]
  const arrowIdx = body.indexOf(' -> ')
  if (arrowIdx === -1) return [unquote(body)]
  return [unquote(body.slice(0, arrowIdx)), unquote(body.slice(arrowIdx + 4))]
}

export async function runDiffGuard(
  execGit: ExecGitFn,
  cwd: string,
): Promise<{ ok: true } | { ok: false; violations: string[] }> {
  const { stdout } = await execGit(cwd, ['status', '--porcelain', '--untracked-files=all'])
  const paths = stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap(parsePorcelainPaths)
    .filter((p) => p.length > 0)
  const { violations } = classifyDiff(paths)
  return violations.length === 0 ? { ok: true } : { ok: false, violations }
}
