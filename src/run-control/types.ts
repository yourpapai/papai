// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Experimental_Steering } from 'ai'

import type { ReplyFn, ReplyTarget } from '../chat/types.js'

/** A side-effecting tool action that completed during a run. */
export type EffectRecord = { toolName: string }

/** A user message captured mid-run, replayed as a fresh turn when it never reached the model. */
export type InjectedMessage = { text: string }

/**
 * The steering surface a live run needs. The SDK's `Experimental_Steering` is
 * assignable, and a fake only has to implement these two methods.
 */
export type SteeringHandle = Pick<Experimental_Steering, 'steer' | 'queue'>

/**
 * One mid-run steer with its delivery verdict: `null` once the SDK reports the text
 * delivered, otherwise the message that must be replayed as a fresh turn.
 */
export type PendingSteerOutcome = {
  readonly text: string
  readonly outcome: Promise<InjectedMessage | null>
}

/** Live control surface for a single in-flight LLM run, keyed by storageContextId. */
export type RunControl = {
  readonly contextId: string
  readonly turnId: string
  readonly reply: ReplyFn
  readonly abortController: AbortController
  readonly originatingMessageIds: readonly string[]
  /**
   * Where the assistant's reply for this run should be posted. Starts `undefined`;
   * `sendLlmResponse` populates it from the adapter's `lastReplyTarget()` once the
   * reply posts, so later W2 edit classification can revise that message in place.
   */
  replyTarget: ReplyTarget | undefined
  /** Native AI SDK steering object; exactly one handle per `generateText` call. */
  readonly steering: SteeringHandle
  /**
   * Whether the handle was handed to the SDK. Its `steer()` promises settle only
   * from inside a started run, so an un-started handle must never be awaited.
   */
  steeringStarted: boolean
  /** Steers awaiting the SDK's delivery verdict. */
  pendingSteerOutcomes: PendingSteerOutcome[]
  /** Steer text the SDK reported as not delivered, kept for fresh-turn replay. */
  steerLeftovers: InjectedMessage[]
  /**
   * Steer text that must not be persisted: the W1 edit notice when `applyEditToHistory` already
   * rewrote the stored user turn, so persisting it would store the correction twice. Ordered, so
   * filtering the collected messages can remove one occurrence per entry. In-memory only and
   * thread-isolated by the run's `storageContextId`.
   */
  excludedSteerTexts: string[]
  /**
   * Interrupt requests made this run, counted at request time. Bounded by
   * `MAX_INTERRUPTS_PER_RUN`; a cancelled call is not a step but can still be
   * billed, so the bound keeps that cost predictable.
   */
  interruptsRequested: number
  stopRequested: boolean
  completedEffects: EffectRecord[]
}

/** Thrown by invokeModel when the user force-aborted the run. */
export class RunAbortedError extends Error {
  readonly effects: ReadonlyArray<EffectRecord>
  constructor(effects: ReadonlyArray<EffectRecord>) {
    super('Run force-aborted by user')
    this.name = 'RunAbortedError'
    this.effects = effects
  }
}
