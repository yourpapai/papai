// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

/**
 * The models.dev pricing table. Exported so a test can pin the domain: this was previously
 * `metrics.dev`, a parked domain that answers 200 with an HTML lander. `JSON.parse` then threw,
 * `loadDb` swallowed it and returned `{}`, and every gate reported its cost as unknown — a
 * failure with no error anywhere. No test caught it because `pricing.test.ts` injects
 * `fetchImpl` and never exercises this constant.
 */
export const MODELS_DEV_URL = 'https://models.dev/api.json'

/**
 * Bound on the pricing fetch. Cost is decoration on a gate summary; a slow or hanging host must
 * never hold up presenting the gate itself, and an unbounded `fetch` here would do exactly that.
 */
export const MODELS_DEV_FETCH_TIMEOUT_MS = 10_000

const CACHE_TTL_MS = 60 * 60 * 1000

export const CostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
})
export type Cost = z.infer<typeof CostSchema>

/**
 * A model's declared context window and output cap, both optional for the reason the whole entry
 * is lenient — and read by `opencode-agent`, where a missing `context` is not cosmetic: OpenCode's
 * `isOverflow` opens with `if (model.limit.context === 0) return false`, so a model with no
 * declared window never auto-compacts and grows until the provider rejects the request.
 */
export const LimitSchema = z.object({
  context: z.number().optional(),
  output: z.number().optional(),
})
export type Limit = z.infer<typeof LimitSchema>

/**
 * `cost` is optional because 419 of the entries models.dev currently publishes have no cost at
 * all (local and open-weight models, mostly). Requiring it made a single unpriced model reject
 * the ENTIRE database — `loadDb` caught the parse error and returned `{}`, so every price
 * silently resolved to unknown. `resolveCost` was already written to skip `cost === undefined`,
 * so the schema was simply stricter than its only consumer.
 *
 * The capability fields beside it are that lesson applied one step further. They are `.catch`,
 * not merely `.optional`: a malformed value degrades to `undefined` for that one field instead of
 * failing its entry — and, since `loadDb` swallows a parse error and answers `{}`, failing an
 * entry means losing the other eighteen hundred. `cost` deliberately keeps the weaker form; its
 * incident was about a field being *absent*, its one consumer already handles `undefined`, and
 * widening it here would hide a real shape change from the reader that depends on it.
 *
 * Unknown fields are dropped rather than rejected — models.dev publishes a dozen more per entry
 * (`knowledge`, `modalities`, `open_weights`, …) and this reader wants none of them.
 */
const ModelEntrySchema = z.object({
  cost: CostSchema.optional(),
  limit: LimitSchema.optional().catch(undefined),
  reasoning: z.boolean().optional().catch(undefined),
  tool_call: z.boolean().optional().catch(undefined),
  temperature: z.boolean().optional().catch(undefined),
  attachment: z.boolean().optional().catch(undefined),
})

/**
 * One model's catalogue row, as much of it as any consumer here reads.
 *
 * Exported because it is the shape `opencode-agent` splices into the OpenCode provider config it
 * emits — the field names are models.dev's and OpenCode's alike, which is what makes the splice a
 * copy rather than a translation.
 */
export type ModelEntry = z.infer<typeof ModelEntrySchema>

const ProviderSchema = z.object({ models: z.record(z.string(), ModelEntrySchema) })
export const ModelsDevDbSchema = z.record(z.string(), ProviderSchema)
export type ModelsDevDb = z.infer<typeof ModelsDevDbSchema>

export interface ResolvedCost extends Cost {
  readonly source: 'primary' | 'fallback'
}

/** Per-million-token rates, the shape the resolved cost publishes. */
export type TokenRates = { input: number; output: number; cache_read?: number; cache_write?: number }

export interface UsageBuckets {
  readonly input: number
  readonly output: number
  readonly reasoning?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

const TOKEN_SCALE = 1_000_000

/**
 * What a set of token counts costs at a set of published rates.
 *
 * Everything the arithmetic knows lives here: the per-million scale, cache
 * tokens charged at their own rate or not at all, and reasoning tokens charged
 * at the *input* rate — which is a convention rather than an arithmetic fact,
 * and so exactly the kind of thing that must not be re-decided by a second
 * implementation. Homed here (with the rates) since the sdd-runner workspace
 * that once published it was deleted at R5; afk-runner keeps no pricing seam.
 */
export function costOfUsage(buckets: UsageBuckets, cost: TokenRates): number {
  const { input, output, reasoning = 0, cacheRead = 0, cacheWrite = 0 } = buckets
  const cacheReadCost = (cacheRead / TOKEN_SCALE) * (cost.cache_read ?? 0)
  const cacheWriteCost = (cacheWrite / TOKEN_SCALE) * (cost.cache_write ?? 0)
  return ((input + reasoning) * cost.input + output * cost.output) / TOKEN_SCALE + cacheReadCost + cacheWriteCost
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

/**
 * One model's catalogue row, or `null` when the database carries no such provider or model.
 *
 * The whole entry rather than one field of it, because the second consumer wants the capability
 * half: `opencode-agent` copies `limit`, `reasoning`, `tool_call`, `temperature` and `attachment`
 * straight into the OpenCode provider config it emits.
 */
export function lookupModel(modelId: string, db: ModelsDevDb): ModelEntry | null {
  const { providerID, modelID } = parseModelId(modelId)
  return db[providerID]?.models[modelID] ?? null
}

export function resolveCost(modelId: string, db: ModelsDevDb): ResolvedCost | null {
  const { modelID } = parseModelId(modelId)
  const primary = lookupModel(modelId, db)?.cost
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
  const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(MODELS_DEV_FETCH_TIMEOUT_MS) })
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
