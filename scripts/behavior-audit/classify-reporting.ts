import { formatElapsedMs } from './config.js'
import { formatPerItemSuffix, type AgentUsage } from './phase-stats.js'
import type { BehaviorAuditProgressReporter, ProgressOutcome } from './progress-reporter.js'

export type ClassificationResultForReporting =
  | { readonly kind: 'reused'; readonly usage: null }
  | { readonly kind: 'classified'; readonly usage: AgentUsage | null }
  | { readonly kind: 'failed'; readonly usage: null }

interface ClassificationReportingInput {
  readonly reporter: BehaviorAuditProgressReporter | undefined
  readonly log: Pick<typeof console, 'log'>
  readonly itemId: string
  readonly context: string
  readonly title: string
  readonly displayIndex: number
  readonly displayTotal: number
  readonly result: ClassificationResultForReporting
  readonly elapsedMs: number
}

function toDoneOutcome(
  usage: AgentUsage | null,
  elapsedMs: number,
): Extract<ProgressOutcome, { readonly kind: 'done' }> {
  if (usage === null) {
    return {
      kind: 'done' as const,
      usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0 },
      elapsedMs,
    }
  }

  return {
    kind: 'done' as const,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      toolCalls: usage.toolCalls,
    },
    elapsedMs,
  }
}

function emitReporterResult(input: ClassificationReportingInput): boolean {
  if (input.reporter === undefined) {
    return false
  }

  switch (input.result.kind) {
    case 'reused':
      input.reporter.emit({
        kind: 'item-finish',
        phase: 'phase2a',
        itemId: input.itemId,
        context: input.context,
        title: input.title,
        outcome: { kind: 'reused', detail: 'already classified' },
      })
      return true
    case 'classified':
      input.reporter.emit({
        kind: 'item-finish',
        phase: 'phase2a',
        itemId: input.itemId,
        context: input.context,
        title: input.title,
        outcome: toDoneOutcome(input.result.usage, input.elapsedMs),
      })
      return true
    case 'failed':
      input.reporter.emit({
        kind: 'item-finish',
        phase: 'phase2a',
        itemId: input.itemId,
        context: input.context,
        title: input.title,
        outcome: { kind: 'failed', detail: 'classification failed after retries' },
      })
      return true
  }

  return false
}

function logTextResult(input: ClassificationReportingInput): void {
  const prefix = `[Phase 2a] [${input.context}] [${input.displayIndex}/${input.displayTotal}] "${input.title}"`

  switch (input.result.kind) {
    case 'reused':
      input.log.log(`${prefix} (reused)`)
      break
    case 'classified':
      input.log.log(
        input.result.usage === null
          ? `${prefix} (${formatElapsedMs(input.elapsedMs)}) ✓`
          : `${prefix}${formatPerItemSuffix(input.result.usage, input.elapsedMs)}`,
      )
      break
    case 'failed':
      input.log.log(`${prefix} (${formatElapsedMs(input.elapsedMs)}) ✗`)
      break
  }
}

export function reportClassificationResult(input: ClassificationReportingInput): void {
  if (emitReporterResult(input)) {
    return
  }

  logTextResult(input)
}
