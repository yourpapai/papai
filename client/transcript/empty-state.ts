// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ViewerStatus } from './transcript.svelte.js'

export interface EmptyStateCopy {
  title: string
  hint?: string
}

/**
 * Copy for a transcript with zero events, per status.
 *
 * `null` means render nothing: for these three statuses the banner already states the
 * whole situation, and a second block beneath it would only dilute the message.
 */
const COPY: Record<ViewerStatus, EmptyStateCopy | null> = {
  connecting: { title: 'Loading the transcript…' },
  live: { title: 'Session is running', hint: 'No output yet.' },
  finished: { title: 'This session produced no output' },
  'recording-disabled': null,
  'invalid-token': null,
  error: null,
}

export function emptyStateFor(status: ViewerStatus): EmptyStateCopy | null {
  return COPY[status]
}
