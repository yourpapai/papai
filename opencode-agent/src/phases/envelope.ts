// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createEnvelope } from '../prompts.js'
import type { UntrustedEnvelope } from '../prompts.js'
import type { AgentState } from '../types.js'

/**
 * Derives the untrusted-input nonce for a run.
 *
 * Derived rather than random so a phase cascade inside one job, and the tests
 * that assert on prompt text, both stay deterministic. It only has to be
 * unguessable to whoever wrote the issue text, and issue authors cannot see the
 * state block's revision counter before the prompt is built.
 */
export const envelopeFor = (state: AgentState): UntrustedEnvelope =>
  createEnvelope(`${state.issueId}-${state.revision}-${state.attempts}${state.ciAttempts}`)
