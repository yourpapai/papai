// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpHandler } from 'msw'

import {
  billingHandlers,
  identityMappingsHandlers,
  instancesHandlers,
  pluginConfigHandlers,
  statsHandlers,
} from './handlers.js'
import {
  adminUsersHandlers,
  byokHandlers,
  kaneoHandlers,
  reposHandlers,
  shellReadyHandlers,
} from './settings-handlers.js'

export const scenarios = {
  'admin-populated': [
    ...billingHandlers.populated,
    ...statsHandlers.populated,
    ...pluginConfigHandlers.populated,
    ...instancesHandlers.populated,
    ...identityMappingsHandlers.populated,
  ],
  'admin-empty': [
    ...billingHandlers.empty,
    ...statsHandlers.empty,
    ...pluginConfigHandlers.empty,
    ...instancesHandlers.empty,
    ...identityMappingsHandlers.empty,
  ],
  'admin-error': [
    ...billingHandlers.error,
    ...statsHandlers.error,
    ...pluginConfigHandlers.error,
    ...instancesHandlers.error,
    ...identityMappingsHandlers.error,
  ],
  'billing-populated': [...billingHandlers.populated],
  'billing-empty': [...billingHandlers.empty],
  'billing-error': [...billingHandlers.error],
  'billing-loading': [...billingHandlers.loading],
  'stats-populated': [...statsHandlers.populated],
  'stats-empty': [...statsHandlers.empty],
  'stats-error': [...statsHandlers.error],
  'plugin-config-populated': [...pluginConfigHandlers.populated],
  'plugin-config-empty': [...pluginConfigHandlers.empty],
  'plugin-config-error': [...pluginConfigHandlers.error],
  'instances-populated': [...instancesHandlers.populated],
  'instances-empty': [...instancesHandlers.empty],
  'instances-error': [...instancesHandlers.error],
  'settings-repos-populated': [...reposHandlers.populated],
  'settings-repos-empty': [...reposHandlers.empty],
  'settings-repos-error': [...reposHandlers.error],
  'settings-repos-loading': [...reposHandlers.loading],
  'settings-byok-secret-set': [...byokHandlers.secretSet],
  'settings-byok-missing': [...byokHandlers.missing],
  'settings-byok-disabled': [...byokHandlers.disabled],
  'settings-byok-error': [...byokHandlers.error],
  'settings-byok-loading': [...byokHandlers.loading],
  'settings-kaneo-populated': [...kaneoHandlers.populated],
  'settings-kaneo-not-provisioned': [...kaneoHandlers.notProvisioned],
  'settings-kaneo-error': [...kaneoHandlers.error],
  'settings-kaneo-loading': [...kaneoHandlers.loading],
  'settings-admin-users-populated': [...adminUsersHandlers.populated],
  'settings-admin-users-empty': [...adminUsersHandlers.empty],
  'settings-admin-users-error': [...adminUsersHandlers.error],
  'settings-admin-users-loading': [...adminUsersHandlers.loading],
  'settings-shell-ready': [...shellReadyHandlers],
} satisfies Record<string, readonly HttpHandler[]>

export type ScenarioName = keyof typeof scenarios
