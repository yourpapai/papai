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

export async function headSha(execGit: ExecGitFn, cwd: string): Promise<string> {
  const { stdout } = await execGit(cwd, ['rev-parse', 'HEAD'])
  return stdout.trim()
}

export async function measureDiffSince(execGit: ExecGitFn, cwd: string, beforeSha: string): Promise<DiffStats> {
  const { stdout } = await execGit(cwd, ['diff', '--numstat', `${beforeSha}..HEAD`])
  return parseNumstat(stdout)
}
