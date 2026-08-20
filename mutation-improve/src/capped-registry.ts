// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

const CappedEntrySchema = z.object({
  score: z.number(),
  cappedAt: z.string(),
  runId: z.string(),
})

const CappedRegistrySchema = z.record(z.string(), CappedEntrySchema)

type CappedRegistry = z.infer<typeof CappedRegistrySchema>

export interface CappedEntry {
  readonly file: string
  readonly score: number
  readonly cappedAt: string
  readonly runId: string
}

export interface CappedRegistryStore {
  readonly entries: readonly CappedEntry[]
  readonly record: (file: string, score: number) => Promise<void>
}

export const cappedRegistryPath = (workDir: string): string => path.join(workDir, 'capped.json')

const isEnoent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'ENOENT'

// Cross-run memory of files whose tests-only mutation-score ceiling landed
// below the threshold. A capped file was merged at its ceiling once already,
// so re-selecting it can only re-discover the same ceiling — the select gate
// rejects these picks. Missing file means "nothing capped yet" ({}); a corrupt
// file throws so cross-run memory is never silently dropped.
export async function loadCappedRegistryStore(workDir: string, runId: string): Promise<CappedRegistryStore> {
  const filePath = cappedRegistryPath(workDir)
  let registry: CappedRegistry = {}
  try {
    registry = CappedRegistrySchema.parse(JSON.parse(await readFile(filePath, 'utf8')))
  } catch (error) {
    if (!isEnoent(error)) throw error
  }
  let entries: readonly CappedEntry[] = Object.entries(registry).map(([file, entry]) => ({ file, ...entry }))
  return {
    get entries() {
      return entries
    },
    record: async (file: string, score: number): Promise<void> => {
      const entry = { score, cappedAt: new Date().toISOString(), runId }
      registry = { ...registry, [file]: entry }
      entries = [...entries.filter((e) => e.file !== file), { file, ...entry }]
      await mkdir(workDir, { recursive: true })
      await writeFile(filePath, JSON.stringify(registry, null, 2))
    },
  }
}
