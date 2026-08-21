// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readEvents } from './events.js'
import { emptyRunFold, foldRunView } from './run-view.js'

/**
 * Disposable-view restore (4.7): a TUI mount holds no state the run needs —
 * after an unmount (crash, detach, re-attach) the fold is rebuilt from
 * `events.ndjson` alone, including a pending gate's presentation state.
 */
export function restoreRunFold(logPath: string): ReturnType<typeof emptyRunFold> {
  let bag = emptyRunFold()
  for (const event of readEvents(logPath)) bag = foldRunView(bag, event)
  return bag
}
