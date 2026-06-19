// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MattermostApiFetch } from './file-helpers.js'

/** Error thrown by the Mattermost REST helper, carrying the HTTP status for classification. */
export class MattermostApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'MattermostApiError'
  }
}

/** Build an authenticated Mattermost REST fetch bound to one instance's baseUrl + bot token. */
export function makeMattermostApiFetch(baseUrl: string, token: string): MattermostApiFetch {
  return async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      throw new MattermostApiError(`Mattermost API ${method} ${path} failed: ${res.status}`, res.status)
    }
    return res.json() as Promise<unknown>
  }
}
