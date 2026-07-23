// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolve } from 'node:path'

import { candidateVersions } from './candidate-registry.js'
import { FROZEN_SCENARIO_MANIFEST } from './manifest.js'
import {
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_STORED_RECORDS,
  FROZEN_100K_WARMUPS,
} from './statistics-storage.js'
import { StorageJobInputSchema, StorageJobResultSchema } from './storage-contracts.js'
import type { StorageJobInput, StorageJobResult } from './storage-contracts.js'

export type StorageWorkerOptions = Readonly<{
  workspaceRoot?: string
  workerPath?: string
  deadlineMs?: number
  terminationGraceMs?: number
}>

type StorageWorkerProcess = Readonly<{
  pid: number
  exited: Promise<number>
  stdout: ReadableStream<Uint8Array> | number | null | undefined
  stderr: ReadableStream<Uint8Array> | number | null | undefined
  kill: (signal?: number | NodeJS.Signals) => void
}>

type StorageWorkerCompletion = Readonly<{
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}>

const failureResult = (input: StorageJobInput, workerPid: number, message: string): StorageJobResult => ({
  candidateId: input.candidateId,
  candidateVersion: candidateVersions[input.candidateId],
  workerPid,
  scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
  scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
  run: {
    scenarioId: input.scenario.scenarioId,
    status: 'failure',
    freshWorker: true,
    fixturesMaterializedBeforeReset: false,
    primaryScopeStoredRecordCount: 0,
    recordsOutsidePrimaryScope: 0,
    warmupCount: 0,
    measuredLatenciesMs: [],
    incrementalRssBytes: 0,
    absoluteProcessPeakRssBytes: 0,
    rssCapture: 'current-pre-serialization',
  },
  resources: {
    ingestedEventCount: 0,
    ingestDurationMs: 0,
    ingestThroughputPerSecond: 0,
    retrievalCount: 0,
    modelCallCount: 0,
    extractorCallCount: 0,
    storedBytes: 0,
    incrementalRssBytes: 0,
  },
  failure: message,
})

const streamText = (stream: ReadableStream<Uint8Array> | number | null | undefined): Promise<string> =>
  stream instanceof ReadableStream ? new Response(stream).text() : Promise.resolve('')

const awaitWorker = async (
  child: StorageWorkerProcess,
  deadlineMs: number,
  terminationGraceMs: number,
): Promise<StorageWorkerCompletion> => {
  let timedOut = false
  let hardKill: ReturnType<typeof setTimeout> | undefined
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    hardKill = setTimeout(() => {
      child.kill('SIGKILL')
    }, terminationGraceMs)
  }, deadlineMs)
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    streamText(child.stdout),
    streamText(child.stderr),
  ])
  clearTimeout(timeout)
  if (hardKill !== undefined) clearTimeout(hardKill)
  return { exitCode, stdout, stderr, timedOut }
}

const parseWorkerOutput = (
  input: StorageJobInput,
  workerPid: number,
  completion: StorageWorkerCompletion,
  deadlineMs: number,
): StorageJobResult => {
  if (completion.timedOut) return failureResult(input, workerPid, `Storage worker exceeded ${deadlineMs} ms`)
  if (completion.exitCode !== 0) {
    return failureResult(
      input,
      workerPid,
      completion.stderr.trim() || `storage worker exited with code ${completion.exitCode}`,
    )
  }
  let parsed: ReturnType<typeof StorageJobResultSchema.safeParse>
  try {
    parsed = StorageJobResultSchema.safeParse(JSON.parse(completion.stdout))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failureResult(input, workerPid, `Storage worker returned invalid JSON: ${message}`)
  }
  const result = parsed.success ? parsed.data : null
  const successfulRunIsConsistent =
    result?.run.status !== 'success' ||
    (result.failure === null &&
      result.run.primaryScopeStoredRecordCount === FROZEN_100K_STORED_RECORDS &&
      result.run.recordsOutsidePrimaryScope === 0 &&
      result.run.warmupCount === FROZEN_100K_WARMUPS &&
      result.run.measuredLatenciesMs.length === FROZEN_100K_MEASURED_RETRIEVALS &&
      result.resources.retrievalCount === FROZEN_100K_WARMUPS + FROZEN_100K_MEASURED_RETRIEVALS)
  if (
    result === null ||
    result.candidateId !== input.candidateId ||
    result.candidateVersion !== candidateVersions[input.candidateId] ||
    result.scenarioManifestVersion !== FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion ||
    result.scenarioManifestSha256 !== FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256 ||
    result.run.scenarioId !== input.scenario.scenarioId ||
    result.workerPid !== workerPid ||
    result.run.freshWorker ||
    result.run.incrementalRssBytes !== result.resources.incrementalRssBytes ||
    (result.run.status === 'success') !== (result.failure === null) ||
    !successfulRunIsConsistent
  ) {
    return failureResult(input, workerPid, 'Storage worker returned invalid or mismatched output')
  }
  return { ...result, run: { ...result.run, freshWorker: true } }
}

export const runIsolatedFrozen100kStorageJob = async (
  inputValue: StorageJobInput,
  options: StorageWorkerOptions = {},
): Promise<StorageJobResult> => {
  const input = StorageJobInputSchema.parse(inputValue)
  if (FROZEN_100K_STORED_RECORDS !== 100_000) {
    throw new Error('Frozen 100k storage contract changed unexpectedly')
  }
  const workspaceRoot = options.workspaceRoot ?? process.cwd()
  const workerPath = options.workerPath ?? resolve(workspaceRoot, 'scripts/memory-research/storage-worker.ts')
  const deadlineMs = options.deadlineMs ?? 180_000
  const terminationGraceMs = options.terminationGraceMs ?? 250
  const child = Bun.spawn({
    cmd: [process.execPath, workerPath],
    cwd: workspaceRoot,
    stdin: new Blob([JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return parseWorkerOutput(input, child.pid, await awaitWorker(child, deadlineMs, terminationGraceMs), deadlineMs)
}
