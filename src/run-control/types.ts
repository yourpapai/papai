// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'

/** A side-effecting tool action that completed during a run. */
export type EffectRecord = { toolName: string }

/** A user message captured mid-run, to be injected at the next step boundary. */
export type InjectedMessage = { text: string }

/** Live control surface for a single in-flight LLM run, keyed by storageContextId. */
export type RunControl = {
  readonly contextId: string
  readonly turnId: string
  readonly reply: ReplyFn
  readonly abortController: AbortController
  steerQueue: InjectedMessage[]
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
