// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DigestRecord } from '../legacy-fold.js'

const MIDDLE_DOT = '·'

/** One-line round digest (legacy renderer copy — the only format the review materializer needs). */
export function formatDigestBody(record: DigestRecord): string {
  const { blocker, material, nitpick } = record.counts
  return `${blocker}b ${material}m ${nitpick}n ${MIDDLE_DOT} ${record.resolved} resolved ${MIDDLE_DOT} ${record.dismissed} dismissed ${MIDDLE_DOT} ${record.verdict}`
}
