// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type PromptRegressionOwnerArea =
  | 'prompt'
  | 'context'
  | 'tools'
  | 'orchestration'
  | 'safety'
  | 'tool-context-reduction'

export type PromptRegressionPhase = 'phase-0' | 'phase-1' | 'phase-2' | 'phase-3' | 'phase-4' | 'phase-5'

export interface PromptRegressionFixtureMeta {
  readonly id: string
  readonly description: string
  readonly ownerArea: PromptRegressionOwnerArea
  readonly roadmapPhase: PromptRegressionPhase
  readonly pending?: {
    readonly reason: string
    readonly expectedFixPhase: Exclude<PromptRegressionPhase, 'phase-0'>
    readonly unskipWhen: string
  }
}

export type PromptRegressionContextType = 'dm' | 'group' | 'proactive' | 'providerless'
export type PromptRegressionProvider = 'kaneo' | 'youtrack' | 'providerless'

export interface PromptRegressionSetup {
  readonly contextType: PromptRegressionContextType
  readonly provider: PromptRegressionProvider
  readonly contextId?: string
  readonly chatUserId?: string
  readonly enabledTools?: readonly string[]
  readonly deniedTools?: readonly string[]
  readonly askTools?: readonly string[]
  readonly memory?: 'none' | 'compacted' | 'long-term' | 'compacted-and-long-term' | 'stale'
  readonly flags?: Readonly<Record<string, boolean>>
}

export interface PromptTextExpectations {
  readonly sectionOrder?: readonly string[]
  readonly mustContain?: readonly string[]
  readonly mustNotContain?: readonly string[]
}

export interface ToolExpectations {
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
}

export interface AssemblyFixture {
  readonly kind: 'assembly'
  readonly meta: PromptRegressionFixtureMeta
  readonly setup: PromptRegressionSetup
  readonly expected: {
    readonly prompt?: PromptTextExpectations
    readonly tools?: ToolExpectations
  }
}

export type TraceFinalClassification =
  | 'completes_action'
  | 'asks_clarification'
  | 'asks_confirmation'
  | 'declines_unsafe_action'
  | 'reports_retryable_failure'
  | 'reports_non_retryable_failure'
  | 'requests_permission'
  | 'answers_without_tools'

export type TraceScriptStep =
  | { readonly type: 'assistant_text'; readonly text: string }
  | {
      readonly type: 'tool_call'
      readonly toolName: string
      readonly toolCallId: string
      readonly input: unknown
      readonly output?: unknown
      readonly error?: string
    }

export interface TraceFixture {
  readonly kind: 'trace'
  readonly meta: PromptRegressionFixtureMeta
  readonly setup: PromptRegressionSetup
  readonly script: readonly TraceScriptStep[]
  readonly expected: {
    readonly toolCalls?: readonly string[]
    readonly forbiddenToolCalls?: readonly string[]
    readonly finalClassification: TraceFinalClassification
    readonly finalReplyMustContain?: readonly string[]
  }
}

export type PromptRegressionFixture = AssemblyFixture | TraceFixture
