// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitUser } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import { DISCLOSURE_STALL_STEPS } from './core.js'
import type { DisclosureSession } from './registry.js'

const log = logger.child({ scope: 'disclosure:prepare-step' })

type PrepareStepArg = { stepNumber: number }
type PrepareStepResult = { activeTools?: string[] }

export function createDisclosurePrepareStep(
  session: DisclosureSession,
  contextId: string,
): (arg: PrepareStepArg) => PrepareStepResult {
  let fallbackEmitted = false
  return ({ stepNumber }) => {
    if (!session.hasLoaded() && stepNumber >= DISCLOSURE_STALL_STEPS) {
      if (!fallbackEmitted) {
        fallbackEmitted = true
        emitUser('disclosure:fallback', contextId, { stepNumber })
        log.warn({ contextId, stepNumber }, 'Disclosure stalled with no loads; opening all tools')
      }
      return {}
    }
    return { activeTools: session.activeToolNames() }
  }
}
