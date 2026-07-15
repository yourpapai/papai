// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile, readFile } from 'node:fs/promises'

import type { z } from 'zod'

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type SpawnFn = (command: string, args: readonly string[], options: { cwd: string }) => Promise<SpawnResult>

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
  onRetry?: () => void
}

interface AttemptResult<T> {
  ok: true
  value: T
}

interface AttemptError {
  ok: false
  error: Error
}

type Attempt<T> = AttemptResult<T> | AttemptError

async function attemptRun<T>(options: RunAgentOptions<T>): Promise<Attempt<T>> {
  const result = await options.spawn(
    'opencode',
    ['run', '--model', options.model, '--dir', options.cwd, ...options.extraArgs, options.prompt],
    { cwd: options.cwd },
  )

  await appendFile(options.logPath, `[${options.label}] stdout: ${result.stdout}\nstderr: ${result.stderr}\n`)

  if (result.exitCode !== 0) {
    return { ok: false, error: new Error(`${options.label} exited with code ${result.exitCode}: ${result.stderr}`) }
  }

  try {
    const raw = await readFile(options.outputPath, 'utf8')
    return { ok: true, value: options.outputSchema.parse(JSON.parse(raw)) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<T> {
  const first = await attemptRun(options)
  if (first.ok) {
    return first.value
  }

  options.onRetry?.()
  const second = await attemptRun(options)
  if (second.ok) {
    return second.value
  }

  throw second.error
}
