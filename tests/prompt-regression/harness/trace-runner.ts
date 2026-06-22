// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assertContainsAll } from './assertions.js'
import type { TraceFinalClassification, TraceFixture } from './fixture-types.js'
import { buildScriptedTrace, classifyFinalReply } from './scripted-model.js'

export interface TraceFixtureResult {
  readonly toolCalls: readonly string[]
  readonly finalText: string
  readonly finalClassification: TraceFinalClassification
}

export function runTraceFixture(fixture: TraceFixture): TraceFixtureResult {
  const trace = buildScriptedTrace(fixture.script)
  const toolCalls = trace.toolCalls.map((call) => call.toolName)
  const finalClassification = classifyFinalReply(trace.finalText)

  for (const expected of fixture.expected.toolCalls ?? []) {
    if (!toolCalls.includes(expected)) throw new Error(`Expected trace to call ${expected}`)
  }
  for (const forbidden of fixture.expected.forbiddenToolCalls ?? []) {
    if (toolCalls.includes(forbidden)) throw new Error(`Expected trace not to call ${forbidden}`)
  }
  if (finalClassification !== fixture.expected.finalClassification) {
    throw new Error(
      `Expected final classification ${fixture.expected.finalClassification}, received ${finalClassification}`,
    )
  }

  assertContainsAll(trace.finalText, fixture.expected.finalReplyMustContain)

  return { toolCalls, finalText: trace.finalText, finalClassification }
}
