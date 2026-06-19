// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Detached control over an ephemeral status message: edit it in place or delete it. */
export type StatusHandle = {
  /** Edit the status message in place. Best-effort; never throws. */
  update: (text: string) => Promise<void>
  /** Delete the status message. Best-effort; never throws. */
  dismiss: () => Promise<void>
}
