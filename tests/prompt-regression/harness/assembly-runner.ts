// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildProviderlessSystemPrompt, buildSystemPrompt } from '../../../src/system-prompt.js'
import { assertContainsAll, assertContainsNone, assertInOrder, normalizePromptText } from './assertions.js'
import { buildPromptRegressionContext } from './context-builders.js'
import type { AssemblyFixture } from './fixture-types.js'

export interface AssemblyFixtureResult {
  readonly prompt: string
  readonly enabledToolNames: readonly string[]
}

export function evaluateAssemblyFixture(fixture: AssemblyFixture): AssemblyFixtureResult {
  const ctx = buildPromptRegressionContext(fixture.setup, fixture.meta.id)
  const prompt =
    ctx.provider === null
      ? buildProviderlessSystemPrompt(ctx.contextId, ctx.enabledToolNames, { askPermissionAvailable: true })
      : buildSystemPrompt(ctx.provider, ctx.contextId, ctx.enabledToolNames, { askPermissionAvailable: true })

  return {
    prompt: normalizePromptText(prompt),
    enabledToolNames: [...ctx.enabledToolNames].toSorted(),
  }
}

export function runAssemblyFixture(fixture: AssemblyFixture): AssemblyFixtureResult {
  const result = evaluateAssemblyFixture(fixture)
  const expectedPrompt = fixture.expected.prompt
  const expectedTools = fixture.expected.tools

  assertContainsAll(result.prompt, expectedPrompt?.mustContain)
  assertContainsNone(result.prompt, expectedPrompt?.mustNotContain)
  assertInOrder(result.prompt, expectedPrompt?.sectionOrder)

  for (const name of expectedTools?.include ?? []) {
    if (!result.enabledToolNames.includes(name)) throw new Error(`Expected active tool ${name}`)
  }
  for (const name of expectedTools?.exclude ?? []) {
    if (result.enabledToolNames.includes(name)) throw new Error(`Expected inactive tool ${name}`)
  }

  return result
}
