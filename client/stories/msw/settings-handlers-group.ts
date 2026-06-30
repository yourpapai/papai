// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

export interface HandlerFamily {
  populated: HttpHandler[]
  empty: HttpHandler[]
  error: HttpHandler[]
  loading: HttpHandler[]
}

// --- Group members (GET /settings/api/group/members) ---
// Schema: GroupMembersResponseSchema = { contextId: string, members: Array<{ user_id, added_by, added_at }> }

const groupMembersPopulated = {
  contextId: 'ctx-group-1',
  members: [
    { user_id: 'u1', added_by: 'admin', added_at: '2026-05-01T00:00:00Z' },
    { user_id: 'u2', added_by: 'u1', added_at: '2026-05-02T00:00:00Z' },
  ],
}

const groupMembersEmpty = {
  contextId: 'ctx-group-1',
  members: [],
}

export const groupMembersHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/group/members', () => HttpResponse.json(groupMembersPopulated))],
  empty: [http.get('/settings/api/group/members', () => HttpResponse.json(groupMembersEmpty))],
  error: [http.get('/settings/api/group/members', boom)],
  loading: [
    http.get('/settings/api/group/members', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(groupMembersEmpty)
    }),
  ],
}

// --- Guest mode (GET /settings/api/group/guest-mode) ---
// Schema: GroupGuestModeResponseSchema = { contextId: string, enabled: boolean }

const guestModePopulated = {
  contextId: 'ctx-group-1',
  enabled: true,
}

const guestModeEmpty = {
  contextId: 'ctx-group-1',
  enabled: false,
}

export const guestModeHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/group/guest-mode', () => HttpResponse.json(guestModePopulated))],
  empty: [http.get('/settings/api/group/guest-mode', () => HttpResponse.json(guestModeEmpty))],
  error: [http.get('/settings/api/group/guest-mode', boom)],
  loading: [
    http.get('/settings/api/group/guest-mode', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(guestModeEmpty)
    }),
  ],
}

// --- Group provider / task-instance (GET /settings/api/group/task-instance) ---
// Schema: GroupTaskInstanceResponseSchema = { contextId, taskInstanceId: string|null, available: Array<{id,type,status}>, canProvision: boolean }

const groupProviderPopulated = {
  contextId: 'ctx-group-1',
  taskInstanceId: 'inst_abc',
  available: [{ id: 'inst_abc', type: 'kaneo', status: 'active' }],
  canProvision: false,
}

const groupProviderEmpty = {
  contextId: 'ctx-group-1',
  taskInstanceId: null,
  available: [],
  canProvision: false,
}

export const groupProviderHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/group/task-instance', () => HttpResponse.json(groupProviderPopulated))],
  empty: [http.get('/settings/api/group/task-instance', () => HttpResponse.json(groupProviderEmpty))],
  error: [http.get('/settings/api/group/task-instance', boom)],
  loading: [
    http.get('/settings/api/group/task-instance', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(groupProviderEmpty)
    }),
  ],
}

// --- Coding identity (GET /settings/api/group/coding-identity + /settings/api/group/members) ---
// Schema: GroupCodingIdentityResponseSchema = { contextId: string, identity: string }
// CodingIdentitySection fetches both coding-identity and members in parallel.

const codingIdentityPopulated = {
  contextId: 'ctx-group-1',
  identity: 'alice',
}

const codingIdentityEmpty = {
  contextId: 'ctx-group-1',
  identity: '',
}

export const codingIdentityHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/group/coding-identity', () => HttpResponse.json(codingIdentityPopulated)),
    http.get('/settings/api/group/members', () => HttpResponse.json(groupMembersPopulated)),
  ],
  empty: [
    http.get('/settings/api/group/coding-identity', () => HttpResponse.json(codingIdentityEmpty)),
    http.get('/settings/api/group/members', () => HttpResponse.json(groupMembersEmpty)),
  ],
  error: [http.get('/settings/api/group/coding-identity', boom)],
  loading: [
    http.get('/settings/api/group/coding-identity', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingIdentityEmpty)
    }),
  ],
}

// --- Group release subscription (GET /settings/api/group/release-subscription) ---
// Schema: GroupReleaseSubscriptionResponseSchema = { contextId: string, enabled: boolean }

export const groupReleaseHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/group/release-subscription', () =>
      HttpResponse.json({ contextId: 'ctx-group-1', enabled: true }),
    ),
  ],
  empty: [
    http.get('/settings/api/group/release-subscription', () =>
      HttpResponse.json({ contextId: 'ctx-group-1', enabled: false }),
    ),
  ],
  error: [http.get('/settings/api/group/release-subscription', boom)],
  loading: [
    http.get('/settings/api/group/release-subscription', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ contextId: 'ctx-group-1', enabled: false })
    }),
  ],
}
