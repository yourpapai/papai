// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createInterface } from 'node:readline/promises'

/**
 * Inline session creation (D3): a title plus optional body become the task
 * text — the first line names the session through the heading-derived change
 * name. Streams are injectable so tests drive the prompt hermetically.
 */

/** A stream as the live seam sees it: tty flags plus the ref/resume handles readline never restores itself. */
export interface TtyPromptStream {
  readonly isTTY?: boolean
  isRaw?: boolean
  setRawMode?(mode: boolean): void
  ref(): void
  resume(): void
}

/**
 * Restore-at-the-seam (stdin-fix): Ink's unmount teardown leaves the tty
 * stdin unref'd (and possibly raw), while readline attaches with listeners
 * only — an unref'd stdin cannot hold the event loop, so the process exits
 * cleanly mid-prompt once transient handles settle. Re-ref + resume (and
 * clear raw mode) so the prompt stays servable; post-prompt exits are all
 * explicit `process.exit`, so the extra ref cannot hang completed actions.
 */
export function restoreStdinForPrompt(stream: TtyPromptStream): void {
  if (stream.isTTY !== true) return
  if (stream.isRaw === true && typeof stream.setRawMode === 'function') stream.setRawMode(false)
  stream.ref()
  stream.resume()
}

export async function runSessionCreate(deps: {
  readonly start: (options: { readonly taskText: string }) => Promise<{ readonly runId: string }>
  readonly stdout: (line: string) => void
  readonly input?: NodeJS.ReadableStream
  readonly output?: NodeJS.WritableStream
}): Promise<'started' | 'abandoned'> {
  if (deps.input === undefined) restoreStdinForPrompt(process.stdin)
  const rl = createInterface({
    input: deps.input ?? process.stdin,
    output: deps.output ?? process.stdout,
  })
  try {
    const title = (await rl.question('Session title: ')).trim()
    if (title === '') {
      deps.stdout('abandoned — a title is required')
      return 'abandoned'
    }
    const body = (await rl.question('Task description (optional, Enter to start): ')).trim()
    const taskText = body === '' ? `# ${title}\n` : `# ${title}\n\n${body}\n`
    const result = await deps.start({ taskText })
    deps.stdout(`started ${result.runId}`)
    return 'started'
  } finally {
    rl.close()
  }
}
