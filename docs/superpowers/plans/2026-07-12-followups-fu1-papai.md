<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai — FU1 (Transcript Stream-Drain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a connection leak in `proxyTranscriptStream` (`src/debug/transcript-viewer.ts`): when the upstream magi `/sessions/:id/stream` fetch returns a non-2xx response that still carries a body, the current code discards the `Response` without draining or cancelling `upstream.body`, leaking the underlying connection. Cancel it before returning the error `Response`.

**Architecture:** One-line fix inside the existing `if (!upstream.ok || upstream.body === null)` early-return branch of `proxyTranscriptStream`: call `void upstream.body?.cancel()` before constructing and returning the error `Response`. `upstream.body` is a `ReadableStream<Uint8Array> | null`; the optional-chained call is a no-op when it's `null` (the other half of that branch's condition), so no additional guard is needed. No new files, no signature changes, no behavior change to the success path (`:82-85`) or to `proxyTranscriptHistory` (out of scope — Component B only touches the stream proxy).

**Tech Stack:** Bun runtime, TypeScript, `bun:test` test runner. Test command: `bun test tests/debug/transcript-viewer.test.ts` from the papai repo root.

**Repo:** /Users/ki/Projects/yourpapai/papai

**Cross-repo note:** This is Component B of `docs/superpowers/specs/2026-07-12-followups-fu1-mcp-wire-alignment-design.md`. Component A (aligning nerv's MCP wire shape — `projectSpec.mcp` to a `McpUpstream[]` array + `mcpTokens` record) is a separate, independent fix in the `nerv` repo with its own plan. Neither component depends on the other; they may land in either order.

---

## File Structure

Modified:

- `src/debug/transcript-viewer.ts:79-81` — `proxyTranscriptStream`'s non-ok/early-return branch gains `void upstream.body?.cancel()` before the `return new Response(...)`.
- `tests/debug/transcript-viewer.test.ts` — new test in the `describe('proxyTranscriptStream', ...)` block asserting that a non-ok upstream response with a body has `.cancel()` called on it.

No new files.

---

### Task 1: Cancel the upstream body on the non-ok early return in `proxyTranscriptStream`

**Files:**

- Modify: `src/debug/transcript-viewer.ts:79-81`
- Test: `tests/debug/transcript-viewer.test.ts`

- [ ] **Step 1: Write the failing test**

  In `tests/debug/transcript-viewer.test.ts`, add the following test inside the existing `describe('proxyTranscriptStream', ...)` block (it sits alongside the existing `'passes through a magi 404'` and `'does not leak upstream Set-Cookie/X-Powered-By headers'` tests, using the same `cfg` constant already declared at the top of that block). This requires adding `mock` to the existing `bun:test` import on line 6.

  Change the import:

  ```ts
  import { describe, expect, mock, test } from 'bun:test'
  ```

  Add the test as the last test in the `describe('proxyTranscriptStream', ...)` block, right after the `'does not leak upstream Set-Cookie/X-Powered-By headers'` test:

  ```ts
  test('cancels the upstream body when the upstream response is non-ok', async () => {
    const clientSignal = new AbortController().signal
    const cancelSpy = mock((_reason?: unknown) => {})
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode('error body'))
      },
      cancel(reason): void {
        cancelSpy(reason)
      },
    })
    const fetchImpl = (): Promise<Response> => Promise.resolve(new Response(stream, { status: 500 }))

    const response = await proxyTranscriptStream('sess-42', cfg, clientSignal, fetchImpl)

    expect(response.status).toBe(500)
    expect(cancelSpy).toHaveBeenCalledTimes(1)
  })
  ```

  This constructs a `Response` whose body is a `ReadableStream` with a `cancel(reason)` callback on its underlying source — that callback fires exactly when something calls `.cancel()` on the stream (or on the `Response`/`Body` that wraps it), giving a spy-able signal without monkey-patching the stream instance. `status: 500` makes `upstream.ok` false, so the early-return branch under test is the one exercised.

- [ ] **Step 2: Run test to verify it fails**

  Run: `bun test tests/debug/transcript-viewer.test.ts -t "cancels the upstream body"`

  Expected: FAIL —

  ```
  error: expect(received).toHaveBeenCalledTimes(expected)

  Expected number of calls: 1
  Received number of calls: 0
  ```

  (The response status assertion passes; only the cancel-spy assertion fails, confirming the current code returns without draining the body.)

- [ ] **Step 3: Write minimal implementation**

  In `src/debug/transcript-viewer.ts`, change the `proxyTranscriptStream` early-return branch (currently lines 79-81):

  ```ts
  if (!upstream.ok || upstream.body === null) {
    return new Response('upstream stream unavailable', { status: upstream.ok ? 502 : upstream.status })
  }
  ```

  to:

  ```ts
  if (!upstream.ok || upstream.body === null) {
    void upstream.body?.cancel()
    return new Response('upstream stream unavailable', { status: upstream.ok ? 502 : upstream.status })
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `bun test tests/debug/transcript-viewer.test.ts`

  Expected: PASS —

  ```
  23 pass
  0 fail
  ```

  (22 pre-existing tests plus the new one; no regressions to `proxyTranscriptHistory`, `routeTranscriptPaths`, or the other `proxyTranscriptStream` cases, since the change only adds a call inside a branch none of the other tests reach without also being non-ok-with-body.)

- [ ] **Step 5: Commit**

  ```bash
  git add src/debug/transcript-viewer.ts tests/debug/transcript-viewer.test.ts
  git commit -m "fix(debug): cancel upstream transcript stream body on non-ok response"
  ```
