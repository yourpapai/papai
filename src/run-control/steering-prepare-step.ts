// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { RunControl } from './types.js'

/** Minimal shape of the AI SDK prepareStep argument we rely on. */
export type PrepareStepArg = { stepNumber: number; messages: ModelMessage[] } & Record<string, unknown>
export type PrepareStepResult = { messages?: ModelMessage[]; activeTools?: string[] }
export type PrepareStep = (arg: PrepareStepArg) => PrepareStepResult | undefined

/** Inject any queued steer messages as user turns at the next step boundary, then drain the queue. */
export function createSteeringPrepareStep(run: RunControl): PrepareStep {
  return ({ messages }) => {
    if (run.steerQueue.length === 0) return undefined
    const injected: ModelMessage[] = run.steerQueue.map((m) => ({ role: 'user', content: m.text }))
    run.steerQueue = []
    return { messages: [...messages, ...injected] }
  }
}

/**
 * Merge steering injection with an optional disclosure prepareStep into the single hook the SDK allows.
 * Steering owns `messages`; disclosure owns `activeTools`. The same arg is forwarded to disclosure
 * (it bases activeTools on stepNumber/steps, not on the injected messages).
 */
export function composePrepareSteps(steering: PrepareStep, disclosure: PrepareStep | undefined): PrepareStep {
  return (arg) => {
    const steerResult = steering(arg)
    const disclosureResult = disclosure?.(arg)
    const hasMessages = steerResult?.messages !== undefined
    const hasActiveTools = disclosureResult?.activeTools !== undefined
    if (!hasMessages && !hasActiveTools) return undefined
    const merged: PrepareStepResult = {}
    if (hasMessages) merged.messages = steerResult.messages
    if (hasActiveTools) merged.activeTools = disclosureResult.activeTools
    return merged
  }
}
