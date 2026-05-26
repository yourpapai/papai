// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const jsonResponse = (body: unknown, ...args: [] | [ResponseInit]): Response => {
  if (args.length === 0) {
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  }
  const init = args[0]
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
}
