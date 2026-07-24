// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  AnalyticsEventName,
  ContextType,
  EventProps,
  IntentV1,
  InvocationMode,
  Platform,
  TaskProvider,
} from './fixture-contract.js'

export type AssignedTaskProvider = Exclude<TaskProvider, 'none'>
export type TurnOutcome = 'success' | 'failure' | 'recovered' | 'abandoned'
export type ToolDomain = 'task' | 'memo' | 'schedule' | 'attachment' | 'web' | 'identity' | 'coding' | 'config' | 'meta'
export type ToolRisk = 'read' | 'write' | 'destructive' | 'open_world'

export interface Actor {
  readonly index: number
  readonly actorKey: string
  readonly platform: Platform
  readonly actorRole: 'admin' | 'member'
  readonly engagementContext: Exclude<ContextType, 'none'>
  readonly assignedProvider: AssignedTaskProvider
  readonly cohortDay: number
  readonly hasConfigLink: boolean
  readonly hasSettingsOpen: boolean
  readonly hasTaskAssignment: boolean
  readonly hasFirstMutatingSuccess: boolean
}

export interface ToolSpec {
  readonly slug: string
  readonly domain: ToolDomain
  readonly risk: ToolRisk
  readonly origin: 'core' | 'first_party_plugin' | 'external_plugin' | 'user_mcp'
  readonly providerOperation: 'read' | 'search' | 'create' | 'update' | 'delete' | 'connect' | 'stream' | 'other'
}

export interface IntentSpec {
  readonly intent: IntentV1
  readonly tool: ToolSpec | null
}

export interface TurnInput {
  readonly actor: Actor
  readonly day: number
  readonly slot: number
  readonly baseAtMs: number
  readonly contextType: Exclude<ContextType, 'none'>
  readonly invocationMode: InvocationMode
  readonly intent: IntentSpec
  readonly requestedOutcome: TurnOutcome
  readonly taskProvider: TaskProvider
  readonly allowMutatingSuccess: boolean
  readonly forceLlmSuccess?: boolean
  readonly followup?: boolean
}

export interface ActorEventInput {
  readonly idSeed: string
  readonly occurredAtMs: number
  readonly eventName: AnalyticsEventName
  readonly contextType: Exclude<ContextType, 'none'>
  readonly invocationMode: InvocationMode
  readonly taskProvider: TaskProvider
  readonly turnKey?: string | null
  readonly sessionKey?: string | null
  readonly props: EventProps
}

export interface FixtureSummary {
  readonly seed: string
  readonly eventCount: number
  readonly actorCount: number
  readonly activeDateCount: number
  readonly duplicateAttempts: number
  readonly duplicateRowsIgnored: number
  readonly outOfOrderRows: number
  readonly outOfOrderRatio: number
  readonly firstOccurredAtMs: number
  readonly lastOccurredAtMs: number
}
