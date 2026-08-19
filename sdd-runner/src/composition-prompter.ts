// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clackPrompter } from './clack-prompter.js'
import type { ClackAdapter } from './clack-prompter.js'
import { readlinePrompter } from './gate-session.js'
import type { Prompter } from './gate-session.js'

/**
 * Composition-root prompter selection (D7): clack when interactive, with
 * the readline fallback for `SDD_NO_CLACK=1` or non-UTF8 terminals (the
 * check lives here, inside the seam). `collectGateDecision` and the session
 * walkthrough stay untouched behind the `Prompter` interface.
 */
export function makePrompterFor(
  interactive: boolean,
  env: Readonly<Record<string, string | undefined>>,
  io: { readonly input: NodeJS.ReadableStream; readonly output: NodeJS.WritableStream } = {
    input: process.stdin,
    output: process.stdout,
  },
): Prompter {
  if (interactive && env['SDD_NO_CLACK'] !== '1' && utf8Capable(env)) {
    return clackPrompter(clackAdapterOf())
  }
  return readlinePrompter({ input: io.input, output: io.output })
}

/** Test seam identifying which front-end a prompter instance drives. */
export function prompterKindOf(prompter: Prompter): 'clack' | 'readline' {
  return prompter.ask.toString().includes('adapter') ? 'clack' : 'readline'
}

function utf8Capable(env: Readonly<Record<string, string | undefined>>): boolean {
  const lang = env['LANG'] ?? env['LC_ALL'] ?? ''
  return lang.length === 0 || lang.includes('UTF-8') || lang.includes('utf8')
}

function clackAdapterOf(): ClackAdapter {
  return {
    confirm: async (opts): Promise<boolean> => {
      const clack = await import('@clack/prompts')
      const answer = await clack.confirm({ message: opts.message })
      return answer === true
    },
    text: async (opts) => {
      const clack = await import('@clack/prompts')
      return clack.text({ message: opts.message })
    },
    select: async (opts) => {
      const clack = await import('@clack/prompts')
      return clack.select({ message: opts.message, options: [...opts.options] })
    },
    spinner: () => {
      throw new Error('spinner requires the live @clack/prompts runtime')
    },
    say: (line: string): void => {
      process.stdout.write(`${line}\n`)
    },
  }
}
