// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Detached control over an already-sent prompt message. Valid after the turn ends. */
export type PromptHandle = {
  /** Edit the prompt in place (used on timeout). */
  redact: (text: string) => Promise<void>
  /** Delete the prompt entirely (used after a decision). */
  remove: () => Promise<void>
}
