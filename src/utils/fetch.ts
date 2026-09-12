// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

declare global {
  interface RequestInit {
    // Mirrors BunFetchRequestInit.timeout as typed by bun-types 1.4: a number
    // sets the socket idle deadline in ms, false (or 0) disables the idle
    // timer, true uses the default.
    timeout?: number | boolean
  }
}

export const fetchWithoutTimeout: typeof fetch = (input, init) => fetch(input, { ...init, timeout: false })
fetchWithoutTimeout.preconnect = fetch.preconnect
