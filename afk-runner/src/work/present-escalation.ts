// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { autonomyOf } from '../config.js'
import type { RunnerConfig } from '../config.js'
import { STAGE_FAILURE_BUDGET } from '../drive/failure-budget.js'
import type { WorkIO } from '../drive/loop.js'
import type { SddEvent } from '../events.js'
import { readEvents } from '../events.js'
import { pipelineMachine } from '../graph/pipeline.js'
import { foldEvents } from '../kernel/fold.js'
import { evaluateEscalationGate } from './auto-policy.js'
import type { EscalationFailureRow } from './gate-render.js'
import { renderEscalationGate } from './gate-render.js'

export interface PresentEscalationDeps {
  readonly config: RunnerConfig
  readonly repoRoot: string
  readonly changeName: string
  readonly runId: string
}

export interface PresentEscalationResult {
  readonly version: number
  readonly rule: 'R5' | 'none'
}

function sumTokens(usage: {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedReadTokens: number
  cachedWriteTokens: number
}): number {
  return (
    usage.inputTokens + usage.outputTokens + usage.reasoningTokens + usage.cachedReadTokens + usage.cachedWriteTokens
  )
}

/** Spend and metering over the log's done events — the same rule gate-signals uses. */
function spendOf(events: readonly SddEvent[]): { readonly spentUsd: number; readonly costKnown: boolean } {
  const spentUsd = events
    .filter((event) => event.type === 'done')
    .reduce((sum, event) => (event.type === 'done' ? sum + event.usage.costUsd : sum), 0)
  const costKnown = events.every(
    (event) => event.type !== 'done' || event.usage.costUsd > 0 || sumTokens(event.usage) === 0,
  )
  return { spentUsd, costKnown }
}

/** The failure ledger rows for the stage — kind, reason, resume hint per declared failure. */
function failureRowsOf(events: readonly SddEvent[], stage: string): readonly EscalationFailureRow[] {
  return events.flatMap((event) =>
    event.type === 'stage_failed' && event.stage === stage
      ? [
          {
            kind: event.kind,
            reason: event.reason,
            ...(event.resumeHint === undefined ? {} : { resumeHint: event.resumeHint }),
          },
        ]
      : [],
  )
}

/**
 * The escalation presentation (C6 D4): file-first `gate-<v>.md` (failure
 * ledger, resume hint, budget math, spend), then the `gate presented` event
 * IS the position mover — interstitial, from the failed stage's position
 * while the map keeps that stage active — then the always-logging ladder
 * (R5 over-ceiling/unknown-cost with extend suppressed, else rule none).
 * Ordering makes every pre-presented crash heal as the owed escalation (W5/W6).
 */
export async function presentEscalationGate(
  deps: PresentEscalationDeps,
  io: WorkIO,
  stage: string,
): Promise<PresentEscalationResult> {
  const runDir = io.runDir
  const logPath = path.join(runDir, 'events.ndjson')
  const events = readEvents(logPath)
  const context = foldEvents(pipelineMachine, events).snapshot.context
  const version = (context.gate?.version ?? 0) + 1
  const autonomy = autonomyOf(deps.config)
  const spend = spendOf(events)
  const decision = evaluateEscalationGate({ ...spend, config: autonomy })
  const failures = failureRowsOf(events, stage)
  const md = renderEscalationGate({
    version,
    changeName: deps.changeName,
    runId: deps.runId,
    stage,
    failures,
    budget: STAGE_FAILURE_BUDGET,
    spendUsd: spend.spentUsd,
    costKnown: spend.costKnown,
    extendOffered: decision.rule !== 'R5',
  })
  await writeFile(path.join(runDir, `gate-${version}.md`), `${md}\n`)
  const deadlineAt =
    autonomy.deadlineMinutes === undefined
      ? undefined
      : new Date(Date.now() + autonomy.deadlineMinutes * 60_000).toISOString()
  io.append({
    altitude: 'L2',
    type: 'gate',
    action: 'presented',
    mode: 'escalation',
    version,
    ...(deadlineAt === undefined ? {} : { deadlineAt }),
  })
  io.append({
    altitude: 'L2',
    type: 'auto_decision',
    rule: decision.rule,
    decision: 'gate',
    evidenceDigest: decision.evidenceDigest,
    gateVersion: version,
  })
  return { version, rule: decision.rule === 'R5' ? 'R5' : 'none' }
}
