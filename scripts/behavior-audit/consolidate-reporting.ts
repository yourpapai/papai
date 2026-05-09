import { formatElapsedMs } from './config.js'
import { formatPerItemSuffix, type AgentUsage } from './phase-stats.js'
import type { BehaviorAuditProgressReporter } from './progress-reporter.js'

export type ConsolidationResultForReporting =
  | { readonly kind: 'consolidated'; readonly usage: AgentUsage }
  | { readonly kind: 'failed' }
  | { readonly kind: 'skipped' }

interface ConsolidationReportingInput {
  readonly reporter: BehaviorAuditProgressReporter | undefined
  readonly log: Pick<typeof console, 'log'>
  readonly featureKey: string
  readonly result: ConsolidationResultForReporting
  readonly elapsedMs: number
}

function emitReporterResult(input: ConsolidationReportingInput): boolean {
  if (input.reporter === undefined) {
    return false
  }

  switch (input.result.kind) {
    case 'consolidated':
      input.reporter.emit({
        kind: 'item-finish',
        phase: 'phase2b',
        itemId: input.featureKey,
        context: input.featureKey,
        title: input.featureKey,
        outcome: {
          kind: 'done',
          usage: {
            inputTokens: input.result.usage.inputTokens,
            outputTokens: input.result.usage.outputTokens,
            toolCalls: input.result.usage.toolCalls,
          },
          elapsedMs: input.elapsedMs,
        },
      })
      return true
    case 'failed':
      input.reporter.emit({
        kind: 'item-finish',
        phase: 'phase2b',
        itemId: input.featureKey,
        context: input.featureKey,
        title: input.featureKey,
        outcome: { kind: 'failed', detail: 'consolidation failed after retries' },
      })
      return true
    case 'skipped':
      input.reporter.emit({
        kind: 'item-finish',
        phase: 'phase2b',
        itemId: input.featureKey,
        context: input.featureKey,
        title: input.featureKey,
        outcome: { kind: 'skipped', detail: 'max retries reached' },
      })
      return true
  }

  return false
}

function logTextResult(input: ConsolidationReportingInput): void {
  switch (input.result.kind) {
    case 'consolidated':
      input.log.log(`  "${input.featureKey}"${formatPerItemSuffix(input.result.usage, input.elapsedMs)}`)
      break
    case 'failed':
      input.log.log(`  "${input.featureKey}" (${formatElapsedMs(input.elapsedMs)}) ✗`)
      break
    case 'skipped':
      input.log.log(`  "${input.featureKey}" (skipped)`)
      break
  }
}

export function reportConsolidationResult(input: ConsolidationReportingInput): void {
  if (emitReporterResult(input)) {
    return
  }

  logTextResult(input)
}
