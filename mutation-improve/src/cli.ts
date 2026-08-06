// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { runAgent } from '../../review-loop/src/agent-runner.js'
import { createShellExec, runBuildCheck } from '../../review-loop/src/build-checker.js'
import { LiveRenderer } from '../../review-loop/src/live-renderer.js'
import { realSpawn } from '../../review-loop/src/spawn.js'
import {
  createWorktree,
  execGit,
  mergeWorktree,
  removeWorktree,
  resetWorktree,
} from '../../review-loop/src/worktree.js'
import { readBaseline, writeBaseline } from './baseline.js'
import { type MutationImproveConfig, loadMutationImproveConfig } from './config.js'
import { assertIntegrationBranch, runFinalize } from './finalize.js'
import { type IterationResult, runPipeline, type PipelineDeps } from './pipeline.js'
import { ResultSchema } from './result-schema.js'
import { createRunState, loadRunState, saveRunState, type MutationImproveRunState } from './run-state.js'
import { measureMutationScore } from './score-reader.js'
import { SelectionSchema } from './selection-schema.js'

export interface CliArgs {
  configPath: string
  count?: number
  threshold?: number
  base?: string
  resumeRunId?: string
  resetWorktree: boolean
  noPr: boolean
}

export const DEFAULT_CONFIG_PATH = path.join(import.meta.dir, '..', 'config.json')

interface GhResult {
  exitCode: number
  stdout: string
  stderr: string
}

function readValueArg(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1]
  if (value === undefined) throw new Error(`Missing value for ${name}`)
  return value
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const flags: CliArgs = { configPath: DEFAULT_CONFIG_PATH, resetWorktree: false, noPr: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg === '--config') {
      flags.configPath = readValueArg(argv, i, '--config')
      i += 1
      continue
    }
    if (arg === '--count') {
      const v = Number(readValueArg(argv, i, '--count'))
      if (!Number.isInteger(v) || v < 1) throw new Error('--count must be a positive integer')
      flags.count = v
      i += 1
      continue
    }
    if (arg.startsWith('--threshold=')) {
      const threshold = Number(arg.slice('--threshold='.length))
      if (!Number.isFinite(threshold)) throw new Error('--threshold must be a finite number')
      flags.threshold = threshold
      continue
    }
    if (arg === '--base') {
      flags.base = readValueArg(argv, i, '--base')
      i += 1
      continue
    }
    if (arg === '--resume-run') {
      flags.resumeRunId = readValueArg(argv, i, '--resume-run')
      i += 1
      continue
    }
    if (arg === '--reset-worktree') {
      flags.resetWorktree = true
      continue
    }
    if (arg === '--no-pr') {
      flags.noPr = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return flags
}

function selectRunner(
  config: MutationImproveConfig,
  runState: MutationImproveRunState,
  log: LiveRenderer,
): PipelineDeps['runSelectAgent'] {
  return (worktreePath, prompt, outputPath) =>
    runAgent({
      spawn: realSpawn,
      model: config.agent.model,
      cwd: worktreePath,
      prompt,
      outputPath,
      outputSchema: SelectionSchema,
      label: 'select',
      logPath: path.join(runState.runDir, 'agent-output.log'),
      extraArgs: config.agent.extraArgs,
      reporter: log,
      timeoutMs: config.agent.timeoutMs,
    })
}

function improveRunner(
  config: MutationImproveConfig,
  runState: MutationImproveRunState,
  log: LiveRenderer,
): PipelineDeps['runImproveAgent'] {
  return (worktreePath, prompt, outputPath) =>
    runAgent({
      spawn: realSpawn,
      model: config.agent.model,
      cwd: worktreePath,
      prompt,
      outputPath,
      outputSchema: ResultSchema,
      label: 'improve',
      logPath: path.join(runState.runDir, 'agent-output.log'),
      extraArgs: config.agent.extraArgs,
      reporter: log,
      timeoutMs: config.agent.timeoutMs,
    })
}

