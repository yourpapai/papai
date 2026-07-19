// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { createAsyncMutex, type AsyncMutex } from './async-mutex.js'
import { CONCURRENCY } from './config.js'
import { resolveSelection, shouldSkip, type ParsedBehavior } from './evaluate-phase3-helpers.js'
import { emitPhase3ItemStart, reportPhase3Failure, reportPhase3Success } from './evaluate-progress.js'
import type { Phase3Deps } from './evaluate.ts'
import type { EvaluatedFeatureRecord } from './evaluated-store.js'
import { recordItemDone } from './phase-stats.js'
import type { Progress } from './progress.js'

type EvaluationAgentResult = NonNullable<Awaited<ReturnType<Phase3Deps['evaluateWithRetry']>>>

function buildSuccessfulEvaluation(
  behavior: ParsedBehavior,
  agentResult: EvaluationAgentResult,
  elapsedMs: number,
): {
  readonly evaluation: EvaluatedFeatureRecord
  readonly usage: EvaluationAgentResult['usage']
  readonly elapsedMs: number
} {
  return {
    evaluation: {
      consolidatedId: behavior.consolidatedId,
      maria: agentResult.result.maria,
      dani: agentResult.result.dani,
      viktor: agentResult.result.viktor,
      flaws: agentResult.result.flaws,
      improvements: agentResult.result.improvements,
      evaluatedAt: new Date().toISOString(),
    },
    usage: agentResult.usage,
    elapsedMs,
  }
}

async function handleFailedEvaluation(input: {
  readonly behavior: ParsedBehavior
  readonly index: number
  readonly total: number
  readonly progress: Progress
  readonly deps: Phase3Deps
  readonly elapsedMs: number
  readonly mutex: AsyncMutex
}): Promise<{ readonly kind: 'failed' }> {
  const attempts = input.deps.getFailedBehaviorAttempts(input.progress, input.behavior.consolidatedId) + 1
  input.deps.markBehaviorFailed(
    input.progress,
    input.behavior.consolidatedId,
    'evaluation failed after retries',
    attempts,
  )
  await input.mutex('progress', () => input.deps.saveProgress(input.progress))
  reportPhase3Failure({
    deps: input.deps,
    behavior: input.behavior,
    index: input.index,
    total: input.total,
    elapsedMs: input.elapsedMs,
  })
  return { kind: 'failed' }
}

async function evaluateSingleBehavior(input: {
  readonly behavior: ParsedBehavior
  readonly index: number
  readonly total: number
  readonly progress: Progress
  readonly deps: Phase3Deps
  readonly buildPrompt: (behavior: ParsedBehavior) => string
  readonly mutex: AsyncMutex
}): Promise<
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'succeeded'
      readonly evaluation: EvaluatedFeatureRecord
      readonly usage: EvaluationAgentResult['usage']
      readonly elapsedMs: number
    }
> {
  emitPhase3ItemStart({
    deps: input.deps,
    behavior: input.behavior,
    index: input.index,
    total: input.total,
  })

  const startedAtMs = performance.now()
  const agentResult = await input.deps.evaluateWithRetry(input.buildPrompt(input.behavior))
  const elapsedMs = performance.now() - startedAtMs
  if (agentResult === null) {
    return handleFailedEvaluation({
      behavior: input.behavior,
      index: input.index,
      total: input.total,
      progress: input.progress,
      deps: input.deps,
      elapsedMs,
      mutex: input.mutex,
    })
  }

  return {
    kind: 'succeeded',
    ...buildSuccessfulEvaluation(input.behavior, agentResult, elapsedMs),
  }
}

