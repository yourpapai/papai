// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  ClarificationAbandonedFact,
  ClarificationRequestedFact,
  ConfigLinkIssuedFact,
  DisclosureFallbackFact,
  IntentClassifiedFact,
  RephraseDetectedFact,
  SettingsOpenedFact,
  TaskInstanceAssignedFact,
  TurnSteeredFact,
  TurnStopRequestedFact,
} from './source-facts-boundary.js'
import type {
  FeatureOpportunityFact,
  FeatureUsedFact,
  FirstVisibleFeedbackFact,
  GuestTurnAggregateFact,
  LiveStatusLifecycleFact,
  LiveStatusOpportunityFact,
  McpAvailabilityFact,
  ProviderRequestCompletedFact,
  RateLimitBlockedFact,
  UnconfiguredReplyFact,
} from './source-facts-derived.js'
import type {
  ConfirmationRequestedFact,
  ConfirmationResolvedFact,
  LlmCompletedFact,
  LlmFailedFact,
  LlmStartedFact,
  ToolCompletedFact,
  ToolStartedFact,
} from './source-facts-execution.js'
import type {
  AuthCheckedFact,
  ChatMessageAcceptedFact,
  ReplySentFact,
  TurnCompletedFact,
  TurnStartedFact,
} from './source-facts-message.js'

export type {
  AuthCheckedFact,
  ChatMessageAcceptedFact,
  ReplySentFact,
  TurnCompletedFact,
  TurnStartedFact,
} from './source-facts-message.js'
export type {
  ConfirmationRequestedFact,
  ConfirmationResolvedFact,
  LlmCompletedFact,
  LlmFailedFact,
  LlmStartedFact,
  ToolCompletedFact,
  ToolStartedFact,
} from './source-facts-execution.js'
export type {
  ClarificationAbandonedFact,
  ClarificationRequestedFact,
  ConfigLinkIssuedFact,
  DisclosureFallbackFact,
  IntentClassifiedFact,
  RephraseDetectedFact,
  SettingsOpenedFact,
  TaskInstanceAssignedFact,
  TurnSteeredFact,
  TurnStopRequestedFact,
} from './source-facts-boundary.js'
export type {
  FeatureOpportunityFact,
  FeatureUsedFact,
  FirstVisibleFeedbackFact,
  GuestTurnAggregateFact,
  LiveStatusLifecycleFact,
  LiveStatusOpportunityFact,
  McpAvailabilityFact,
  ProviderRequestCompletedFact,
  RateLimitBlockedFact,
  UnconfiguredReplyFact,
} from './source-facts-derived.js'

export type AnalyticsSourceContext = Readonly<{
  platform: 'telegram' | 'mattermost' | 'discord' | 'kontur-talk'
  platformInstanceId: string
  chatUserId: string | null
  nativeContextId: string
  storageContextId: string
  configContextId: string
  contextType: 'dm' | 'group'
  actorRole: 'admin' | 'member' | 'guest' | 'system'
  taskInstanceId: string | null
  taskProvider: 'kaneo' | 'youtrack' | 'none' | 'other'
  invocationMode: 'normal' | 'command' | 'settings' | 'proactive' | 'scheduler'
  rawTurnId: string | null
}>

export type FactBase = Readonly<{
  version: 1
  sourceEventId: string
  occurredAtMs: number
  source: AnalyticsSourceContext
}>

export type AnalyticsSourceFact =
  | ChatMessageAcceptedFact
  | AuthCheckedFact
  | TurnStartedFact
  | TurnCompletedFact
  | ReplySentFact
  | LlmStartedFact
  | LlmCompletedFact
  | LlmFailedFact
  | ToolStartedFact
  | ToolCompletedFact
  | ConfirmationRequestedFact
  | ConfirmationResolvedFact
  | TurnSteeredFact
  | TurnStopRequestedFact
  | ClarificationRequestedFact
  | RephraseDetectedFact
  | ClarificationAbandonedFact
  | DisclosureFallbackFact
  | ConfigLinkIssuedFact
  | SettingsOpenedFact
  | TaskInstanceAssignedFact
  | IntentClassifiedFact
  | FeatureOpportunityFact
  | FeatureUsedFact
  | FirstVisibleFeedbackFact
  | LiveStatusOpportunityFact
  | LiveStatusLifecycleFact
  | ProviderRequestCompletedFact
  | RateLimitBlockedFact
  | UnconfiguredReplyFact
  | McpAvailabilityFact
  | GuestTurnAggregateFact
