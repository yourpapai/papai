// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from './agent-runner.js'
import { createShellExec } from './build-checker.js'
import { loadReviewLoopConfig } from './config.js'
import { createIssueLedger, loadIssueLedger, type IssueLedger } from './issue-ledger.js'
import { LiveRenderer } from './live-renderer.js'
import { runReviewLoop } from './loop-controller.js'
import { createRunState, loadRunState, type RunState } from './run-state.js'
import { formatSummary } from './summary.js'
import { createWorktree, mergeWorktree, removeWorktree, worktreeExists } from './worktree.js'

export interface CliArgs {
  configPath: string
  planPath: string
  repoRoot: string
  resumeRunId?: string
}

const DEFAULT_CONFIG_PATH = path.join(import.meta.dir, '..', 'config.json')

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let configPath = DEFAULT_CONFIG_PATH
  let planPath: string | undefined
  let repoRoot = '.'
  let resumeRunId: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config') {
      const value = argv[index + 1]
      if (value === undefined) {
        throw new Error('Missing value for --config')
      }
      configPath = value
      index += 1
      continue
    }
    if (arg === '--plan') {
      planPath = argv[index + 1]
      if (planPath === undefined) {
        throw new Error('Missing value for --plan')
      }
      index += 1
      continue
    }
    if (arg === '--repo') {
      const value = argv[index + 1]
      if (value === undefined) {
        throw new Error('Missing value for --repo')
      }
      repoRoot = value
      index += 1
      continue
    }
    if (arg === '--resume-run') {
      resumeRunId = argv[index + 1]
      if (resumeRunId === undefined) {
        throw new Error('Missing value for --resume-run')
      }
      index += 1
    }
  }

  if (planPath === undefined) {
    throw new Error('Missing required --plan')
  }

  return { configPath, planPath, repoRoot, resumeRunId }
}

const realSpawn: SpawnFn = (command, args, options, onLine): Promise<SpawnResult> => {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let pending = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      pending += text
      let newlineIndex = pending.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = pending.slice(0, newlineIndex)
        pending = pending.slice(newlineIndex + 1)
        newlineIndex = pending.indexOf('\n')
        if (line.length > 0) {
          onLine?.(line)
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', () => {
      resolve({ exitCode: 1, stdout, stderr })
    })
    child.on('close', (code) => {
      if (pending.length > 0) {
        onLine?.(pending)
      }
      resolve({ exitCode: code ?? 0, stdout, stderr })
    })
  })
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseCliArgs(argv)
  const config = await loadReviewLoopConfig({
    configPath: args.configPath,
    repoRoot: args.repoRoot,
  })

  const runState: RunState =
    args.resumeRunId === undefined
      ? await createRunState(config, args.planPath)
      : await loadRunState(config.workDir, args.resumeRunId)

  const ledger: IssueLedger =
    args.resumeRunId === undefined ? await createIssueLedger(runState.runDir) : await loadIssueLedger(runState.runDir)

  if (!worktreeExists(runState.worktreePath)) {
    await createWorktree(config.repoRoot, runState.worktreePath, runState.runId)
  }

  const log = new LiveRenderer(process.stdout)
  const exec = createShellExec(runState.worktreePath, config.checkCommand)

  try {
    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: realSpawn,
      exec,
      log,
    })

    const summary = formatSummary(result)
    await writeFile(path.join(runState.runDir, 'summary.txt'), `${summary}\n`)
    console.log(summary)

    await mergeWorktree(config.repoRoot, `review-loop/${runState.runId}`)
    await removeWorktree(config.repoRoot, runState.worktreePath, runState.runId)
  } catch (error) {
    console.error('Review loop failed:', error)
    console.error(`Worktree preserved at ${runState.worktreePath} for inspection.`)
    throw error
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
