// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { z } from 'zod'

import { createLineHandler, enqueueLog } from './line-handler.js'
import type { LineHandler } from './line-handler.js'
import type { ProgressReporter } from './progress-log.js'

export { createLineHandler } from './line-handler.js'
export type { LineHandler } from './line-handler.js'

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
  // True when the kill was triggered by the inactivity watchdog (no stdout for
  // inactivityTimeoutMs) rather than the wall-clock timeout. Stalls are
  // retryable: a hung provider stream is transient, unlike an over-budget run.
  stalled?: boolean
}

export type LineSink = (line: string) => void

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeout?: number; killGraceMs?: number; inactivityTimeoutMs?: number },
  onLine?: LineSink,
) => Promise<SpawnResult>

export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  wallMs: number
}

export interface AgentRunResult<T> {
  value: T
  usage: AgentUsage
}

export class AgentRunError extends Error {
  readonly usage: AgentUsage
  constructor(message: string, usage: AgentUsage) {
    super(message)
    this.name = 'AgentRunError'
    this.usage = usage
  }
}

export interface RunAgentOptions<T> {
  spawn: SpawnFn
  model: string
  cwd: string
  prompt: string
  outputPath: string
  outputSchema: z.ZodType<T>
  label: string
  logPath: string
  extraArgs: readonly string[]
  reporter?: ProgressReporter
  onRetry?: () => void
  timeoutMs?: number
  inactivityTimeoutMs?: number
}

interface AttemptResult<T> {
  ok: true
  value: T
}

interface AttemptError {
  ok: false
  error: Error
  timedOut: boolean
  stalled: boolean
}

type Attempt<T> = AttemptResult<T> | AttemptError

/**
 * Absolute path the agent should write its output to.
 *
 * The path is absolute (not relative) so the agent cannot mis-resolve it
 * against an unrelated project root. The worktree cwd itself often lives at
 * `<repoRoot>/.review-loop/worktrees/<runId>/`, and a relative path like
 * `.review-loop/matches.json` is ambiguous: the agent may resolve it against
 * the worktree cwd (correct) or against the project root two levels up
 * (`<repoRoot>/.review-loop/matches.json` — wrong). The runner always reads
 * from `<cwd>/.review-loop/<basename(outputPath)>`, so the prompt must direct
 * the agent there unambiguously.
 */
export function agentWritePath(cwd: string, outputPath: string): string {
  return path.resolve(cwd, '.review-loop', path.basename(outputPath))
}

const MISPLACEMENT_SEARCH_DEPTH = 8

export function findMisplacedScratches(expectedPath: string, cwd: string, basename: string): string[] {
  const expected = path.resolve(expectedPath)
  const found: string[] = []
  let current = path.resolve(cwd)
  for (let i = 0; i < MISPLACEMENT_SEARCH_DEPTH; i += 1) {
    const candidate = path.resolve(current, '.review-loop', basename)
    if (candidate !== expected && existsSync(candidate)) {
      found.push(candidate)
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return found
}

function attemptRun<T>(options: RunAgentOptions<T>, onLine?: LineSink): Promise<SpawnResult> {
  return options.spawn(
    'opencode',
    [
      'run',
      '--auto',
      '--format',
      'json',
      '--model',
      options.model,
      '--dir',
      options.cwd,
      ...options.extraArgs,
      options.prompt,
    ],
    { cwd: options.cwd, timeout: options.timeoutMs, inactivityTimeoutMs: options.inactivityTimeoutMs },
    onLine,
  )
}

async function runAttempt<T>(options: RunAgentOptions<T>, handler: LineHandler): Promise<Attempt<T>> {
  await mkdir(path.resolve(options.cwd, '.review-loop'), { recursive: true })
  const result = await attemptRun(options, handler.onLine)
  if (result.exitCode !== 0) {
    enqueueLog(handler.ctx, `[${options.label}] stderr: ${result.stderr}\n`)
    return {
      ok: false,
      error: new Error(`${options.label} exited with code ${result.exitCode}: ${result.stderr}`),
      timedOut: result.timedOut === true,
      stalled: result.stalled === true,
    }
  }
  try {
    const agentFile = agentWritePath(options.cwd, options.outputPath)
    await mkdir(path.dirname(options.outputPath), { recursive: true })
    await copyFile(agentFile, options.outputPath)
    await unlink(agentFile)
    const raw = await readFile(options.outputPath, 'utf8')
    return { ok: true, value: options.outputSchema.parse(JSON.parse(raw)) }
  } catch (error) {
    const isEnoent =
      error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
    if (isEnoent) {
      const misplaced = findMisplacedScratches(
        agentWritePath(options.cwd, options.outputPath),
        options.cwd,
        path.basename(options.outputPath),
      )
      const hint = misplaced.length === 0 ? '' : ` Possible misplaced file(s): ${misplaced.join(', ')}.`
      const agentFile = agentWritePath(options.cwd, options.outputPath)
      return {
        ok: false,
        error: new Error(`${options.label} did not write to the expected scratch path: ${agentFile}.${hint}`),
        timedOut: false,
        stalled: false,
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      timedOut: false,
      stalled: false,
    }
  }
}

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<AgentRunResult<T>> {
  const handler = createLineHandler(options)
  const buildUsage = (): AgentUsage => ({
    ...handler.ctx.usage,
    wallMs: handler.ctx.firstStepAt === null ? 0 : Date.now() - handler.ctx.firstStepAt,
  })
  const finalize = (value: T): AgentRunResult<T> => ({ value, usage: buildUsage() })
  try {
    const first = await runAttempt(options, handler)
    if (first.ok) return finalize(first.value)
    // Wall-clock timeouts are not retried (the task genuinely overran its
    // budget), but stalls are: a hung provider stream is transient, and the
    // retry usually lands on a healthy request path.
    if (first.timedOut && !first.stalled) throw new AgentRunError(first.error.message, buildUsage())
    options.onRetry?.()
    const second = await runAttempt(options, handler)
    if (second.ok) return finalize(second.value)
    throw new AgentRunError(second.error.message, buildUsage())
  } finally {
    await handler.dispose()
  }
}