function buildCollectedEvaluationItem(input: {
  readonly behavior: ParsedBehavior
  readonly result: Extract<Awaited<ReturnType<typeof evaluateSingleBehavior>>, { readonly kind: 'succeeded' }>
  readonly index: number
  readonly total: number
}): {
  readonly kind: 'succeeded'
  readonly item: {
    readonly behavior: ParsedBehavior
    readonly evaluation: EvaluatedFeatureRecord
    readonly usage: EvaluationAgentResult['usage']
    readonly elapsedMs: number
    readonly index: number
    readonly total: number
  }
} {
  return {
    kind: 'succeeded',
    item: {
      behavior: input.behavior,
      evaluation: input.result.evaluation,
      usage: input.result.usage,
      elapsedMs: input.result.elapsedMs,
      index: input.index,
      total: input.total,
    },
  }
}

async function collectOneEvaluation(input: {
  readonly behavior: ParsedBehavior
  readonly index: number
  readonly total: number
  readonly progress: Progress
  readonly selection: ReturnType<typeof resolveSelection>
  readonly deps: Phase3Deps
  readonly buildPrompt: (behavior: ParsedBehavior) => string
  readonly mutex: AsyncMutex
}): Promise<
  | {
      readonly kind: 'skipped'
    }
  | {
      readonly kind: 'succeeded'
      readonly item: {
        readonly behavior: ParsedBehavior
        readonly evaluation: EvaluatedFeatureRecord
        readonly usage: EvaluationAgentResult['usage']
        readonly elapsedMs: number
        readonly index: number
        readonly total: number
      }
    }
> {
  if (shouldSkip(input.behavior, input.selection, input.progress, input.deps)) {
    return { kind: 'skipped' }
  }

  const result = await evaluateSingleBehavior({
    behavior: input.behavior,
    index: input.index,
    total: input.total,
    progress: input.progress,
    deps: input.deps,
    buildPrompt: input.buildPrompt,
    mutex: input.mutex,
  })
  if (result.kind === 'failed') {
    return { kind: 'skipped' }
  }

  return buildCollectedEvaluationItem({
    behavior: input.behavior,
    result,
    index: input.index,
    total: input.total,
  })
}

export async function collectNewEvaluations(input: {
  readonly behaviors: readonly ParsedBehavior[]
  readonly selection: ReturnType<typeof resolveSelection>
  readonly progress: Progress
  readonly deps: Phase3Deps
  readonly buildPrompt: (behavior: ParsedBehavior) => string
}): Promise<
  readonly {
    readonly behavior: ParsedBehavior
    readonly evaluation: EvaluatedFeatureRecord
    readonly usage: EvaluationAgentResult['usage']
    readonly elapsedMs: number
    readonly index: number
    readonly total: number
  }[]
> {
  const collected: Array<{
    readonly behavior: ParsedBehavior
    readonly evaluation: EvaluatedFeatureRecord
    readonly usage: EvaluationAgentResult['usage']
    readonly elapsedMs: number
    readonly index: number
    readonly total: number
  }> = []
  const mutex = createAsyncMutex()
  const limit = pLimit(CONCURRENCY)
  await Promise.all(
    input.behaviors.map((behavior, index) =>
      limit(async () => {
        const collectedItem = await collectOneEvaluation({
          behavior,
          index: index + 1,
          total: input.behaviors.length,
          progress: input.progress,
          selection: input.selection,
          deps: input.deps,
          buildPrompt: input.buildPrompt,
          mutex,
        })
        if (collectedItem.kind === 'succeeded') {
          collected.push(collectedItem.item)
        }
      }),
    ),
  )
  return collected
}

export function finalizeCollectedEvaluations(input: {
  readonly collected: readonly {
    readonly behavior: ParsedBehavior
    readonly usage: EvaluationAgentResult['usage']
    readonly elapsedMs: number
    readonly index: number
    readonly total: number
  }[]
  readonly progress: Progress
  readonly deps: Phase3Deps
}): void {
  for (const item of input.collected) {
    input.deps.markBehaviorDone(input.progress, item.behavior.consolidatedId)
    recordItemDone(input.deps.stats, item.usage)
    reportPhase3Success({
      deps: input.deps,
      behavior: item.behavior,
      usage: item.usage,
      elapsedMs: item.elapsedMs,
      index: item.index,
      total: item.total,
    })
  }
}
