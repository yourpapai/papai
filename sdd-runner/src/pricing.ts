// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

const MODELS_DEV_URL = 'https://metrics.dev/api.json'
const CACHE_TTL_MS = 60 * 60 * 1000

export const CostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
})
export type Cost = z.infer<typeof CostSchema>

const ModelEntrySchema = z.object({ cost: CostSchema })
const ProviderSchema = z.object({ models: z.record(z.string(), ModelEntrySchema) })
export const ModelsDevDbSchema = z.record(z.string(), ProviderSchema)
export type ModelsDevDb = z.infer<typeof ModelsDevDbSchema>

export interface ResolvedCost extends Cost {
  readonly source: 'primary' | 'fallback'
}

export interface LoadDbDeps {
  readonly cachePath?: string
  readonly now?: () => Date
  readonly fetchImpl?: () => Promise<string>
}

export function defaultCachePath(): string {
  return path.join(os.homedir(), '.cache', 'sdd-runner', 'models.json')
}

export function parseModelId(modelId: string): { providerID: string; modelID: string } {
  const slash = modelId.indexOf('/')
  if (slash <= 0) throw new Error(`invalid model id "${modelId}": expected "<providerID>/<modelID>"`)
  return { providerID: modelId.slice(0, slash), modelID: modelId.slice(slash + 1) }
}

function isPriced(cost: Cost): boolean {
  return cost.input > 0 || cost.output > 0
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function medianDefined(values: (number | undefined)[]): number | undefined {
  const present = values.filter((v): v is number => v !== undefined && v > 0)
  if (present.length === 0) return undefined
  return median(present)
}

export function resolveCost(modelId: string, db: ModelsDevDb): ResolvedCost | null {
  const { providerID, modelID } = parseModelId(modelId)
  const primary = db[providerID]?.models[modelID]?.cost
  if (primary !== undefined && isPriced(primary)) {
    return { ...primary, source: 'primary' }
  }
  const entries: Cost[] = []
  for (const pid of Object.keys(db)) {
    const cost = db[pid]?.models[modelID]?.cost
    if (cost !== undefined && isPriced(cost)) entries.push(cost)
  }
  if (entries.length === 0) return null
  return {
    input: median(entries.map((e) => e.input)),
    output: median(entries.map((e) => e.output)),
    cache_read: medianDefined(entries.map((e) => e.cache_read)),
    cache_write: medianDefined(entries.map((e) => e.cache_write)),
    source: 'fallback',
  }
}

async function defaultFetch(): Promise<string> {
  const response = await fetch(MODELS_DEV_URL)
  return response.text()
}

interface CachedDb {
  readonly db: ModelsDevDb
  readonly mtime: Date
}

async function readCache(cachePath: string): Promise<CachedDb | null> {
  try {
    const raw = await readFile(cachePath, 'utf8')
    const { mtime } = await stat(cachePath)
    return { db: ModelsDevDbSchema.parse(JSON.parse(raw)), mtime }
  } catch {
    return null
  }
}

async function writeCache(cachePath: string, db: ModelsDevDb): Promise<void> {
  try {
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify(db))
  } catch {
    // cache write is best-effort; resolveCost degrades to null on next read
  }
}

export async function loadDb(deps: LoadDbDeps = {}): Promise<ModelsDevDb> {
  const cachePath = deps.cachePath ?? defaultCachePath()
  const now = deps.now?.() ?? new Date()
  const fetchImpl = deps.fetchImpl ?? defaultFetch

  const cached = await readCache(cachePath)
  if (cached !== null && now.getTime() - cached.mtime.getTime() < CACHE_TTL_MS) {
    return cached.db
  }

  try {
    const body = await fetchImpl()
    const db = ModelsDevDbSchema.parse(JSON.parse(body))
    await writeCache(cachePath, db)
    return db
  } catch {
    if (cached !== null) return cached.db
    return {}
  }
}
