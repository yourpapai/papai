// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Puts an upper bound on work that has none of its own.
 *
 * The bound is on **waiting**, not on the work: nothing here can cancel an
 * in-flight HTTP request, and pretending otherwise would be worse than saying
 * so. What it buys is which failure happens. A model turn that never returns
 * used to run until the Actions job timeout, and a job killed by its own timeout
 * posts nothing — no failure comment, no state block — so the issue is left in
 * whatever phase it started in, with no record that anything went wrong. Failing
 * here instead means the orchestrator gets an error it can report, on an issue
 * whose next `/retry` will land somewhere sensible.
 *
 * A non-positive budget disables the bound. That is for a caller with nothing to
 * bound, not an operator escape hatch: `AGENT_TIMEOUT_MS` is range-checked to at
 * least a second, so config never produces one.
 */
export const withDeadline = async <T>(
  work: Promise<T>,
  timeoutMs: number,
  describe: (elapsedMs: number) => Error,
): Promise<T> => {
  if (timeoutMs <= 0) return work

  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(describe(timeoutMs))
    }, timeoutMs)
  })

  try {
    return await Promise.race([work, expiry])
  } finally {
    // Not optional. An uncleared timer holds the event loop open, and this
    // process is meant to exit the moment the pipeline is done — the same
    // reason the OpenCode server and the provider proxy are closed explicitly.
    clearTimeout(timer)
  }
}
