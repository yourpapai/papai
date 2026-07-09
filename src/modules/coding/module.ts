// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { migration061CodingSessionCredentials } from '../../db/migrations/061_coding_session_credentials.js'
import { migration064CodingSessionRepos } from '../../db/migrations/064_coding_session_repos.js'
import { migration066CodingReposEgress } from '../../db/migrations/066_coding_repos_egress.js'
import type { TrustedModule } from '../../ports/module.js'
import { operatorAllowlistPort, type WhoMayUse } from '../../ports/operator-allowlist.js'
import { resolveCodingGuardrails } from './credentials/guardrails.js'

/** Who-may-use resolver for coding sessions: the platform-instance guardrail policy's allowlist. */
export const codingWhoMayUseResolver = (platformInstanceId: string): WhoMayUse =>
  resolveCodingGuardrails(platformInstanceId).whoMayUse

/**
 * The coding trusted module. It owns the coding-session DB tables via `migrations` (run by the
 * composition root's loadTrustedModules → applyModuleMigrations after core initDb), and on
 * activation registers the operator allowlist resolver so the orchestrator can gate
 * coding-session tools without importing the coding feature. (`065_coding_identity` stays in
 * core — it alters the core-owned `authorized_groups` table.)
 */
export const codingModule: TrustedModule = {
  id: 'coding',
  migrations: [migration061CodingSessionCredentials, migration064CodingSessionRepos, migration066CodingReposEgress],
  onActivate(): void {
    operatorAllowlistPort.register(codingWhoMayUseResolver)
  },
}
