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

interface MergedRow {
  file: string
  beforeScore: number
  afterScore: number
  iter: number
  specPath?: string
  planPath?: string
}

interface FailedRow {
  iter: number
  gate: string
  reason: string
}

export function buildSummaryBody(merged: readonly MergedRow[], failed: readonly FailedRow[]): string {
  const rows = merged
    .map((m) => `| ${m.file} | ${m.beforeScore} | ${m.afterScore} | ${m.specPath ?? ''} | ${m.planPath ?? ''} |`)
    .join('\n')
  const header = '| File | Before | After | Spec | Plan |\n|---|---|---|---|---|\n'
  let body = `## mutation-improve\n\n${header}${rows}\n`
  if (failed.length > 0) {
    body += `\n## Failed iterations\n\n| Iter | Gate | Reason |\n|---|---|---|\n`
    body += failed.map((f) => `| ${f.iter} | ${f.gate} | ${f.reason} |`).join('\n')
  }
  return body
}

export async function runFinalize(deps: FinalizeDeps, input: FinalizeInput): Promise<FinalizeResult> {
  const { config, runState } = input
  await deps.execGit(config.repoRoot, ['push', config.upstream, config.base])
  const title = `mutation-improve: ${runState.merged.map((m) => m.file).join(', ')}`
  const body = buildSummaryBody(runState.merged, runState.failed)
  const result = await deps.runGh(
    ['pr', 'create', '--base', config.base, '--title', title, '--body', body],
    config.repoRoot,
  )
  if (result.exitCode !== 0) {
    const logPath = path.join(runState.runDir, 'finalize.log')
    await mkdir(path.dirname(logPath), { recursive: true })
    await appendFile(
      logPath,
      `gh pr create failed (exit ${result.exitCode}): ${result.stderr}\nRe-run: gh pr create --base ${config.base} --title ${JSON.stringify(title)} --body <body>\n`,
    )
    return { pushed: true }
  }
  return { pushed: true, prUrl: result.stdout.trim() || undefined }
}
