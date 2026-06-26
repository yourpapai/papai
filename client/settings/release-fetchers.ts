// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  GroupReleaseSubscriptionResponseSchema,
  ReleaseSubscriptionResponseSchema,
  type GroupReleaseSubscriptionResponse,
  type ReleaseSubscriptionResponse,
} from './fetcher-schemas-release.js'
import { ctxQuery, getJson, writeJson } from './fetchers.js'

export const fetchReleaseSubscription = (): Promise<ReleaseSubscriptionResponse> =>
  getJson('/settings/api/release-subscription', (b) => ReleaseSubscriptionResponseSchema.parse(b))

export const patchReleaseSubscription = (input: { enabled: boolean }): Promise<unknown> =>
  writeJson('/settings/api/release-subscription', 'PATCH', input, (b) => b)

export const fetchGroupReleaseSubscription = (contextId: string): Promise<GroupReleaseSubscriptionResponse> =>
  getJson(`/settings/api/group/release-subscription?${ctxQuery(contextId)}`, (b) =>
    GroupReleaseSubscriptionResponseSchema.parse(b),
  )

export const patchGroupReleaseSubscription = (input: { enabled: boolean; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/release-subscription', 'PATCH', input, (b) => b)
