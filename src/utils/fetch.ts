// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

declare global {
  interface RequestInit {
    timeout?: number | false
  }
}

export const fetchWithoutTimeout: typeof fetch = (input, init) => fetch(input, { ...init, timeout: false })
fetchWithoutTimeout.preconnect = fetch.preconnect
