import type { Phase1RunnerDeps } from './extract-phase1-types.js'
import { formatPerItemSuffix, recordItemDone, recordItemFailed, recordItemSkipped } from './phase-stats.js'

export function emitPhase1ItemStart(input: {
  readonly deps: Phase1RunnerDeps
  readonly itemId: string
  readonly context: string
  readonly title: string
  readonly index: number
  readonly total: number
}): void {
  if (input.deps.reporter === undefined) {
    return
  }

  input.deps.reporter.emit({
    kind: 'item-start',
    phase: 'phase1',
    itemId: input.itemId,
    context: input.context,
    title: input.title,
    index: input.index,
    total: input.total,
  })
}

export function reportPhase1Failure(input: {
  readonly deps: Phase1RunnerDeps
  readonly itemId: string
  readonly context: string
  readonly title: string
  readonly index: number
  readonly total: number
  readonly detail: string
  readonly usage: Parameters<typeof recordItemFailed>[1]
}): void {
  if (input.deps.reporter === undefined) {
    input.deps.log.log(`  [${input.index}/${input.total}] "${input.title}" (${input.detail}) ✗`)
  } else {
    input.deps.reporter.emit({
      kind: 'item-finish',
      phase: 'phase1',
      itemId: input.itemId,
      context: input.context,
      title: input.title,
      outcome: {
        kind: 'failed',
        detail: input.detail,
      },
    })
  }

  if (input.deps.stats !== undefined) {
    recordItemFailed(input.deps.stats, input.usage)
  }
}

export function reportPhase1Skipped(input: {
  readonly deps: Phase1RunnerDeps
  readonly itemId: string
  readonly context: string
  readonly title: string
  readonly index: number
  readonly total: number
}): void {
  if (input.deps.reporter === undefined) {
    input.deps.log.log(`  [${input.index}/${input.total}] "${input.title}" (skipped, max retries reached)`)
  } else {
    input.deps.reporter.emit({
      kind: 'item-finish',
      phase: 'phase1',
      itemId: input.itemId,
      context: input.context,
      title: input.title,
      outcome: {
        kind: 'skipped',
        detail: 'max retries reached',
      },
    })
  }

  if (input.deps.stats !== undefined) {
    recordItemSkipped(input.deps.stats)
  }
}

export function reportPhase1Success(input: {
  readonly deps: Phase1RunnerDeps
  readonly itemId: string
  readonly context: string
  readonly title: string
  readonly index: number
  readonly total: number
  readonly usage: Parameters<typeof formatPerItemSuffix>[0]
  readonly elapsedMs: number
}): void {
  if (input.deps.reporter === undefined) {
    input.deps.log.log(
      `  [${input.index}/${input.total}] "${input.title}"${formatPerItemSuffix(input.usage, input.elapsedMs)}`,
    )
  } else {
    input.deps.reporter.emit({
      kind: 'item-finish',
      phase: 'phase1',
      itemId: input.itemId,
      context: input.context,
      title: input.title,
      outcome: {
        kind: 'done',
        usage: {
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          toolCalls: input.usage.toolCalls,
        },
        elapsedMs: input.elapsedMs,
      },
    })
  }

  if (input.deps.stats !== undefined) {
    recordItemDone(input.deps.stats, input.usage)
  }
}

export function reportPhase1ArtifactWrite(input: {
  readonly deps: Phase1RunnerDeps
  readonly context: string
  readonly detail: string
}): void {
  if (input.deps.reporter === undefined) {
    input.deps.log.log(`  -> ${input.detail}`)
    return
  }

  input.deps.reporter.emit({
    kind: 'artifact-write',
    phase: 'phase1',
    context: input.context,
    detail: input.detail,
  })
}
