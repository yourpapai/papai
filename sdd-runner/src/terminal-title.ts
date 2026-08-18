// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Terminal title (D10): `\x1b]0;sdd <change> · <stage>\x07` on stage
 * transitions, TTY-only from the caller's side, best-effort restore — a
 * fixed default string when the prior title cannot be queried. Restoration
 * is attempted from clean exits and SIGINT/SIGTERM handlers registered by
 * the composition root; SIGKILL cannot be covered.
 */
export const TERMINAL_TITLE_RESTORE = '\x1b]0;\x07'

export function terminalTitleFor(changeName: string, stage: string): string {
  return `\x1b]0;sdd ${changeName} · ${stage}\x07`
}

export interface TerminalTitleHandle {
  readonly restore: () => void
}

/**
 * Register best-effort title restoration: `process.on('exit')` plus
 * SIGINT/SIGTERM handlers. Returns a handle whose `restore()` can be called
 * directly (used by tests and explicit teardown).
 */
export function registerTerminalTitle(write: (chunk: string) => void, defaultTitle: () => string): TerminalTitleHandle {
  const restore = (): void => {
    write(defaultTitle())
  }
  process.on('exit', restore)
  process.on('SIGINT', () => {
    restore()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    restore()
    process.exit(143)
  })
  return { restore }
}
