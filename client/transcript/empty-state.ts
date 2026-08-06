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
 * Every status returns copy. With no events the page is otherwise a single status pill on empty
 * space, and a pill has no room to say what happens next — the banner states the condition, this
 * states the consequence.
 *
 * No status offers an action. `invalid-token` has no in-app recovery (links are minted by magi
 * and posted into chat by the bot), and `error` already reconnects by itself, so a retry control
 * would claim credit for work the browser is doing.
 */
const COPY: Record<ViewerStatus, EmptyStateCopy> = {
  connecting: { title: 'Loading the transcript…' },
  live: { title: 'Session is running', hint: 'No output yet.' },
  finished: { title: 'This session produced no output' },
  'recording-disabled': {
    title: 'Live output only',
    hint: 'Nothing is retained for this session. Output appears as it happens and is gone on reload.',
  },
  'invalid-token': {
    title: 'This link is no longer valid',
    hint: 'Transcript links expire when the session ends or the link is revoked. Ask the bot for a new link in your chat.',
  },
  error: {
    title: 'Connection lost',
    hint: 'Reconnecting automatically — the page will fill in on its own.',
  },
}

export function emptyStateFor(status: ViewerStatus): EmptyStateCopy {
  return COPY[status]
}
