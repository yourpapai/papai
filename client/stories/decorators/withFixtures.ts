// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpHandler } from 'msw'

import { adminState } from '../../admin/admin.svelte.js'
import { adminGlobals } from '../../admin/global-stats.svelte.js'
import { scenarios } from '../msw/scenarios.js'
import { sseStub } from '../stubs/sse.js'

const scenarioMap: Record<string, readonly HttpHandler[]> = scenarios

interface LoaderContext {
  parameters: Record<string, unknown>
}

export function resolveScenario(name: string): readonly HttpHandler[] {
  return scenarioMap[name] ?? []
}

export function resetAllSingletons(): void {
  adminState.currentSection = 'overview'
  adminState.lastRefreshedAt = null
  adminGlobals.window = '30d'
  adminGlobals.loading = false
  adminGlobals.data = null
  adminGlobals.fetchedAt = null
}

// Runs before each story renders: resets rune singletons, clears any SSE
// connections from the previous story, then registers the scenario's MSW
// handlers and replays seed SSE events. getWorker is imported lazily so the
// happy-dom unit suite never pulls in msw/browser.
export async function fixturesLoader(context: LoaderContext): Promise<Record<string, never>> {
  resetAllSingletons()
  sseStub.reset()

  const scenario = context.parameters['fixtures']
  if (typeof scenario === 'string') {
    const { getWorker } = await import('msw-storybook-addon')
    const worker = getWorker()
    worker.resetHandlers()
    const handlers = resolveScenario(scenario)
    if (handlers.length > 0) worker.use(...handlers)

    const seed = context.parameters['sseSeed']
    if (Array.isArray(seed)) sseStub.seed(seed)
  }

  return {}
}
