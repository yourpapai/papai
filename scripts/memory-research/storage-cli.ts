// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { link, mkdir, open, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { FROZEN_100K_SEED } from './statistics-storage.js'
import type { FrozenStorageReport } from './storage-report.js'
import { stableStorageReportJson, validateFrozenStorageReport } from './storage-report.js'

export type StorageCliOptions = Readonly<{
  seed: typeof FROZEN_100K_SEED
  queryTimeoutMs: number
  workerDeadlineMs: number
  output: string
}>

export type FrozenStorageOutputReservation = Readonly<{
  output: string
  lockPath: string
}>

const valueFlags = new Set(['--candidate', '--seed', '--query-timeout-ms', '--worker-deadline-ms', '--output'])

const argumentValues = (args: readonly string[]): ReadonlyMap<string, string> => {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag === undefined || !valueFlags.has(flag)) throw new Error(`Unknown storage argument: ${String(flag)}`)
    if (values.has(flag)) throw new Error(`Duplicate storage argument: ${flag}`)
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    values.set(flag, value)
  }
  return values
}

const positiveInteger = (value: string, flag: string): number => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

export const parseStorageResearchArgs = (args: readonly string[]): StorageCliOptions => {
  const values = argumentValues(args)
  const candidate = values.get('--candidate') ?? 'all'
  if (candidate !== 'all') throw new Error('The frozen storage report requires --candidate all')
  const seed = positiveInteger(values.get('--seed') ?? String(FROZEN_100K_SEED), '--seed')
  if (seed !== FROZEN_100K_SEED) throw new Error(`Frozen storage seed must be ${String(FROZEN_100K_SEED)}`)
  const queryTimeoutMs = positiveInteger(values.get('--query-timeout-ms') ?? '5000', '--query-timeout-ms')
  const workerDeadlineMs = positiveInteger(values.get('--worker-deadline-ms') ?? '180000', '--worker-deadline-ms')
  if (workerDeadlineMs < queryTimeoutMs) throw new Error('Worker deadline must cover the query timeout')
  return {
    seed: FROZEN_100K_SEED,
    queryTimeoutMs,
    workerDeadlineMs,
    output: values.get('--output') ?? 'docs/research/agent-memory/raw/v3-20260723/storage-100000/storage.json',
  }
}

const releaseReservation = async (reservation: FrozenStorageOutputReservation): Promise<void> => {
  try {
    await unlink(reservation.lockPath)
  } catch {
    // The task-owned reservation may already have been released after an error.
  }
}

export const reserveFrozenStorageOutput = async (outputValue: string): Promise<FrozenStorageOutputReservation> => {
  const output = resolve(outputValue)
  await mkdir(dirname(output), { recursive: true })
  const lockPath = `${output}.lock`
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(lockPath, 'wx')
  } catch {
    throw new Error(`Frozen storage output is already reserved: ${output}`)
  }
  await handle.close()
  const reservation = { output, lockPath }
  if (await Bun.file(output).exists()) {
    await releaseReservation(reservation)
    throw new Error(`Refusing to overwrite frozen storage output: ${output}`)
  }
  return reservation
}

export const publishFrozenStorageOutput = async (
  input: FrozenStorageReport,
  reservation: FrozenStorageOutputReservation,
): Promise<string> => {
  const report = validateFrozenStorageReport(input)
  const temporary = `${reservation.output}.tmp-${process.pid}-${randomUUID()}`
  try {
    await Bun.write(temporary, stableStorageReportJson(report))
    await link(temporary, reservation.output)
    await unlink(temporary)
  } catch (error) {
    try {
      await unlink(temporary)
    } catch {
      // A missing task-owned temporary file needs no cleanup.
    }
    throw error
  }
  return reservation.output
}

export const writeFrozenStorageOutput = async (input: FrozenStorageReport, outputValue: string): Promise<string> => {
  const reservation = await reserveFrozenStorageOutput(outputValue)
  try {
    return await publishFrozenStorageOutput(input, reservation)
  } finally {
    await releaseReservation(reservation)
  }
}

export { releaseReservation as releaseFrozenStorageOutputReservation }
