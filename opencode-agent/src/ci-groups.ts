// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import process from 'node:process'

/**
 * GitHub Actions' `::group::` workflow commands, in the one module that may
 * spell them.
 *
 * A `::group::<headline>` line folds everything up to the matching
 * `::endgroup::` into a collapsible section in the Actions log viewer — which
 * is how a twenty-minute implement phase stops being one wall of tool lines.
 * The runner interprets the command only when it arrives as a **raw** stdout
 * line: routed through the NDJSON logger it would be quoted into a JSON string
 * and printed literally, so this module takes its own sink and defaults to
 * stdout, and nothing else in the pipeline may write the command syntax.
 */

export interface CiGroups {
  /** Opens a collapsible section named for the phase that is starting. */
  startGroup: (headline: string) => void
  /** Closes the current section. */
  endGroup: () => void
}

/** Creates the pair. The sink is a seam for tests; the default is raw stdout. */
export const createCiGroups = (
  sink: (line: string) => void = (line): void => {
    process.stdout.write(line)
  },
): CiGroups => ({
  startGroup: (headline): void => {
    sink(`::group::${headline}\n`)
  },
  endGroup: (): void => {
    sink('::endgroup::\n')
  },
})
