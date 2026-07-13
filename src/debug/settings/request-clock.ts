// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const requestTimes = new WeakMap<Request, number>()

export function setSettingsRequestNowMs(request: Request, nowMs: number | undefined): void {
  if (nowMs === undefined) requestTimes.delete(request)
  else requestTimes.set(request, nowMs)
}

export function settingsRequestNowMs(request: Request): number {
  return requestTimes.get(request) ?? Date.now()
}
