// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { logger } from '../logger.js'

const log = logger.child({ scope: 'deferred:proof-store' })

export type ProofVerdict = 'pass' | 'fail' | 'inconclusive' | 'pending'

export interface ProofCheckRecord {
  run_id: string
  check: string
  variant?: string
  started_at: string
  finished_at: string
  verdict: ProofVerdict
  observations: string[]
}

export interface ProofStoreDeps {
  path?: string
  now?: () => Date
}

const FILE_NAME = 'proof-checks.jsonl'
const MAX_RECORDS = 50

const defaultNow = (): Date => new Date()

export const defaultProofStorePath = (): string => {
  const dbPath = process.env['DB_PATH']
  const base = dbPath === undefined || dbPath === '' ? 'papai.db' : dbPath
  return join(dirname(base), FILE_NAME)
}

const isProofVerdict = (value: unknown): value is ProofVerdict =>
  value === 'pass' || value === 'fail' || value === 'inconclusive' || value === 'pending'

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isProofCheckRecord = (value: unknown): value is ProofCheckRecord => {
  if (!isRecordObject(value)) return false
  const observations = value['observations']
  return (
    typeof value['run_id'] === 'string' &&
    typeof value['check'] === 'string' &&
    (value['variant'] === undefined || typeof value['variant'] === 'string') &&
    typeof value['started_at'] === 'string' &&
    typeof value['finished_at'] === 'string' &&
    isProofVerdict(value['verdict']) &&
    Array.isArray(observations) &&
    observations.every((entry: unknown) => typeof entry === 'string')
  )
}

const isProofDeliveryRecord = (value: unknown): boolean =>
  isRecordObject(value) &&
  typeof value['runId'] === 'string' &&
  typeof value['responseText'] === 'string' &&
  value['delivered'] === true &&
  typeof value['at'] === 'string'

let writeChain: Promise<unknown> = Promise.resolve()

const enqueue = <T>(operation: () => T): Promise<T> => {
  const result = writeChain.then(operation)
  writeChain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const parseJsonLine = (line: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(line)
    return parsed
  } catch {
    return undefined
  }
}

const trimToFit = (path: string, now: () => Date): void => {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
  if (lines.length <= MAX_RECORDS) return
  const tempPath = `${path}.tmp-${now().getTime()}`
  writeFileSync(tempPath, `${lines.slice(-MAX_RECORDS).join('\n')}\n`)
  renameSync(tempPath, path)
}

export const appendProofJsonLine = (line: unknown, deps?: ProofStoreDeps): Promise<void> =>
  enqueue(() => {
    const path = deps?.path ?? defaultProofStorePath()
    appendFileSync(path, `${JSON.stringify(line)}\n`)
    trimToFit(path, deps?.now ?? defaultNow)
  })

export const appendProofRecord = (record: ProofCheckRecord, deps?: ProofStoreDeps): Promise<void> =>
  appendProofJsonLine(record, deps)

export const loadProofRecords = (deps?: ProofStoreDeps): Promise<ProofCheckRecord[]> =>
  enqueue(() => {
    const path = deps?.path ?? defaultProofStorePath()
    if (!existsSync(path)) return []
    const records: ProofCheckRecord[] = []
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line === '') continue
      const parsed = parseJsonLine(line)
      if (isProofDeliveryRecord(parsed)) continue
      if (!isProofCheckRecord(parsed)) {
        log.warn({ path }, 'Skipping invalid line in proof store')
        continue
      }
      records.push(parsed)
    }
    return records
  })