function buildPipelineDeps(
  config: MutationImproveConfig,
  runState: MutationImproveRunState,
  log: LiveRenderer,
): PipelineDeps {
  return {
    config,
    runState,
    spawn: realSpawn,
    createWorktree,
    resetWorktree,
    removeWorktree,
    mergeWorktree,
    execGit,
    runBuildCheck: (worktreePath: string) => {
      const exec = createShellExec(worktreePath, config.checkCommand, config.buildTimeoutMs)
      return runBuildCheck({ exec: () => exec() })
    },
    measureScore: (worktreePath: string, srcFile: string) => {
      const exec = createShellExec(worktreePath, `${config.mutateFileCommand} ${srcFile}`, config.mutateTimeoutMs)
      return measureMutationScore({ exec: () => exec() }, path.join(worktreePath, 'reports', 'paired'), srcFile)
    },
    readBaseline,
    writeBaseline,
    runSelectAgent: selectRunner(config, runState, log),
    runImproveAgent: improveRunner(config, runState, log),
    saveRunState,
    log,
  }
}

async function runGh(ghArgs: readonly string[], cwd: string): Promise<GhResult> {
  const { execFile } = await import('node:child_process')
  return new Promise<GhResult>((resolve) => {
    execFile('gh', [...ghArgs], { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ exitCode: err === null ? 0 : 1, stdout, stderr })
    })
  })
}

// Sweeps stale iteration worktrees left over from a crashed/killed prior run
// (process death bypasses runIteration's try/catch cleanup, so `<runId>-iterN`
// worktrees and their `mutation-improve/<runId>-iterN` branches leak). Keyed by
// runId so concurrent runs sharing a repo are not disturbed — mirrors
// review-loop's cleanWorkerWorktrees, including the basename-only match (git
// resolves symlinks in `worktree list`, so a prefix check would miss entries
// under a `/var`-style tmp root). Removes sequentially because
// `git worktree remove`/`branch -D` take repo-wide locks and race under load.
export async function resetRunWorktrees(repoRoot: string, runId: string, branchPrefix: string): Promise<void> {
  const { stdout } = await execGit(repoRoot, ['worktree', 'list', '--porcelain'])
  const stale: string[] = []
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('worktree ')) continue
    const wtPath = line.slice('worktree '.length)
    if (path.basename(wtPath).startsWith(`${runId}-iter`)) stale.push(wtPath)
  }
  let chain: Promise<unknown> = Promise.resolve()
  for (const wtPath of stale) {
    chain = chain.then(() =>
      removeWorktree(repoRoot, wtPath, path.basename(wtPath), branchPrefix).catch(() => undefined),
    )
  }
  await chain
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseCliArgs(argv)
  const config = await loadMutationImproveConfig({ configPath: args.configPath })
  if (args.count !== undefined) config.count = args.count
  if (args.threshold !== undefined) config.threshold = args.threshold
  if (args.base !== undefined) config.base = args.base

  await assertIntegrationBranch(execGit, config.repoRoot, config.base)

  const runState: MutationImproveRunState =
    args.resumeRunId === undefined ? await createRunState(config) : await loadRunState(config.workDir, args.resumeRunId)

  if (args.resetWorktree) {
    await resetRunWorktrees(config.repoRoot, runState.runId, config.prBranchPrefix)
  }

  const log = new LiveRenderer(process.stdout)
  const deps = buildPipelineDeps(config, runState, log)
  // I1: try/finally guarantees saveRunState runs even if runPipeline throws
  // (e.g. AgentRunError mid-pipeline), so --resume-run sees the last-known
  // in-memory progress instead of losing everything to a throw.
  let results: IterationResult[] = []
  let aborted = false
  try {
    const pipelineOut = await runPipeline(deps)
    results = pipelineOut.results
    aborted = pipelineOut.aborted
  } finally {
    await saveRunState(runState)
  }

  const failed = results.filter((r) => r.outcome === 'failed')
  if (!args.noPr && runState.merged.length > 0 && !aborted) {
    await runFinalize({ execGit, runGh }, { config, runState })
  }
  if (failed.length > 0 || aborted) process.exitCode = 1
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
