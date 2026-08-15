// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import type { MutationImproveConfig } from './config.js'
import type { MutationImproveRunState } from './run-state.js'

export interface ExecGitFn {
  (cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }>
}

export interface RunGhFn {
  (args: readonly string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

export interface FinalizeDeps {
  execGit: ExecGitFn
  runGh: RunGhFn
}

export interface FinalizeInput {
  config: MutationImproveConfig
  runState: MutationImproveRunState
}

export interface FinalizeResult {
  prUrl?: string
  pushed: boolean
}

interface MergedResidual {
  loc: string
  why: string
  mutantIds?: readonly string[]
}

interface MergedRow {
  file: string
  beforeScore: number
  afterScore: number
  iter: number
  residuals?: readonly MergedResidual[]
  /** Carried by rows stored before the runner stopped mandating documents; not rendered. */
  specPath?: string
  planPath?: string
}

interface FailedRow {
  iter: number
  gate: string
  reason: string
}

export function buildSummaryBody(merged: readonly MergedRow[], failed: readonly FailedRow[]): string {
  // Residuals rather than two document links. That array is the one the runner
  // set-matched against its own surviving mutant ids, so a reader sees the
  // checked answer for why a file was accepted below target — where the links
  // pointed at prose no gate ever read.
  const rows = merged
    .map((m) => {
      const residuals = m.residuals ?? []
      const why = residuals.length === 0 ? '—' : residuals.map((r) => `${r.loc}: ${r.why}`).join('; ')
      return `| ${m.file} | ${m.beforeScore} | ${m.afterScore} | ${residuals.length} | ${why} |`
    })
    .join('\n')
  const header = '| File | Before | After | Residuals | Accepted because |\n|---|---|---|---|---|\n'
  let body = `## mutation-improve\n\n${header}${rows}\n`
  if (failed.length > 0) {
    body += `\n## Failed iterations\n\n| Iter | Gate | Reason |\n|---|---|---|\n`
    body += failed.map((f) => `| ${f.iter} | ${f.gate} | ${f.reason} |`).join('\n')
  }
  return body
}

export async function runFinalize(deps: FinalizeDeps, input: FinalizeInput): Promise<FinalizeResult> {
  const { config, runState } = input
  const { stdout } = await deps.execGit(config.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = stdout.trim()
  await deps.execGit(config.repoRoot, ['push', config.upstream, branch])
  const title = `mutation-improve: ${runState.merged.map((m) => m.file).join(', ')}`
  const body = buildSummaryBody(runState.merged, runState.failed)
  const result = await deps.runGh(
    ['pr', 'create', '--base', config.base, '--head', branch, '--title', title, '--body', body],
    config.repoRoot,
  )
  if (result.exitCode !== 0) {
    const logPath = path.join(runState.runDir, 'finalize.log')
    await mkdir(path.dirname(logPath), { recursive: true })
    await appendFile(
      logPath,
      `gh pr create failed (exit ${result.exitCode}): ${result.stderr}\nRe-run: gh pr create --base ${config.base} --head ${branch} --title ${JSON.stringify(title)} --body <body>\n`,
    )
    return { pushed: true }
  }
  return { pushed: true, prUrl: result.stdout.trim() || undefined }
}

// Iterations merge into whatever branch repoRoot is checked out on. Starting
// a run on base (or a detached HEAD) would merge+push straight onto base with
// no PR, so refuse before any run state is created.
export async function assertIntegrationBranch(execGit: ExecGitFn, repoRoot: string, base: string): Promise<void> {
  const { stdout } = await execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = stdout.trim()
  if (branch === base || branch === 'HEAD') {
    throw new Error(
      `mutation-improve merges iterations into the checked-out branch, but repoRoot is on '${branch}'. Check out a non-base integration branch first (base: ${base}).`,
    )
  }
}
