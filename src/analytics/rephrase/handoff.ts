// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Pseudonym } from '../controlled-types.js'
import type { RephraseCoverageLossReason, RephrasePairDetection } from '../intent/rephrase.js'
import {
  captureTextImpl,
  completeTurnImpl,
  createHandoffState,
  disposeImpl,
  inspectImpl,
  withdrawImpl,
} from './state.js'
import type {
  RephraseCaptureInput,
  RephraseInspection,
  RephraseStoreDeps,
  RephraseTerminalInput,
  RephraseWithdrawInput,
} from './state.js'

export type { RephraseCaptureInput, RephraseInspection, RephraseTerminalInput, RephraseWithdrawInput } from './state.js'

export interface RephraseHandoff {
  captureText(input: RephraseCaptureInput): void
  completeTurn(input: RephraseTerminalInput): void
  withdraw(input: RephraseWithdrawInput): void
}

export interface RephraseHandoffDeps {
  readonly nowMs: () => number
  readonly onPairDetected?: (pair: RephrasePairDetection) => void
  readonly onCoverageLoss?: (reason: RephraseCoverageLossReason) => void
}

export interface RephraseHandoffHandle {
  readonly handoff: RephraseHandoff
  readonly inspect: () => RephraseInspection
  readonly dispose: () => void
}

export type RephraseBoundaryKeys = Readonly<{
  actorKey: Pseudonym
  conversationKey: Pseudonym
  turnKey: Pseudonym
}>

export type RephraseBoundaryDeriverInput = Readonly<{
  storageContextId: string
  chatUserId: string
  rawTurnId: string
  actorRole: string
}>

export type RephraseBoundaryDeps = Readonly<{
  handoff: RephraseHandoff
  deriveKeys: (input: RephraseBoundaryDeriverInput) => RephraseBoundaryKeys | null
  noteTurnSource?: (turnKey: Pseudonym, rawTurnId: string) => void
  nowMs?: () => number
}>

export interface RephraseStore {
  captureText(input: RephraseCaptureInput): void
  completeTurn(input: RephraseTerminalInput): void
  withdraw(input: RephraseWithdrawInput): void
  inspect(): RephraseInspection
  dispose(): void
}

export const createRephraseStore = (deps: RephraseStoreDeps): RephraseStore => {
  const state = createHandoffState(deps)
  return {
    captureText: (input) => {
      captureTextImpl(state, input)
    },
    completeTurn: (input) => {
      completeTurnImpl(state, input)
    },
    withdraw: (input) => {
      withdrawImpl(state, input)
    },
    inspect: () => inspectImpl(state),
    dispose: () => {
      disposeImpl(state)
    },
  }
}

export const createRephraseHandoff = (deps: RephraseHandoffDeps): RephraseHandoffHandle => {
  const store = createRephraseStore({
    nowMs: deps.nowMs,
    onPairDetected: (pair) => {
      if (deps.onPairDetected !== undefined) {
        deps.onPairDetected(pair)
      }
    },
    onCoverageLoss: (reason) => {
      if (deps.onCoverageLoss !== undefined) {
        deps.onCoverageLoss(reason)
      }
    },
  })
  return {
    handoff: {
      captureText: (input) => {
        store.captureText(input)
      },
      completeTurn: (input) => {
        store.completeTurn(input)
      },
      withdraw: (input) => {
        store.withdraw(input)
      },
    },
    inspect: () => store.inspect(),
    dispose: () => {
      store.dispose()
    },
  }
}
