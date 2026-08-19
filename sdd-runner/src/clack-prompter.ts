// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Prompter } from './gate-session.js'

/**
 * The slice of `@clack/prompts` the adapter uses — kept as an interface so
 * tests can drive the adapter with a scripted implementation (mocked
 * `@clack/prompts`) instead of a live TTY.
 */
export interface ClackAdapter {
  readonly confirm: (opts: { readonly message: string }) => Promise<boolean>
  readonly text: (opts: { readonly message: string }) => Promise<string | symbol | null>
  readonly select: (opts: {
    readonly message: string
    readonly options: readonly { readonly value: string; readonly label?: string }[]
  }) => Promise<string | symbol | null>
  readonly spinner: () => { start: () => void; stop: (code?: number) => void }
  readonly say: (line: string) => void
}

const CANCEL: unique symbol = Symbol('clack-cancel')

function isCancel(value: unknown): boolean {
  return typeof value === 'symbol'
}

/**
 * `clackPrompter()` adapts `@clack/prompts` (confirm / select / text /
 * spinner) to the two-method `Prompter` interface the gate session depends
 * on. clack's cancel symbol maps to `null` — the existing abandon signal —
 * so the session's abandon handling is untouched (D7).
 */
export function clackPrompter(adapter: ClackAdapter): Prompter {
  return {
    say: (line: string): void => {
      adapter.say(line)
    },
    ask: (prompt: string): Promise<string | null> =>
      adapter.text({ message: prompt }).then((answer) => {
        if (answer === null || isCancel(answer)) return null
        return String(answer).trim()
      }),
  }
}

export { CANCEL }
