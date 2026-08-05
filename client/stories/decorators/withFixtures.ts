// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpHandler } from 'msw'
import type { MswApi } from 'msw-storybook-addon'

import { adminState } from '../../admin/admin.svelte.js'
import { adminGlobals, refreshGlobals } from '../../admin/global-stats.svelte.js'
import { settingsSession } from '../../settings/session.svelte.js'
import { scenarios } from '../msw/scenarios.js'
import { sseStub } from '../stubs/sse.js'

const scenarioMap: Record<string, readonly HttpHandler[]> = scenarios

interface LoaderContext {
  parameters: Record<string, unknown>
  msw?: MswApi
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

// Ready shell for personal, group, or admin mode.
// Admin mode sets both isBotAdmin and isSuperAdmin to expose the full Admin zone.
export function applyReadySettingsSession(mode: 'personal' | 'group' | 'admin' = 'personal'): void {
  settingsSession.status = 'ready'
  settingsSession.display = 'Alice'
  settingsSession.isBotAdmin = mode === 'admin'
  settingsSession.isSuperAdmin = mode === 'admin'
  const ctx =
    mode === 'group'
      ? { kind: 'group' as const, contextId: 'ctx-group-1', label: 'Acme team' }
      : { kind: 'personal' as const, contextId: 'ctx-personal-1', label: 'Alice (personal)' }
  settingsSession.contexts = [ctx]
  settingsSession.activeContextId = ctx.contextId
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
// handlers and replays seed SSE events. The MSW worker comes from context.msw,
// installed by mswLoader, which `.storybook/preview.ts` awaits before calling
// this function — sibling loaders in one array run through `Promise.all`, so
// being listed after mswLoader would not have been enough. This file never
// imports msw/browser itself, so the happy-dom unit suite never pulls it in.
//
// `refreshGlobals: true` primes the adminGlobals rune through the real fetch
// path (served by the active scenario) so components that read adminGlobals.data
// without fetching themselves (e.g. OverviewSection) can show a populated state.
export async function fixturesLoader(context: LoaderContext): Promise<Record<string, never>> {
  resetAllSingletons()
  sseStub.reset()

  const scenario = context.parameters['fixtures']
  if (typeof scenario === 'string') {
    const worker = context.msw
    if (worker !== undefined) {
      worker.resetHandlers()
      const handlers = resolveScenario(scenario)
      if (handlers.length > 0) worker.use(...handlers)
    }

    if (context.parameters['refreshGlobals'] === true) await refreshGlobals()
    const ready = context.parameters['settingsReady']
    if (ready === true || ready === 'personal') applyReadySettingsSession('personal')
    else if (ready === 'group') applyReadySettingsSession('group')
    else if (ready === 'admin') applyReadySettingsSession('admin')

    const seed = context.parameters['sseSeed']
    if (Array.isArray(seed)) sseStub.seed(seed)
  }

  return {}
}
