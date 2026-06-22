// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProvider } from '../../../src/providers/types.js'
import { partitionToolNames, setToolPrefs, type ToolPrefs } from '../../../src/tools/tool-preferences.js'
import { createMockProvider } from '../../tools/mock-provider.js'
import type { PromptRegressionSetup } from './fixture-types.js'

export interface BuiltPromptRegressionContext {
  readonly contextId: string
  readonly chatUserId: string
  readonly provider: TaskProvider | null
  readonly enabledToolNames: ReadonlySet<string>
}

function buildToolPrefs(setup: PromptRegressionSetup): ToolPrefs {
  const toolOverrides: Record<string, 'allow' | 'deny' | 'ask'> = {}
  for (const name of setup.deniedTools ?? []) toolOverrides[name] = 'deny'
  for (const name of setup.askTools ?? []) toolOverrides[name] = 'ask'
  return { domainDefaults: {}, toolOverrides }
}

export function buildPromptRegressionContext(
  setup: PromptRegressionSetup,
  fixtureId?: string,
): BuiltPromptRegressionContext {
  const contextId =
    setup.contextId ?? (fixtureId === undefined ? `ctx-${setup.contextType}-${setup.provider}` : `ctx-${fixtureId}`)
  const chatUserId = setup.chatUserId ?? 'user-prompt-regression'
  const provider = setup.provider === 'providerless' ? null : createMockProvider()
  const configuredToolNames = setup.enabledTools ?? ['get_current_time']

  const prefs = buildToolPrefs(setup)
  if (Object.keys(prefs.toolOverrides).length > 0) setToolPrefs(contextId, prefs)
  const enabledToolNames = partitionToolNames(prefs, configuredToolNames).exposed

  return { contextId, chatUserId, provider, enabledToolNames }
}
