// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Whether a live terminal owns stdin — the TUI/line render-mode input. */
export function stdinIsInteractive(input: NodeJS.ReadStream | { readonly isTTY?: boolean } = process.stdin): boolean {
  return input.isTTY === true
}
