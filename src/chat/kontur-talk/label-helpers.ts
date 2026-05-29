// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type ApiFetchFn = (method: string, path: string, body: unknown) => Promise<unknown>

export function resolveKonturTalkUserLabel(_apiFetch: ApiFetchFn, userId: string): Promise<string | null> {
  if (userId.trim() === '') return Promise.resolve(null)
  return Promise.resolve(userId)
}

export function resolveKonturTalkGroupLabel(_apiFetch: ApiFetchFn, _groupId: string): Promise<string | null> {
  return Promise.resolve(null)
}
