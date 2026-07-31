// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FactBase } from './source-facts.js'

export type TurnSteeredFact = FactBase &
  Readonly<{
    type: 'turn_steered'
    ordinal: number
    steerLengthChars: number
    ackSent: boolean
  }>

export type EditClassifiedFact = FactBase &
  Readonly<{
    type: 'edit_classified'
    window: string
  }>

export type EditRegenFact = FactBase &
  Readonly<{
    type: 'edit_regen'
    phase: string
    durationMs?: number
  }>

export type TurnStopRequestedFact = FactBase &
  Readonly<{
    type: 'turn_stop_requested'
    stage: string
  }>

export type ClarificationRequestedFact = FactBase &
  Readonly<{
    type: 'clarification_requested'
    reason: string
  }>

export type RephraseDetectedFact = FactBase &
  Readonly<{
    type: 'rephrase_detected'
    detector: string
    similarity: string
    priorOutcome: string
    gap: string
  }>

export type ClarificationAbandonedFact = FactBase &
  Readonly<{
    type: 'clarification_abandoned'
    observationHours: number
  }>

export type DisclosureFallbackFact = FactBase &
  Readonly<{
    type: 'disclosure_fallback'
    reason: string
    stepCount: number
  }>

export type ConfigLinkIssuedFact = FactBase &
  Readonly<{
    type: 'config_link_issued'
    result: string
  }>

export type SettingsOpenedFact = FactBase &
  Readonly<{
    type: 'settings_opened'
    entry: string
    result: string
  }>

export type TaskInstanceAssignedFact = FactBase &
  Readonly<{
    type: 'task_instance_assigned'
    change: string
    fromProvider: string
    toProvider: string
  }>

export type IntentClassifiedFact = FactBase &
  Readonly<{
    type: 'intent_classified'
    taxonomy: string
    primary: string
    goals: readonly string[]
    confidence: string
    strategy: string
    abstained: boolean
  }>
