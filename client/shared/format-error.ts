// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { FetchError } from './fetcher-helpers.js'

/**
 * Maps a thrown settings-API error to a short, plain-language message for the UI.
 * Validation-class statuses (400/409/422) keep the server's specific text; other
 * classes get a canned message. Non-FetchError throws are treated as connectivity
 * failures.
 */
export function formatFetchError(err: unknown): string {
  if (!(err instanceof FetchError)) {
    return "Couldn't reach the server. Check your connection and try again."
  }
  const { status } = err
  if (status === 401 || status === 403) {
    return 'Your settings link may have expired. Send /config to the bot for a new one.'
  }
  if (status === 404) return 'Not found — it may have been removed.'
  if (status === 400 || status === 409 || status === 422) return err.message
  if (status >= 500) return 'Something went wrong on the server. Try again shortly.'
  return err.message
}
