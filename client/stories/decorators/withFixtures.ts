// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpHandler } from 'msw'

import { adminState } from '../../admin/admin.svelte.js'
import { adminGlobals, refreshGlobals } from '../../admin/global-stats.svelte.js'
import { settingsSession } from '../../settings/session.svelte.js'
import { scenarios } from '../msw/scenarios.js'
import { sseStub } from '../stubs/sse.js'

const scenarioMap: Record<string, readonly HttpHandler[]> = scenarios

interface LoaderContext {
  parameters: Record<string, unknown>
}

export function resolveScenario(name: string): readonly HttpHandler[] {
  return scenarioMap[name] ?? []
}

export function resetSettingsSession(): void {
  settingsSession.status = 'loading'
  settingsSession.display = ''
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = []
  settingsSession.activeContextId = ''
}

// Personal, non-admin "ready" shell: status ready + a single personal context.
// Advanced + Admin zones stay hidden (isGroup=false, isBotAdmin=false).
function applyReadySettingsSession(): void {
  settingsSession.status = 'ready'
  settingsSession.display = 'Alice'
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = [{ kind: 'personal', contextId: 'ctx-personal-1', label: 'Alice (personal)' }]
  settingsSession.activeContextId = 'ctx-personal-1'
}

export function resetAllSingletons(): void {
  adminState.currentSection = 'overview'
  adminState.lastRefreshedAt = null
  adminGlobals.window = '30d'
  adminGlobals.loading = false
  adminGlobals.data = null
  adminGlobals.fetchedAt = null
  resetSettingsSession()
}

// Runs before each story renders: resets rune singletons, clears any SSE
// connections from the previous story, then registers the scenario's MSW
// handlers and replays seed SSE events. getWorker is imported lazily so the
// happy-dom unit suite never pulls in msw/browser.
//
// `refreshGlobals: true` primes the adminGlobals rune through the real fetch
// path (served by the active scenario) so components that read adminGlobals.data
// without fetching themselves (e.g. OverviewSection) can show a populated state.
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

    if (context.parameters['refreshGlobals'] === true) await refreshGlobals()
    if (context.parameters['settingsReady'] === true) applyReadySettingsSession()

    const seed = context.parameters['sseSeed']
    if (Array.isArray(seed)) sseStub.seed(seed)
  }

  return {}
}
