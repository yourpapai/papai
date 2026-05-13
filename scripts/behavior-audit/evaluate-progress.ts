import { formatElapsedMs } from './config.js'
import type { ParsedBehavior } from './evaluate-phase3-helpers.js'
import { formatPerItemSuffix, recordItemFailed, type AgentUsage, type PhaseStats } from './phase-stats.js'
import type { BehaviorAuditProgressReporter } from './progress-reporter.js'

export interface Phase3ReportingDeps {
  readonly log: Pick<typeof console, 'log'>
  readonly reporter: BehaviorAuditProgressReporter | undefined
  readonly stats: PhaseStats | undefined
}

export function emitPhase3ItemStart(input: {
  readonly deps: Phase3ReportingDeps
  readonly behavior: ParsedBehavior
  readonly index: number
  readonly total: number
}): void {
  if (input.deps.reporter === undefined) {
    return
  }

  input.deps.reporter.emit({
    kind: 'item-start',
    phase: 'phase3',
    itemId: input.behavior.consolidatedId,
    context: input.behavior.domain,
    title: input.behavior.featureName,
    index: input.index,
    total: input.total,
  })
}

export function reportPhase3Failure(input: {
  readonly deps: Phase3ReportingDeps
  readonly behavior: ParsedBehavior
  readonly index: number
  readonly total: number
  readonly elapsedMs: number
}): void {
  const fallbackPrefix = `[Phase 3] [${input.behavior.domain}] [${input.index}/${input.total}] "${input.behavior.featureName}"`
  if (input.deps.reporter === undefined) {
    input.deps.log.log(`${fallbackPrefix} (${formatElapsedMs(input.elapsedMs)}) ✗`)
  } else {
    input.deps.reporter.emit({
      kind: 'item-finish',
      phase: 'phase3',
      itemId: input.behavior.consolidatedId,
      context: input.behavior.domain,
      title: input.behavior.featureName,
      outcome: {
        kind: 'failed',
        detail: 'evaluation failed after retries',
      },
    })
  }

  if (input.deps.stats !== undefined) {
    recordItemFailed(input.deps.stats)
  }
}

export function reportPhase3Success(input: {
  readonly deps: Phase3ReportingDeps
  readonly behavior: ParsedBehavior
  readonly usage: AgentUsage
  readonly elapsedMs: number
  readonly index: number
  readonly total: number
}): void {
  const fallbackPrefix = `[Phase 3] [${input.behavior.domain}] [${input.index}/${input.total}] "${input.behavior.featureName}"`
  if (input.deps.reporter === undefined) {
    input.deps.log.log(`${fallbackPrefix}${formatPerItemSuffix(input.usage, input.elapsedMs)}`)
    return
  }

  input.deps.reporter.emit({
    kind: 'item-finish',
    phase: 'phase3',
    itemId: input.behavior.consolidatedId,
    context: input.behavior.domain,
    title: input.behavior.featureName,
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
