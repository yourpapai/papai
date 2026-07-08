// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TrustedModule } from '../../ports/module.js'
import { operatorAllowlistPort, type WhoMayUse } from '../../ports/operator-allowlist.js'
import { resolveCodingGuardrails } from './credentials/guardrails.js'

/** Who-may-use resolver for coding sessions: the platform-instance guardrail policy's allowlist. */
export const codingWhoMayUseResolver = (platformInstanceId: string): WhoMayUse =>
  resolveCodingGuardrails(platformInstanceId).whoMayUse

/**
 * The coding trusted module. On activation it registers the operator allowlist resolver so the
 * orchestrator can gate coding-session tools without importing the coding feature. (It owns no
 * tables yet — `coding-credentials`/`coding-repos` relocation is a later phase.)
 */
export const codingModule: TrustedModule = {
  id: 'coding',
  onActivate(): void {
    operatorAllowlistPort.register(codingWhoMayUseResolver)
  },
}
