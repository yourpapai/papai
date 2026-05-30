// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpHandler } from 'msw'

import { adminHandlers, billingHandlers, instancesHandlers, pluginConfigHandlers, statsHandlers } from './handlers.js'

export const scenarios = {
  'admin-populated': [
    ...adminHandlers.populated,
    ...billingHandlers.populated,
    ...statsHandlers.populated,
    ...pluginConfigHandlers.populated,
    ...instancesHandlers.populated,
  ],
  'admin-empty': [
    ...adminHandlers.empty,
    ...billingHandlers.empty,
    ...statsHandlers.empty,
    ...pluginConfigHandlers.empty,
    ...instancesHandlers.empty,
  ],
  'admin-error': [
    ...adminHandlers.error,
    ...billingHandlers.error,
    ...statsHandlers.error,
    ...pluginConfigHandlers.error,
    ...instancesHandlers.error,
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
} satisfies Record<string, readonly HttpHandler[]>

export type ScenarioName = keyof typeof scenarios
