import type { BehaviorAuditPhase, ProgressEvent, ProgressOutcome } from './progress-reporter.js'

export interface StartedItem {
  readonly phase: BehaviorAuditPhase
  readonly context: string
  readonly itemId: string
  readonly title: string
  readonly index: number
  readonly total: number
}

export interface ReporterState {
  readonly startedItems: Readonly<Record<string, StartedItem>>
}

function assertUnreachable(_value: never): never {
  throw new Error('Unexpected progress reporter variant')
}

export const emptyReporterState: ReporterState = {
  startedItems: {},
}

function toPhaseLabel(phase: BehaviorAuditPhase): string {
  switch (phase) {
    case 'phase1':
      return 'Phase 1'
    case 'phase2a':
      return 'Phase 2a'
    case 'phase2b':
      return 'Phase 2b'
    case 'phase3':
      return 'Phase 3'
  }

  return assertUnreachable(phase)
}

function renderIndexedPrefix(item: StartedItem): string {
  return `[${toPhaseLabel(item.phase)}] [${item.context}] [${item.index}/${item.total}] "${item.title}"`
}

function renderFallbackPrefix(event: Extract<ProgressEvent, { readonly kind: 'item-finish' }>): string {
  return `[${toPhaseLabel(event.phase)}] [${event.context}] "${event.title}"`
}

function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString('en-US')
}

function formatElapsed(elapsedMs: number): string {
  return elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`
}

function computeTokensPerSecond(outputTokens: number, elapsedMs: number): number {
  if (elapsedMs <= 0) {
    return 0
  }

  return Math.round(outputTokens / (elapsedMs / 1000))
}

function renderDoneSuffix(outcome: Extract<ProgressOutcome, { readonly kind: 'done' }>): string {
  const totalTokens = outcome.usage.inputTokens + outcome.usage.outputTokens
  const toolLabel = outcome.usage.toolCalls === 1 ? '1 tool' : `${outcome.usage.toolCalls} tools`
  return ` — ${toolLabel}, ${formatTokenCount(totalTokens)} tok in ${formatElapsed(outcome.elapsedMs)} (${computeTokensPerSecond(outcome.usage.outputTokens, outcome.elapsedMs)} tok/s) ✓`
}

function renderItemFinishLine(
  event: Extract<ProgressEvent, { readonly kind: 'item-finish' }>,
  item: StartedItem | undefined,
): string {
  const prefix = item === undefined ? renderFallbackPrefix(event) : renderIndexedPrefix(item)

  switch (event.outcome.kind) {
    case 'done':
      return `${prefix}${renderDoneSuffix(event.outcome)}`
    case 'failed':
      return `${prefix} — ${event.outcome.detail} ✗`
    case 'skipped':
      return `${prefix} — ${event.outcome.detail} (skipped)`
    case 'reused':
      return `${prefix} — ${event.outcome.detail} (reused)`
  }

  return assertUnreachable(event.outcome)
}

function toStartedItemKey(input: {
  readonly phase: BehaviorAuditPhase
  readonly context: string
  readonly itemId: string
}): string {
  return `${input.phase}\u0000${input.context}\u0000${input.itemId}`
}

function omitKey(record: Readonly<Record<string, StartedItem>>, key: string): Readonly<Record<string, StartedItem>> {
  const { [key]: _removed, ...remaining } = record
  return remaining
}

function getStartedItem(
  startedItems: Readonly<Record<string, StartedItem>>,
  event: Extract<ProgressEvent, { readonly kind: 'item-finish' }>,
): StartedItem | undefined {
  const exactMatch = startedItems[toStartedItemKey(event)]
  if (exactMatch !== undefined) {
    return exactMatch
  }

  const samePhaseMatches = Object.values(startedItems).filter(
    (item) => item.itemId === event.itemId && item.phase === event.phase,
  )

  if (samePhaseMatches.length === 1) {
    return samePhaseMatches[0]
  }

  return undefined
}

function getStartedItemForCleanup(
  startedItems: Readonly<Record<string, StartedItem>>,
  event: Extract<ProgressEvent, { readonly kind: 'item-finish' }>,
): StartedItem | undefined {
  const renderedItem = getStartedItem(startedItems, event)
  if (renderedItem !== undefined) {
    return renderedItem
  }

  return Object.values(startedItems).find((item) => item.itemId === event.itemId && item.phase === event.phase)
}

function removeStartedItem(
  startedItems: Readonly<Record<string, StartedItem>>,
  matchedItem: StartedItem | undefined,
): Readonly<Record<string, StartedItem>> {
  if (matchedItem === undefined) {
    return startedItems
  }

  return omitKey(startedItems, toStartedItemKey(matchedItem))
}

function renderArtifactWriteLine(event: Extract<ProgressEvent, { readonly kind: 'artifact-write' }>): string {
  return `[${toPhaseLabel(event.phase)}] [${event.context}] ${event.detail}`
}

export function reduceReporterState(
  state: ReporterState,
  event: ProgressEvent,
): {
  readonly state: ReporterState
  readonly line: string | null
} {
  switch (event.kind) {
    case 'item-start': {
      const startedItem = {
        phase: event.phase,
        context: event.context,
        itemId: event.itemId,
        title: event.title,
        index: event.index,
        total: event.total,
      } satisfies StartedItem
      return {
        state: {
          startedItems: {
            ...state.startedItems,
            [toStartedItemKey(startedItem)]: startedItem,
          },
        },
        line: null,
      }
    }
    case 'item-finish': {
      const startedItem = getStartedItem(state.startedItems, event)
      const startedItemForCleanup = getStartedItemForCleanup(state.startedItems, event)
      return {
        state: {
          startedItems: removeStartedItem(state.startedItems, startedItemForCleanup),
        },
        line: renderItemFinishLine(event, startedItem),
      }
    }
    case 'artifact-write':
      return {
        state,
        line: renderArtifactWriteLine(event),
      }
  }

  return assertUnreachable(event)
}
