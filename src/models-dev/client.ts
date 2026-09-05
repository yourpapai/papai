// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { logger } from '../logger.js'
import type { ModelsDevProvider, ModelsDevSnapshot } from './resolve.js'

const log = logger.child({ scope: 'models-dev:client' })

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const MODELS_DEV_FETCH_TIMEOUT_MS = 10_000
export const MODELS_DEV_TTL_MS = 60 * 60 * 1000

export const defaultModelsDevCachePath = (): string => path.join(os.homedir(), '.cache', 'papai', 'models.json')

export type ModelsDevClientDeps = {
  readonly fetchImpl: (signal: AbortSignal) => Promise<string>
  readonly cachePath: string
  readonly now: () => number
  readonly ttlMs: number
  readonly fetchTimeoutMs: number
}

export type ModelsDevClientOverrides = Partial<ModelsDevClientDeps>

const LimitSchema = z.object({
  context: z.number().optional().catch(undefined),
  output: z.number().optional().catch(undefined),
})

const ModelEntrySchema = z.object({ limit: LimitSchema.optional().catch(undefined) })

const ModelsSchema = z.record(z.string(), ModelEntrySchema.nullable().catch(null)).catch({})
const ProviderSchema = z.object({ models: ModelsSchema })
const ProviderRecordSchema = z.record(z.string(), ProviderSchema.nullable().catch(null))

type ParsedModelEntry = z.infer<typeof ModelEntrySchema>
type ParsedProvider = z.infer<typeof ProviderSchema>

const normalizeProviders = (
  raw: Record<string, ParsedProvider | null>,
): Readonly<Record<string, ModelsDevProvider>> => {
  const providers: Record<string, ModelsDevProvider> = {}
  for (const [id, provider] of Object.entries(raw)) {
    if (provider === null) continue
    const models: Record<string, ParsedModelEntry> = {}
    for (const [modelId, entry] of Object.entries(provider.models)) {
      if (entry !== null) models[modelId] = entry
    }
    providers[id] = { models }
  }
  return providers
}

const parseProviders = (body: string): Readonly<Record<string, ModelsDevProvider>> =>
  normalizeProviders(ProviderRecordSchema.parse(JSON.parse(body)))

const hasAnyModel = (providers: Readonly<Record<string, ModelsDevProvider>>): boolean =>
  Object.values(providers).some((provider) => Object.keys(provider.models).length > 0)

const defaultFetchImpl = async (signal: AbortSignal): Promise<string> => {
  const response = await fetch(MODELS_DEV_URL, { signal })
  return response.text()
}

const defaultDeps = (): ModelsDevClientDeps => ({
  fetchImpl: defaultFetchImpl,
  cachePath: defaultModelsDevCachePath(),
  now: Date.now,
  ttlMs: MODELS_DEV_TTL_MS,
  fetchTimeoutMs: MODELS_DEV_FETCH_TIMEOUT_MS,
})

interface CachedProviders {
  readonly providers: Readonly<Record<string, ModelsDevProvider>>
  readonly mtime: number
}

const readCache = async (cachePath: string): Promise<CachedProviders | null> => {
  try {
    const raw = await readFile(cachePath, 'utf8')
    const { mtimeMs } = await stat(cachePath)
    const providers = parseProviders(raw)
    if (!hasAnyModel(providers)) return null
    return { providers, mtime: mtimeMs }
  } catch {
    return null
  }
}

const writeCache = async (cachePath: string, providers: Readonly<Record<string, ModelsDevProvider>>): Promise<void> => {
  try {
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify(providers))
  } catch {
    return undefined
  }
}

let active: ModelsDevClientDeps = defaultDeps()
let snapshot: ModelsDevSnapshot = { fetchedAt: null, providers: {} }
let inFlight: Promise<void> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

export const getModelsDevSnapshot = (): ModelsDevSnapshot => snapshot

const runCycle = async (deps: ModelsDevClientDeps): Promise<void> => {
  if (snapshot.fetchedAt === null) {
    const cached = await readCache(deps.cachePath)
    if (cached !== null) {
      snapshot = { fetchedAt: cached.mtime, providers: cached.providers }
      if (deps.now() - cached.mtime < deps.ttlMs) return
    }
  }
  try {
    const body = await deps.fetchImpl(AbortSignal.timeout(deps.fetchTimeoutMs))
    const providers = parseProviders(body)
    if (!hasAnyModel(providers)) {
      log.warn('models.dev response parsed to an empty catalogue; keeping previous snapshot')
      return
    }
    snapshot = { fetchedAt: deps.now(), providers }
    await writeCache(deps.cachePath, providers)
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'models.dev snapshot refresh failed; keeping previous snapshot',
    )
  }
}

const loadOnce = (overrides?: ModelsDevClientOverrides): Promise<void> => {
  if (inFlight !== null) return inFlight
  const deps: ModelsDevClientDeps = { ...active, ...overrides }
  inFlight = runCycle(deps).finally(() => {
    inFlight = null
  })
  return inFlight
}

const scheduleNextRefresh = (deps: ModelsDevClientDeps): void => {
  if (refreshTimer !== null) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void loadOnce().then(() => {
      scheduleNextRefresh(active)
    })
  }, deps.ttlMs)
  refreshTimer.unref?.()
}

export const prewarmModelsDevSnapshot = (overrides: ModelsDevClientOverrides = {}): Promise<void> => {
  active = { ...active, ...overrides }
  return loadOnce().then(() => {
    scheduleNextRefresh(active)
  })
}

export const refreshModelsDevSnapshot = (overrides: ModelsDevClientOverrides = {}): Promise<void> => loadOnce(overrides)

export const resetModelsDevSnapshotForTest = (): void => {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  inFlight = null
  snapshot = { fetchedAt: null, providers: {} }
  active = defaultDeps()
}
