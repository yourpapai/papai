import { emptyReporterState, reduceReporterState } from './progress-reporter-state.js'

export type BehaviorAuditPhase = 'phase1' | 'phase2a' | 'phase2b' | 'phase3'

export type BehaviorAuditProgressRenderer = 'auto' | 'text' | 'listr2'

export type ResolvedBehaviorAuditProgressRenderer = 'text' | 'listr2'

export type ProgressOutcome =
  | {
      readonly kind: 'done'
      readonly usage: {
        readonly inputTokens: number
        readonly outputTokens: number
        readonly toolCalls: number
      }
      readonly elapsedMs: number
    }
  | {
      readonly kind: 'failed'
      readonly detail: string
    }
  | {
      readonly kind: 'skipped'
      readonly detail: string
    }
  | {
      readonly kind: 'reused'
      readonly detail: string
    }

export type ProgressEvent =
  | {
      readonly kind: 'item-start'
      readonly phase: BehaviorAuditPhase
      readonly itemId: string
      readonly context: string
      readonly title: string
      readonly index: number
      readonly total: number
    }
  | {
      readonly kind: 'item-finish'
      readonly phase: BehaviorAuditPhase
      readonly itemId: string
      readonly context: string
      readonly title: string
      readonly outcome: ProgressOutcome
    }
  | {
      readonly kind: 'artifact-write'
      readonly phase: BehaviorAuditPhase
      readonly context: string
      readonly detail: string
    }

export interface BehaviorAuditProgressReporter {
  emit(event: ProgressEvent): void
  end(): void
}

export interface CreateProgressReporterInput {
  readonly renderer: BehaviorAuditProgressRenderer
  readonly isTTY: boolean
  readonly isTestEnvironment: boolean
  readonly log: (line: string) => void
}

interface TextProgressReporterOptions {
  readonly log: (line: string) => void
}

function assertUnreachable(_value: never): never {
  throw new Error('Unexpected progress reporter variant')
}

function supportsListr2Renderer(input: Omit<CreateProgressReporterInput, 'log'>): boolean {
  return input.isTTY && !input.isTestEnvironment
}

export function createTextProgressReporter(options: TextProgressReporterOptions): BehaviorAuditProgressReporter {
  let state = emptyReporterState

  return {
    emit(event): void {
      const next = reduceReporterState(state, event)
      state = next.state
      if (next.line !== null) {
        options.log(next.line)
      }
    },
    end(): void {
      state = emptyReporterState
    },
  }
}

export function resolveProgressRenderer(
  input: Omit<CreateProgressReporterInput, 'log'>,
): ResolvedBehaviorAuditProgressRenderer {
  switch (input.renderer) {
    case 'text':
      return 'text'
    case 'listr2':
      return supportsListr2Renderer(input) ? 'listr2' : 'text'
    case 'auto':
      return supportsListr2Renderer(input) ? 'listr2' : 'text'
  }

  return assertUnreachable(input.renderer)
}

function createListr2FallbackReporter(input: CreateProgressReporterInput): BehaviorAuditProgressReporter {
  return createTextProgressReporter({ log: input.log })
}

export function createProgressReporter(input: CreateProgressReporterInput): BehaviorAuditProgressReporter {
  const resolvedRenderer = resolveProgressRenderer(input)

  switch (resolvedRenderer) {
    case 'text':
      return createTextProgressReporter({ log: input.log })
    case 'listr2':
      return createListr2FallbackReporter(input)
  }

  return assertUnreachable(resolvedRenderer)
}
