// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DashboardState } from './dashboard-types.js'

export const LOG_CAP = 65535

export const dashboard = $state<DashboardState>({
  connected: false,
  stats: { startedAt: Date.now(), totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
  sessions: new Map(),
  wizards: new Map(),
  scheduler: {},
  pollers: {},
  messageCache: {},
  llmTraces: [],
  logs: [],
  logScopes: new Set(),
  turns: [],
  notifications: [],
  toolFailures: [],
  recurringTasks: [],
  deferredPrompts: [],
  memos: [],
  identityMappings: new Map(),
  activeConfigEditors: new Set(),
  authorizedGroups: [],
  activeContext: 'all',
  activeLogFilter: {},
  billingWindow: '30d',
  billingSubjects: [],
  billingDetail: null,
  adminLlm: null,
  statsWindow: '30d',
  globalStats: null,
  subjectStats: null,
})
