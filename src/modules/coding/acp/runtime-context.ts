// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getPluginAdminConfig, kvDelete, kvGet, kvList, kvSet } from '../../../plugins/store.js'
import {
  configContextOf,
  resolveAgent,
  resolveAgentSecrets,
  resolveForge,
  resolveForgeToken,
  resolveMcp,
  resolveMcpToken,
  resolveModel,
  resolveProviderHost,
} from '../credentials/resolve-agent-secrets.js'
import { getRepoByName, listRepos } from '../repos/store.js'
import type { RuntimeContext } from './tools.js'

/**
 * kv/admin-config namespace. Deliberately the legacy `'acp'` string (NOT the module id `'coding'`):
 * plugin_kv/plugin_admin_config rows are keyed by this id, and existing session records + the
 * operator's magi config were written under `'acp'`. Keeping it preserves those rows across the
 * plugin→module migration.
 */
const ACP_NAMESPACE = 'acp'

/**
 * Build the RuntimeContext facade the acp tool factories expect, from the per-call identity.
 * Mirrors the old plugin loader's wiring exactly:
 *  - kv + repos are scoped to the GROUP config context (`configContextOf`), so a group's session
 *    records and repo catalogue are shared across its threads;
 *  - the credential resolvers receive the RAW `storageContextId` + `chatUserId` and derive their
 *    own identity context internally;
 *  - `storageContextId` handed to tool bodies (and used as magi's `contextId`) stays the raw
 *    thread-scoped id, so async milestone notifications target the originating thread.
 */
export function buildRuntimeContext(storageContextId: string, chatUserId: string): RuntimeContext {
  const cfgCtx = configContextOf(storageContextId)
  return {
    storageContextId,
    adminConfig: { get: (key: string): string | undefined => getPluginAdminConfig(ACP_NAMESPACE, key) },
    kv: {
      get: (key: string): string | undefined => kvGet(ACP_NAMESPACE, cfgCtx, key),
      set: (key: string, value: string): void => {
        kvSet(ACP_NAMESPACE, cfgCtx, key, value)
      },
      delete: (key: string): void => {
        kvDelete(ACP_NAMESPACE, cfgCtx, key)
      },
      list: (prefix?: string): Array<{ key: string; value: string }> =>
        (prefix === undefined ? kvList(ACP_NAMESPACE, cfgCtx) : kvList(ACP_NAMESPACE, cfgCtx, prefix)).map(
          (row): { key: string; value: string } => ({ key: row.key, value: row.value }),
        ),
    },
    codingSecrets: {
      resolve: (): Record<string, string> | null => resolveAgentSecrets(storageContextId, chatUserId),
      resolveForgeToken: (): string | null => resolveForgeToken(storageContextId, chatUserId),
      resolveAgent: (): string | null => resolveAgent(storageContextId, chatUserId),
      resolveForge: () => resolveForge(storageContextId, chatUserId),
      resolveProviderHost: (): string | null => resolveProviderHost(storageContextId, chatUserId),
      resolveModel: (): string | null => resolveModel(storageContextId, chatUserId),
      resolveMcp: () => resolveMcp(storageContextId, chatUserId),
      resolveMcpToken: (): string | undefined => resolveMcpToken(storageContextId, chatUserId),
    },
    codingRepos: {
      list: () => listRepos(cfgCtx),
      get: (name: string) => getRepoByName(cfgCtx, name),
    },
  }
}
