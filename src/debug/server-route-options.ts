// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type WebServerRouteOptions = Readonly<{
  debugEnabled: boolean
  mattermostActionSecretForTest?: string
  nowMs?: number
}>

export const DEFAULT_WEB_SERVER_ROUTE_OPTIONS = { debugEnabled: true } as const satisfies WebServerRouteOptions
