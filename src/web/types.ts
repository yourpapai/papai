// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type WebFetchResult = {
  readonly url: string
  readonly title: string
  readonly summary: string
  readonly excerpt: string
  readonly truncated: boolean
  readonly contentType: string
  readonly source: 'cache' | 'fetch'
  readonly fetchedAt: number
}

export type RateLimitResult =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly remaining: 0; readonly retryAfterSec: number }

export type SafeFetchResponse = {
  readonly finalUrl: string
  readonly contentType: string
  readonly body: Uint8Array
}
