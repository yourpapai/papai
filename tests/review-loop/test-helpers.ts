// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { ReviewLoopConfig } from '../../review-loop/src/config.js'
import type { Verdict } from '../../review-loop/src/issue-schema.js'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
import type { TraceEvent, TraceLogger } from '../../review-loop/src/trace-log.js'
import type { Worker, WorkerPool } from '../../review-loop/src/worker-pool.js'
import { execGit } from '../../review-loop/src/worktree.js'

const tempDirs: string[] = []

export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

export function createReviewLoopConfigFixture(
  repoRoot: string,
  overrides?: Partial<ReviewLoopConfig>,
): ReviewLoopConfig {
  return {
    repoRoot,
    workDir: path.join(repoRoot, '.review-loop'),
    maxRounds: 5,
    maxNoProgressRounds: 2,
    agentTimeoutMs: 600_000,
    buildTimeoutMs: 600_000,
    checkCommand: 'bun check:full',
    poolSize: 3,
    reviewer: {
      model: 'ollama-cloud/kimi-k2.6:cloud',
      extraArgs: [],
    },
    fixer: {
      model: 'opencode/claude-sonnet-4-6',
      extraArgs: [],
    },
    matcher: {
      model: 'ollama-cloud/kimi-k2.6:cloud',
      extraArgs: [],
    },
    ...overrides,
  }
}

export function silentReporter(): ProgressReporter {
  return {
    dynamic: false,
    event() {},
    live() {},
    clearLive() {},
    log() {},
  }
}

export function silentTrace(): TraceLogger {
  return {
    append(_: TraceEvent): Promise<void> {
      return Promise.resolve()
    },
  }
}

export function fakePool(opts: {
  size: number
  worktreePath?: string
  worktreePaths?: string[]
  mergeOk?: boolean
  conflictFiles?: string[]
}): {
  pool: WorkerPool
  workers: Worker[]
  acquireLog: number[]
  releaseLog: number[]
} {
  const useRealGit = opts.worktreePath !== undefined || opts.worktreePaths !== undefined
  const worktreePaths = opts.worktreePaths ?? Array.from({ length: opts.size }, () => opts.worktreePath!)
  const workers: Worker[] = []
  for (let i = 1; i <= opts.size; i++) {
    const worktreePath = worktreePaths[i - 1] ?? `/tmp/fake-${i}`
    workers.push({
      id: i,
      worktreePath,
      branch: `fake-${i}`,
      busy: false,
      lockedFiles: new Set(),
      headSha: async () => {
        if (!useRealGit) return 'sha'
        const result = await execGit(worktreePath, ['rev-parse', 'HEAD'])
        return result.stdout.trim()
      },
      resetToBaseline: async (sha: string) => {
        if (!useRealGit) return
        await execGit(worktreePath, ['reset', '--hard', sha])
        await execGit(worktreePath, ['clean', '-fdx', '-e', '.review-loop'])
      },
    })
  }
  const acquireLog: number[] = []
  const releaseLog: number[] = []
  const waiters: Array<() => void> = []
  return {
    pool: {
      primaryWorktreePath: '/tmp/fake-primary',
      primaryBranch: 'fake-primary',
      async acquire(file) {
        while (true) {
          const free = workers.filter((w) => !w.busy)
          if (free.length > 0) {
            const w = free[0]!
            w.busy = true
            w.lockedFiles = new Set([file])
            acquireLog.push(Date.now())
            return w
          }
          await new Promise<void>((r) => {
            waiters.push(r)
          })
        }
      },
      release(worker) {
        releaseLog.push(Date.now())
        worker.busy = false
        worker.lockedFiles = new Set()
        const next = waiters.shift()
        if (next !== undefined) next()
      },
      mergeWorkerIntoPrimary() {
        return Promise.resolve(
          opts.mergeOk === false ? { ok: false, conflictFiles: opts.conflictFiles ?? ['x.ts'] } : { ok: true },
        )
      },
      workerPaths() {
        return workers.map((w) => w.worktreePath)
      },
      close() {
        return Promise.resolve()
      },
    },
    workers,
    acquireLog,
    releaseLog,
  }
}

export function mockSpawnForFixerAndInspector(opts: {
  fixerVerdict?: Verdict
  fixerFixed?: boolean
  inspectorAddresses?: boolean
  inspectorCallCount?: { current: number }
  fixerCallCount?: { current: number }
}): SpawnFn {
  return (_cmd, args, spawnOpts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)

    if (prompt.includes('You are an inspector')) {
      if (opts.inspectorCallCount !== undefined) {
        opts.inspectorCallCount.current += 1
      }
      writeFileSync(
        path.resolve(spawnOpts.cwd, outputPath),
        JSON.stringify({
          addresses: opts.inspectorAddresses ?? true,
          reasoning: 'mock inspector reasoning',
          confidence: 0.9,
        }),
      )
    } else {
      // Any non-inspector prompt is a fixer prompt (initial, build-retry, or inspector-rejection retry).
      if (opts.fixerCallCount !== undefined) {
        opts.fixerCallCount.current += 1
      }
      writeFileSync(
        path.resolve(spawnOpts.cwd, outputPath),
        JSON.stringify({
          verdict: opts.fixerVerdict ?? 'valid',
          fixability: 'auto',
          fixed: opts.fixerFixed ?? true,
          reasoning: 'mock fixer reasoning',
          targetFiles: [],
          commitSha: 'abc',
          commitMessage: 'fix: mock',
          severity: 'low',
        }),
      )
      writeFileSync(path.join(spawnOpts.cwd, 'fixed.ts'), 'ok\n')
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
}
