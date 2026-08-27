// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { kernelSetup } from '../../kernel/machine.js'

export const start = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'intake',
      guard: { type: 'isStage', params: { stage: 'intake' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const intake = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'draft',
      guard: { type: 'isStage', params: { stage: 'draft' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const draft = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'review',
      guard: { type: 'isStage', params: { stage: 'review' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const review = kernelSetup.createStateConfig({
  on: {
    'stage.enter': [
      {
        target: 'review',
        guard: { type: 'isStage', params: { stage: 'review' } },
        actions: ['closeThenActivate'],
      },
      {
        target: 'decompose',
        guard: { type: 'isStage', params: { stage: 'decompose' } },
        actions: ['closeThenActivate'],
      },
    ],
  },
})

export const decompose = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'atomicity',
      guard: { type: 'isStage', params: { stage: 'atomicity' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const atomicity = kernelSetup.createStateConfig({
  on: {
    'stage.enter': {
      target: 'gate',
      guard: { type: 'isStage', params: { stage: 'gate' } },
      actions: ['closeThenActivate'],
    },
  },
})

export const gate = kernelSetup.createStateConfig({
  on: {
    'gate.answered': { target: 'completed', guard: 'allStagesDone', actions: ['answerGate'] },
  },
})

export const completed = kernelSetup.createStateConfig({ type: 'final' })

export const aborted = kernelSetup.createStateConfig({ type: 'final' })
