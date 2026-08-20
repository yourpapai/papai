// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** How often the tailer looks for new log bytes. ~250 ms: live enough, cheap enough. */
export const MIRROR_POLL_MS = 250

/** Every side effect the tailer performs; injected so the loop is unit-testable. */
export interface MirrorDeps {
  /** Current log size in bytes, or `null` when the file cannot be stat'd. */
  size: (path: string) => number | null
  /** Read a byte range of the log; only ever called with ranges `size` just vouched for. */
  read: (path: string, start: number, end: number) => string
  /** Mirror one chunk of new bytes (in production: `process.stderr.write`). */
  write: (chunk: string) => void
  /** Park until the next poll; in production a plain `setTimeout` sleep. */
  sleep: (ms: number) => Promise<void>
}

/**
 * Build a `read` dep that decodes the tail's byte ranges as one UTF-8 stream.
 *
 * `mirrorLogWhile` only ever requests contiguous, ever-advancing ranges, so the
 * decoder can hold a multi-byte character that a poll boundary split in half and
 * complete it on the next drain; decoding each range on its own would mirror
 * both halves as U+FFFD. A trailing incomplete sequence (a truncated log) is
 * held back rather than mirrored as U+FFFD.
 */
export const utf8TailRead = (
  readBytes: (path: string, start: number, end: number) => Uint8Array,
): MirrorDeps['read'] => {
  const decoder = new TextDecoder('utf-8')
  return (path, start, end): string => decoder.decode(readBytes(path, start, end), { stream: true })
}

/**
 * Mirror the bytes appended to `path` while `until` is pending, then drain once
 * more and stop. The invariants the wrapper relies on:
 *
 * - only bytes beyond the last mirrored offset are ever written, so nothing is
 *   duplicated even if a poll lands between two flushes of the child's stdio;
 * - a file that vanishes (or cannot be stat'd) is skipped for that poll, never
 *   thrown on — a tailer must not be able to kill the run it is watching;
 * - the tail ends with one final drain after `until` resolves, and the file is
 *   never touched again after this returns.
 *
 * The poll cycle is a self-scheduling step rather than a `while` + `await` loop:
 * the sequence IS the product here (one poll per interval, in order), and the
 * repo's `no-await-in-loop` policy exists precisely to keep such sequences
 * deliberate rather than accidental.
 */
export async function mirrorLogWhile(path: string, until: Promise<unknown>, deps: MirrorDeps): Promise<void> {
  let offset = 0

  const drain = (): void => {
    const size = deps.size(path)
    if (size === null || size <= offset) return
    deps.write(deps.read(path, offset, size))
    offset = size
  }

  const finished = until.then(
    (): boolean => true,
    (): boolean => true,
  )
  const pollAgain = async (): Promise<boolean> => {
    await deps.sleep(MIRROR_POLL_MS)
    return false
  }

  const step = async (): Promise<void> => {
    drain()
    // Race the poll sleep against the child exiting, so shutdown never waits
    // out a full poll interval on a fast exit.
    const done = await Promise.race([pollAgain(), finished])
    if (done) {
      drain()
      return
    }
    await step()
  }

  await step()
}
