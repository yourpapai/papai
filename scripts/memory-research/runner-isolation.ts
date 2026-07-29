// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolve } from 'node:path'

import { candidateVersions } from './candidate-registry.js'
import { ScenarioJobInputSchema, ScenarioJobResultSchema } from './runner-contracts.js'
import type { ScenarioJobInput, ScenarioJobResult } from './runner-contracts.js'
import { zeroResources } from './runner-initialize.js'
import { failedQueryEvaluation, timedOutQueryEvaluation } from './runner-query.js'

export type IsolatedWorkerOptions = Readonly<{
  workspaceRoot?: string
  workerPath?: string
  deadlineMs?: number
  terminationGraceMs?: number
}>

const workerFailure = (
  input: ScenarioJobInput,
  kind: 'exception' | 'timeout' | 'validation',
  message: string,
): ScenarioJobResult => ({
  candidateId: input.candidateId,
  candidateVersion: candidateVersions[input.candidateId],
  workerPid: process.pid,
  scenario: {
    scenarioId: input.scenario.scenarioId,
    queries: input.scenario.queries.map((query) =>
      kind === 'timeout' ? timedOutQueryEvaluation(query, input.queryTimeoutMs) : failedQueryEvaluation(query, message),
    ),
  },
  resources: zeroResources(),
  failures: input.scenario.queries.map((query) => ({
    scenarioId: input.scenario.scenarioId,
    queryId: query.queryId,
    stage: 'setup',
    kind,
    message,
  })),
  lifecycle: [],
  rebuildProbes: input.scenario.faults.rebuildBeforeQueryIds.map((queryId) => ({
    queryId,
    beforeHitIds: [],
    afterHitIds: [],
    status: kind === 'timeout' ? 'timeout' : 'failure',
  })),
})

const streamText = (stream: ReadableStream<Uint8Array> | number | null | undefined): Promise<string> =>
  stream instanceof ReadableStream ? new Response(stream).text() : Promise.resolve('')

type WorkerOutcome =
  | Readonly<{ status: 'completed'; exitCode: number; stdout: string; stderr: string }>
  | Readonly<{ status: 'timeout' }>

const workerOutcome = async (
  child: ReturnType<typeof Bun.spawn>,
  deadlineMs: number,
  terminationGraceMs: number,
): Promise<WorkerOutcome> => {
  let timedOut = false
  let terminationTimer: ReturnType<typeof setTimeout> | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const completion = Promise.all([child.exited, streamText(child.stdout), streamText(child.stderr)]).then(
    ([exitCode, stdout, stderr]) => ({ status: 'completed', exitCode, stdout, stderr }) as const,
  )
  const hardDeadline = new Promise<Readonly<{ status: 'timeout' }>>((resolveDeadline) => {
    terminationTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        child.kill('SIGKILL')
        resolveDeadline({ status: 'timeout' })
      }, terminationGraceMs)
    }, deadlineMs)
  })
  const outcome = await Promise.race([completion, hardDeadline])
  if (terminationTimer !== undefined) clearTimeout(terminationTimer)
  if (killTimer !== undefined) clearTimeout(killTimer)
  return timedOut ? { status: 'timeout' } : outcome
}

const identityMismatch = (input: ScenarioJobInput, result: ScenarioJobResult): string | null => {
  const expectedVersion = candidateVersions[input.candidateId]
  if (result.candidateId !== input.candidateId || result.candidateVersion !== expectedVersion) {
    return (
      `Worker candidate identity mismatch: expected ${input.candidateId}@${expectedVersion}, ` +
      `received ${result.candidateId}@${result.candidateVersion}`
    )
  }
  return result.scenario.scenarioId === input.scenario.scenarioId ? null : 'Worker scenario identity mismatch'
}

export const runIsolatedScenarioJob = async (
  inputValue: ScenarioJobInput,
  options: IsolatedWorkerOptions = {},
): Promise<ScenarioJobResult> => {
  const input = ScenarioJobInputSchema.parse(inputValue)
  const workspaceRoot = options.workspaceRoot ?? process.cwd()
  const workerPath = options.workerPath ?? resolve(workspaceRoot, 'scripts/memory-research/runner-worker.ts')
  const deadlineMs = options.deadlineMs ?? 120_000
  const terminationGraceMs = options.terminationGraceMs ?? 1_000
  const child = Bun.spawn({
    cmd: [process.execPath, workerPath],
    cwd: workspaceRoot,
    stdin: new Blob([JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const outcome = await workerOutcome(child, deadlineMs, terminationGraceMs)
  if (outcome.status === 'timeout') {
    return workerFailure(input, 'timeout', `Worker exceeded ${deadlineMs} ms`)
  }
  if (outcome.exitCode !== 0) {
    const detail = outcome.stderr.trim() || `worker exited with code ${outcome.exitCode}`
    return workerFailure(input, 'exception', detail)
  }
  try {
    const result = ScenarioJobResultSchema.parse(JSON.parse(outcome.stdout))
    const mismatch = identityMismatch(input, result)
    return mismatch === null ? result : workerFailure(input, 'validation', mismatch)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return workerFailure(input, 'validation', `Invalid worker output: ${message}`)
  }
}
